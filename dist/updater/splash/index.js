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
var splash_exports = {};
__export(splash_exports, {
  dispatchEvent: () => dispatchEvent,
  getStartURL: () => getStartURL,
  getWindow: () => getWindow
});
module.exports = __toCommonJS(splash_exports);
var import_electron = require("electron");
var import_path = __toESM(require("path"));
const MAIN_MESSAGE = "@jake-gao/delta-updater:main";
const splashHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\u66F4\u65B0</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%;
      background: #1b1e2e;
      font-family: -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif;
      font-size: 13px;
      color: #c8cdd8;
      overflow: hidden;
      -webkit-app-region: drag;
      user-select: none;
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 20px 28px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .logo {
      width: 34px;
      height: 34px;
      background: linear-gradient(135deg, #5b8def, #7c6ff7);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 17px;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
      box-shadow: 0 2px 10px rgba(91, 141, 239, 0.25);
    }
    .title {
      font-size: 14px;
      font-weight: 600;
      color: #e2e5ed;
      letter-spacing: 0.5px;
    }
    .status-area {
      text-align: center;
    }
    .status-text {
      font-size: 12px;
      color: #8b91a3;
      line-height: 1.6;
      min-height: 20px;
    }
    .status-text .dot::after {
      content: '';
      animation: dots 1.5s steps(4, end) infinite;
    }
    @keyframes dots {
      0% { content: ''; }
      25% { content: '.'; }
      50% { content: '..'; }
      75% { content: '...'; }
      100% { content: '...'; }
    }
    .progress-wrap {
      width: 260px;
      height: 4px;
      background: rgba(255,255,255,0.06);
      border-radius: 6px;
      overflow: hidden;
      margin: 14px auto 0;
      display: none;
    }
    .progress-bar {
      height: 100%;
      width: 100%;
      background: linear-gradient(90deg, #5b8def, #7c6ff7);
      border-radius: 6px;
      transform: scaleX(0);
      transform-origin: left center;
      transition: transform 0.3s ease;
      box-shadow: 0 0 10px rgba(91, 141, 239, 0.35);
    }
    .progress-detail {
      font-size: 11px;
      color: #5e6478;
      margin-top: 6px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">H</div>
      <span class="title">\u5E94\u7528\u66F4\u65B0</span>
    </div>
    <div class="status-area">
      <div class="status-text" id="status">\u6B63\u5728\u68C0\u67E5\u66F4\u65B0<span class="dot"></span></div>
      <div class="progress-wrap" id="progressWrap">
        <div class="progress-bar" id="progressBar"></div>
      </div>
      <div class="progress-detail" id="progressDetail"></div>
    </div>
  </div>
  <script>
    const MAIN_MESSAGE = '@jake-gao/delta-updater:main';
    var statusDom = document.getElementById("status");
    var progressBar = document.getElementById("progressBar");
    var progressWrap = document.getElementById("progressWrap");
    var progressDetail = document.getElementById("progressDetail");

    function setProgress(pct) {
      progressBar.style.transform = 'scaleX(' + (pct / 100) + ')';
    }

    window.addEventListener(MAIN_MESSAGE, function (event) {
      var data = event.detail;
      var eventName = data.eventName;
      var payload = data.payload;

      switch (eventName) {
        case 'checking-for-update':
          statusDom.innerHTML = '\u6B63\u5728\u68C0\u67E5\u66F4\u65B0<span class="dot"></span>';
          break;
        case 'update-available':
          statusDom.innerHTML = '\u53D1\u73B0\u65B0\u7248\u672C\uFF0C\u5F00\u59CB\u4E0B\u8F7D...';
          progressWrap.style.display = 'block';
          progressDetail.style.display = 'block';
          break;
        case 'update-not-available':
          statusDom.innerHTML = '\u6B63\u5728\u542F\u52A8<span class="dot"></span>';
          break;
        case 'error':
          statusDom.textContent = '\u66F4\u65B0\u51FA\u9519\uFF0C\u6B63\u5728\u542F\u52A8...';
          break;
        case 'download-progress':
          var percentage = payload.percentage;
          setProgress(percentage);
          statusDom.textContent = '\u6B63\u5728\u4E0B\u8F7D' + percentage + '%';
          progressDetail.textContent = payload.transferred + ' / ' + payload.total;
          break;
        case 'update-downloaded':
          statusDom.innerHTML = '\u6B63\u5728\u5B89\u88C5\u66F4\u65B0<span class="dot"></span>';
          setProgress(100);
          progressDetail.textContent = '';
          break;
        default:
          statusDom.innerHTML = '\u6B63\u5728\u542F\u52A8<span class="dot"></span>';
      }
    });
  </script>
</body>
</html>`;
function getWindow() {
  const win = new import_electron.BrowserWindow({
    width: 360,
    height: 150,
    resizable: false,
    frame: false,
    show: false,
    titleBarStyle: "hidden",
    backgroundColor: "#1b1e2e",
    fullscreenable: false,
    skipTaskbar: false,
    center: true,
    movable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      disableBlinkFeatures: "Auxclick",
      sandbox: true,
      preload: import_path.default.join(__dirname, "preload.js")
    }
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  return win;
}
function getStartURL() {
  return "data:text/html;charset=utf-8," + encodeURIComponent(splashHtml);
}
function dispatchEvent(updaterWindow, eventName, payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send(MAIN_MESSAGE, { eventName, payload });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  dispatchEvent,
  getStartURL,
  getWindow
});
