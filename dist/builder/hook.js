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
var hook_exports = {};
__export(hook_exports, {
  createHook: () => createHook,
  default: () => hook_default
});
module.exports = __toCommonJS(hook_exports);
var import_path = __toESM(require("path"));
var import_fs = __toESM(require("fs"));
var import_os = __toESM(require("os"));
var import_child_process = require("child_process");
var import_index = require("./index");
const DEFAULTS = {
  releasesDir: "delta-releases",
  productIconPath: "build/icons/icon.ico",
  cacheDir: import_path.default.join(import_os.default.homedir(), ".electron-delta"),
  nsisZipPath: "scripts/lib/nsis.zip",
  nsisBinsDir: import_path.default.join(process.env.APPDATA || import_path.default.join(import_os.default.homedir(), "AppData", "Roaming"), "electron-delta-bins"),
  nsisDownloadUrl: "https://github.com/electron-delta/nsis.zip/raw/main/nsis.zip"
};
const STEP = (msg) => console.log(`
\x1B[36m[delta] ${msg}\x1B[0m`);
const OK = (msg) => console.log(`\x1B[32m  \u2713\x1B[0m ${msg}`);
const WARN = (msg) => console.log(`\x1B[33m  \u26A0\x1B[0m ${msg}`);
const INFO = (msg) => console.log(`  \u2022 ${msg}`);
function extractVersion(fileName) {
  const match = fileName.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}
