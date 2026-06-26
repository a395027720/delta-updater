const { EventEmitter } = require("events");
const electron = require("electron");

const path = require("path");
const crypto = require("crypto");
const fs = require("fs-extra");
const fetch = require("cross-fetch");
const semver = require("semver");
const http = require("http");
const { spawn, spawnSync, execFile, execSync } = require("child_process");
const yaml = require("yaml");

const { downloadFile, niceBytes } = require("./download");

const { getGithubFeedURL } = require("./github-provider");
const { getGenericFeedURL } = require("./generic-provider");
const { newBaseUrl, newUrlFromBase } = require("./utils");

const { getStartURL, getWindow, toDataURI } = require("./splash");

const { app, BrowserWindow, Notification } = electron;

// ========== splash-helper 独立进程脚本（内联，运行时写入磁盘） ==========
const SPLASH_HELPER_SCRIPT = `'use strict';
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// --- 解析 CLI 参数 ---
const ARGS = {};
process.argv.forEach((arg) => {
  const matched = arg.match(/^--(.+?)=(.+)\$/);
  if (matched) ARGS[matched[1]] = matched[2];
});

const SPLASH_URL    = ARGS['splash-url']  || '';
const LOGO_DATA_URI = ARGS['logo']         || '';
const PORT_FILE     = ARGS['port-file']    || '';
const PID_FILE      = ARGS['pid-file']     || '';
const TIMEOUT_MS    = parseInt(ARGS['timeout'], 10) || 300000;

const MAIN_MESSAGE = '@electron-delta/updater:main';

let timeoutHandle = null;
let win = null;
let server = null;

function resetTimeout() {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  timeoutHandle = setTimeout(() => {
    if (server) { try { server.close(); } catch (_) {} }
    if (win && !win.isDestroyed()) win.close();
    try { app.quit(); } catch (_) {}
    process.exit(0);
  }, TIMEOUT_MS);
}

function cleanupFiles() {
  try { fs.unlinkSync(PORT_FILE); } catch (_) {}
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
}

app.whenReady().then(() => {
  // 写入 PID 文件
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (_) {}

  // 创建 BrowserWindow（配置与 getWindow() 一致）
  win = new BrowserWindow({
    width: 360, height: 150,
    resizable: false,
    frame: false,
    show: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#1b1e2e',
    fullscreenable: false,
    skipTaskbar: false,
    center: true,
    movable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      disableBlinkFeatures: 'Auxclick',
      sandbox: true,
    },
  });

  // 注入自定义 logo（如有）
  if (LOGO_DATA_URI) {
    win.webContents.once('dom-ready', () => {
      win.webContents.executeJavaScript(
        "window.__CUSTOM_LOGO__ = '" + LOGO_DATA_URI.replace(/'/g, "\\\\'") + "';" +
        "var el = document.getElementById('logoImg');" +
        "if (el) el.src = window.__CUSTOM_LOGO__;"
      ).catch(() => {});
    });
  }

  win.loadURL(SPLASH_URL);

  // 启动 HTTP server
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', pid: process.pid }));
      return;
    }

    if (req.method === 'POST' && req.url === '/event') {
      resetTimeout();
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (win && !win.isDestroyed()) {
            const payload = JSON.stringify({ eventName: data.eventName, payload: data.payload });
            win.webContents.executeJavaScript(
              "window.dispatchEvent(new CustomEvent('" + MAIN_MESSAGE + "', { detail: " + payload + " }));"
            ).catch(() => {});
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/close') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, closing: true }));
      cleanupFiles();
      if (timeoutHandle) clearTimeout(timeoutHandle);
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.close();
        try { app.quit(); } catch (_) {}
        process.exit(0);
      }, 200);
      return;
    }

    res.writeHead(404); res.end('not found');
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    try { fs.writeFileSync(PORT_FILE, String(port)); } catch (_) {}
    resetTimeout();
  });
});

app.on('window-all-closed', () => {}); // splash 进程不自动退出
`;

const getChannel = () => {
  const version = app.getVersion();
  const preRelease = semver.prerelease(version);
  if (!preRelease) return "latest";

  return preRelease[0];
};

const getAppName = () => app.getName();

