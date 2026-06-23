const { EventEmitter } = require('events');
const { app, BrowserWindow, Notification } = require('electron');
const { autoUpdater: electronAutoUpdater } = require('electron-updater');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const fetch = require('cross-fetch');
const semver = require('semver');
const { execSync } = require('child_process');
const yaml = require('yaml');
const { downloadFile, niceBytes } = require('./download');
const { newUrlFromBase } = require('./utils');
const { getStartURL, getWindow, dispatchEvent } = require('./splash');

const fifteenMinutes = 15 * 60 * 1000;

function getChannel() {
  var version = app.getVersion();
  var preRelease = semver.prerelease(version);
  if (!preRelease) return 'latest';
  return preRelease[0];
}

function getAppName() { return app.getName(); }

function computeSHA256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  var fileBuffer = fs.readFileSync(filePath);
  var sum = crypto.createHash('sha256');
  sum.update(fileBuffer);
  return sum.digest('hex');
}

function isSHACorrect(filePath, correctSHA) {
  try { return computeSHA256(filePath) === correctSHA; } catch (e) { return false; }
}

function stripTrailingSlash(str) { return str.endsWith('/') ? str.slice(0, -1) : str; }

class DeltaUpdater extends EventEmitter {
  constructor(options) {
    super();
    this.autoUpdateInfo = null;
    this.logger = (options && options.logger) || console;
    this.autoUpdater = (options && options.autoUpdater) || electronAutoUpdater;
    this.hostURL = (options && options.hostURL) || null;
    this.updaterWindow = null;
    this.boundOnQuit = null;
    this._timedOut = false;

    if (app.isPackaged) {
      this.setConfigPath();
      this.prepareUpdater();
      this.appPath = stripTrailingSlash(path.dirname(app.getPath('exe')));
      this.appName = getAppName();
      this.logger.info('[Updater] 应用路径 = ', this.appPath);
    }
  }

  setConfigPath() {
    var configPath = path.join(process.resourcesPath, 'app-update.yml');
    this.updateConfig = yaml.parse(fs.readFileSync(configPath, 'utf8'));
  }

  async prepareUpdater() {
    var channel = getChannel();
    if (!channel) return;
    this.logger.info('[Updater]  CHANNEL = ', channel);
    this.autoUpdater.channel = channel;
    this.autoUpdater.logger = this.logger;
    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;

    this.deltaUpdaterRootPath = path.join(app.getPath('appData'), '../Local/' + this.updateConfig.updaterCacheDirName);
    this.updateDetailsJSON = path.join(app.getPath('userData'), 'delta-update-details.json');
    this.deltaHolderPath = path.join(app.getPath('userData'), 'deltas');
  }

  checkForUpdates(resolve, reject) {
    this.logger.log('[Updater] 正在检查更新...');
    this.autoUpdater.checkForUpdates();
  }

  pollForUpdates(resolve, reject) {
    this.checkForUpdates(resolve, reject);
    setInterval(() => this.checkForUpdates(resolve, reject), fifteenMinutes);
  }

  ensureSafeQuitAndInstall() {
    this.logger.info('[Updater] 安全退出并安装');
    app.removeAllListeners('window-all-closed');
    BrowserWindow.getAllWindows().forEach(function (w) {
      if (w === this.updaterWindow) return;
      w.removeAllListeners('close');
      if (!w.isDestroyed()) w.close();
    }.bind(this));
  }

  async writeAutoUpdateDetails(_ref) {
    var isDelta = _ref.isDelta, attemptedVersion = _ref.attemptedVersion;
    var date = new Date();
    var data = { isDelta: isDelta, attemptedVersion: attemptedVersion, appVersion: app.getVersion(), timestamp: date.getTime(), timeHuman: date.toString() };
    try { await fs.writeJSON(this.updateDetailsJSON, data); } catch (e) { this.logger.error('[Updater] ', e); }
  }

