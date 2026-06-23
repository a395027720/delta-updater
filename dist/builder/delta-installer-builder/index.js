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
var delta_installer_builder_exports = {};
__export(delta_installer_builder_exports, {
  DeltaInstallerBuilder: () => DeltaInstallerBuilder
});
module.exports = __toCommonJS(delta_installer_builder_exports);
var import_fs_extra = __toESM(require("fs-extra"));
var import_path = __toESM(require("path"));
var import_utils = require("../utils");
const defaultOptions = {
  nsisURL: "https://github.com/electron-delta/nsis.zip/raw/main/nsis.zip"
};
class DeltaInstallerBuilder {
  constructor(options) {
    this.options = { ...defaultOptions, ...options };
    this.defines = {
      APP_GUID: this.options.APP_GUID || "",
      PRODUCT_NAME: this.options.PRODUCT_NAME,
      PROCESS_NAME: this.options.PROCESS_NAME || this.options.PRODUCT_NAME
    };
  }
  getNSISScriptPath() {
    return import_path.default.resolve(import_path.default.join(__dirname, "installer.nsi"));
  }
  async getNSISPath() {
    const deltaBinsDir = import_path.default.join(
      process.env.APPDATA,
      "electron-delta-bins"
    );
    const nsisRootPath = import_path.default.join(deltaBinsDir, "nsis-3.0.5.0");
    const makeNSISPath = import_path.default.join(
      nsisRootPath,
      "Bin",
      "makensis.exe"
    );
    if (import_fs_extra.default.existsSync(makeNSISPath)) {
      return { makeNSISPath, nsisRootPath };
    }
    await import_fs_extra.default.ensureDir(deltaBinsDir);
    const filePath = await (0, import_utils.downloadFile)(
      this.options.nsisURL,
      import_path.default.join(deltaBinsDir, "nsis.zip")
    );
    await (0, import_utils.extract7zip)(filePath, deltaBinsDir);
    return { makeNSISPath, nsisRootPath };
  }
  getNSISArgs() {
    const args = [];
    Object.keys(this.defines).forEach((key) => {
      args.push(`-D${key}=${this.defines[key]}`);
    });
    return args;
  }
  async executeNSIS() {
    const args = this.getNSISArgs();
    const { makeNSISPath, nsisRootPath } = await this.getNSISPath();
    args.push(this.installerNSIPath);
    try {
      await (0, import_utils.safeSpawn)(makeNSISPath, args, {
        cwd: import_path.default.dirname(this.installerNSIPath),
        env: { ...process.env, NSISDIR: nsisRootPath },
        stdio: "inherit"
      });
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }
  async build(params) {
    this.installerNSIPath = this.getNSISScriptPath();
    this.defines.INSTALLER_OUTPUT_PATH = params.installerOutputPath;
    this.defines.DELTA_FILE_PATH = params.deltaFilePath;
    this.defines.DELTA_FILE_NAME = params.deltaFileName;
    if (params.productIconPath) {
      this.defines.PRODUCT_ICON_PATH = params.productIconPath;
    }
    const created = await this.executeNSIS();
    if (!created) return null;
    return params.installerOutputPath;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DeltaInstallerBuilder
});