const computeSHA256 = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const fileBuffer = fs.readFileSync(filePath);
  const sum = crypto.createHash("sha256");
  sum.update(fileBuffer);
  const hex = sum.digest("hex");
  return hex;
};

const isSHACorrect = (filePath, correctSHA) => {
  try {
    const sha = computeSHA256(filePath);
    return sha === correctSHA;
  } catch (e) {
    return false;
  }
};

const stripTrailingSlash = (str) =>
  str.endsWith("/") ? str.slice(0, -1) : str;

class DeltaUpdater extends EventEmitter {
  constructor(options) {
    super();
    this.autoUpdateInfo = null;
    this.logger = options.logger || console;
    this.autoUpdater =
      options.autoUpdater || require("electron-updater").autoUpdater;
    this.hostURL = options.hostURL || null;
    this.logo = options.logo || null;
    this.keepDeltaCount = options.keepDeltaCount || 3;

    // 外部 splash-helper 进程管理
    this.splashPort = null;          // splash-helper HTTP server 端口
    this.splashProcess = null;       // ChildProcess 引用
    this.portFilePath = null;        // 端口号文件路径
    this.pidFilePath = null;         // PID 文件路径
    this.helperScriptPath = null;    // splash-helper.js 磁盘路径

    // 绑定 this 防止作为事件回调时丢失上下文
    this.onQuit = this.onQuit.bind(this);

    if (app.isPackaged) {
      this.setConfigPath();
      this.prepareUpdater();
      this.appPath = stripTrailingSlash(path.dirname(app.getPath("exe")));
      this.appName = getAppName();
      this.logger.info("[Updater] 应用路径 = ", this.appPath);
    }
  }

  setConfigPath() {
    const updateConfigPath = path.join(process.resourcesPath, "app-update.yml");
    this.updateConfig = yaml.parse(fs.readFileSync(updateConfigPath, "utf8"));
  }

  async guessHostURL() {
    if (!this.updateConfig) {
      return null;
    }

    let hostURL = null;
    try {
      switch (this.updateConfig.provider) {
        case "github":
          hostURL = await getGithubFeedURL(this.updateConfig);
          break;
        case "generic":
          hostURL = await getGenericFeedURL(this.updateConfig);
          break;
        default:
          hostURL = await this.computeHostURL();
      }
    } catch (e) {
      this.logger.error("[Updater] 猜测 host URL 错误 ", e);
    }
    if (!hostURL) {
      return null;
    }
    hostURL = newBaseUrl(hostURL);
    return hostURL;
  }

  async computeHostURL() {
    const provider = await this.autoUpdater.clientPromise;
    return provider.baseUrl.href;
  }

  /**
   * 获取更新缓存根目录
   * Windows: %PROGRAMDATA%\{updaterCacheDirName}  （避免 AppData\Local 被360误报）
   * macOS:   ~/Library/Application Support/{updaterCacheDirName}
   */
  getDeltaUpdaterRootPath() {
    const cacheDirName = this.updateConfig.updaterCacheDirName;
    if (process.platform === "win32") {
      // 优先使用 ProgramData（C:\ProgramData），微软推荐的应用共享数据目录
      // Chrome、VS Code 等正规软件均使用此路径存放更新文件，杀软误报率低
      const programData =
        process.env.ProgramData || process.env.ALLUSERSPROFILE;
      if (programData) {
        return path.join(programData, cacheDirName);
      }
      // 降级：如果 ProgramData 不可用，回退到 AppData/Local
      return path.join(app.getPath("appData"), `../Local/${cacheDirName}`);
    }
    // macOS: 保持原有路径
    return path.join(
      app.getPath("appData"),
      `../Application Support/${cacheDirName}`,
    );
  }

  async prepareUpdater() {
    const channel = getChannel();
    if (!channel) return;

    this.logger.info("[Updater] 频道 = ", channel);
    this.autoUpdater.channel = channel;
    this.autoUpdater.logger = this.logger;

    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;

    this.deltaUpdaterRootPath = this.getDeltaUpdaterRootPath();

    this.updateDetailsJSON = path.join(
      this.deltaUpdaterRootPath,
      "./update-details.json",
    );
    this.deltaHolderPath = path.join(this.deltaUpdaterRootPath, "./deltas");

    // splash-helper 独立进程的 port/pid 文件路径
    this.portFilePath = path.join(
      this.deltaUpdaterRootPath,
      "splash-helper.port",
    );
    this.pidFilePath = path.join(
      this.deltaUpdaterRootPath,
      "splash-helper.pid",
    );

    if (process.platform === "darwin") {
      this.macUpdaterPath = path.join(
        this.deltaUpdaterRootPath,
        "./mac-updater",
      );
      this.hpatchzPath = path.join(this.deltaUpdaterRootPath, "./hpatchz");
    }
  }

