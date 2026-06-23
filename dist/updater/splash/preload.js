var import_electron = require("electron");
const RENDERER_MESSAGE = "@jake-gao/delta-updater:renderer";
const MAIN_MESSAGE = "@jake-gao/delta-updater:main";
process.once("loaded", () => {
  window.addEventListener(RENDERER_MESSAGE, (event) => {
    import_electron.ipcRenderer.send(RENDERER_MESSAGE, event.detail);
  });
  import_electron.ipcRenderer.removeAllListeners(MAIN_MESSAGE);
  import_electron.ipcRenderer.on(MAIN_MESSAGE, (event, data) => {
    window.dispatchEvent(new CustomEvent(MAIN_MESSAGE, { detail: data }));
  });
});
