/**
 * Splash 窗口预加载脚本 (preload.js)
 *
 * ============================================================
 * 通信桥接 — 解决 sandbox + contextIsolation 下的 IPC 问题
 * ============================================================
 *
 *   主进程 (main)
 *     dispatchEvent()
 *       → webContents.send(MAIN_MESSAGE, data)
 *         ↓
 *   preload.js (contextBridge 虽未用，但 ipcRenderer 可用)
 *     ipcRenderer.on(MAIN_MESSAGE) → window.dispatchEvent(CustomEvent)
 *       ↓
 *   splash HTML (sandbox renderer)
 *     window.addEventListener(MAIN_MESSAGE) → 更新 DOM
 *
 *   注意: 未使用 contextBridge.exposeInMainWorld,
 *        而是直接通过 ipcRenderer.on + window.dispatchEvent 桥接
 */
/// <reference lib="dom" />
import { ipcRenderer } from "electron";

const RENDERER_MESSAGE = "@jake-gao/delta-updater:renderer";
const MAIN_MESSAGE = "@jake-gao/delta-updater:main";

process.once("loaded", () => {
  // 渲染进程 → 主进程 (当前未使用，预留)
  window.addEventListener(RENDERER_MESSAGE, (event) => {
    ipcRenderer.send(RENDERER_MESSAGE, (event as CustomEvent).detail);
  });

  ipcRenderer.removeAllListeners(MAIN_MESSAGE);

  // 主进程 → 渲染进程: IPC 消息转 DOM CustomEvent
  ipcRenderer.on(MAIN_MESSAGE, (event, data) => {
    window.dispatchEvent(new CustomEvent(MAIN_MESSAGE, { detail: data }));
  });
});