  checkForUpdates(resolve, reject) {
    this.logger.info("[Updater] 正在检查更新...");
    if (
      !this.hostURL &&
      this.updateConfig &&
      this.updateConfig.provider === "github"
    ) {
      // github 特殊处理：需要获取最新版本，因为 delta-win/mac.json 托管在
      // 新版本根目录下，例如：
      // https://github.com/${owner}/${repo}/releases/download/${latestReleaseTagName}/delta-{win/mac}.json

      getGithubFeedURL(this.updateConfig)
        .then((hostURL) => {
          this.logger.info("[Updater] github hostURL = ", hostURL);
          this.hostURL = newBaseUrl(hostURL);
          this.autoUpdater.checkForUpdates();
        })
        .catch((err) => {
          // 当更新检查失败时，需要关闭 updaterWindow 并加载应用的当前版本
          this.logger.error("[Updater] 检查更新失败");
          this._sendToSplash("error", err);
          reject(err);
        });
    } else {
      this.autoUpdater.checkForUpdates();
    }
  }

  pollForUpdates(resolve, reject) {
    this.checkForUpdates(resolve, reject);
  }

  ensureSafeQuitAndInstall() {
    this.logger.info("[Updater] 确保安全退出并安装");
    app.removeAllListeners("window-all-closed");
    const browserWindows = BrowserWindow.getAllWindows();
    browserWindows.forEach((browserWindow) => {
      browserWindow.removeAllListeners("close");
      if (!browserWindow.isDestroyed()) {
        browserWindow.close();
      }
    });
  }

  async writeAutoUpdateDetails({ isDelta, attemptedVersion }) {
    if (process.platform === "darwin") return;

    const date = new Date();
    const data = {
      isDelta,
      attemptedVersion,
      appVersion: app.getVersion(),
      timestamp: date.getTime(),
      timeHuman: date.toString(),
    };
    try {
      fs.writeFileSync(this.updateDetailsJSON, JSON.stringify(data));
    } catch (e) {
      this.logger.error("[Updater] 写入更新详情错误 ", e);
    }
  }

  async getAutoUpdateDetails() {
    let data = null;
    try {
      data = await fs.readJSON(this.updateDetailsJSON);
    } catch (e) {
      this.logger.error(`[Updater] ${this.updateDetailsJSON} 文件未找到`);
    }
    return data;
  }

  async setFeedURL(feedURL) {
    try {
      this.logger.info("[Updater] 设置 Feed URL: ", feedURL);
      await this.autoUpdater.setFeedURL(feedURL);
    } catch (e) {
      this.logger.error("[Updater] 设置 FeedURL 错误 ", e);
    }
  }

  createSplashWindow() {
    this.updaterWindow = getWindow({ logo: this.logo });
  }

