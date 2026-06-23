/**
 * Delta creation & NSIS packaging pipeline — Windows only
 * Vendored & trimmed from @electron-delta/builder
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

function preparePreviousReleases(
  previousReleases: Release[]
): PreparedRelease[] {
  return previousReleases.map((release) => ({
    url: release.url,
    version: semverClean(release.version) || release.version,
    fileName: fileNameFromUrl(release.url),
  }));
}

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

  const dataDir = path.join(cacheDir, "data");
  const deltaDir = path.join(cacheDir, "deltas");
  fs.ensureDirSync(cacheDir);
  fs.ensureDirSync(dataDir);
  fs.ensureDirSync(deltaDir);

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

  // Download all previous installers
  for (const { url, fileName } of previousReleases) {
    const filePath = path.join(dataDir, fileName);
    logger.log("Downloading file ", filePath, " from ", url);
    await downloadFileIfNotExists(url, filePath);
  }

  // Extract the installers
  for (const { fileName, version } of previousReleases) {
    const extractedDir = path.join(dataDir, version);
    const filePath = path.join(dataDir, fileName);
    if (!fs.existsSync(path.join(extractedDir, `${processName}.exe`))) {
      fs.ensureDirSync(extractedDir);
      fs.emptyDirSync(extractedDir);
      await extract7zip(filePath, extractedDir);
    }
  }

  const latestReleaseDir = path.join(dataDir, latestVersion);
  await extract7zip(latestReleaseFilePath, latestReleaseDir);
  const outputDir = path.join(outDir, `${latestVersion}-${platform}-deltas`);

  fs.ensureDirSync(latestReleaseDir);
  fs.ensureDirSync(outputDir);
  fs.emptyDirSync(outputDir);

  // Compute delta between versions
  for (const { version } of previousReleases) {
    const deltaFileName = `${productName}-${version}-to-${latestVersion}.delta`;
    const deltaFilePath = path.join(deltaDir, deltaFileName);
    logger.log(`Creating delta for ${version}`);

    createDelta(path.join(dataDir, version), latestReleaseDir, deltaFilePath);
    logger.log("Delta file created ", deltaFilePath);
  }

  const deltaJSON: Record<string, any> = {
    productName,
    latestVersion,
  };

  // Create NSIS installer for each delta
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
    await sign(installerOutputPath);

    logger.log("Delta installer created ", installerOutputPath);
    deltaJSON[version] = { path: installerFileName };
  }

  // SHA256 checksums
  for (const { version } of previousReleases) {
    const installerFileName = `${productName}-${version}-to-${latestVersion}-delta.exe`;
    const installerOutputPath = path.join(outputDir, installerFileName);
    const sha256 = computeSHA256(installerOutputPath);
    deltaJSON[version] = { ...deltaJSON[version], sha256 };
  }

  const deltaJSONPath = path.join(outputDir, `delta-${platform}.json`);
  fs.writeFileSync(deltaJSONPath, JSON.stringify(deltaJSON, null, 2));

  return fs
    .readdirSync(outputDir)
    .map((fileName) => path.join(outputDir, fileName));
}
