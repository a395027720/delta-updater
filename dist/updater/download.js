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
var download_exports = {};
__export(download_exports, {
  downloadFile: () => downloadFile,
  niceBytes: () => niceBytes
});
module.exports = __toCommonJS(download_exports);
var import_fs_extra = __toESM(require("fs-extra"));
var import_https = __toESM(require("https"));
var import_http = __toESM(require("http"));
const units = ["bytes", "KB", "MB", "GB", "TB", "PB"];
function niceBytes(x) {
  let l = 0;
  let n = parseInt(x, 10) || 0;
  while (n >= 1024 && ++l) {
    n /= 1024;
  }
  return `${n.toFixed(n < 10 && l > 0 ? 1 : 0)} ${units[l]}`;
}
function downloadFile(url, filePath, onProgressCb) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let totalLen = "0 MB";
    let transferred = 0;
    const httpOrHttps = url.startsWith("https") ? import_https.default : import_http.default;
    const request = httpOrHttps.get(url, (response) => {
      if (response.statusCode === 200) {
        const file = import_fs_extra.default.createWriteStream(filePath);
        file.on("error", (err) => {
          request.destroy();
          reject(err);
        });
        response.on("data", (chunk) => {
          transferred += chunk.length;
          const percentage = parseFloat(transferred * 100 / total).toFixed(2);
          if (onProgressCb && typeof onProgressCb === "function") {
            onProgressCb({
              transferred: niceBytes(transferred),
              percentage,
              total: totalLen
            });
          }
        });
        response.on("end", () => {
          file.end();
        });
        response.on("error", (err) => {
          file.destroy();
          import_fs_extra.default.unlink(filePath, () => reject(err));
        });
        response.pipe(file).once("finish", () => {
          resolve();
        });
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, filePath, onProgressCb).then(() => resolve());
      } else {
        reject(new Error(`Network error ${response.statusCode}`));
      }
    });
    request.on("response", (res) => {
      total = parseInt(res.headers["content-length"], 10);
      totalLen = niceBytes(total);
    });
    request.on("error", (e) => {
      reject(e);
    });
    request.end();
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  downloadFile,
  niceBytes
});
