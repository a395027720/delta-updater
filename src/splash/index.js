/*
 * @Description: 增量更新窗口
 * @Author: GaoJQiang
 * @Date: 2022-08-17 02:33:25
 * @LastEditors: GaoJQiang
 * @LastEditTime: 2026-06-24 20:51:58
 */
const { BrowserWindow } = require("electron");
const path = require("path");
const url = require("url");
const fs = require("fs");

const MAIN_MESSAGE = "@electron-delta/updater:main";

/**
 * 将本地图片文件转为 data URI。如果已经是 data URI 则直接返回。
 */
function toDataURI(logo) {
  if (!logo) return null;
  if (logo.startsWith("data:")) return logo;

  const resolved = path.isAbsolute(logo) ? logo : path.resolve(logo);
  if (!fs.existsSync(resolved)) return null;

  const ext = path.extname(resolved).toLowerCase().replace(".", "");
  const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };
  const mime = mimeMap[ext] || "image/png";
  const buf = fs.readFileSync(resolved);
  return "data:" + mime + ";base64," + buf.toString("base64");
}

const getWindow = (options) => {
  const opts = options || {};
  const win = new BrowserWindow({
    width: 360,
    height: 150,
    resizable: false,
    frame: false,
    show: true,
    titleBarStyle: "hidden",
    backgroundColor: "#1b1e2e",
    fullscreenable: false,
    skipTaskbar: false,
    center: true,
    movable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      disableBlinkFeatures: "Auxclick",
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // dom-ready 后注入自定义配置
  win.webContents.once("dom-ready", () => {
    const scripts = [];

    // 自定义标题
    if (opts.title) {
      scripts.push(
        "window.__CUSTOM_TITLE__ = '" + opts.title.replace(/'/g, "\\'") + "';" +
        "var t = document.getElementById('titleText');" +
        "if (t) { t.textContent = window.__CUSTOM_TITLE__; document.title = window.__CUSTOM_TITLE__; }"
      );
    }

    // 自定义 logo
    const dataURI = toDataURI(opts.logo);
    if (dataURI) {
      scripts.push(
        "window.__CUSTOM_LOGO__ = '" + dataURI + "';" +
        "var el = document.getElementById('logoImg');" +
        "if (el) el.src = window.__CUSTOM_LOGO__;"
      );
    }

    if (scripts.length) {
      win.webContents.executeJavaScript(scripts.join(";")).catch(() => {});
    }
  });

  return win;
};

function getStartURL() {
  return url.pathToFileURL(path.join(__dirname, "splash.html")).toString();
}

function dispatchEvent(updaterWindow, eventName, payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send(MAIN_MESSAGE, { eventName, payload });
  }
}

module.exports = { getWindow, getStartURL, dispatchEvent };
