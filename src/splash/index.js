/*
 * @Description: 增量更新窗口
 * @Author: GaoJQiang
 * @Date: 2022-08-17 02:33:25
 * @LastEditors: GaoJQiang
 * @LastEditTime: 2026-06-24 20:51:58
 */
const { BrowserWindow, app } = require("electron");
const path = require("path");
const url = require("url");
const fs = require("fs");
const os = require("os");

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

const DEFAULT_LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 34' fill='none'%3E%3Crect width='34' height='34' rx='8' fill='url(%23g)'/%3E%3Cpath d='M17 10v10M12 16l5 5 5-5' stroke='%23fff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M10 22h14' stroke='%23fff' stroke-width='2' stroke-linecap='round'/%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='34' y2='34' gradientUnits='userSpaceOnUse'%3E%3Cstop stop-color='%235b8def'/%3E%3Cstop offset='1' stop-color='%237c6ff7'/%3E%3C/linearGradient%3E%3C/defs%3E%3C/svg%3E";
const DEFAULT_TITLE = "应用更新";

let tempHtmlPath = null;

/**
 * 生成启动页 URL。将 logo (data URI) 和 title 烘焙进 HTML 模板，
 * 写入临时文件后返回 file:// URL。零时序问题，无需 executeJavaScript。
 */
function getStartURL(opts) {
  const logo = (opts && opts.logo) || null;
  const title = (opts && opts.title) || null;

  const templatePath = path.join(__dirname, "splash.html");
  let html = fs.readFileSync(templatePath, "utf8");

  // 替换 logo
  const dataURI = toDataURI(logo) || DEFAULT_LOGO;
  html = html.replace("__LOGO_URI__", dataURI);

  // 替换 title（转义单引号防止 JS 注入）
  const safeTitle = (title || DEFAULT_TITLE).replace(/'/g, "\\'");
  html = html.replace("__TITLE__", safeTitle);

  // 写入临时目录，preload 仍使用 __dirname 解析，不受影响
  const tmpDir = os.tmpdir();
  tempHtmlPath = path.join(tmpDir, "delta-updater-splash.html");
  fs.writeFileSync(tempHtmlPath, html, "utf8");

  return url.pathToFileURL(tempHtmlPath).toString();
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

  return win;
};

function dispatchEvent(updaterWindow, eventName, payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send(MAIN_MESSAGE, { eventName, payload });
  }
}

module.exports = { getWindow, getStartURL, dispatchEvent };
