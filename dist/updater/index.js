var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var updater_exports = {};
__export(updater_exports, {
  default: () => updater_default
});
module.exports = __toCommonJS(updater_exports);
var import_events = require("events");
var import_electron = require("electron");
var import_electron_updater = require("electron-updater");
var import_path = __toESM(require("path"));
var import_crypto = __toESM(require("crypto"));
var import_fs_extra = __toESM(require("fs-extra"));
var import_cross_fetch = __toESM(require("cross-fetch"));
var import_semver = __toESM(require("semver"));
var import_child_process = require("child_process");
var import_yaml = __toESM(require("yaml"));
var import_download = require("./download");
var import_utils = require("./utils");
var import_splash = require("./splash");
const fifteenMinutes = 15 * 60 * 1e3;
const getChannel = () => {
  const version = import_electron.app.getVersion();
  const preRelease = import_semver.default.prerelease(version);
  if (!preRelease) return "latest";
  return preRelease[0];
};
const getAppName = () => import_electron.app.getName();
const computeSHA256 = (filePath) => {
  if (!import_fs_extra.default.existsSync(filePath)) return null;
  const fileBuffer = import_fs_extra.default.readFileSync(filePath);
  const sum = import_crypto.default.createHash("sha256");
  sum.update(fileBuffer);
  return sum.digest("hex");
};
const isSHACorrect = (filePath, correctSHA) => {
  try {
    return computeSHA256(filePath) === correctSHA;
  } catch {
    return false;
  }
};
const stripTrailingSlash = (str) => str.endsWith("/") ? str.slice(0, -1) : str;
class DeltaUpdater extends import_events.EventEmitter {
  constructor(options) {
    super();
    this.autoUpdateInfo = null;
    this.hostURL = null;
    this.updaterWindow = null;
    this.boundOnQuit = null;
    this.autoUpdateInfo = null;
    this.logger = options.logger || console;
    this.autoUpdater = options.autoUpdater || import_electron_updater.autoUpdater;
    this.hostURL = options.hostURL || null;
    if (import_electron.app.isPackaged) {
      this.setConfigPath();
      this.prepareUpdater();
      this.appPath = stripTrailingSlash(import_path.default.dirname(import_electron.app.getPath("exe")));
      this.appName = getAppName();
      this.logger.info("[Updater] \u5E94\u7528\u8DEF\u5F84 = ", this.appPath);
    }
  }
  setConfigPath() {
    const updateConfigPath = import_path.default.join(
      process.resourcesPath,
      "app-update.yml"
    );
    this.updateConfig = import_yaml.default.parse(import_fs_extra.default.readFileSync(updateConfigPath, "utf8"));
  }
  async prepareUpdater() {
    const channel = getChannel();
    if (!channel) return;
    this.logger.info("[Updater]  CHANNEL = ", channel);
    this.autoUpdater.channel = channel;
    this.autoUpdater.logger = this.logger;
    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;
    this.deltaUpdaterRootPath = import_path.default.join(
      import_electron.app.getPath("appData"),
      `../Local/${this.updateConfig.updaterCacheDirName}`
    );
    this.updateDetailsJSON = import_path.default.join(
      this.deltaUpdaterRootPath,
      "./update-details.json"
    );
    this.deltaHolderPath = import_path.default.join(this.deltaUpdaterRootPath, "./deltas");
  }
  checkForUpdates(resolve, reject) {
    this.logger.log("[Updater] \u6B63\u5728\u68C0\u67E5\u66F4\u65B0...");
    this.autoUpdater.checkForUpdates();
  }
  pollForUpdates(resolve, reject) {
    this.checkForUpdates(resolve, reject);
    setInterval(() => {
      this.checkForUpdates(resolve, reject);
    }, fifteenMinutes);
  }
  ensureSafeQuitAndInstall() {
    this.logger.info("[Updater] \u5B89\u5168\u9000\u51FA\u5E76\u5B89\u88C5");
    import_electron.app.removeAllListeners("window-all-closed");
    const browserWindows = import_electron.BrowserWindow.getAllWindows();
    browserWindows.forEach((browserWindow) => {
      if (browserWindow === this.updaterWindow) return;
      browserWindow.removeAllListeners("close");
      if (!browserWindow.isDestroyed()) {
        browserWindow.close();
      }
    });
  }
  async writeAutoUpdateDetails({
    isDelta,
    attemptedVersion
  }) {
    const date = /* @__PURE__ */ new Date();
    const data = {
      isDelta,
      attemptedVersion,
      appVersion: import_electron.app.getVersion(),
      timestamp: date.getTime(),
      timeHuman: date.toString()
    };
    try {
      await import_fs_extra.default.writeJSON(this.updateDetailsJSON, data);
    } catch (e) {
      this.logger.error("[Updater] ", e);
    }
  }
  async getAutoUpdateDetails() {
    let data = null;
    try {
      data = await import_fs_extra.default.readJSON(this.updateDetailsJSON);
    } catch (e) {
      this.logger.error(`[Updater] ${this.updateDetailsJSON} \u6587\u4EF6\u672A\u627E\u5230`);
    }
    return data;
  }
  async setFeedURL(feedURL) {
    try {
      this.logger.log("[Updater] \u8BBE\u7F6E\u66F4\u65B0\u6E90: ", feedURL);
      await this.autoUpdater.setFeedURL(feedURL);
    } catch (e) {
      this.logger.error("[Updater] \u8BBE\u7F6E\u66F4\u65B0\u6E90\u5931\u8D25 ", e);
    }
  }
  createSplashWindow() {
    this.updaterWindow = (0, import_splash.getWindow)();
  }
  attachListeners(resolve, reject) {
    if (!import_electron.app.isPackaged) {
      setTimeout(() => resolve(), 1e3);
      return;
    }
    this.autoUpdater.removeAllListeners();
    this.pollForUpdates(resolve, reject);
    this.logger.log("[Updater] \u7ED1\u5B9A\u76D1\u542C\u5668");
    this.autoUpdater.on("checking-for-update", () => {
      this.logger.log("[Updater] \u6B63\u5728\u68C0\u67E5\u66F4\u65B0");
      (0, import_splash.dispatchEvent)(this.updaterWindow, "checking-for-update");
    });
    this.autoUpdater.on("error", (error) => {
      this.logger.error("[Updater] \u66F4\u65B0\u51FA\u9519: ", error);
      this.emit("error", error);
      (0, import_splash.dispatchEvent)(this.updaterWindow, "error", error);
      reject(error);
    });
    this.autoUpdater.on("update-available", async (info) => {
      this.logger.info("[Updater] \u53D1\u73B0\u65B0\u7248\u672C ", info);
      this.emit("update-available", info);
      (0, import_splash.dispatchEvent)(this.updaterWindow, "update-available", info);
      const updateDetails = await this.getAutoUpdateDetails();
      if (updateDetails) {
        this.logger.info("[Updater] \u4E0A\u6B21\u66F4\u65B0\u8BB0\u5F55: ", updateDetails);
        if (updateDetails.isDelta && updateDetails.appVersion === import_electron.app.getVersion()) {
          this.logger.info("[Updater] \u4E0A\u6B21\u589E\u91CF\u66F4\u65B0\u5931\u8D25\uFF0C\u5C1D\u8BD5\u5168\u91CF\u66F4\u65B0");
          this.autoUpdater.downloadUpdate();
          return;
        }
      }
      this.doSmartDownload(info);
    });
    this.autoUpdater.on("download-progress", (info) => {
      this.emit("download-progress", info);
      (0, import_splash.dispatchEvent)(this.updaterWindow, "download-progress", {
        percentage: parseFloat(info.percent).toFixed(1),
        transferred: (0, import_download.niceBytes)(info.transferred),
        total: (0, import_download.niceBytes)(info.total)
      });
    });
    this.logger.info("[Updater] \u5DF2\u6DFB\u52A0\u9000\u51FA\u76D1\u542C\u5668");
    this.boundOnQuit = this.onQuit.bind(this);
    import_electron.app.on("quit", this.boundOnQuit);
    this.autoUpdater.on("update-not-available", () => {
      this.logger.info("[Updater] \u65E0\u53EF\u7528\u66F4\u65B0");
      this.emit("update-not-available");
      (0, import_splash.dispatchEvent)(this.updaterWindow, "update-not-available");
      resolve();
    });
    this.autoUpdater.on("update-downloaded", (info) => {
      this.logger.info("[Updater] \u66F4\u65B0\u5DF2\u4E0B\u8F7D ", info);
      this.emit("update-downloaded", info);
      (0, import_splash.dispatchEvent)(this.updaterWindow, "update-downloaded", info);
      this.handleUpdateDownloaded(info, resolve);
    });
  }
  async onQuit(_event, _exitCode) {
    this.logger.info("[Updater] onQuit");
    if (this.autoUpdateInfo) {
      this.logger.info("[Updater] On Quit ", this.autoUpdateInfo);
      if (this.autoUpdateInfo.delta) {
        try {
          this.logger.log(this.autoUpdateInfo.deltaPath, [
            `/APPPATH="${this.appPath}"`,
            '/RESTART="0"'
          ]);
          (0, import_child_process.execSync)(
            `${this.autoUpdateInfo.deltaPath} /APPPATH="${this.appPath}" /RESTART="0"`,
            { stdio: "ignore" }
          );
        } catch (err) {
          this.logger.error("[Updater] \u542F\u52A8\u8FDB\u7A0B\u5931\u8D25 ", err);
        }
      } else {
        await this.applyUpdate(this.autoUpdateInfo.version, false);
      }
    } else {
      this.logger.info("[Updater] \u6B63\u5728\u9000\u51FA\uFF0C\u65E0\u53EF\u7528\u66F4\u65B0");
    }
  }
  async quitAndInstall() {
    this.logger.info("[Updater] \u9000\u51FA\u5E76\u5B89\u88C5");
    if (!this.autoUpdateInfo) {
      this.logger.info("[Updater] \u65E0\u53EF\u7528\u66F4\u65B0");
      return;
    }
    if (this.autoUpdateInfo.delta) {
      this.logger.info("[Updater] \u6B63\u5728\u5E94\u7528\u589E\u91CF\u66F4\u65B0");
      await this.applyDeltaUpdate(
        this.autoUpdateInfo.deltaPath,
        this.autoUpdateInfo.version
      );
    } else {
      this.logger.info("[Updater] \u6B63\u5728\u5E94\u7528\u5168\u91CF\u66F4\u65B0");
      await this.applyUpdate(this.autoUpdateInfo.version, true);
    }
  }
  async handleUpdateDownloaded(info, resolve) {
    this.autoUpdateInfo = info;
    if (this.updaterWindow) {
      this.logger.info("[Updater] \u89E6\u53D1\u66F4\u65B0");
      await this.quitAndInstall();
      resolve();
    } else {
      this.logger.info("[Updater] \u672A\u627E\u5230\u542F\u52A8\u7A97\u53E3\uFF0C\u4EC5\u663E\u793A\u901A\u77E5");
      this.showUpdateNotification(this.autoUpdateInfo);
    }
  }
  showUpdateNotification(info) {
    const notification = new import_electron.Notification({
      title: `${getAppName()} ${info.version} \u53EF\u7528\uFF0C\u5C06\u5728\u9000\u51FA\u65F6\u5B89\u88C5\u3002`,
      body: "\u70B9\u51FB\u7ACB\u5373\u5E94\u7528\u66F4\u65B0\u3002",
      silent: true
    });
    notification.show();
    notification.on("click", () => {
      this.quitAndInstall();
    });
  }
  async boot({ splashScreen }) {
    this.logger.info("[Updater] \u6B63\u5728\u542F\u52A8");
    if (splashScreen) {
      const startURL = (0, import_splash.getStartURL)();
      this.createSplashWindow();
      this.updaterWindow.loadURL(startURL);
    }
    const updateCheckPromise = new Promise((resolve, reject) => {
      this.attachListeners(resolve, reject);
      if (!splashScreen) resolve();
    });
    const timeoutMs = 5e3;
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        this.logger.warn(
          `[Updater] \u68C0\u67E5\u66F4\u65B0\u8D85\u65F6 (${timeoutMs / 1e3}s)\uFF0C\u7EE7\u7EED\u542F\u52A8`
        );
        resolve();
      }, timeoutMs);
    });
    return Promise.race([updateCheckPromise, timeoutPromise]).then(() => {
      this.logger.info("[Updater] \u542F\u52A8\u5B8C\u6210");
      if (splashScreen && this.updaterWindow && !this.updaterWindow.isDestroyed()) {
        this.updaterWindow.close();
        this.updaterWindow = null;
      }
    }).catch((err) => {
      this.logger.error("[Updater] \u542F\u52A8\u5931\u8D25 ", err);
      if (splashScreen && this.updaterWindow && !this.updaterWindow.isDestroyed()) {
        this.updaterWindow.close();
        this.updaterWindow = null;
      }
    });
  }
  getDeltaURL({ deltaPath }) {
    return (0, import_utils.newUrlFromBase)(deltaPath, this.hostURL);
  }
  getDeltaJSONUrl() {
    return (0, import_utils.newUrlFromBase)("delta-win.json", this.hostURL);
  }
  async doSmartDownload({
    version,
    releaseDate
  }) {
    const deltaDownloaded = (deltaPath2) => {
      this.logger.info(`[Updater] \u5DF2\u4E0B\u8F7D ${deltaPath2}`);
      this.autoUpdater.emit("update-downloaded", {
        delta: true,
        deltaPath: deltaPath2,
        version,
        releaseDate
      });
    };
    let channel = getChannel();
    if (!channel) return;
    channel = channel === "latest" ? "stable" : channel;
    const appVersion = import_electron.app.getVersion();
    const deltaJSONUrl = this.getDeltaJSONUrl();
    let deltaJSON = null;
    try {
      this.logger.info(`[Updater] \u6B63\u5728\u83B7\u53D6\u589E\u91CF JSON: ${deltaJSONUrl}`);
      const response = await (0, import_cross_fetch.default)(deltaJSONUrl);
      if (response.status !== 200) {
        this.logger.error(
          `[Updater] \u83B7\u53D6 ${deltaJSONUrl} \u5931\u8D25: ${response.status}`
        );
      } else {
        deltaJSON = await response.json();
      }
    } catch (err) {
      this.logger.error("\u83B7\u53D6\u5931\u8D25 ", deltaJSONUrl);
    }
    if (!deltaJSON) {
      this.logger.error("[Updater] \u672A\u627E\u5230\u589E\u91CF\u66F4\u65B0");
      this.autoUpdater.downloadUpdate();
      return;
    }
    const deltaDetails = deltaJSON[appVersion];
    if (!deltaDetails) {
      this.logger.error("[Updater] \u672A\u627E\u5230\u6B64\u7248\u672C\u7684\u589E\u91CF\u66F4\u65B0 ", appVersion);
      this.autoUpdater.downloadUpdate();
      return;
    }
    const deltaURL = this.getDeltaURL({ deltaPath: deltaDetails.path });
    this.logger.info("[Updater] Delta URL ", deltaURL);
    const shaVal = deltaDetails.sha256;
    if (!shaVal) {
      this.logger.info("[Updater] \u65E0\u6CD5\u83B7\u53D6\u589E\u91CF SHA\uFF0C\u5C1D\u8BD5\u5168\u91CF\u4E0B\u8F7D");
      this.autoUpdater.downloadUpdate();
      return;
    }
    const deltaPath = import_path.default.join(this.deltaHolderPath, deltaDetails.path);
    if (import_fs_extra.default.existsSync(deltaPath) && isSHACorrect(deltaPath, shaVal)) {
      this.logger.info("[Updater] \u589E\u91CF\u6587\u4EF6\u5DF2\u5B58\u5728 ", deltaPath);
      deltaDownloaded(deltaPath);
      return;
    }
    this.logger.info("[Updater] \u5F00\u59CB\u4E0B\u8F7D\u589E\u91CF\u6587\u4EF6 ", deltaURL);
    await import_fs_extra.default.ensureDir(this.deltaHolderPath);
    const onProgressCb = ({
      percentage,
      transferred,
      total
    }) => {
      this.logger.info(
        `\u4E0B\u8F7D\u8FDB\u5EA6=${percentage}%, transferred = ${transferred} / ${total}`
      );
      this.emit("download-progress", { percentage, transferred, total });
      (0, import_splash.dispatchEvent)(this.updaterWindow, "download-progress", {
        percentage: parseFloat(percentage).toFixed(1),
        transferred: (0, import_download.niceBytes)(transferred),
        total: (0, import_download.niceBytes)(total)
      });
    };
    try {
      await (0, import_download.downloadFile)(deltaURL, deltaPath, onProgressCb.bind(this));
      if (!isSHACorrect(deltaPath, shaVal)) {
        this.logger.info("[Updater] \u589E\u91CF\u4E0B\u8F7D\u5B8C\u6210\uFF0CSHA \u6821\u9A8C\u5931\u8D25\uFF0C\u5C1D\u8BD5\u5168\u91CF\u4E0B\u8F7D");
        this.autoUpdater.downloadUpdate();
        return;
      }
      deltaDownloaded(deltaPath);
    } catch (err) {
      this.logger.error("[Updater] \u589E\u91CF\u4E0B\u8F7D\u5931\u8D25\uFF0C\u5C1D\u8BD5\u5168\u91CF\u4E0B\u8F7D", err);
      this.autoUpdater.downloadUpdate();
    }
  }
  async applyUpdate(version, forceRunAfter = true) {
    this.logger.info("[Updater] \u6B63\u5728\u5E94\u7528\u5168\u91CF\u66F4\u65B0");
    await this.writeAutoUpdateDetails({
      isDelta: false,
      attemptedVersion: version
    });
    this.ensureSafeQuitAndInstall();
    setTimeout(
      () => this.autoUpdater.quitAndInstall(true, forceRunAfter),
      100
    );
  }
  async applyDeltaUpdate(deltaPath, version) {
    await this.writeAutoUpdateDetails({
      isDelta: true,
      attemptedVersion: version
    });
    this.ensureSafeQuitAndInstall();
    try {
      this.logger.log(deltaPath, [
        `/APPPATH="${this.appPath}"`,
        '/RESTART="1"'
      ]);
      (0, import_child_process.execSync)(
        `${deltaPath} /APPPATH="${this.appPath}" /RESTART="1"`,
        { stdio: "ignore" }
      );
      if (this.boundOnQuit) {
        import_electron.app.removeListener("quit", this.boundOnQuit);
      }
      import_electron.app.isQuitting = true;
      import_electron.app.quit();
    } catch (err) {
      this.logger.info("[Updater] \u5E94\u7528\u589E\u91CF\u66F4\u65B0\u5931\u8D25 ", err);
    }
  }
}
var updater_default = DeltaUpdater;
