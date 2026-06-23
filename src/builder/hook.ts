/**
 * electron-builder afterAllArtifactBuild hook
 *
 * ============================================================
 * 触发时机 & 整体流程
 * ============================================================
 *
 *  electron-builder 执行完所有打包任务后，调用此 hook
 *
 *    afterAllArtifactBuild
 *      ↓
 *    1. NSIS 检查 (makensis.exe)
 *       ├── 已在 %APPDATA%/electron-delta-bins/ 缓存 → 跳过
 *       ├── assets/nsis.zip 内置 → 解压到缓存目录
 *       └── 都没有 → 跳过差分生成，继续全量构建
 *      ↓
 *    2. 扫描历史安装器 (delta-releases/ 目录)
 *       ├── 根据环境 (test/stage/prod) 过滤文件名
 *       ├── 提取版本号 (正则 \d+\.\d+\.\d+)
 *       └── 过滤掉当前版本 (自己不能和自己比)
 *      ↓
 *    3. 同步到构建缓存 (~/.electron-delta/data/)
 *       └── 首次下载或从 delta-releases/ 拷贝
 *      ↓
 *    4. 生成差量补丁 (createAllDeltas)
 *       ├── 7z 解压新旧安装器 → 提取 exe
 *       ├── hdiffz 生成 .delta 差分文件
 *       ├── makensis 打包为 -delta.exe 安装器
 *       └── SHA256 校验 → 写入 delta-win.json
 *      ↓
 *    5. 存档当前安装器
 *       └── out/ → delta-releases/ (供下次构建使用)
 *       └── 清理同环境旧版本
 *
 * ============================================================
 * 目录结构
 * ============================================================
 *
 *   项目根/
 *   ├── delta-releases/              ← 历史安装器 (手动放入或自动存档)
 *   │   └── MyApp Setup 1.0.15-test.exe
 *   ├── out/                         ← electron-builder 输出
 *   │   ├── MyApp Setup 1.0.16-test.exe
 *   │   └── 1.0.16-win-deltas/       ← 差量产物
 *   │       ├── delta-win.json
 *   │       └── MyApp-1.0.15-to-1.0.16-delta.exe
 *   └── cmd/
 *       └── builder-test.json
 *
 *   全局缓存:
 *   ~/.electron-delta/
 *   ├── data/                        ← 下载/拷贝的安装器缓存
 *   └── deltas/                      ← .delta 文件缓存
 *
 *   %APPDATA%/electron-delta-bins/   ← NSIS 编译器 (makensis.exe)
 *   └── nsis-3.0.5.0/Bin/makensis.exe
 *
 * ============================================================
 * 环境检测
 * ============================================================
 *
 *   从 process.env.npm_lifecycle_event 推断:
 *     npm run build:test  → 只匹配 *-test.exe
 *     npm run build:stage → 只匹配 *-stage.exe
 *     npm run build:prod  → 只匹配 *-prod.exe
 *     无法识别            → 匹配所有 .exe
 *
 * ============================================================
 * 使用方式
 * ============================================================
 *
 *   零配置: "afterAllArtifactBuild": "@jake-gao/delta-updater/builder"
 *   自定义: "afterAllArtifactBuild": "./electron-delta.hook.js"
 *           module.exports = createHook({ releasesDir: "my-releases", ... })
 */

import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { build } from "./index";

// ============================================================
// Types
// ============================================================

export interface DeltaBuilderConfig {
  /**
   * 历史版本安装器存放目录（相对于项目根目录）
   * @default "delta-releases"
   * @env DELTA_RELEASES_DIR
   */
  releasesDir?: string;

  /**
   * 应用图标路径（相对于项目根目录）
   * @default "build/icons/icon.ico"
   * @env DELTA_PRODUCT_ICON
   */
  productIconPath?: string;

  /**
   * 构建缓存目录
   * @default "~/.electron-delta"
   * @env DELTA_CACHE_DIR
   */
  cacheDir?: string;

  /**
   * NSIS zip 本地路径（相对于项目根目录），用于离线环境预置 makensis
   * @default "scripts/lib/nsis.zip"
   * @env DELTA_NSIS_ZIP
   */
  nsisZipPath?: string;

