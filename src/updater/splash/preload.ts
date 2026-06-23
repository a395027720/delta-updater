/// <reference lib="dom" />
import { ipcRenderer } from "electron";

const RENDERER_MESSAGE = "@jake-gao/delta-updater:renderer";
const MAIN_MESSAGE = "@jake-gao/delta-updater:main";

process.once("loaded", () => {
  window.addEventListener(RENDERER_MESSAGE, (event) => {
    ipcRenderer.send(RENDERER_MESSAGE, (event as CustomEvent).detail);
  });

  ipcRenderer.removeAllListeners(MAIN_MESSAGE);

  ipcRenderer.on(MAIN_MESSAGE, (event, data) => {
    window.dispatchEvent(new CustomEvent(MAIN_MESSAGE, { detail: data }));
  });
});
