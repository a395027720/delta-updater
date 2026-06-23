/**
 * 核心差量生成管道 — Windows only
 *
 * ============================================================
 * 流程 (由 hook.ts → build() → 此处 createAllDeltas 调用)
 * ============================================================
 *
 *   createAllDeltas()
 *     ├── 1. 获取历史版本列表 (scanReleases 结果)
 *     │      最多取 10 个历史版本
 *     │
 *     ├── 2. 下载历史安装器到缓存 (~/.electron-delta/data/)
 *     │      downloadFileIfNotExists: 缓存命中则跳过
 *     │
 *     ├── 3. 7z 解压所有安装器 (历史 + 当前)
 *     │      提取到 ~/.electron-delta/data/<version>/
 *     │      如果已解压过则跳过 (检查 processName.exe 是否存在)
 *     │
 *     ├── 4. hdiffz 生成 .delta 文件
 *     │      createDelta(oldDir, newDir, output)
 *     │      → ~/.electron-delta/deltas/xxx-1.0.15-to-1.0.16.delta
 *     │
 *     ├── 5. NSIS 打包为安装器
 *     │      DeltaInstallerBuilder.build()
 *     │      → out/<version>-win-deltas/xxx-1.0.15-to-1.0.16-delta.exe
 *     │
 *     ├── 6. 签名 (可选, sign 回调)
 *     │
 *     ├── 7. SHA256 校验 → 写入 delta-win.json
 *     │
 *     └── 返回产物文件列表
 *
 * ============================================================
 * delta-win.json 格式 (上传到更新服务器)
 * ============================================================
 *
 *   {
 *     "productName": "MyApp",
 *     "latestVersion": "1.0.16",
 *     "1.0.15": { "path": "MyApp-1.0.15-to-1.0.16-delta.exe", "sha256": "abc..." },
 *     "1.0.14": { "path": "MyApp-1.0.14-to-1.0.16-delta.exe", "sha256": "def..." }
 *   }
 *
 *   客户端以 app.getVersion() 为 key 查找匹配的差量补丁
 */

import path from "path";
import fs from "fs-extra";
import semverClean from "semver/functions/clean";
import { DeltaInstallerBuilder } from "./delta-installer-builder";
import { createDelta } from "./delta-installer-builder/create-delta";
import {
  downloadFileIfNotExists,
  extract7zip,
  computeSHA256,
  fileNameFromUrl,
} from "./utils";

interface Release {
  url: string;
  version: string;
}

interface CreateAllDeltasParams {
  platform: string;
  outDir: string;
  logger: any;
  cacheDir: string;
  target: string;
  getPreviousReleases: (opts?: any) => Promise<Release[]>;
  sign: (filePath: string) => Promise<void>;
  productIconPath: string;
  productName: string;
  processName: string;
  latestReleaseFilePath: string;
  latestReleaseFileName: string;
  latestVersion: string;
}

interface PreparedRelease {
  url: string;
  version: string;
  fileName: string;
}

/** 标准化版本号 (去除 v 前缀等) */
function preparePreviousReleases(
  previousReleases: Release[]
): PreparedRelease[] {
  return previousReleases.map((release) => ({
    url: release.url,
    version: semverClean(release.version) || release.version,
    fileName: fileNameFromUrl(release.url),
  }));
}

/**
 * 核心差量生成
 *
 * @param params.outDir              - electron-builder 输出目录 (项目根/out)
 * @param params.cacheDir            - 构建缓存 (~/.electron-delta)
 * @param params.latestReleaseFilePath - 本次全量安装器路径 (用于解压新版本)
 */
