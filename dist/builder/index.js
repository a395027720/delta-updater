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
var builder_exports = {};
__export(builder_exports, {
  build: () => build
});
module.exports = __toCommonJS(builder_exports);
var import_path = __toESM(require("path"));
var import_os = __toESM(require("os"));
var import_create_all_deltas = require("./create-all-deltas");
var import_utils = require("./utils");
function getLatestReleaseInfo(artifactPaths, target) {
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
    latestReleaseFileName: (0, import_utils.removeExt)((0, import_utils.fileNameFromUrl)(latestReleaseFilePath))
  };
}
async function build({
  context,
  options
}) {
  const { outDir, artifactPaths, platformToTargets } = context;
  const logger = options.logger || console;
  const sign = options.sign || (async () => {
  });
  const productIconPath = options.productIconPath || "";
  const productName = options.productName;
  const processName = options.processName || productName;
  const cacheDir = process.env.ELECTRON_DELTA_CACHE || options.cache || import_path.default.join(import_os.default.homedir(), ".electron-delta");
  const latestVersion = options.latestVersion || process.env.npm_package_version;
  const { getPreviousReleases } = options;
  const buildFiles = [];
  for (const platform of platformToTargets.keys()) {
    const platformName = platform.buildConfigurationKey;
    if (platformName === "win") {
      const targets = platformToTargets.get(platform);
      const target = targets.entries().next().value[0];
      const { latestReleaseFilePath, latestReleaseFileName } = getLatestReleaseInfo(artifactPaths, target);
      const files = await (0, import_create_all_deltas.createAllDeltas)({
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
        latestVersion
      });
      if (files && files.length) {
        buildFiles.push(...files);
      }
    }
  }
  return buildFiles;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  build
});
