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
var utils_exports = {};
__export(utils_exports, {
  computeSHA256: () => computeSHA256,
  downloadFile: () => downloadFile,
  downloadFileIfNotExists: () => downloadFileIfNotExists,
  extract7zip: () => extract7zip,
  fileNameFromUrl: () => fileNameFromUrl,
  removeExt: () => removeExt,
  safeSpawn: () => safeSpawn
});
module.exports = __toCommonJS(utils_exports);
var import_path = __toESM(require("path"));
var import_fs_extra = __toESM(require("fs-extra"));
var import_crypto = __toESM(require("crypto"));
var import_cross_fetch = __toESM(require("cross-fetch"));
var import_child_process = require("child_process");
const removeExt = (str) => str.replace(/\.[^/.]+$/, "");
const fileNameFromUrl = (url) => import_path.default.basename(url);
const computeSHA256 = (filePath) => {
  const fileBuffer = import_fs_extra.default.readFileSync(filePath);
  const sum = import_crypto.default.createHash("sha256");
  sum.update(fileBuffer);
  return sum.digest("hex");
};
const safeSpawn = (command, args, options) => {
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process.spawn)(command, args, options);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
  });
};
const downloadFile = async (url, dest) => {
  const response = await (0, import_cross_fetch.default)(url);
  const buffer = await response.arrayBuffer();
  import_fs_extra.default.ensureDirSync(import_path.default.dirname(dest));
  import_fs_extra.default.writeFileSync(dest, Buffer.from(buffer));
  return dest;
};
const downloadFileIfNotExists = async (url, dest) => {
  if (import_fs_extra.default.existsSync(dest)) return dest;
  return downloadFile(url, dest);
};
const extract7zip = (archivePath, dest) => {
  import_fs_extra.default.ensureDirSync(dest);
  const szaPath = process.env.SZA_PATH;
  try {
    if (szaPath && import_fs_extra.default.existsSync(szaPath)) {
      (0, import_child_process.execSync)(`"${szaPath}" x "${archivePath}" -o"${dest}" -y`, {
        stdio: "pipe",
        timeout: 3e5
      });
    } else {
      (0, import_child_process.execSync)(`7z x "${archivePath}" -o"${dest}" -y`, {
        stdio: "pipe",
        timeout: 3e5
      });
    }
  } catch {
    try {
      (0, import_child_process.execSync)(`7za x "${archivePath}" -o"${dest}" -y`, {
        stdio: "pipe",
        timeout: 3e5
      });
    } catch {
      throw new Error(
        `7z not found. Install 7-Zip or set SZA_PATH.
Tried to extract: ${archivePath}`
      );
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  computeSHA256,
  downloadFile,
  downloadFileIfNotExists,
  extract7zip,
  fileNameFromUrl,
  removeExt,
  safeSpawn
});
