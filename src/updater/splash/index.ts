/**
 * Splash 闪屏窗口 — 更新进度展示
 *
 * ============================================================
 * 架构
 * ============================================================
 *
 *   DeltaUpdater (主进程)
 *     ├── getStartURL(logo?)  ← 生成 HTML (内嵌 data URL)
 *     ├── getWindow()         ← 创建 BrowserWindow
 *     │       preload: preload.js (IPC 桥接)
 *     └── dispatchEvent()     ← 通过 IPC 推送状态到闪屏
 *           ↓
 *   splash HTML (渲染进程, sandbox + contextIsolation)
 *     ├── 监听 custom DOM events → 更新 UI
 *     └── preload.js 桥: 主进程 IPC → DOM CustomEvent
 *
 * ============================================================
 * 窗口特性
 * ============================================================
 *
 *   - 无框 (frame: false), 置顶 (alwaysOnTop), 不可拖动 (movable: false)
 *   - 360×150, 深色背景 (#1b1e2e)
 *   - sandbox + contextIsolation (Electron 安全最佳实践)
 *   - HTML 通过 data URL 加载，无需文件系统访问
 *
 * ============================================================
 * Logo 支持
 * ============================================================
 *
 *   splashLogo 参数支持三种格式:
 *   1. 文字: "MyApp" → 直接渲染文字
 *   2. 图片路径: "./logo.png" → 转 base64 data URL 嵌入 (sandbox 环境无法访问本地文件)
 *   3. SVG 字符串: "<svg>...</svg>" → 直接注入 HTML
 *   4. 不传: 默认下载图标 SVG
 */

import { BrowserWindow } from "electron";
import fs from "fs";
import path from "path";

/** 主进程 → 渲染进程 IPC channel */
const MAIN_MESSAGE = "@jake-gao/delta-updater:main";

/**
 * 内嵌闪屏 HTML 模板
 * ✅ sandbox 兼容: CSS/JS 全部内联，无外部资源
 * ✅ 进度条动画 + 动态状态文字 + 下载详情
 */
const splashHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>更新</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%;
      background: #1b1e2e;
      font-family: -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif;
      font-size: 13px;
      color: #c8cdd8;
      overflow: hidden;
      -webkit-app-region: drag;
      user-select: none;
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 20px 28px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .logo {
      width: 34px;
      height: 34px;
      background: linear-gradient(135deg, #5b8def, #7c6ff7);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 2px 10px rgba(91, 141, 239, 0.25);
    }
    .logo svg {
      width: 18px;
      height: 18px;
      stroke: #fff;
    }
    .title {
      font-size: 14px;
      font-weight: 600;
      color: #e2e5ed;
      letter-spacing: 0.5px;
    }
    .status-area {
      text-align: center;
    }
    .status-text {
      font-size: 12px;
      color: #8b91a3;
      line-height: 1.6;
      min-height: 20px;
    }
    .status-text .dot::after {
      content: '';
      animation: dots 1.5s steps(4, end) infinite;
    }
    @keyframes dots {
      0% { content: ''; }
      25% { content: '.'; }
      50% { content: '..'; }
      75% { content: '...'; }
      100% { content: '...'; }
    }
    .progress-wrap {
      width: 260px;
      height: 4px;
      background: rgba(255,255,255,0.06);
      border-radius: 6px;
      overflow: hidden;
      margin: 14px auto 0;
      display: none;
    }
    .progress-bar {
      height: 100%;
      width: 100%;
      background: linear-gradient(90deg, #5b8def, #7c6ff7);
      border-radius: 6px;
      transform: scaleX(0);
      transform-origin: left center;
      transition: transform 0.3s ease;
      box-shadow: 0 0 10px rgba(91, 141, 239, 0.35);
    }
    .progress-detail {
      font-size: 11px;
      color: #5e6478;
      margin-top: 6px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">{logo}</div>
      <span class="title">应用更新</span>
    </div>
    <div class="status-area">
      <div class="status-text" id="status">正在检查更新<span class="dot"></span></div>
      <div class="progress-wrap" id="progressWrap">
        <div class="progress-bar" id="progressBar"></div>
      </div>
      <div class="progress-detail" id="progressDetail"></div>
    </div>
  </div>
  <script>
    const MAIN_MESSAGE = '@jake-gao/delta-updater:main';
    var statusDom = document.getElementById("status");
    var progressBar = document.getElementById("progressBar");
    var progressWrap = document.getElementById("progressWrap");
    var progressDetail = document.getElementById("progressDetail");

    function setProgress(pct) {
      progressBar.style.transform = 'scaleX(' + (pct / 100) + ')';
    }

    // 监听主进程通过 IPC → preload → DOM CustomEvent 推送的事件
    window.addEventListener(MAIN_MESSAGE, function (event) {
      var data = event.detail;
      var eventName = data.eventName;
      var payload = data.payload;

      switch (eventName) {
        case 'checking-for-update':
          statusDom.innerHTML = '正在检查更新<span class="dot"></span>';
          break;
        case 'update-available':
          statusDom.innerHTML = '发现新版本，开始下载...';
          progressWrap.style.display = 'block';
          progressDetail.style.display = 'block';
          break;
        case 'update-not-available':
          statusDom.innerHTML = '正在启动<span class="dot"></span>';
          break;
        case 'error':
          statusDom.textContent = '更新出错，正在启动...';
          break;
        case 'download-progress':
          var percentage = payload.percentage;
          setProgress(percentage);
          statusDom.textContent = '正在下载' + percentage + '%';
          progressDetail.textContent = payload.transferred + ' / ' + payload.total;
          break;
        case 'update-downloaded':
          statusDom.innerHTML = '正在安装更新<span class="dot"></span>';
          setProgress(100);
          progressDetail.textContent = '';
          break;
        default:
          statusDom.innerHTML = '正在启动<span class="dot"></span>';
      }
    });
  </script>
</body>
</html>`;

/** 创建闪屏 BrowserWindow */
export function getWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 150,
    resizable: false,
    frame: false,
    show: false,
    titleBarStyle: "hidden",
    backgroundColor: "#1b1e2e",
    fullscreenable: false,
    skipTaskbar: false,
    center: true,
    alwaysOnTop: true,
    movable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      disableBlinkFeatures: "Auxclick",
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  return win;
}

/** 判断 logo 是否为图片路径 (本地文件/远程 URL) */
function isImagePath(logo: string): boolean {
  return (
    /\.(png|ico|svg|jpg|jpeg|gif)$/i.test(logo) ||
    logo.startsWith("/") ||
    logo.startsWith("http")
  );
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

/**
 * 将本地图片路径转为 base64 data URL
 * 原因: sandbox 窗口中无法通过 file:// 访问本地图片
 * 返回 null 表示转换失败 (文件不存在等)
 */
function toDataURL(logo: string): string | null {
  if (logo.startsWith("data:") || logo.startsWith("http")) {
    return logo;
  }

  try {
    const filePath = path.isAbsolute(logo) ? logo : path.resolve(process.cwd(), logo);
    if (!fs.existsSync(filePath)) return null;

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_MAP[ext] || "image/png";
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * 生成闪屏 HTML 的 data URL
 *
 * @param logo - 可选 logo
 *   - 不传: 默认下载图标 SVG
 *   - 图片路径: 转 base64 → <img> 标签
 *   - 文字/SVG: 直接注入 HTML
 */
export function getStartURL(logo?: string): string {
  const defaultSVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="7 10 12 15 17 10"/>' +
    '<line x1="12" y1="15" x2="12" y2="3"/>' +
    '</svg>';

  let logoContent = defaultSVG;

  if (logo) {
    if (isImagePath(logo)) {
      const dataUrl = toDataURL(logo);
      if (dataUrl) {
        logoContent = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain;border-radius:8px" />`;
      }
    } else {
      // 纯文字或 SVG 字符串直接注入
      logoContent = logo;
    }
  }

  const html = splashHtml.replace("{logo}", logoContent);
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

/**
 * 通过 IPC 向闪屏窗口推送事件
 *
 * 通信链路:
 *   主进程 dispatchEvent()
 *     → webContents.send(MAIN_MESSAGE, { eventName, payload })
 *       → preload.js: ipcRenderer.on(MAIN_MESSAGE)
 *         → window.dispatchEvent(CustomEvent)
 *           → splash HTML 中 window.addEventListener(MAIN_MESSAGE) 处理
 */
export function dispatchEvent(
  updaterWindow: BrowserWindow | null,
  eventName: string,
  payload?: any,
): void {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send(MAIN_MESSAGE, { eventName, payload });
  }
}
