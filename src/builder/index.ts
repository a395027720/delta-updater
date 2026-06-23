/**
 * Builder 主入口 — Windows only
 * 被 hook.ts 的 createHook 内部调用
 *
 * 遍历构建目标，找到 NSIS target，调用 createAllDeltas 生成差量补丁
 */
import path from "path";
import os from "os";
import { createAllDeltas } from "./create-all-deltas";
import { removeExt, fileNameFromUrl } from "./utils";

interface BuildContext {
  outDir: string;
  artifactPaths: string[];
  platformToTargets: Map<any, any>;
  configuration: any;
  packager?: any;
}

interface BuildOptions {
  logger?: any;
  sign?: (filePath: string) => Promise<void>;
  productIconPath?: string;
  productName: string;
  processName?: string;
  cache?: string;
  latestVersion?: string;
  getPreviousReleases: (opts?: any) => Promise<any[]>;
}

/** 从构建产物路径中找到 NSIS 安装器 */
function getLatestReleaseInfo(artifactPaths: string[], target: string) {
  const latestReleaseFilePath = artifactPaths.filter((d) => {
    if (target === "nsis" && !d.includes("nsis-web")) {
      return d.endsWith(".exe");
    }
    if (target === "nsis-web") {
      return d.endsWith(".7z");
    }
    return false;
  })[0];

  return {
    latestReleaseFilePath,
    latestReleaseFileName: removeExt(fileNameFromUrl(latestReleaseFilePath)),
  };
}

/**
 * 主构建函数
 * 遍历 platformToTargets → 找到 Windows → NSIS → 调用 createAllDeltas
 */
export async function build({
  context,
  options,
}: {
  context: BuildContext;
  options: BuildOptions;
}): Promise<string[]> {
  const { outDir, artifactPaths, platformToTargets } = context;
  const logger = options.logger || console;
  const sign = options.sign || (async () => {});
  const productIconPath = options.productIconPath || "";
  const productName = options.productName;
  const processName = options.processName || productName;
  const cacheDir =
    process.env.ELECTRON_DELTA_CACHE ||
    options.cache ||
    path.join(os.homedir(), ".electron-delta");
  const latestVersion =
    options.latestVersion || process.env.npm_package_version;
  const { getPreviousReleases } = options;
  const buildFiles: string[] = [];

  for (const platform of platformToTargets.keys()) {
    const platformName = platform.buildConfigurationKey;

    if (platformName === "win") {
      const targets = platformToTargets.get(platform);
      const target = targets.entries().next().value[0];

      const { latestReleaseFilePath, latestReleaseFileName } =
        getLatestReleaseInfo(artifactPaths, target);

      const files = await createAllDeltas({
        platform: platformName,
        outDir,
        logger,
        cacheDir,
        target,
        getPreviousReleases,
        sign,
        productIconPath,
        productName,
        processName,
        latestReleaseFilePath,
        latestReleaseFileName,
        latestVersion,
      });

      if (files && files.length) {
        buildFiles.push(...files);
      }
    }
  }

  return buildFiles;
}