  /**
   * NSIS 编译器缓存目录
   * @default "%APPDATA%/electron-delta-bins"
   * @env DELTA_NSIS_BINS_DIR
   */
  nsisBinsDir?: string;

  /**
   * NSIS zip 下载地址（在线环境自动下载）
   * @default "https://github.com/electron-delta/nsis.zip/raw/main/nsis.zip"
   * @env DELTA_NSIS_DOWNLOAD_URL
   */
  nsisDownloadUrl?: string;

  /**
   * 签名函数，对生成的差分安装器进行签名
   * @default async () => {}
   */
  sign?: (filePath: string) => Promise<void>;

  /**
   * 环境检测函数，自定义如何从 npm script 推断 test/stage/prod
   * @default 从 npm_lifecycle_event 自动检测
   */
  detectEnvironment?: () => string | null;
}

const DEFAULTS: Required<Omit<DeltaBuilderConfig, "sign" | "detectEnvironment">> = {
  releasesDir: "delta-releases",
  productIconPath: "build/icons/icon.ico",
  cacheDir: path.join(os.homedir(), ".electron-delta"),
  nsisZipPath: "scripts/lib/nsis.zip",
  nsisBinsDir: path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "electron-delta-bins"),
  nsisDownloadUrl: "https://github.com/electron-delta/nsis.zip/raw/main/nsis.zip",
};

// ============================================================
// Helpers
// ============================================================

const STEP = (msg: string) => console.log(`\n\x1b[36m[delta] ${msg}\x1b[0m`);
const OK = (msg: string) => console.log(`\x1b[32m  ✓\x1b[0m ${msg}`);
const WARN = (msg: string) => console.log(`\x1b[33m  ⚠\x1b[0m ${msg}`);
const INFO = (msg: string) => console.log(`  • ${msg}`);