  async getAutoUpdateDetails() {
    var data = null;
    try { data = await fs.readJSON(this.updateDetailsJSON); } catch (e) { this.logger.error('[Updater] ' + this.updateDetailsJSON + ' 文件未找到'); }
    return data;
  }

  async setFeedURL(feedURL) {
    try {
      this.logger.log('[Updater] 设置更新源: ', feedURL);
      await this.autoUpdater.setFeedURL(feedURL);
    } catch (e) { this.logger.error('[Updater] 设置更新源失败 ', e); }
  }

  createSplashWindow() { this.updaterWindow = getWindow(); }

  attachListeners(resolve, reject) {
    if (!app.isPackaged) { setTimeout(function () { resolve(); }, 1000); return; }
    this.autoUpdater.removeAllListeners();
    this.pollForUpdates(resolve, reject);
    this.logger.log('[Updater] 绑定监听器');

    this.autoUpdater.on('checking-for-update', function () {
      dispatchEvent(this.updaterWindow, 'checking-for-update');
    }.bind(this));

    this.autoUpdater.on('error', function (error) {
      this.logger.error('[Updater] 更新出错: ', error);
      this.emit('error', error);
      dispatchEvent(this.updaterWindow, 'error', error);
      reject(error);
    }.bind(this));

    this.autoUpdater.on('update-available', async function (info) {
      this.logger.info('[Updater] 发现新版本 ', info);
      this.emit('update-available', info);
      dispatchEvent(this.updaterWindow, 'update-available', info);

      var updateDetails = await this.getAutoUpdateDetails();
      if (updateDetails) {
        this.logger.info('[Updater] 上次更新记录: ', updateDetails);
        if (updateDetails.isDelta && updateDetails.appVersion === app.getVersion()) {
          this.logger.info('[Updater] 上次增量更新失败，尝试全量更新');
          this.autoUpdater.downloadUpdate();
          return;
        }
      }
      this.doSmartDownload(info);
    }.bind(this));

    this.autoUpdater.on('download-progress', function (info) {
      this.emit('download-progress', info);
      dispatchEvent(this.updaterWindow, 'download-progress', {
        percentage: parseFloat(info.percent).toFixed(1),
        transferred: niceBytes(info.transferred),
        total: niceBytes(info.total),
      });
    }.bind(this));

    this.logger.info('[Updater] 已添加退出监听器');
    this.boundOnQuit = this.onQuit.bind(this);
    app.on('quit', this.boundOnQuit);

    this.autoUpdater.on('update-not-available', function () {
      this.logger.info('[Updater] 无可用更新');
      this.emit('update-not-available');
      dispatchEvent(this.updaterWindow, 'update-not-available');
      resolve();
    }.bind(this));

    this.autoUpdater.on('update-downloaded', function (info) {
      this.logger.info('[Updater] 更新已下载 ', info);
      this.emit('update-downloaded', info);
      dispatchEvent(this.updaterWindow, 'update-downloaded', info);
      this.handleUpdateDownloaded(info, resolve);
    }.bind(this));
  }

  async onQuit(event, exitCode) {
    this.logger.info('[Updater] onQuit');
    if (this.autoUpdateInfo) {
      this.logger.info('[Updater] On Quit ', this.autoUpdateInfo);
      if (this.autoUpdateInfo.delta) {
        this.logger.info('[Updater] 退出时应用增量更新');
        try {
          execSync('"' + this.autoUpdateInfo.deltaPath + '" /APPPATH="' + this.appPath + '" /RESTART="0"', { stdio: 'ignore' });
        } catch (err) { this.logger.error('[Updater] delta.exe(onQuit) 执行失败: ', err); }
      } else {
        await this.applyUpdate(this.autoUpdateInfo.version, false);
      }
    } else {
      this.logger.info('[Updater] 正在退出，无可用更新');
    }
  }

