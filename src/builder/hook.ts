/**
 * electron-builder afterAllArtifactBuild hook
 *
 * 用法（零配置）：
 *   "afterAllArtifactBuild": "@jake-gao/delta-updater/builder"
 *
 * 自定义配置：
 *   "afterAllArtifactBuild": "./electron-delta.hook.js"
 *   // electron-delta.hook.js:
 *   const { createHook } = require("@jake-gao/delta-updater/builder");
 *   module.exports = createHook({ releasesDir: "my-releases" });
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

function extractVersion(fileName: string): string | null {
  const match = fileName.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function defaultDetectEnvironment(): string | null {
  const npmScript = process.env.npm_lifecycle_event || "";
  if (npmScript.includes("prod")) return "prod";
  if (npmScript.includes("stage")) return "stage";
  if (npmScript.includes("test")) return "test";
  return null;
}

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

  // Validate zip
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

  // Extract to cache
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

  // Keep only current version
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
    console.log("║   delta-updater 增量更新构建          ║");
    console.log("╚══════════════════════════════════════╝");

    STEP(`产品: ${options.productName}  版本: ${options.latestVersion}  环境: ${env || "未知"}`);

    // 0. NSIS
    if (!checkNSIS(projectRoot, config)) {
      WARN("跳过增量差分构建（NSIS 不可用），全量安装器仍会正常生成");
      archiveInstaller(projectRoot, config, options.latestVersion);
      return [];
    }

    // 1. Scan
    let previousReleases = await options.getPreviousReleases();
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

    // 2. Sync cache
    STEP("检查缓存...");
    syncLocalReleasesToCache(projectRoot, config, previousReleases);

    // 3. Build
    STEP("开始生成增量差分补丁...");
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

    archiveInstaller(projectRoot, config, options.latestVersion);
    return deltaInstallerFiles;
  };
}

// ============================================================
// Default export (zero-config)
// ============================================================

export default createHook();