function defaultDetectEnvironment() {
  const npmScript = process.env.npm_lifecycle_event || "";
  if (npmScript.includes("prod")) return "prod";
  if (npmScript.includes("stage")) return "stage";
  if (npmScript.includes("test")) return "test";
  return null;
}
function matchEnvironment(fileName, env) {
  if (!env) return true;
  const baseName = import_path.default.basename(fileName, import_path.default.extname(fileName));
  if (env === "test") return baseName.endsWith("-test");
  if (env === "stage") return baseName.endsWith("-stage");
  if (env === "prod") return baseName.endsWith("-prod");
  return true;
}
function resolveConfig(userConfig) {
  return {
    releasesDir: (userConfig == null ? void 0 : userConfig.releasesDir) || process.env.DELTA_RELEASES_DIR || DEFAULTS.releasesDir,
    productIconPath: (userConfig == null ? void 0 : userConfig.productIconPath) || process.env.DELTA_PRODUCT_ICON || DEFAULTS.productIconPath,
    cacheDir: (userConfig == null ? void 0 : userConfig.cacheDir) || process.env.DELTA_CACHE_DIR || DEFAULTS.cacheDir,
    nsisZipPath: (userConfig == null ? void 0 : userConfig.nsisZipPath) || process.env.DELTA_NSIS_ZIP || DEFAULTS.nsisZipPath,
    nsisBinsDir: (userConfig == null ? void 0 : userConfig.nsisBinsDir) || process.env.DELTA_NSIS_BINS_DIR || DEFAULTS.nsisBinsDir,
    nsisDownloadUrl: (userConfig == null ? void 0 : userConfig.nsisDownloadUrl) || process.env.DELTA_NSIS_DOWNLOAD_URL || DEFAULTS.nsisDownloadUrl,
    sign: (userConfig == null ? void 0 : userConfig.sign) || (async () => {
    }),
    detectEnvironment: (userConfig == null ? void 0 : userConfig.detectEnvironment) || defaultDetectEnvironment
  };
}
function scanReleases(projectRoot, config) {
  const localDir = import_path.default.join(projectRoot, config.releasesDir);
  const env = config.detectEnvironment();
  const releases = [];
  if (!import_fs.default.existsSync(localDir)) {
    WARN(`${config.releasesDir}/ \u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7\u589E\u91CF\u5DEE\u5206`);
    return releases;
  }
  const allFiles = import_fs.default.readdirSync(localDir).filter((f) => f.endsWith(".exe") || f.endsWith(".7z"));
  if (allFiles.length === 0) {
    WARN(`${config.releasesDir}/ \u4E3A\u7A7A\uFF0C\u8DF3\u8FC7\u589E\u91CF\u5DEE\u5206`);
    return releases;
  }
  const files = allFiles.filter((f) => matchEnvironment(f, env));
  const skipped = allFiles.filter((f) => !matchEnvironment(f, env));
  if (files.length === 0) {
    WARN(`\u65E0\u5339\u914D ${env || "\u5F53\u524D"} \u73AF\u5883\u7684\u5386\u53F2\u7248\u672C\uFF0C\u8DF3\u8FC7\u589E\u91CF\u5DEE\u5206`);
    return releases;
  }
  STEP(`\u626B\u63CF\u5386\u53F2\u5B89\u88C5\u5668 (${config.releasesDir}/) [\u73AF\u5883: ${env || "\u672A\u77E5"}]:`);
  for (const file of files) {
    const version = extractVersion(file);
    if (version) {
      const fullPath = import_path.default.join(localDir, file);
      const sizeMB = (import_fs.default.statSync(fullPath).size / (1024 * 1024)).toFixed(1);
      INFO(`${file}  \u2192  \u7248\u672C ${version}  (${sizeMB} MB)`);
      releases.push({ version, url: import_path.default.basename(file) });
    } else {
      WARN(`\u65E0\u6CD5\u8BC6\u522B\u7248\u672C\u53F7\uFF0C\u8DF3\u8FC7: ${file}`);
    }
  }
  if (skipped.length > 0) {
    INFO(`\u5DF2\u8DF3\u8FC7 ${skipped.length} \u4E2A\u5176\u4ED6\u73AF\u5883\u7684\u5B89\u88C5\u5668`);
  }
  return releases;
}
function syncLocalReleasesToCache(projectRoot, config, previousReleases) {
  const dataDir = import_path.default.join(config.cacheDir, "data");
  const localDir = import_path.default.join(projectRoot, config.releasesDir);
  if (!import_fs.default.existsSync(localDir) || previousReleases.length === 0) return;
  import_fs.default.mkdirSync(dataDir, { recursive: true });
  let synced = 0;
  for (const release of previousReleases) {
    const fileName = import_path.default.basename(release.url);
    const cachePath = import_path.default.join(dataDir, fileName);
    const localPath = import_path.default.join(localDir, fileName);
    if (import_fs.default.existsSync(cachePath)) {
      INFO(`\u7F13\u5B58\u547D\u4E2D: ${fileName}`);
      continue;
    }
    if (import_fs.default.existsSync(localPath)) {
      import_fs.default.copyFileSync(localPath, cachePath);
      INFO(`\u540C\u6B65\u5230\u7F13\u5B58: ${fileName}`);
      synced++;
    }
  }
  if (synced > 0) OK(`${synced} \u4E2A\u6587\u4EF6\u5DF2\u540C\u6B65\u5230\u7F13\u5B58`);
}
function checkNSIS(projectRoot, config) {
  const makeNSISPath = import_path.default.join(config.nsisBinsDir, "nsis-3.0.5.0", "Bin", "makensis.exe");
  if (import_fs.default.existsSync(makeNSISPath)) return true;
  const bundledZip = import_path.default.join(__dirname, "..", "assets", "nsis.zip");
  const localZip = import_path.default.isAbsolute(config.nsisZipPath) ? config.nsisZipPath : import_path.default.join(projectRoot, config.nsisZipPath);
  const cachedZip = import_path.default.join(config.nsisBinsDir, "nsis.zip");
  let sourceZip = null;
  for (const candidate of [bundledZip, localZip, cachedZip]) {
    if (import_fs.default.existsSync(candidate)) {
      sourceZip = candidate;
      break;
    }
  }
  if (!sourceZip) {
    console.log("\n\x1B[31m  \u274C NSIS \u7F16\u8BD1\u5668\u672A\u627E\u5230\uFF01\x1B[0m");
    console.log("   builder \u9700\u8981 makensis.exe \u6765\u751F\u6210\u5DEE\u5206\u5B89\u88C5\u5668\n");
    console.log("   nsis.zip \u5DF2\u5185\u7F6E\u5728 @jake-gao/delta-updater \u5305\u4E2D\uFF0C\u4E0D\u5E94\u8BE5\u51FA\u73B0\u6B64\u9519\u8BEF\u3002");
    console.log("   \u5982\u9700\u81EA\u884C\u63D0\u4F9B\uFF0C\u53EF\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF DELTA_NSIS_ZIP \u6216 createHook({ nsisZipPath })");
    return false;
  }
  try {
    (0, import_child_process.execSync)(
      `powershell -command "Add-Type -A 'System.IO.Compression.FileSystem'; [System.IO.Compression.ZipFile]::OpenRead('${sourceZip}').Dispose()"`,
      { stdio: "pipe", timeout: 1e4 }
    );
  } catch {
    WARN("nsis.zip \u6587\u4EF6\u635F\u574F");
    if (sourceZip === cachedZip) import_fs.default.unlinkSync(cachedZip);
    return false;
  }
  const sourceLabel = sourceZip === bundledZip ? "\u5305\u5185\u7F6E" : "\u672C\u5730";
  INFO(`\u6B63\u5728\u89E3\u538B nsis.zip (${sourceLabel}) \u2192 ${config.nsisBinsDir} ...`);
  import_fs.default.mkdirSync(config.nsisBinsDir, { recursive: true });
  try {
    (0, import_child_process.execSync)(
      `powershell -command "Expand-Archive -Path '${sourceZip}' -DestinationPath '${config.nsisBinsDir}' -Force"`,
      { stdio: "inherit" }
    );
  } catch {
    WARN("NSIS \u89E3\u538B\u5931\u8D25");
    return false;
  }
  if (import_fs.default.existsSync(makeNSISPath)) {
    OK("NSIS \u89E3\u538B\u5B8C\u6210");
    return true;
  }
  WARN("NSIS \u89E3\u538B\u540E\u672A\u627E\u5230 makensis.exe");
  return false;
}
function archiveInstaller(projectRoot, config, latestVersion) {
  const outDir = import_path.default.join(projectRoot, "out");
  const prevDir = import_path.default.join(projectRoot, config.releasesDir);
  const env = config.detectEnvironment();
  if (!import_fs.default.existsSync(outDir)) return;
  const files = import_fs.default.readdirSync(outDir).filter(
    (f) => f.endsWith(".exe") && matchEnvironment(f, env) && extractVersion(f) === latestVersion
  );
  if (files.length === 0) return;
  import_fs.default.mkdirSync(prevDir, { recursive: true });
  for (const file of files) {
    const version = extractVersion(file);
    const existing = import_fs.default.readdirSync(prevDir).find((f) => f.includes(version) && matchEnvironment(f, env));
    if (existing) {
      import_fs.default.unlinkSync(import_path.default.join(prevDir, existing));
      INFO(`\u8986\u76D6\u65E7\u7248\u672C: ${existing}`);
    }
    const src = import_path.default.join(outDir, file);
    const dest = import_path.default.join(prevDir, file);
    import_fs.default.copyFileSync(src, dest);
    const sizeMB = (import_fs.default.statSync(dest).size / (1024 * 1024)).toFixed(1);
    OK(`\u5B89\u88C5\u5668\u5DF2\u5B58\u6863: ${config.releasesDir}/${file}  (${sizeMB} MB)`);
  }
  const staleFiles = import_fs.default.readdirSync(prevDir).filter(
    (f) => f.endsWith(".exe") && matchEnvironment(f, env) && extractVersion(f) !== latestVersion
  );
  for (const stale of staleFiles) {
    import_fs.default.unlinkSync(import_path.default.join(prevDir, stale));
    INFO(`\u6E05\u7406\u65E7\u7248\u672C: ${stale}`);
  }
}
function createHook(userConfig) {
  return async function(context) {
    var _a, _b, _c;
    const config = resolveConfig(userConfig);
    const projectRoot = process.env.INIT_CWD || process.cwd();
    const options = {
      productIconPath: import_path.default.isAbsolute(config.productIconPath) ? config.productIconPath : import_path.default.join(projectRoot, config.productIconPath),
      productName: context.configuration.productName,
      latestVersion: ((_a = context.configuration.extraMetadata) == null ? void 0 : _a.version) || ((_c = (_b = context.packager) == null ? void 0 : _b.appInfo) == null ? void 0 : _c.version) || "1.0.0",
      cache: config.cacheDir,
      sign: config.sign,
      getPreviousReleases: async () => scanReleases(projectRoot, config)
    };
    const env = config.detectEnvironment();
    console.log("\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
    console.log("\u2551   delta-updater \u589E\u91CF\u66F4\u65B0\u6784\u5EFA          \u2551");
    console.log("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
    STEP(`\u4EA7\u54C1: ${options.productName}  \u7248\u672C: ${options.latestVersion}  \u73AF\u5883: ${env || "\u672A\u77E5"}`);
    if (!checkNSIS(projectRoot, config)) {
      WARN("\u8DF3\u8FC7\u589E\u91CF\u5DEE\u5206\u6784\u5EFA\uFF08NSIS \u4E0D\u53EF\u7528\uFF09\uFF0C\u5168\u91CF\u5B89\u88C5\u5668\u4ECD\u4F1A\u6B63\u5E38\u751F\u6210");
      archiveInstaller(projectRoot, config, options.latestVersion);
      return [];
    }
    let previousReleases = await options.getPreviousReleases();
    previousReleases = previousReleases.filter(
      (r) => r.version !== options.latestVersion
    );
    options.getPreviousReleases = async () => previousReleases;
    if (previousReleases.length === 0) {
      INFO("\u9996\u6B21\u589E\u91CF\u6784\u5EFA\uFF0C\u65E0\u5386\u53F2\u7248\u672C\u53EF\u5BF9\u6BD4\uFF0C\u8DF3\u8FC7\u5DEE\u5206\u751F\u6210");
      INFO(`\u5B89\u88C5\u5668\u5DF2\u81EA\u52A8\u5B58\u6863\u5230 ${config.releasesDir}/\uFF0C\u4E0B\u6B21\u6784\u5EFA\u5C06\u57FA\u4E8E\u6B64\u751F\u6210\u5DEE\u5206`);
      archiveInstaller(projectRoot, config, options.latestVersion);
      return [];
    }
    INFO(`\u5171\u68C0\u6D4B\u5230 ${previousReleases.length} \u4E2A\u5386\u53F2\u7248\u672C\uFF0C\u5C06\u9010\u4E00\u751F\u6210\u5DEE\u5206\u8865\u4E01`);
    STEP("\u68C0\u67E5\u7F13\u5B58...");
    syncLocalReleasesToCache(projectRoot, config, previousReleases);
    STEP("\u5F00\u59CB\u751F\u6210\u589E\u91CF\u5DEE\u5206\u8865\u4E01...");
    const noop = () => {
    };
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      stdout: process.stdout.write,
      stderr: process.stderr.write
    };
    console.log = noop;
    console.info = noop;
    console.warn = noop;
    process.stdout.write = noop;
    process.stderr.write = noop;
    let deltaInstallerFiles;
    try {
      deltaInstallerFiles = await (0, import_index.build)({ context, options });
    } finally {
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      process.stdout.write = originals.stdout;
      process.stderr.write = originals.stderr;
    }
    if (deltaInstallerFiles && deltaInstallerFiles.length > 0) {
      OK(`\u5DEE\u5206\u8865\u4E01\u751F\u6210\u5B8C\u6210\uFF0C\u5171 ${deltaInstallerFiles.length} \u4E2A\u6587\u4EF6`);
    }
    archiveInstaller(projectRoot, config, options.latestVersion);
    return deltaInstallerFiles;
  };
}
var hook_default = createHook();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createHook
});
