const { EventEmitter } = require("events");
const electron = require("electron");

const path = require("path");
const crypto = require("crypto");
const fs = require("fs-extra");
const fetch = require("cross-fetch");
const semver = require("semver");
const { spawnSync, execFile, execSync } = require("child_process");
const yaml = require("yaml");

const { downloadFile, niceBytes } = require("./download");

const { getGithubFeedURL } = require("./github-provider");
const { getGenericFeedURL } = require("./generic-provider");
const { newBaseUrl, newUrlFromBase } = require("./utils");

const { getStartURL, getWindow, dispatchEvent } = require("./splash");

const { app, BrowserWindow, Notification } = electron;
const oneMinute = 60 * 1000;
const fifteenMinutes = 15 * oneMinute;

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

    // 绑定 this 防止作为事件回调时丢失上下文
    this.onQuit = this.onQuit.bind(this);

    if (app.isPackaged) {
      this.setConfigPath();
      this.prepareUpdater();
      this.appPath = stripTrailingSlash(path.dirname(app.getPath("exe")));
      this.appName = getAppName();
      this.logger.info("[更新器] 应用路径 = ", this.appPath);
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
      this.logger.error("[更新器] 猜测 host URL 错误 ", e);
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

  async prepareUpdater() {
    const channel = getChannel();
    if (!channel) return;

    this.logger.info("[更新器] 频道 = ", channel);
    this.autoUpdater.channel = channel;
    this.autoUpdater.logger = this.logger;

    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;

    this.deltaUpdaterRootPath = path.join(
      app.getPath("appData"),
      `../Local/${this.updateConfig.updaterCacheDirName}`,
    );

    this.updateDetailsJSON = path.join(
      this.deltaUpdaterRootPath,
      "./update-details.json",
    );
    this.deltaHolderPath = path.join(this.deltaUpdaterRootPath, "./deltas");

    if (app.isPackaged && process.platform === "darwin") {
      this.macUpdaterPath = path.join(
        this.deltaUpdaterRootPath,
        "./mac-updater",
      );
      this.hpatchzPath = path.join(this.deltaUpdaterRootPath, "./hpatchz");
    }
  }

  checkForUpdates(resolve, reject) {
    this.logger.info("[更新器] 正在检查更新...");
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
          this.logger.info("[更新器] github hostURL = ", hostURL);
          this.hostURL = newBaseUrl(hostURL);
          this.autoUpdater.checkForUpdates();
        })
        .catch((err) => {
          // 当更新检查失败时，需要关闭 updaterWindow 并加载应用的当前版本
          this.logger.error("[更新器] 检查更新失败");
          dispatchEvent(this.updaterWindow, "error", err);
          reject(err);
        });
    } else {
      this.autoUpdater.checkForUpdates();
    }
  }

  pollForUpdates(resolve, reject) {
    this.checkForUpdates(resolve, reject);
    setInterval(() => {
      this.checkForUpdates(resolve, reject);
    }, fifteenMinutes);
  }

  ensureSafeQuitAndInstall() {
    this.logger.info("[更新器] 确保安全退出并安装");
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
      this.logger.error("[更新器] 写入更新详情错误 ", e);
    }
  }

  async getAutoUpdateDetails() {
    let data = null;
    try {
      data = await fs.readJSON(this.updateDetailsJSON);
    } catch (e) {
      this.logger.error(`[更新器] ${this.updateDetailsJSON} 文件未找到`);
    }
    return data;
  }

  async setFeedURL(feedURL) {
    try {
      this.logger.info(
        "[更新器] 设置 Feed URL: ",
        feedURL,
      );
      await this.autoUpdater.setFeedURL(feedURL);
    } catch (e) {
      this.logger.error("[更新器] 设置 FeedURL 错误 ", e);
    }
  }

  createSplashWindow() {
    this.updaterWindow = getWindow({ logo: this.logo });
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

    this.logger.info("[更新器] 绑定事件监听器");

    this.autoUpdater.on("checking-for-update", () => {
      this.logger.info("[更新器] 正在检查更新");
      dispatchEvent(this.updaterWindow, "checking-for-update");
    });

    this.autoUpdater.on("error", (error) => {
      this.logger.error("[更新器] 错误: ", error);
      this.emit("error", error);
      dispatchEvent(this.updaterWindow, "error", error);
      reject(error);
    });

    this.autoUpdater.on("update-available", async (info) => {
      this.logger.info("[更新器] 有可用更新 ", info);
      this.emit("update-available", info);
      dispatchEvent(this.updaterWindow, "update-available", info);

      const updateDetails = await this.getAutoUpdateDetails();
      if (updateDetails) {
        this.logger.info("[更新器] 上次更新详情: ", updateDetails);
        const appVersion = app.getVersion();
        this.logger.info("[更新器] 当前应用版本 ", appVersion);
        if (updateDetails.appVersion === appVersion) {
          this.logger.info(
            "[更新器] 上次更新失败，尝试使用普通更新器",
          );
          this.autoUpdater.downloadUpdate();
          return;
        }
      }

      this.doSmartDownload(info);
    });

    this.autoUpdater.on("download-progress", (info) => {
      this.emit("download-progress", info);
      dispatchEvent(this.updaterWindow, "download-progress", {
        percentage: parseFloat(info.percent).toFixed(1),
        transferred: niceBytes(info.transferred),
        total: niceBytes(info.total),
      });
    });

    this.logger.info("[更新器] 添加退出监听器");

    app.on("quit", this.onQuit);

    this.autoUpdater.on("update-not-available", () => {
      this.logger.info("[更新器] 没有可用更新");
      this.emit("update-not-available");
      dispatchEvent(this.updaterWindow, "update-not-available");
      resolve();
    });

    this.autoUpdater.on("update-downloaded", (info) => {
      this.logger.info("[更新器] 更新已下载 ", info);
      this.emit("update-downloaded", info);
      dispatchEvent(this.updaterWindow, "update-downloaded", info);
      this.handleUpdateDownloaded(info, resolve);
    });
  }

  async onQuit(event, exitCode) {
    this.logger.info("[更新器] 退出应用");
    if (this.autoUpdateInfo) {
      this.logger.info("[更新器] 更新信息 ", this.autoUpdateInfo);
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
            this.logger.error("[更新器] 启动进程错误 ", err);
          }
        }

        if (process.platform === "darwin") {
          const command = `${this.macUpdaterPath} ${getAppName()} ${this.autoUpdateInfo.deltaPath} ${this.hpatchzPath}`;
          this.logger.info(
            "[更新器] 在退出时应用增量更新 macOS ",
            command,
          );

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
      this.logger.info("[更新器] 现在退出，没有可用更新");
    }
  }

  quitAndInstall() {
    this.logger.info("[更新器] 退出并安装");

    if (!this.autoUpdateInfo) {
      this.logger.info("[更新器] 没有可用更新");
      return;
    }

    setTimeout(async () => {
      if (this.autoUpdateInfo.delta) {
        this.logger.info("[更新器] 应用增量更新");
        await this.applyDeltaUpdate(
          this.autoUpdateInfo.deltaPath,
          this.autoUpdateInfo.version,
        );
      } else {
        this.logger.info("[更新器] 应用完整更新");
        await this.applyUpdate(this.autoUpdateInfo.version, true);
      }
    }, 0);
  }

  async handleUpdateDownloaded(info, resolve) {
    this.autoUpdateInfo = info; // important to save this info for later
    if (this.updaterWindow) {
      this.logger.info("[更新器] 触发更新");
      resolve();
      this.quitAndInstall();
    } else {
      this.logger.info(
        "[更新器] 未找到启动窗口，仅显示通知",
      );
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
    this.logger.info("[更新器] 启动中");
    if (!this.hostURL) {
      this.hostURL = await this.guessHostURL();
    }

    if (splashScreen) {
      const startURL = getStartURL();
      this.createSplashWindow();
      this.updaterWindow.loadURL(startURL);
    }
    return new Promise((resolve, reject) => {
      this.attachListeners(resolve, reject);
      if (!splashScreen) {
        resolve();
      }
    })
      .then(() => {
        this.logger.info("[更新器] 启动完成");
        if (
          splashScreen &&
          this.updaterWindow &&
          !this.updaterWindow.isDestroyed()
        ) {
          this.updaterWindow.close();
          this.updaterWindow = null;
        }
      })
      .catch((err) => {
        this.logger.error("[更新器] 启动错误 ", err);
        if (
          splashScreen &&
          this.updaterWindow &&
          !this.updaterWindow.isDestroyed()
        ) {
          this.updaterWindow.close();
          this.updaterWindow = null;
        }
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
    const deltaDownloaded = (deltaPath) => {
      this.logger.info(`[更新器] 已下载 ${deltaPath}`);
      this.autoUpdater.emit("update-downloaded", {
        delta: true,
        deltaPath,
        version,
        releaseDate,
      });
    };

    let channel = getChannel();
    if (!channel) return;
    channel = channel === "latest" ? "stable" : channel;

    const appVersion = app.getVersion();

    const deltaJSONUrl = this.getDeltaJSONUrl();
    let deltaJSON = null;
    try {
      this.logger.info(`[更新器] 从 ${deltaJSONUrl} 获取增量 JSON`);
      const response = await fetch(deltaJSONUrl);
      if (response.status !== 200) {
        this.logger.error(
          `[更新器] 获取 ${deltaJSONUrl} 错误: ${response.status}`,
        );
      } else {
        deltaJSON = await response.json();
      }
    } catch (err) {
      this.logger.error("获取失败 ", deltaJSONUrl);
    }

    if (!deltaJSON) {
      this.logger.error("[更新器] 未找到增量更新");
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaDetails = deltaJSON[appVersion];

    if (!deltaDetails) {
      this.logger.error(
        "[更新器] 此版本没有增量更新 ",
        appVersion,
      );
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaURL = this.getDeltaURL({ deltaPath: deltaDetails.path });
    this.logger.info("[更新器] 增量更新 URL ", deltaURL);

    const shaVal = deltaDetails.sha256;

    if (!shaVal) {
      this.logger.info(
        "[更新器] 无法获取增量文件的 SHA，尝试普通下载",
      );
      this.autoUpdater.downloadUpdate();
      return;
    }
    if (process.platform === "darwin") {
      try {
        const macUpdaterURL = newUrlFromBase("mac-updater", this.hostURL);
        const hpatchzURL = newUrlFromBase("hpatchz", this.hostURL);
        this.logger.info("[更新器] 下载 mac-updater 和 hpatchz");
        this.logger.info(`${macUpdaterURL} 和 ${hpatchzURL}`);
        await downloadFile(macUpdaterURL, this.macUpdaterPath);
        await downloadFile(hpatchzURL, this.hpatchzPath);
        await fs.chmod(this.macUpdaterPath, "755");
        await fs.chmod(this.hpatchzPath, "755");
      } catch (err) {
        this.logger.error(
          "[更新器] 下载更新辅助文件错误",
          err,
        );
        this.autoUpdater.downloadUpdate();
        return;
      }
    }

    const deltaPath = path.join(this.deltaHolderPath, deltaDetails.path);

    if (fs.existsSync(deltaPath) && isSHACorrect(deltaPath, shaVal)) {
      // cached downloaded file is good to go
      this.logger.info("[更新器] 增量文件已存在 ", deltaPath);
      deltaDownloaded(deltaPath);
      return;
    }

    this.logger.info("[更新器] 开始下载增量文件 ", deltaURL);

    await fs.ensureDir(this.deltaHolderPath);

    const onProgressCb = ({ percentage, transferred, total }) => {
      this.logger.info(
        `已下载=${percentage}%, 已传输 = ${transferred} / ${total}`,
      );
      this.emit("download-progress", { percentage, transferred, total });
      dispatchEvent(this.updaterWindow, "download-progress", {
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
          "[更新器] 增量文件已下载，但 SHA 不正确，尝试普通下载",
        );
        this.autoUpdater.downloadUpdate();
        return;
      }
      deltaDownloaded(deltaPath);
    } catch (err) {
      this.logger.error(
        "[更新器] 增量下载错误，尝试普通下载",
        err,
      );
      this.autoUpdater.downloadUpdate();
    }
  }

  async applyUpdate(version, forceRunAfter = true) {
    this.logger.info("[更新器] 应用普通更新");
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
    this.logger.info("[更新器] 应用增量更新");
    await this.writeAutoUpdateDetails({
      isDelta: true,
      attemptedVersion: version,
    });
    this.ensureSafeQuitAndInstall();

    try {
      if (process.platform === "darwin") {
        const command = `${this.macUpdaterPath} ${getAppName()} ${deltaPath} ${this.hpatchzPath}`;
        this.logger.info(
          "[更新器] 使用 execFile 应用增量更新 ",
          command,
        );
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
      this.log.info("[更新器] 应用增量更新错误 ", err);
    }
  }
}

module.exports = DeltaUpdater;
