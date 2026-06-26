/*
 * @Description: 增量更新窗口
 * @Author: GaoJQiang
 * @Date: 2022-08-17 02:33:25
 * @LastEditors: GaoJQiang
 * @LastEditTime: 2026-06-26 19:20:30
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

  // 注入自定义 logo 和应用名称
  const injections = [];

  if (opts.logo) {
    const dataURI = toDataURI(opts.logo);
    if (dataURI) {
      injections.push(
        "window.__CUSTOM_LOGO__ = '" + dataURI + "';" +
        "var logoEl = document.getElementById('logoImg');" +
        "if (logoEl) logoEl.src = window.__CUSTOM_LOGO__;"
      );
    }
  }

  if (opts.splashTitle) {
    injections.push(
      "window.__APP_NAME__ = '" + opts.splashTitle + "';" +
      "var titleEl = document.getElementById('titleText');" +
      "if (titleEl) titleEl.textContent = '" + opts.splashTitle + " 正在启动';"
    );
  }

  if (injections.length > 0) {
    win.webContents.once("dom-ready", () => {
      win.webContents.executeJavaScript(injections.join("")).catch(() => {});
    });
  }

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
