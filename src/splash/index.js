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

const MAIN_MESSAGE = "@electron-delta/updater:main";

const getWindow = () =>
  new BrowserWindow({
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

function getStartURL() {
  return url.pathToFileURL(path.join(__dirname, "splash.html")).toString();
}

function dispatchEvent(updaterWindow, eventName, payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send(MAIN_MESSAGE, { eventName, payload });
  }
}

module.exports = { getWindow, getStartURL, dispatchEvent };
