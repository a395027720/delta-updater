var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var create_all_deltas_exports = {};
__export(create_all_deltas_exports, {
  createAllDeltas: () => createAllDeltas
});
module.exports = __toCommonJS(create_all_deltas_exports);
var import_path = __toESM(require("path"));
var import_fs_extra = __toESM(require("fs-extra"));
var import_clean = __toESM(require("semver/functions/clean"));
var import_delta_installer_builder = require("./delta-installer-builder");
var import_create_delta = require("./delta-installer-builder/create-delta");
var import_utils = require("./utils");
function preparePreviousReleases(previousReleases) {
  return previousReleases.map((release) => ({
    url: release.url,
    version: (0, import_clean.default)(release.version) || release.version,
    fileName: (0, import_utils.fileNameFromUrl)(release.url)
  }));
}
async function createAllDeltas(params) {
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
    latestVersion
  } = params;
  const dataDir = import_path.default.join(cacheDir, "data");
  const deltaDir = import_path.default.join(cacheDir, "deltas");
  import_fs_extra.default.ensureDirSync(cacheDir);
  import_fs_extra.default.ensureDirSync(dataDir);
  import_fs_extra.default.ensureDirSync(deltaDir);
  let allReleases = [];
  try {
    allReleases = await getPreviousReleases({ platform, target: "nsis" });
  } catch (e) {
    logger.error("Unable to fetch previous releases", e);
  }
  if (!allReleases.length) {
    logger.warn("No previous releases found");
    return null;
  }
  allReleases = allReleases.slice(0, 10);
  logger.log("Current release info ", {
    latestReleaseFilePath,
    latestVersion
  });
  const deltaInstallerBuilder = new import_delta_installer_builder.DeltaInstallerBuilder({
    PRODUCT_NAME: productName,
    PROCESS_NAME: processName
  });
  const previousReleases = preparePreviousReleases(allReleases);
  for (const { url, fileName } of previousReleases) {
    const filePath = import_path.default.join(dataDir, fileName);
    logger.log("Downloading file ", filePath, " from ", url);
    await (0, import_utils.downloadFileIfNotExists)(url, filePath);
  }
  for (const { fileName, version } of previousReleases) {
    const extractedDir = import_path.default.join(dataDir, version);
    const filePath = import_path.default.join(dataDir, fileName);
    if (!import_fs_extra.default.existsSync(import_path.default.join(extractedDir, `${processName}.exe`))) {
      import_fs_extra.default.ensureDirSync(extractedDir);
      import_fs_extra.default.emptyDirSync(extractedDir);
      await (0, import_utils.extract7zip)(filePath, extractedDir);
    }
  }
  const latestReleaseDir = import_path.default.join(dataDir, latestVersion);
  await (0, import_utils.extract7zip)(latestReleaseFilePath, latestReleaseDir);
  const outputDir = import_path.default.join(outDir, `${latestVersion}-${platform}-deltas`);
  import_fs_extra.default.ensureDirSync(latestReleaseDir);
  import_fs_extra.default.ensureDirSync(outputDir);
  import_fs_extra.default.emptyDirSync(outputDir);
  for (const { version } of previousReleases) {
    const deltaFileName = `${productName}-${version}-to-${latestVersion}.delta`;
    const deltaFilePath = import_path.default.join(deltaDir, deltaFileName);
    logger.log(`Creating delta for ${version}`);
    (0, import_create_delta.createDelta)(import_path.default.join(dataDir, version), latestReleaseDir, deltaFilePath);
    logger.log("Delta file created ", deltaFilePath);
  }
  const deltaJSON = {
    productName,
    latestVersion
  };
  for (const { version } of previousReleases) {
    const deltaFileName = `${productName}-${version}-to-${latestVersion}.delta`;
    const deltaFilePath = import_path.default.resolve(import_path.default.join(deltaDir, deltaFileName));
    const installerFileName = `${productName}-${version}-to-${latestVersion}-delta.exe`;
    const installerOutputPath = import_path.default.resolve(
      import_path.default.join(outputDir, installerFileName)
    );
    console.log(`Creating delta installer for ${version}`);
    await deltaInstallerBuilder.build({
      installerOutputPath,
      deltaFilePath,
      deltaFileName,
      productIconPath
    });
    await sign(installerOutputPath);
    logger.log("Delta installer created ", installerOutputPath);
    deltaJSON[version] = { path: installerFileName };
  }
  for (const { version } of previousReleases) {
    const installerFileName = `${productName}-${version}-to-${latestVersion}-delta.exe`;
    const installerOutputPath = import_path.default.join(outputDir, installerFileName);
    const sha256 = (0, import_utils.computeSHA256)(installerOutputPath);
    deltaJSON[version] = { ...deltaJSON[version], sha256 };
  }
  const deltaJSONPath = import_path.default.join(outputDir, `delta-${platform}.json`);
  import_fs_extra.default.writeFileSync(deltaJSONPath, JSON.stringify(deltaJSON, null, 2));
  return import_fs_extra.default.readdirSync(outputDir).map((fileName) => import_path.default.join(outputDir, fileName));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createAllDeltas
});