/** 从文件名提取 semver 版本号, 例 "MyApp Setup 1.0.15-test.exe" → "1.0.15" */
function extractVersion(fileName: string): string | null {
  const match = fileName.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/** 默认环境检测: 从 npm_lifecycle_event 推断 test/stage/prod */
function defaultDetectEnvironment(): string | null {
  const npmScript = process.env.npm_lifecycle_event || "";
  if (npmScript.includes("prod")) return "prod";
  if (npmScript.includes("stage")) return "stage";
  if (npmScript.includes("test")) return "test";
  return null;
}

/** 根据环境过滤安装器文件名: test → *-test.exe, stage → *-stage.exe, null → 全部 */
function matchEnvironment(fileName: string, env: string | null): boolean {
  if (!env) return true;
  const baseName = path.basename(fileName, path.extname(fileName));
  if (env === "test") return baseName.endsWith("-test");
  if (env === "stage") return baseName.endsWith("-stage");
  if (env === "prod") return baseName.endsWith("-prod");
  return true;
}

// ============================================================
// Config resolution
// ============================================================

/** 合并用户配置 + 环境变量 + 默认值 (优先级: 用户 > 环境变量 > 默认) */
function resolveConfig(userConfig?: DeltaBuilderConfig): Required<Omit<DeltaBuilderConfig, "sign" | "detectEnvironment">> & { sign: (f: string) => Promise<void>; detectEnvironment: () => string | null } {
  return {
    releasesDir: userConfig?.releasesDir || process.env.DELTA_RELEASES_DIR || DEFAULTS.releasesDir,
    productIconPath: userConfig?.productIconPath || process.env.DELTA_PRODUCT_ICON || DEFAULTS.productIconPath,
    cacheDir: userConfig?.cacheDir || process.env.DELTA_CACHE_DIR || DEFAULTS.cacheDir,
    nsisZipPath: userConfig?.nsisZipPath || process.env.DELTA_NSIS_ZIP || DEFAULTS.nsisZipPath,
    nsisBinsDir: userConfig?.nsisBinsDir || process.env.DELTA_NSIS_BINS_DIR || DEFAULTS.nsisBinsDir,
    nsisDownloadUrl: userConfig?.nsisDownloadUrl || process.env.DELTA_NSIS_DOWNLOAD_URL || DEFAULTS.nsisDownloadUrl,
    sign: userConfig?.sign || (async () => {}),
    detectEnvironment: userConfig?.detectEnvironment || defaultDetectEnvironment,
  };
}

// ============================================================
// Scan
// ============================================================

interface ReleaseEntry {
  version: string;
  url: string;
}

/**
 * 扫描历史安装器目录 (delta-releases/)
 * - 按环境过滤文件
 * - 提取版本号
 * - 返回 { version, url (文件名) }
 */
function scanReleases(projectRoot: string, config: ReturnType<typeof resolveConfig>): ReleaseEntry[] {
  const localDir = path.join(projectRoot, config.releasesDir);
  const env = config.detectEnvironment();
  const releases: ReleaseEntry[] = [];

  if (!fs.existsSync(localDir)) {
    WARN(`${config.releasesDir}/ 目录不存在，跳过增量差分`);
    return releases;
  }

  const allFiles = fs.readdirSync(localDir).filter((f) => f.endsWith(".exe") || f.endsWith(".7z"));

  if (allFiles.length === 0) {
    WARN(`${config.releasesDir}/ 为空，跳过增量差分`);
    return releases;
  }

  const files = allFiles.filter((f) => matchEnvironment(f, env));
  const skipped = allFiles.filter((f) => !matchEnvironment(f, env));

  if (files.length === 0) {
    WARN(`无匹配 ${env || "当前"} 环境的历史版本，跳过增量差分`);
    return releases;
  }

  STEP(`扫描历史安装器 (${config.releasesDir}/) [环境: ${env || "未知"}]:`);
  for (const file of files) {
    const version = extractVersion(file);
    if (version) {
      const fullPath = path.join(localDir, file);
      const sizeMB = (fs.statSync(fullPath).size / (1024 * 1024)).toFixed(1);
      INFO(`${file}  →  版本 ${version}  (${sizeMB} MB)`);
      releases.push({ version, url: path.basename(file) });
    } else {
      WARN(`无法识别版本号，跳过: ${file}`);
    }
  }

  if (skipped.length > 0) {
    INFO(`已跳过 ${skipped.length} 个其他环境的安装器`);
  }

  return releases;
}

// ============================================================
// Cache sync
// ============================================================

/**
 * 将 delta-releases/ 中的安装器同步到构建缓存 (~/.electron-delta/data/)
 * 如果缓存中已有，跳过；否则从本地目录拷贝
 * 后续 createAllDeltas 会从缓存读取安装器
 */
function syncLocalReleasesToCache(
  projectRoot: string,
  config: ReturnType<typeof resolveConfig>,
  previousReleases: ReleaseEntry[]
): void {
  const dataDir = path.join(config.cacheDir, "data");
  const localDir = path.join(projectRoot, config.releasesDir);

  if (!fs.existsSync(localDir) || previousReleases.length === 0) return;

  fs.mkdirSync(dataDir, { recursive: true });
  let synced = 0;

  for (const release of previousReleases) {
    const fileName = path.basename(release.url);
    const cachePath = path.join(dataDir, fileName);
    const localPath = path.join(localDir, fileName);

    if (fs.existsSync(cachePath)) {
      INFO(`缓存命中: ${fileName}`);
      continue;
    }
    if (fs.existsSync(localPath)) {
      fs.copyFileSync(localPath, cachePath);
      INFO(`同步到缓存: ${fileName}`);
      synced++;
    }
  }

  if (synced > 0) OK(`${synced} 个文件已同步到缓存`);
}

// ============================================================
// NSIS check
// ============================================================

/**
 * 检查 NSIS 编译器 (makensis.exe) 是否可用
 *
 * 查找优先级:
 *   1. %APPDATA%/electron-delta-bins/nsis-3.0.5.0/Bin/makensis.exe (已缓存)
 *   2. dist/builder/assets/nsis.zip (包内置, 最优先的新来源)
 *   3. 用户指定的本地路径 (nsisZipPath)
 *   4. 缓存目录中的 nsis.zip
 *
 * 如果都不存在: 打印错误提示，返回 false → 跳过差量构建
 * 如果 zip 存在但未解压: 用 PowerShell 解压到缓存目录 → 返回 true
 */
function checkNSIS(projectRoot: string, config: ReturnType<typeof resolveConfig>): boolean {
  const makeNSISPath = path.join(config.nsisBinsDir, "nsis-3.0.5.0", "Bin", "makensis.exe");

  // Already cached from previous build
  if (fs.existsSync(makeNSISPath)) return true;

  // Try nsis.zip sources in priority order
  const bundledZip = path.join(__dirname, "..", "assets", "nsis.zip");   // 1. 包内置
  const localZip = path.isAbsolute(config.nsisZipPath) ? config.nsisZipPath : path.join(projectRoot, config.nsisZipPath); // 2. 用户提供
  const cachedZip = path.join(config.nsisBinsDir, "nsis.zip");            // 3. 上次下载缓存

  let sourceZip: string | null = null;
  for (const candidate of [bundledZip, localZip, cachedZip]) {
    if (fs.existsSync(candidate)) { sourceZip = candidate; break; }
  }

  if (!sourceZip) {
    console.log("\n\x1b[31m  ❌ NSIS 编译器未找到！\x1b[0m");
    console.log("   builder 需要 makensis.exe 来生成差分安装器\n");
    console.log("   nsis.zip 已内置在 @jake-gao/delta-updater 包中，不应该出现此错误。");
    console.log("   如需自行提供，可设置环境变量 DELTA_NSIS_ZIP 或 createHook({ nsisZipPath })");
    return false;
  }

  // Validate zip integrity
  try {
    execSync(
      `powershell -command "Add-Type -A 'System.IO.Compression.FileSystem'; [System.IO.Compression.ZipFile]::OpenRead('${sourceZip}').Dispose()"`,
      { stdio: "pipe", timeout: 10000 }
    );
  } catch {
    WARN("nsis.zip 文件损坏");
    if (sourceZip === cachedZip) fs.unlinkSync(cachedZip);
    return false;
  }

  // Extract to cache directory
  const sourceLabel = sourceZip === bundledZip ? "包内置" : "本地";
  INFO(`正在解压 nsis.zip (${sourceLabel}) → ${config.nsisBinsDir} ...`);
  fs.mkdirSync(config.nsisBinsDir, { recursive: true });
  try {
    execSync(
      `powershell -command "Expand-Archive -Path '${sourceZip}' -DestinationPath '${config.nsisBinsDir}' -Force"`,
      { stdio: "inherit" }
    );
  } catch {
    WARN("NSIS 解压失败");
    return false;
  }

  if (fs.existsSync(makeNSISPath)) {
    OK("NSIS 解压完成");
    return true;
  }
  WARN("NSIS 解压后未找到 makensis.exe");
  return false;
}

// ============================================================
// Archive
// ============================================================

/**
 * 将本次构建的安装器从 out/ 存档到 delta-releases/
 * 供下次构建作为"历史版本"生成差量补丁
 *
 * 同时清理同环境的旧版本 (仅保留当前版本)
 */
function archiveInstaller(
  projectRoot: string,
  config: ReturnType<typeof resolveConfig>,
  latestVersion: string
): void {
  const outDir = path.join(projectRoot, "out");
  const prevDir = path.join(projectRoot, config.releasesDir);
  const env = config.detectEnvironment();

  if (!fs.existsSync(outDir)) return;

  const files = fs.readdirSync(outDir).filter(
    (f) => f.endsWith(".exe") && matchEnvironment(f, env) && extractVersion(f) === latestVersion
  );
  if (files.length === 0) return;

  fs.mkdirSync(prevDir, { recursive: true });

  for (const file of files) {
    const version = extractVersion(file)!;
    const existing = fs.readdirSync(prevDir).find((f) => f.includes(version) && matchEnvironment(f, env));
    if (existing) {
      fs.unlinkSync(path.join(prevDir, existing));
      INFO(`覆盖旧版本: ${existing}`);
    }

    const src = path.join(outDir, file);
    const dest = path.join(prevDir, file);
    fs.copyFileSync(src, dest);
    const sizeMB = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
    OK(`安装器已存档: ${config.releasesDir}/${file}  (${sizeMB} MB)`);
  }

  // Keep only current version in same environment
  const staleFiles = fs.readdirSync(prevDir).filter(
    (f) => f.endsWith(".exe") && matchEnvironment(f, env) && extractVersion(f) !== latestVersion
  );
  for (const stale of staleFiles) {
    fs.unlinkSync(path.join(prevDir, stale));
    INFO(`清理旧版本: ${stale}`);
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * 创建自定义配置的 builder hook
 *
 * @example
 * // electron-delta.hook.js
 * const { createHook } = require("@jake-gao/delta-updater/builder");
 * module.exports = createHook({
 *   releasesDir: "my-releases",
 *   nsisZipPath: "tools/nsis.zip",
 * });
 */
export function createHook(userConfig?: DeltaBuilderConfig) {
  return async function (context: any): Promise<string[]> {
    const config = resolveConfig(userConfig);
    const projectRoot = process.env.INIT_CWD || process.cwd();

    const options: any = {
      productIconPath: path.isAbsolute(config.productIconPath)
        ? config.productIconPath
        : path.join(projectRoot, config.productIconPath),
      productName: context.configuration.productName,
      latestVersion:
        context.configuration.extraMetadata?.version ||
        context.packager?.appInfo?.version ||
        "1.0.0",
      cache: config.cacheDir,
      sign: config.sign,
      getPreviousReleases: async () => scanReleases(projectRoot, config),
    };

    const env = config.detectEnvironment();

    console.log("\n╔══════════════════════════════════════╗");
    console.log("║    delta-updater 增量更新构建        ║");
    console.log("╚══════════════════════════════════════╝");

    STEP(`产品: ${options.productName}  版本: ${options.latestVersion}  环境: ${env || "未知"}`);

    // ---- 0. NSIS 检查 ----
    if (!checkNSIS(projectRoot, config)) {
      WARN("跳过增量差分构建（NSIS 不可用），全量安装器仍会正常生成");
      archiveInstaller(projectRoot, config, options.latestVersion);
      return [];
    }

    // ---- 1. 扫描历史版本 ----
    let previousReleases = await options.getPreviousReleases();
    // 过滤掉当前版本 (自己不能和自己比)
    previousReleases = previousReleases.filter(
      (r: ReleaseEntry) => r.version !== options.latestVersion
    );
    options.getPreviousReleases = async () => previousReleases;

    if (previousReleases.length === 0) {
      INFO("首次增量构建，无历史版本可对比，跳过差分生成");
      INFO(`安装器已自动存档到 ${config.releasesDir}/，下次构建将基于此生成差分`);
      archiveInstaller(projectRoot, config, options.latestVersion);
      return [];
    }

    INFO(`共检测到 ${previousReleases.length} 个历史版本，将逐一生成差分补丁`);

    // ---- 2. 同步缓存 ----
    STEP("检查缓存...");
    syncLocalReleasesToCache(projectRoot, config, previousReleases);

    // ---- 3. 生成差量补丁 ----
    STEP("开始生成增量差分补丁...");
    // 静默构建过程中的底层日志 (hdiffz/makensis 输出大量信息)
    const noop = () => {};
    const originals = {
      log: console.log, info: console.info, warn: console.warn,
      stdout: process.stdout.write, stderr: process.stderr.write,
    };
    console.log = noop; console.info = noop; console.warn = noop;
    process.stdout.write = noop as any; process.stderr.write = noop as any;
    let deltaInstallerFiles: string[];
    try {
      deltaInstallerFiles = await build({ context, options });
    } finally {
      console.log = originals.log; console.info = originals.info;
      console.warn = originals.warn;
      process.stdout.write = originals.stdout; process.stderr.write = originals.stderr;
    }

    if (deltaInstallerFiles && deltaInstallerFiles.length > 0) {
      OK(`差分补丁生成完成，共 ${deltaInstallerFiles.length} 个文件`);
    }

    // ---- 4. 存档本次安装器 ----
    archiveInstaller(projectRoot, config, options.latestVersion);
    return deltaInstallerFiles;
  };
}

// ============================================================
// Default export (zero-config)
// ============================================================

/** 零配置导出: 在 builder 配置中直接引用包名即可 */
export default createHook();