export async function createAllDeltas(
  params: CreateAllDeltasParams
): Promise<string[] | null> {
  const {
    platform,
    outDir,
    logger,
    cacheDir,
    getPreviousReleases,
    sign,
    productIconPath,
    productName,
    processName,
    latestReleaseFilePath,
    latestVersion,
  } = params;

  // -- 缓存目录准备 --
  const dataDir = path.join(cacheDir, "data");     // 安装器缓存 ~/.electron-delta/data/
  const deltaDir = path.join(cacheDir, "deltas");   // .delta 文件缓存 ~/.electron-delta/deltas/
  fs.ensureDirSync(cacheDir);
  fs.ensureDirSync(dataDir);
  fs.ensureDirSync(deltaDir);

  // ---- 1. 获取历史版本 ----
  let allReleases: Release[] = [];
  try {
    allReleases = await getPreviousReleases({ platform, target: "nsis" });
  } catch (e: any) {
    logger.error("Unable to fetch previous releases", e);
  }

  if (!allReleases.length) {
    logger.warn("No previous releases found");
    return null;
  }

  // 最多处理 10 个历史版本 (防止构建时间过长)
  allReleases = allReleases.slice(0, 10);

  logger.log("Current release info ", {
    latestReleaseFilePath,
    latestVersion,
  });

  const deltaInstallerBuilder = new DeltaInstallerBuilder({
    PRODUCT_NAME: productName,
    PROCESS_NAME: processName,
  });

  const previousReleases = preparePreviousReleases(allReleases);

  // ---- 2. 下载历史安装器到缓存 ----
  for (const { url, fileName } of previousReleases) {
    const filePath = path.join(dataDir, fileName);
    logger.log("Downloading file ", filePath, " from ", url);
    // downloadFileIfNotExists: 已缓存则跳过
    await downloadFileIfNotExists(url, filePath);
  }

  // ---- 3. 7z 解压历史安装器 ----
  // 提取到 ~/.electron-delta/data/<version>/
  for (const { fileName, version } of previousReleases) {
    const extractedDir = path.join(dataDir, version);
    const filePath = path.join(dataDir, fileName);
    // 如果已解压 (processName.exe 存在) 则跳过
    if (!fs.existsSync(path.join(extractedDir, `${processName}.exe`))) {
      fs.ensureDirSync(extractedDir);
      fs.emptyDirSync(extractedDir);
      await extract7zip(filePath, extractedDir);
    }
  }

  // ---- 3.5 解压最新版本安装器 ----
  const latestReleaseDir = path.join(dataDir, latestVersion);
  await extract7zip(latestReleaseFilePath, latestReleaseDir);

  // 产物输出目录: out/<version>-win-deltas/
  const outputDir = path.join(outDir, `${latestVersion}-${platform}-deltas`);

  fs.ensureDirSync(latestReleaseDir);
  fs.ensureDirSync(outputDir);
  fs.emptyDirSync(outputDir);

  // ---- 4. hdiffz 生成 .delta 文件 ----
  for (const { version } of previousReleases) {
    const deltaFileName = `${productName}-${version}-to-${latestVersion}.delta`;
    const deltaFilePath = path.join(deltaDir, deltaFileName);
    logger.log(`Creating delta for ${version}`);

    // 旧版本解压目录 vs 新版本解压目录 → 生成差分
    createDelta(path.join(dataDir, version), latestReleaseDir, deltaFilePath);
    logger.log("Delta file created ", deltaFilePath);
  }

  // delta-win.json 结构
  const deltaJSON: Record<string, any> = {
    productName,
    latestVersion,
  };

  // ---- 5. NSIS 打包每个差量 → .exe 安装器 ----
  for (const { version } of previousReleases) {
    const deltaFileName = `${productName}-${version}-to-${latestVersion}.delta`;
    const deltaFilePath = path.resolve(path.join(deltaDir, deltaFileName));
    const installerFileName = `${productName}-${version}-to-${latestVersion}-delta.exe`;
    const installerOutputPath = path.resolve(
      path.join(outputDir, installerFileName)
    );
    console.log(`Creating delta installer for ${version}`);
    await deltaInstallerBuilder.build({
      installerOutputPath,
      deltaFilePath,
      deltaFileName,
      productIconPath,
    });
    // ---- 6. 签名 ----
    await sign(installerOutputPath);

    logger.log("Delta installer created ", installerOutputPath);
    deltaJSON[version] = { path: installerFileName };
  }

  // ---- 7. SHA256 校验 & 写入索引 ----
  for (const { version } of previousReleases) {
    const installerFileName = `${productName}-${version}-to-${latestVersion}-delta.exe`;
    const installerOutputPath = path.join(outputDir, installerFileName);
    const sha256 = computeSHA256(installerOutputPath);
    deltaJSON[version] = { ...deltaJSON[version], sha256 };
  }

  // 写出 delta-win.json
  const deltaJSONPath = path.join(outputDir, `delta-${platform}.json`);
  fs.writeFileSync(deltaJSONPath, JSON.stringify(deltaJSON, null, 2));

  return fs
    .readdirSync(outputDir)
    .map((fileName) => path.join(outputDir, fileName));
}
