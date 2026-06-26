const { contextBridge, ipcRenderer } = require('electron');

const RENDERER_MESSAGE = '@electron-delta/updater:renderer';
const MAIN_MESSAGE = '@electron-delta/updater:main';

// 解析 additionalArguments 中的自定义配置，在页面脚本执行前暴露
const config = {};
process.argv.forEach((arg) => {
  if (arg.startsWith('--delta-title=')) {
    config.title = decodeURIComponent(arg.slice('--delta-title='.length));
  }
  if (arg.startsWith('--delta-logo=')) {
    config.logo = decodeURIComponent(arg.slice('--delta-logo='.length));
  }
});

contextBridge.exposeInMainWorld('__deltaConfig__', config);

process.once('loaded', () => {
  window.addEventListener(RENDERER_MESSAGE, (event) => {
    ipcRenderer.send(RENDERER_MESSAGE, event.detail);
  });

  ipcRenderer.removeAllListeners(MAIN_MESSAGE);

  ipcRenderer.on(MAIN_MESSAGE, (event, data) => {
    window.dispatchEvent(new CustomEvent(MAIN_MESSAGE, { detail: data }));
  });
});