  async quitAndInstall() {
    this.logger.info('[Updater] 退出并安装');
    if (!this.autoUpdateInfo) { this.logger.info('[Updater] 无可用更新'); return; }
    if (this.autoUpdateInfo.delta) {
      this.logger.info('[Updater] 正在应用增量更新');
      await this.applyDeltaUpdate(this.autoUpdateInfo.deltaPath, this.autoUpdateInfo.version);
    } else {
      this.logger.info('[Updater] 正在应用全量更新');
      await this.applyUpdate(this.autoUpdateInfo.version, true);
    }
  }

  async handleUpdateDownloaded(info, resolve) {
    this.autoUpdateInfo = info;
    if (this._timedOut) {
      this.logger.info('[Updater] 启动已超时，后台安装更新');
      await this.quitAndInstall();
      return;
    }
    if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
      this.logger.info('[Updater] 触发更新');
      await this.quitAndInstall();
    } else {
      this.logger.info('[Updater] 未找到启动窗口，仅显示通知');
      this.showUpdateNotification(this.autoUpdateInfo);
    }
  }

  showUpdateNotification(info) {
    var notification = new Notification({
      title: getAppName() + ' ' + info.version + ' 可用，将在退出时安装。',
      body: '点击立即应用更新。',
      silent: true,
    });
    notification.show();
    notification.on('click', function () { this.quitAndInstall(); }.bind(this));
  }

  async boot(_ref2) {
    var splashScreen = (_ref2 && _ref2.splashScreen) || false;
    var splashLogo = _ref2 && _ref2.splashLogo;
    this.logger.info('[Updater] 正在启动');

    if (splashScreen) {
      var startURL = getStartURL(splashLogo);
      this.createSplashWindow();
      this.updaterWindow.loadURL(startURL);
    }

    var _this = this;
    var updateCheckPromise = new Promise(function (resolve, reject) {
      _this.attachListeners(resolve, reject);
      if (!splashScreen) resolve();
    });

    var timeoutMs = 5000;
    var timeoutPromise = new Promise(function (resolve) {
      setTimeout(function () {
        _this.logger.warn('[Updater] 检查更新超时 (' + (timeoutMs / 1000) + 's)，继续启动');
        _this._timedOut = true;
        resolve();
      }, timeoutMs);
    });

    return Promise.race([updateCheckPromise, timeoutPromise]).then(function () {
      _this.logger.info('[Updater] 启动完成');
      if (splashScreen && _this.updaterWindow && !_this.updaterWindow.isDestroyed()) {
        _this.updaterWindow.close();
        _this.updaterWindow = null;
      }
    }).catch(function (err) {
      _this.logger.error('[Updater] 启动失败 ', err);
      if (splashScreen && _this.updaterWindow && !_this.updaterWindow.isDestroyed()) {
        _this.updaterWindow.close();
        _this.updaterWindow = null;
      }
    });
  }

  getDeltaURL(_ref3) { return newUrlFromBase(_ref3.deltaPath, this.hostURL); }
  getDeltaJSONUrl() { return newUrlFromBase('delta-win.json', this.hostURL); }

  async doSmartDownload(_ref4) {
    var version = _ref4.version, releaseDate = _ref4.releaseDate;
    var _this = this;

    function deltaDownloaded(deltaPath) {
      _this.logger.info('[Updater] 已下载 ' + deltaPath);
      _this.autoUpdater.emit('update-downloaded', { delta: true, deltaPath: deltaPath, version: version, releaseDate: releaseDate });
    }

    var channel = getChannel();
    if (!channel) return;
    channel = channel === 'latest' ? 'stable' : channel;
    var appVersion = app.getVersion();

    // 1. 拉取 delta-win.json
    var deltaJSONUrl = this.getDeltaJSONUrl();
    var deltaJSON = null;
    try {
      this.logger.info('[Updater] 正在获取增量 JSON: ' + deltaJSONUrl);
      var response = await fetch(deltaJSONUrl);
      if (response.status !== 200) {
        this.logger.error('[Updater] 获取 ' + deltaJSONUrl + ' 失败: ' + response.status);
      } else { deltaJSON = await response.json(); }
    } catch (err) { this.logger.error('获取失败 ', deltaJSONUrl); }

    if (!deltaJSON) { this.logger.error('[Updater] 未找到增量更新'); this.autoUpdater.downloadUpdate(); return; }

    // 2. 匹配当前版本
    var deltaDetails = deltaJSON[appVersion];
    if (!deltaDetails) { this.logger.error('[Updater] 未找到此版本的增量更新 ' + appVersion); this.autoUpdater.downloadUpdate(); return; }

    var deltaURL = this.getDeltaURL({ deltaPath: deltaDetails.path });
    this.logger.info('[Updater] Delta URL ', deltaURL);
    var shaVal = deltaDetails.sha256;
    if (!shaVal) { this.logger.info('[Updater] 无法获取增量 SHA，尝试全量下载'); this.autoUpdater.downloadUpdate(); return; }

    // 3. 检查本地缓存
    var deltaPath = path.join(this.deltaHolderPath, deltaDetails.path);
    if (fs.existsSync(deltaPath) && isSHACorrect(deltaPath, shaVal)) {
      this.logger.info('[Updater] 增量文件已存在 ', deltaPath);
      deltaDownloaded(deltaPath);
      return;
    }

    // 4. 下载
    this.logger.info('[Updater] 开始下载增量文件 ', deltaURL);
    await fs.ensureDir(this.deltaHolderPath);

    function onProgressCb(_ref5) {
      var pct = _ref5.percentage, transferred = _ref5.transferred, total = _ref5.total;
      _this.logger.info('下载进度=' + pct + '%, transferred = ' + transferred + ' / ' + total);
      _this.emit('download-progress', { percentage: pct, transferred: transferred, total: total });
      dispatchEvent(_this.updaterWindow, 'download-progress', { percentage: parseFloat(pct).toFixed(1), transferred: niceBytes(transferred), total: niceBytes(total) });
    }

    try {
      await downloadFile(deltaURL, deltaPath, onProgressCb);
      if (!isSHACorrect(deltaPath, shaVal)) { this.logger.info('[Updater] 增量下载完成，SHA 校验失败，尝试全量下载'); this.autoUpdater.downloadUpdate(); return; }
      deltaDownloaded(deltaPath);
    } catch (err) { this.logger.error('[Updater] 增量下载失败，尝试全量下载', err); this.autoUpdater.downloadUpdate(); }
  }

  clearDeltaCache() {
    try {
      if (this.deltaHolderPath && fs.existsSync(this.deltaHolderPath)) { fs.emptyDirSync(this.deltaHolderPath); this.logger.info('[Updater] 已清理增量缓存目录'); }
    } catch (err) { this.logger.error('[Updater] 清理增量缓存失败: ', err); }
  }

  async applyUpdate(version, forceRunAfter) {
    if (forceRunAfter === undefined) forceRunAfter = true;
    this.logger.info('[Updater] 正在应用全量更新');
    await this.writeAutoUpdateDetails({ isDelta: false, attemptedVersion: version });
    if (this.boundOnQuit) { app.removeListener('quit', this.boundOnQuit); this.boundOnQuit = null; }
    this.ensureSafeQuitAndInstall();
    setTimeout(function () { this.autoUpdater.quitAndInstall(true, forceRunAfter); }.bind(this), 100);
  }

  async applyDeltaUpdate(deltaPath, version) {
    await this.writeAutoUpdateDetails({ isDelta: true, attemptedVersion: version });
    if (this.boundOnQuit) { app.removeListener('quit', this.boundOnQuit); this.boundOnQuit = null; }
    this.ensureSafeQuitAndInstall();
    try {
      this.logger.log(deltaPath, ['/APPPATH="' + this.appPath + '"', '/RESTART="1"']);
      execSync('"' + deltaPath + '" /APPPATH="' + this.appPath + '" /RESTART="1"', { stdio: 'ignore' });
      app.isQuitting = true;
      app.quit();
    } catch (err) {
      this.logger.error('[Updater] 增量更新执行失败: ', err);
      app.isQuitting = true;
      app.quit();
    }
  }
}

module.exports = DeltaUpdater;
