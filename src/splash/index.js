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

  // 通过 additionalArguments 将自定义配置传入 preload，
  // 由 preload 通过 contextBridge 暴露，页面脚本执行前即可读取，
  // 避免 executeJavaScript 的时序问题及 sandbox 环境兼容风险
  const additionalArgs = [];
  if (opts.title) {
    additionalArgs.push(`--delta-title=${encodeURIComponent(opts.title)}`);
  }
  const dataURI = toDataURI(opts.logo);
  if (dataURI) {
    additionalArgs.push(`--delta-logo=${encodeURIComponent(dataURI)}`);
  }

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
      additionalArguments: additionalArgs,
      preload: path.join(__dirname, "preload.js"),
    },
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