  /**
   * 关闭 splash 窗口。
   * 优先关闭外部 splash-helper 进程，同时处理进程内窗口回退路径。
   * 外部（如主应用加载完成时）调用此方法主动关闭 splash。
   */
  closeSplash() {
    // 关闭外部 splash-helper（通过 HTTP /close）
    if (this.splashPort) {
      const req = http.request({
        hostname: "127.0.0.1",
        port: this.splashPort,
        path: "/close",
        method: "POST",
        timeout: 3000,
      }, (res) => {
        res.resume();
      });
      req.on("error", () => {});
      req.end();
      this._cleanupSplashFiles();
      this.splashPort = null;
      this.splashProcess = null;
    }

    // 关闭进程内窗口（回退路径）
    if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
      this.logger.info("[Updater] 关闭 splash 窗口");
      this.updaterWindow.close();
    }
    this.updaterWindow = null;
  }

  attachListeners(resolve, reject) {
    if (!app.isPackaged) {
      setTimeout(() => {
        resolve();
      }, 1000);
      return;
    }
    this.autoUpdater.removeAllListeners();
    this.pollForUpdates(resolve, reject);

    this.logger.info("[Updater] 绑定事件监听器");

    this.autoUpdater.on("checking-for-update", () => {
      this.logger.info("[Updater] 正在检查更新");
      this._sendToSplash("checking-for-update");
    });

    this.autoUpdater.on("error", (error) => {
      this.logger.error("[Updater] 错误: ", error);
      this.emit("error", error);
      this._sendToSplash("error", error);
      reject(error);
    });

    this.autoUpdater.on("update-available", async (info) => {
      this.logger.info("[Updater] 有可用更新 ", info);
      this.emit("update-available", info);
      this._sendToSplash("update-available", info);

      const updateDetails = await this.getAutoUpdateDetails();
      if (updateDetails) {
        this.logger.info("[Updater] 上次更新详情: ", updateDetails);
        const appVersion = app.getVersion();
        this.logger.info("[Updater] 当前应用版本 ", appVersion);
        if (updateDetails.appVersion === appVersion) {
          this.logger.info("[Updater] 上次更新失败，尝试使用全量更新");
          this.autoUpdater.downloadUpdate();
          return;
        }
      }

      this.doSmartDownload(info);
    });

    this.autoUpdater.on("download-progress", (info) => {
      this.emit("download-progress", info);
      this._sendToSplash("download-progress", {
        percentage: parseFloat(info.percent).toFixed(1),
        transferred: niceBytes(info.transferred),
        total: niceBytes(info.total),
      });
    });

    this.logger.info("[Updater] 添加退出监听器");

    app.on("quit", this.onQuit);

    this.autoUpdater.on("update-not-available", () => {
      this.logger.info("[Updater] 没有可用更新");
      this.emit("update-not-available");
      this._sendToSplash("update-not-available");
      resolve();
    });

    this.autoUpdater.on("update-downloaded", (info) => {
      this.logger.info("[Updater] 更新已下载 ", info);
      this.emit("update-downloaded", info);
      this._sendToSplash("update-downloaded", info);
      this.handleUpdateDownloaded(info, resolve);
    });
  }

  async onQuit(event, exitCode) {
    this.logger.info("[Updater] 退出应用");
    if (this.autoUpdateInfo) {
      this.logger.info("[Updater] 更新信息 ", this.autoUpdateInfo);
      if (this.autoUpdateInfo.delta) {
        if (process.platform === "win32") {
          try {
            this.logger.info(this.autoUpdateInfo.deltaPath, [
              `/APPPATH="${this.appPath}"`,
              '/RESTART="0"',
            ]);
            execSync(
              `${this.autoUpdateInfo.deltaPath} /APPPATH="${this.appPath}" /RESTART="0"`,
              {
                stdio: "ignore",
              },
            );
          } catch (err) {
            this.logger.error("[Updater] 启动进程错误 ", err);
          }
        }

        if (process.platform === "darwin") {
          const command = `${this.macUpdaterPath} ${getAppName()} ${this.autoUpdateInfo.deltaPath} ${this.hpatchzPath}`;
          this.logger.info("[Updater] 在退出时应用增量更新 macOS ", command);

          execFile(this.macUpdaterPath, [
            getAppName(),
            this.autoUpdateInfo.deltaPath,
            this.hpatchzPath,
          ]).unref();
        }
      } else {
        await this.applyUpdate(this.autoUpdateInfo.version, false);
      }
    } else {
      this.logger.info("[Updater] 现在退出，没有可用更新");
    }
  }

  quitAndInstall() {
    this.logger.info("[Updater] 退出并安装");

    if (!this.autoUpdateInfo) {
      this.logger.info("[Updater] 没有可用更新");
      return;
    }

    setTimeout(async () => {
      if (this.autoUpdateInfo.delta) {
        this.logger.info("[Updater] 应用增量更新");
        await this.applyDeltaUpdate(
          this.autoUpdateInfo.deltaPath,
          this.autoUpdateInfo.version,
        );
      } else {
        this.logger.info("[Updater] 应用完整更新");
        await this.applyUpdate(this.autoUpdateInfo.version, true);
      }
    }, 0);
  }

  async handleUpdateDownloaded(info, resolve) {
    this.autoUpdateInfo = info; // important to save this info for later
    if (this.updaterWindow || this.splashPort) {
      this.logger.info("[Updater] 触发更新");
      resolve();
      this.quitAndInstall();
    } else {
      this.logger.info("[Updater] 未找到启动窗口，仅显示通知");
      this.showUpdateNotification(this.autoUpdateInfo);
    }
  }

  showUpdateNotification(info) {
    const notification = new Notification({
      title: `${getAppName()} ${info.version} 已可用，将在退出时自动安装`,
      body: "点击立即应用更新",
      silent: true,
    });
    notification.show();
    notification.on("click", () => {
      this.quitAndInstall();
    });
  }

  async boot({ splashScreen = false } = { splashScreen: true }) {
    this.logger.info("[Updater] 启动中");
    if (!this.hostURL) {
      this.hostURL = await this.guessHostURL();
    }

    if (splashScreen) {
      // 1. 先尝试检测上一次次运行的 splash-helper 进程
      const existing = await this._detectExistingSplashHelper();

      if (!existing) {
        // 2. 写入脚本并启动外部 splash-helper
        const written = this._writeSplashHelperScript();
        if (written) {
          const spawned = await this._spawnSplashHelper();
          if (!spawned) {
            // 回退到进程内 BrowserWindow
            this.logger.info("[Updater] 外部 splash 不可用，使用进程内窗口");
            this.createSplashWindow();
            this.updaterWindow.loadURL(getStartURL());
          }
        } else {
          // 回退到进程内 BrowserWindow
          this.createSplashWindow();
          this.updaterWindow.loadURL(getStartURL());
        }
      }
      // existing helper detected: 已在 _detectExistingSplashHelper 中重连，无需操作
    }

    return new Promise((resolve, reject) => {
      this.attachListeners(resolve, reject);
      if (!splashScreen) {
        resolve();
      }
    })
      .then(() => {
        this.logger.info("[Updater] 启动完成");
        // 仅在没有更新待安装时关闭 splash
        // 有更新时 this.autoUpdateInfo 已在 handleUpdateDownloaded 中设置，
        // splash 需要跨重启存活，由新进程实例来关闭
        if (!this.autoUpdateInfo) {
          this.closeSplash();
        }
      })
      .catch((err) => {
        this.logger.error("[Updater] 启动错误 ", err);
        this.closeSplash();
      });
  }

  getDeltaURL({ deltaPath }) {
    return newUrlFromBase(deltaPath, this.hostURL);
  }

  getDeltaJSONUrl() {
    const jsonFileName =
      process.platform === "win32" ? "delta-win.json" : "delta-mac.json";
    return newUrlFromBase(jsonFileName, this.hostURL);
  }

  async doSmartDownload({ version, releaseDate }) {
    this.logger.info(
      `[Updater] doSmartDownload 开始, version=${version}, releaseDate=${releaseDate}`,
    );
    const deltaDownloaded = async (deltaPath) => {
      this.logger.info(`[Updater] 已下载 ${deltaPath}`);
      // 先清理旧增量文件，再触发更新事件 —— 因为 update-downloaded 会触发 quitAndInstall 重启
      await this.cleanupOldDeltas(deltaPath);
      this.autoUpdater.emit("update-downloaded", {
        delta: true,
        deltaPath,
        version,
        releaseDate,
      });
    };

    let channel = getChannel();
    if (!channel) {
      this.logger.info("[Updater] doSmartDownload 退出: 无channel");
      return;
    }
    channel = channel === "latest" ? "stable" : channel;

    const appVersion = app.getVersion();

    const deltaJSONUrl = this.getDeltaJSONUrl();
    let deltaJSON = null;
    try {
      this.logger.info(`[Updater] 从 ${deltaJSONUrl} 获取增量 JSON`);
      const response = await fetch(deltaJSONUrl);
      if (response.status !== 200) {
        this.logger.error(
          `[Updater] 获取 ${deltaJSONUrl} 错误: ${response.status}`,
        );
      } else {
        deltaJSON = await response.json();
      }
    } catch (err) {
      this.logger.error("获取失败 ", deltaJSONUrl);
    }

    if (!deltaJSON) {
      this.logger.error("[Updater] 未找到增量更新");
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaDetails = deltaJSON[appVersion];

    if (!deltaDetails) {
      this.logger.error("[Updater] 此版本没有增量更新 ", appVersion);
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaURL = this.getDeltaURL({ deltaPath: deltaDetails.path });
    this.logger.info("[Updater] 增量更新 URL ", deltaURL);

    const shaVal = deltaDetails.sha256;

    if (!shaVal) {
      this.logger.info("[Updater] 无法获取增量文件的 SHA，尝试全量下载");
      this.autoUpdater.downloadUpdate();
      return;
    }
    if (process.platform === "darwin") {
      try {
        const macUpdaterURL = newUrlFromBase("mac-updater", this.hostURL);
        const hpatchzURL = newUrlFromBase("hpatchz", this.hostURL);
        this.logger.info("[Updater] 下载 mac-updater 和 hpatchz");
        this.logger.info(`${macUpdaterURL} 和 ${hpatchzURL}`);
        await downloadFile(macUpdaterURL, this.macUpdaterPath);
        await downloadFile(hpatchzURL, this.hpatchzPath);
        await fs.chmod(this.macUpdaterPath, "755");
        await fs.chmod(this.hpatchzPath, "755");
      } catch (err) {
        this.logger.error("[Updater] 下载更新辅助文件错误", err);
        this.autoUpdater.downloadUpdate();
        return;
      }
    }

    const deltaPath = path.join(this.deltaHolderPath, deltaDetails.path);

    if (fs.existsSync(deltaPath) && isSHACorrect(deltaPath, shaVal)) {
      // cached downloaded file is good to go
      this.logger.info("[Updater] 增量文件已存在 ", deltaPath);
      await deltaDownloaded(deltaPath);
      return;
    }

    this.logger.info("[Updater] 开始下载增量文件 ", deltaURL);

    await fs.ensureDir(this.deltaHolderPath);

    const onProgressCb = ({ percentage, transferred, total }) => {
      this.logger.info(
        `已下载=${percentage}%, 已传输 = ${transferred} / ${total}`,
      );
      this.emit("download-progress", { percentage, transferred, total });
      this._sendToSplash("download-progress", {
        percentage: parseFloat(percentage).toFixed(1),
        transferred: niceBytes(transferred),
        total: niceBytes(total),
      });
    };

    try {
      await downloadFile(deltaURL, deltaPath, onProgressCb.bind(this));
      const isFileGood = isSHACorrect(deltaPath, shaVal);
      if (!isFileGood) {
        this.logger.info(
          "[Updater] 增量文件已下载，但 SHA 不正确，尝试全量下载",
        );
        this.autoUpdater.downloadUpdate();
        return;
      }
      await deltaDownloaded(deltaPath);
    } catch (err) {
      this.logger.error("[Updater] 增量下载错误，尝试全量下载", err);
      this.autoUpdater.downloadUpdate();
    }
  }

  async applyUpdate(version, forceRunAfter = true) {
    this.logger.info("[Updater] 应用全量更新");
    await this.writeAutoUpdateDetails({
      isDelta: false,
      attemptedVersion: version,
    });

    this.ensureSafeQuitAndInstall();
    if (process.platform === "darwin") {
      this.autoUpdater.quitAndInstall();
      return;
    }
    setTimeout(() => this.autoUpdater.quitAndInstall(true, forceRunAfter), 100);
  }

  async applyDeltaUpdate(deltaPath, version) {
    this.logger.info("[Updater] 应用增量更新");
    await this.writeAutoUpdateDetails({
      isDelta: true,
      attemptedVersion: version,
    });

    // 先关闭所有窗口，避免退出流程中窗口事件干扰
    this.ensureSafeQuitAndInstall();

    try {
      if (process.platform === "darwin") {
        const command = `${this.macUpdaterPath} ${getAppName()} ${deltaPath} ${this.hpatchzPath}`;
        this.logger.info("[Updater] 使用 execFile 应用增量更新 ", command);
        execFile(this.macUpdaterPath, [
          getAppName(),
          deltaPath,
          this.hpatchzPath,
        ]).unref();
      } else {
        this.logger.info(deltaPath, [
          `/APPPATH="${this.appPath}"`,
          '/RESTART="1"',
        ]);
        execSync(`${deltaPath} /APPPATH="${this.appPath}" /RESTART="1"`, {
          stdio: "ignore",
        });
      }
      app.removeListener("quit", this.onQuit);
      app.isQuitting = true;
      app.quit();
    } catch (err) {
      this.log.info("[Updater] 应用增量更新错误 ", err);
    }
  }

  async cleanupOldDeltas(keepDeltaPath) {
    if (!this.deltaHolderPath) {
      this.logger.info("[Updater] cleanupOldDeltas 跳过: deltaHolderPath 为空");
      return;
    }
    try {
      const files = await fs.readdir(this.deltaHolderPath);
      this.logger.info(
        `[Updater] delta目录文件列表(${files.length}): ${JSON.stringify(files)}`,
      );
      this.logger.info(
        `[Updater] keepDeltaCount=${this.keepDeltaCount}, keepDeltaPath=${keepDeltaPath}`,
      );

      if (files.length <= this.keepDeltaCount) {
        this.logger.info(`[Updater] 文件数<=保留数，无需清理`);
        return;
      }

      const fileStats = await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(this.deltaHolderPath, file);
          const stat = await fs.stat(filePath);
          return { filePath, mtime: stat.mtime, isFile: stat.isFile() };
        }),
      );

      // 只处理文件，排除目录
      const allFiles = fileStats.filter((f) => f.isFile);
      this.logger.info(
        `[Updater] 有效文件(${allFiles.length}): ${JSON.stringify(allFiles.map((f) => ({ path: path.basename(f.filePath), mtime: f.mtime })))}`,
      );

      // 按修改时间倒序（新→旧），跳过最新的 keepDeltaCount 个，
      // 但要确保刚下载的 keepDeltaPath 不会被误删
      const sorted = allFiles.sort(
        (a, b) => b.mtime.getTime() - a.mtime.getTime(),
      );
      const toDelete = sorted
        .slice(this.keepDeltaCount)
        .filter((f) => f.filePath !== keepDeltaPath);

      this.logger.info(
        `[Updater] 排序后(新→旧): ${JSON.stringify(sorted.map((f) => path.basename(f.filePath)))}`,
      );
      this.logger.info(
        `[Updater] 待删除(${toDelete.length}): ${JSON.stringify(toDelete.map((f) => path.basename(f.filePath)))}`,
      );

      if (toDelete.length === 0) {
        this.logger.info(`[Updater] 没有需要清理的文件`);
        return;
      }

      // 并行删除，单独捕获每个文件的错误
      const results = await Promise.all(
        toDelete.map(async ({ filePath }) => {
          try {
            await fs.remove(filePath);
            this.logger.info(`[Updater] 已清理旧增量包 ${filePath}`);
            return { filePath, success: true };
          } catch (err) {
            this.logger.warn(`[Updater] 清理增量包失败 ${filePath}`, err);
            return { filePath, success: false, error: err.message };
          }
        }),
      );

      const deleted = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      this.logger.info(
        `[Updater] 清理完成: 成功${deleted.length}个, 失败${failed.length}个`,
      );
    } catch (err) {
      this.logger.warn("[Updater] 清理旧增量包失败", err);
    }
  }

  // ========== 外部 splash-helper 进程管理 ==========

  /**
   * 将 splash-helper 脚本写入磁盘。
   * 只在生产环境（app.isPackaged）执行，文件写入 delta 缓存根目录。
   * @returns {boolean}
   */
  _writeSplashHelperScript() {
    if (!app.isPackaged) return false;

    const scriptPath = path.join(this.deltaUpdaterRootPath, "splash-helper.js");
    try {
      fs.writeFileSync(scriptPath, SPLASH_HELPER_SCRIPT, "utf8");
      this.helperScriptPath = scriptPath;
      this.logger.info("[Updater] splash-helper 脚本已写入 ", scriptPath);
      return true;
    } catch (e) {
      this.logger.error("[Updater] 无法写入 splash-helper 脚本", e);
      return false;
    }
  }

  /**
   * 检测是否有上一次运行遗留的 splash-helper 进程。
   * 通过读取 port 文件并发起 health check 来判断。
   * @returns {Promise<boolean>}
   */
  _detectExistingSplashHelper() {
    if (!this.portFilePath) return Promise.resolve(false);

    let port;
    try {
      port = parseInt(fs.readFileSync(this.portFilePath, "utf8").trim(), 10);
      if (!port) return Promise.resolve(false);
    } catch (_) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/health",
        method: "GET",
        timeout: 2000,
      }, (res) => {
        if (res.statusCode === 200) {
          this.splashPort = port;
          this.logger.info(`[Updater] 重连到现有 splash-helper (port=${port})`);
          resolve(true);
        } else {
          resolve(false);
        }
      });
      req.on("error", () => {
        this.logger.info("[Updater] splash-helper health check 失败，清理过期文件");
        this._cleanupSplashFiles();
        resolve(false);
      });
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  /**
   * 轮询 port 文件，等待 splash-helper 写入端口号。
   * @param {number} timeout 超时毫秒
   * @returns {Promise<number|null>}
   */
  _waitForPortFile(timeout) {
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        try {
          const port = parseInt(fs.readFileSync(this.portFilePath, "utf8").trim(), 10);
          if (port > 0) {
            resolve(port);
            return;
          }
        } catch (_) {
          // 文件尚未写入
        }
        if (Date.now() - start > timeout) {
          resolve(null);
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  /**
   * 启动独立的 splash-helper Electron 进程。
   * @returns {Promise<boolean>}
   */
  async _spawnSplashHelper() {
    if (!this.helperScriptPath || !app.isPackaged) return false;

    // 清理可能残留的 port 文件
    try { fs.unlinkSync(this.portFilePath); } catch (_) {}

    // 转换 logo 为 data URI
    let logoArg = "";
    if (this.logo) {
      const dataURI = toDataURI(this.logo);
      if (dataURI) {
        // Windows CreateProcess 命令行限制约 32KB，data URI 通常远小于此
        logoArg = `--logo=${dataURI}`;
      }
    }

    const splashURL = getStartURL();
    const args = [
      this.helperScriptPath,
      `--splash-url=${splashURL}`,
      `--port-file=${this.portFilePath}`,
      `--pid-file=${this.pidFilePath}`,
      logoArg,
      `--timeout=300000`,
    ].filter(Boolean);

    try {
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();

      // 轮询等待 port 文件写入（最多 10 秒）
      const port = await this._waitForPortFile(10000);
      if (!port) {
        this.logger.error("[Updater] splash-helper 启动超时（未写入 port 文件）");
        return false;
      }

      this.splashPort = port;
      this.splashProcess = child;
      this.logger.info(`[Updater] splash-helper 已启动 (pid=${child.pid}, port=${port})`);
      return true;
    } catch (err) {
      this.logger.error("[Updater] 启动 splash-helper 失败", err);
      this._cleanupSplashFiles();
      return false;
    }
  }

  /**
   * 向外部 splash-helper 发送事件。
   * fire-and-forget 模式，不等待响应，静默处理错误。
   * @param {string} eventName
   * @param {*} payload
   */
  _sendToSplash(eventName, payload) {
    // 优先：通过 HTTP 发送到外部 splash-helper
    if (this.splashPort) {
      const data = JSON.stringify({ eventName, payload });
      const req = http.request({
        hostname: "127.0.0.1",
        port: this.splashPort,
        path: "/event",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 3000,
      }, (res) => {
        res.resume();
      });
      req.on("error", () => {
        // splash 非关键路径，静默处理
      });
      req.write(data);
      req.end();
      return;
    }

    // 回退：发送到进程内 BrowserWindow（开发模式或外部 splash 不可用时）
    if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
      this.updaterWindow.webContents.send("@electron-delta/updater:main", {
        eventName,
        payload,
      });
    }
  }

  /**
   * 清理 splash-helper 相关文件。
   */
  _cleanupSplashFiles() {
    try { if (this.portFilePath) fs.unlinkSync(this.portFilePath); } catch (_) {}
    try { if (this.pidFilePath) fs.unlinkSync(this.pidFilePath); } catch (_) {}
  }
}

module.exports = DeltaUpdater;
