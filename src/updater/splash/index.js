const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const MAIN_MESSAGE = '@jake-gao/delta-updater:main';

const splashHtml = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>更新</title><style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;background:#1b1e2e;font-family:-apple-system,"Microsoft YaHei","PingFang SC",sans-serif;font-size:13px;color:#c8cdd8;overflow:hidden;-webkit-app-region:drag;user-select:none}.container{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px 28px}.header{display:flex;align-items:center;gap:10px;margin-bottom:16px}.logo{width:34px;height:34px;background:linear-gradient(135deg,#5b8def,#7c6ff7);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 10px rgba(91,141,239,.25)}.logo svg{width:18px;height:18px;stroke:#fff}.title{font-size:14px;font-weight:600;color:#e2e5ed;letter-spacing:.5px}.status-area{text-align:center}.status-text{font-size:12px;color:#8b91a3;line-height:1.6;min-height:20px}.status-text .dot::after{content:\'\';animation:dots 1.5s steps(4,end) infinite}@keyframes dots{0%{content:\'\'}25%{content:\'.\'}50%{content:\'..\'}75%{content:\'...\'}100%{content:\'...\'}}.progress-wrap{width:260px;height:4px;background:rgba(255,255,255,.06);border-radius:6px;overflow:hidden;margin:14px auto 0;display:none}.progress-bar{height:100%;width:100%;background:linear-gradient(90deg,#5b8def,#7c6ff7);border-radius:6px;transform:scaleX(0);transform-origin:left center;transition:transform .3s ease;box-shadow:0 0 10px rgba(91,141,239,.35)}.progress-detail{font-size:11px;color:#5e6478;margin-top:6px;display:none}</style></head><body><div class="container"><div class="header"><div class="logo">{logo}</div><span class="title">应用更新</span></div><div class="status-area"><div class="status-text" id="status">正在检查更新<span class="dot"></span></div><div class="progress-wrap" id="progressWrap"><div class="progress-bar" id="progressBar"></div></div><div class="progress-detail" id="progressDetail"></div></div></div><script>var MAIN_MESSAGE=\'@jake-gao/delta-updater:main\';var statusDom=document.getElementById("status");var progressBar=document.getElementById("progressBar");var progressWrap=document.getElementById("progressWrap");var progressDetail=document.getElementById("progressDetail");function setProgress(pct){progressBar.style.transform=\'scaleX(\'+(pct/100)+\')\'}window.addEventListener(MAIN_MESSAGE,function(event){var data=event.detail;var eventName=data.eventName;var payload=data.payload;switch(eventName){case\'checking-for-update\':statusDom.innerHTML=\'正在检查更新<span class="dot"></span>\';break;case\'update-available\':statusDom.innerHTML=\'发现新版本，开始下载...\';progressWrap.style.display=\'block\';progressDetail.style.display=\'block\';break;case\'update-not-available\':statusDom.innerHTML=\'正在启动<span class="dot"></span>\';break;case\'error\':statusDom.textContent=\'更新出错，正在启动...\';break;case\'download-progress\':var pct=payload.percentage;setProgress(pct);statusDom.textContent=\'正在下载\'+pct+\'%\';progressDetail.textContent=payload.transferred+\' / \'+payload.total;break;case\'update-downloaded\':statusDom.innerHTML=\'正在安装更新<span class="dot"></span>\';setProgress(100);progressDetail.textContent=\'\';break;default:statusDom.innerHTML=\'正在启动<span class="dot"></span>\'}})</script></body></html>';

function getWindow() {
  const win = new BrowserWindow({
    width: 360, height: 150, resizable: false, frame: false, show: false,
    titleBarStyle: 'hidden', backgroundColor: '#1b1e2e', fullscreenable: false,
    skipTaskbar: false, center: true, alwaysOnTop: true, movable: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, disableBlinkFeatures: 'Auxclick',
      sandbox: true, preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.once('ready-to-show', () => win.show());
  return win;
}

function isImagePath(logo) {
  return /\.(png|ico|svg|jpg|jpeg|gif)$/i.test(logo) || logo.startsWith('/') || logo.startsWith('http');
}

const MIME_MAP = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

function toDataURL(logo) {
  if (logo.startsWith('data:') || logo.startsWith('http')) return logo;
  try {
    const fp = path.isAbsolute(logo) ? logo : path.resolve(process.cwd(), logo);
    if (!fs.existsSync(fp)) return null;
    const ext = path.extname(fp).toLowerCase();
    const mime = MIME_MAP[ext] || 'image/png';
    const buf = fs.readFileSync(fp);
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch (e) { return null; }
}

function getStartURL(logo) {
  var defaultSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var logoContent = defaultSVG;
  if (logo) {
    if (isImagePath(logo)) {
      var dataUrl = toDataURL(logo);
      if (dataUrl) logoContent = '<img src="' + dataUrl + '" style="width:100%;height:100%;object-fit:contain;border-radius:8px" />';
    } else {
      logoContent = logo;
    }
  }
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml.replace('{logo}', logoContent));
}

function dispatchEvent(updaterWindow, eventName, payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send(MAIN_MESSAGE, { eventName: eventName, payload: payload });
  }
}

module.exports = { getWindow, getStartURL, dispatchEvent };
