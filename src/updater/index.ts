/**
 * DeltaUpdater — Windows-only
 * 基于 @electron-delta/updater v0.1.17 精简
 */
import { EventEmitter } from 'events';
import { app, BrowserWindow, Notification } from 'electron';
import { autoUpdater as electronAutoUpdater } from 'electron-updater';

import path from 'path';
import crypto from 'crypto';
import fs from 'fs-extra';
import fetch from 'cross-fetch';
import semver from 'semver';
import { spawn } from 'child_process';
import yaml from 'yaml';

import { downloadFile, niceBytes } from './download';
import { newUrlFromBase } from './utils';
import { getStartURL, getWindow, dispatchEvent } from './splash';

const fifteenMinutes = 15 * 60 * 1000;

const getChannel = () => {
  const version = app.getVersion();
  const preRelease = semver.prerelease(version);
  if (!preRelease) return 'latest';
  return preRelease[0];
};

const getAppName = () => app.getName();

const computeSHA256 = (filePath: string) => {
  if (!fs.existsSync(filePath)) return null;
  const fileBuffer = fs.readFileSync(filePath);
  const sum = crypto.createHash('sha256');
  sum.update(fileBuffer);
  return sum.digest('hex');
};

const isSHACorrect = (filePath: string, correctSHA: string) => {
  try {
    return computeSHA256(filePath) === correctSHA;
  } catch {
    return false;
  }
};

const stripTrailingSlash = (str: string) =>
  str.endsWith('/') ? str.slice(0, -1) : str;

interface UpdateInfo {
  delta: boolean;
  deltaPath: string;
  version: string;
  releaseDate?: string;
}

interface DeltaDetails {
  path: string;
  sha256: string;
}

interface AutoUpdateDetails {
  isDelta: boolean;
  attemptedVersion: string;
  appVersion: string;
  timestamp: number;
  timeHuman: string;
}

class DeltaUpdater extends EventEmitter {
  autoUpdateInfo: UpdateInfo | null = null;
  logger: any;
  autoUpdater: any;
  hostURL: string | null = null;
  updateConfig!: any;
  appPath!: string;
  appName!: string;
  deltaUpdaterRootPath!: string;
  updateDetailsJSON!: string;
  deltaHolderPath!: string;
  updaterWindow: BrowserWindow | null = null;
  boundOnQuit: ((...args: any[]) => void) | null = null;
  private _timedOut = false;

  constructor(options: { logger?: any; autoUpdater?: any; hostURL?: string }) {
    super();
    this.autoUpdateInfo = null;
    this.logger = options.logger || console;
    this.autoUpdater = options.autoUpdater || electronAutoUpdater;
    this.hostURL = options.hostURL || null;

    if (app.isPackaged) {
      this.setConfigPath();
      this.prepareUpdater();
      this.appPath = stripTrailingSlash(path.dirname(app.getPath('exe')));
      this.appName = getAppName();
      this.logger.info('[Updater] 应用路径 = ', this.appPath);
    }
  }

  setConfigPath() {
    const updateConfigPath = path.join(
      process.resourcesPath!,
      'app-update.yml',
    );
    this.updateConfig = yaml.parse(fs.readFileSync(updateConfigPath, 'utf8'));
  }

  async prepareUpdater() {
    const channel = getChannel();
    if (!channel) return;

    this.logger.info('[Updater]  CHANNEL = ', channel);
    this.autoUpdater.channel = channel;
    this.autoUpdater.logger = this.logger;

    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;

    this.deltaUpdaterRootPath = path.join(
      app.getPath('appData'),
      `../Local/${this.updateConfig.updaterCacheDirName}`,
    );

    // update-details.json 存到 userData，避免被 clearUpdateCache 误删
    this.updateDetailsJSON = path.join(
      app.getPath('userData'),
      'delta-update-details.json',
    );
    this.deltaHolderPath = path.join(this.deltaUpdaterRootPath, './deltas');
  }

  checkForUpdates(resolve: () => void, reject: (err: Error) => void) {
    this.logger.log('[Updater] 正在检查更新...');
    this.autoUpdater.checkForUpdates();
  }

  pollForUpdates(resolve: () => void, reject: (err: Error) => void) {
    this.checkForUpdates(resolve, reject);
    setInterval(() => {
      this.checkForUpdates(resolve, reject);
    }, fifteenMinutes);
  }

  ensureSafeQuitAndInstall() {
    this.logger.info('[Updater] 安全退出并安装');
    app.removeAllListeners('window-all-closed');
    const browserWindows = BrowserWindow.getAllWindows();
    browserWindows.forEach((browserWindow) => {
      if (browserWindow === this.updaterWindow) return;
      browserWindow.removeAllListeners('close');
      if (!browserWindow.isDestroyed()) {
        browserWindow.close();
      }
    });
  }

  async writeAutoUpdateDetails({
    isDelta,
    attemptedVersion,
  }: {
    isDelta: boolean;
    attemptedVersion: string;
  }) {
    const date = new Date();
    const data = {
      isDelta,
      attemptedVersion,
      appVersion: app.getVersion(),
      timestamp: date.getTime(),
      timeHuman: date.toString(),
    };
    try {
      await fs.writeJSON(this.updateDetailsJSON, data);
    } catch (e) {
      this.logger.error('[Updater] ', e);
    }
  }

  async getAutoUpdateDetails(): Promise<AutoUpdateDetails | null> {
    let data = null;
    try {
      data = await fs.readJSON(this.updateDetailsJSON);
    } catch (e) {
      this.logger.error(`[Updater] ${this.updateDetailsJSON} 文件未找到`);
    }
    return data;
  }

  async setFeedURL(feedURL: string) {
    try {
      this.logger.log('[Updater] 设置更新源: ', feedURL);
      await this.autoUpdater.setFeedURL(feedURL);
    } catch (e) {
      this.logger.error('[Updater] 设置更新源失败 ', e);
    }
  }

  createSplashWindow() {
    this.updaterWindow = getWindow();
  }

  attachListeners(resolve: () => void, reject: (err: Error) => void) {
    if (!app.isPackaged) {
      setTimeout(() => resolve(), 1000);
      return;
    }
    this.autoUpdater.removeAllListeners();
    this.pollForUpdates(resolve, reject);

    this.logger.log('[Updater] 绑定监听器');

    this.autoUpdater.on('checking-for-update', () => {
      this.logger.log('[Updater] 正在检查更新');
      dispatchEvent(this.updaterWindow!, 'checking-for-update');
    });

    this.autoUpdater.on('error', (error: Error) => {
      this.logger.error('[Updater] 更新出错: ', error);
      this.emit('error', error);
      dispatchEvent(this.updaterWindow!, 'error', error);
      reject(error);
    });

    this.autoUpdater.on('update-available', async (info: any) => {
      this.logger.info('[Updater] 发现新版本 ', info);
      this.emit('update-available', info);
      dispatchEvent(this.updaterWindow!, 'update-available', info);

      const updateDetails = await this.getAutoUpdateDetails();
      if (updateDetails) {
        this.logger.info('[Updater] 上次更新记录: ', updateDetails);
        if (
          updateDetails.isDelta &&
          updateDetails.appVersion === app.getVersion()
        ) {
          this.logger.info('[Updater] 上次增量更新失败，尝试全量更新');
          this.autoUpdater.downloadUpdate();
          return;
        }
      }

      this.doSmartDownload(info);
    });

    this.autoUpdater.on('download-progress', (info: any) => {
      this.emit('download-progress', info);
      dispatchEvent(this.updaterWindow!, 'download-progress', {
        percentage: parseFloat(info.percent).toFixed(1),
        transferred: niceBytes(info.transferred),
        total: niceBytes(info.total),
      });
    });

    this.logger.info('[Updater] 已添加退出监听器');

    this.boundOnQuit = this.onQuit.bind(this);
    app.on('quit', this.boundOnQuit);

    this.autoUpdater.on('update-not-available', () => {
      this.logger.info('[Updater] 无可用更新');
      this.emit('update-not-available');
      dispatchEvent(this.updaterWindow!, 'update-not-available');
      resolve();
    });

    this.autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.logger.info('[Updater] 更新已下载 ', info);
      this.emit('update-downloaded', info);
      dispatchEvent(this.updaterWindow!, 'update-downloaded', info);
      this.handleUpdateDownloaded(info, resolve);
    });
  }

  async onQuit(_event?: Event, _exitCode?: number) {
    this.logger.info('[Updater] onQuit');
    if (this.autoUpdateInfo) {
      this.logger.info('[Updater] On Quit ', this.autoUpdateInfo);
      if (this.autoUpdateInfo.delta) {
        this.logger.info('[Updater] 退出时应用增量更新');
        const child = spawn(this.autoUpdateInfo.deltaPath, [
          `/APPPATH="${this.appPath}"`,
          '/RESTART="0"',
        ], {
          stdio: ['ignore', 'ignore', 'pipe'],
          detached: true,
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          const msg = chunk.toString().trim();
          if (msg) {
            this.logger.error('[Updater] delta.exe(onQuit) stderr: ', msg);
          }
        });
        child.on('error', (err) => {
          this.logger.error('[Updater] delta.exe(onQuit) 启动失败: ', err);
        });
        child.on('close', (code) => {
          this.logger.info(`[Updater] delta.exe(onQuit) 已退出, code=${code}`);
        });
        child.unref();
      } else {
        await this.applyUpdate(this.autoUpdateInfo.version, false);
      }
    } else {
      this.logger.info('[Updater] 正在退出，无可用更新');
    }
  }

  async quitAndInstall() {
    this.logger.info('[Updater] 退出并安装');

    if (!this.autoUpdateInfo) {
      this.logger.info('[Updater] 无可用更新');
      return;
    }

    if (this.autoUpdateInfo.delta) {
      this.logger.info('[Updater] 正在应用增量更新');
      await this.applyDeltaUpdate(
        this.autoUpdateInfo.deltaPath,
        this.autoUpdateInfo.version,
      );
    } else {
      this.logger.info('[Updater] 正在应用全量更新');
      await this.applyUpdate(this.autoUpdateInfo.version, true);
    }
  }

  async handleUpdateDownloaded(info: UpdateInfo, resolve: () => void) {
    this.autoUpdateInfo = info;

    // 超时后不再安装更新，此时缓存可能已被清理，且闪屏已关闭
    if (this._timedOut) {
      this.logger.info('[Updater] 启动已超时，跳过更新安装，下次启动重试');
      return;
    }

    if (this.updaterWindow) {
      this.logger.info('[Updater] 触发更新');
      await this.quitAndInstall();
      // 更新已触发，进程即将退出，不应 resolve boot promise
      // 否则旧进程会继续执行 app.run()，创建无效窗口
    } else {
      this.logger.info('[Updater] 未找到启动窗口，仅显示通知');
      this.showUpdateNotification(this.autoUpdateInfo);
    }
  }

  showUpdateNotification(info: UpdateInfo) {
    const notification = new Notification({
      title: `${getAppName()} ${info.version} 可用，将在退出时安装。`,
      body: '点击立即应用更新。',
      silent: true,
    });
    notification.show();
    notification.on('click', () => {
      this.quitAndInstall();
    });
  }

  async boot({ splashScreen, splashLogo }: { splashScreen?: boolean; splashLogo?: string }) {
    this.logger.info('[Updater] 正在启动');

    if (splashScreen) {
      const startURL = getStartURL(splashLogo);
      this.createSplashWindow();
      this.updaterWindow!.loadURL(startURL);
    }

    const updateCheckPromise = new Promise<void>((resolve, reject) => {
      this.attachListeners(resolve, reject);
      if (!splashScreen) resolve();
    });

    const timeoutMs = 5000;
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        this.logger.warn(
          `[Updater] 检查更新超时 (${timeoutMs / 1000}s)，继续启动`,
        );
        this._timedOut = true;
        resolve();
      }, timeoutMs);
    });

    return Promise.race([updateCheckPromise, timeoutPromise])
      .then(() => {
        this.logger.info('[Updater] 启动完成');
        // 无更新时清理旧增量补丁，避免磁盘占用累积
        this.clearDeltaCache();
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
        this.logger.error('[Updater] 启动失败 ', err);
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

  getDeltaURL({ deltaPath }: { deltaPath: string }) {
    return newUrlFromBase(deltaPath, this.hostURL!);
  }

  getDeltaJSONUrl() {
    return newUrlFromBase('delta-win.json', this.hostURL!);
  }

  async doSmartDownload({
    version,
    releaseDate,
  }: {
    version: string;
    releaseDate?: string;
  }) {
    const deltaDownloaded = (deltaPath: string) => {
      this.logger.info(`[Updater] 已下载 ${deltaPath}`);
      this.autoUpdater.emit('update-downloaded', {
        delta: true,
        deltaPath,
        version,
        releaseDate,
      });
    };

    let channel = getChannel();
    if (!channel) return;
    channel = channel === 'latest' ? 'stable' : channel;

    const appVersion = app.getVersion();

    const deltaJSONUrl = this.getDeltaJSONUrl();
    let deltaJSON: Record<string, DeltaDetails> | null = null;
    try {
      this.logger.info(`[Updater] 正在获取增量 JSON: ${deltaJSONUrl}`);
      const response = await fetch(deltaJSONUrl);
      if (response.status !== 200) {
        this.logger.error(
          `[Updater] 获取 ${deltaJSONUrl} 失败: ${response.status}`,
        );
      } else {
        deltaJSON = await response.json();
      }
    } catch (err) {
      this.logger.error('获取失败 ', deltaJSONUrl);
    }

    if (!deltaJSON) {
      this.logger.error('[Updater] 未找到增量更新');
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaDetails = deltaJSON[appVersion];

    if (!deltaDetails) {
      this.logger.error('[Updater] 未找到此版本的增量更新 ', appVersion);
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaURL = this.getDeltaURL({ deltaPath: deltaDetails.path });
    this.logger.info('[Updater] Delta URL ', deltaURL);

    const shaVal = deltaDetails.sha256;

    if (!shaVal) {
      this.logger.info('[Updater] 无法获取增量 SHA，尝试全量下载');
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaPath = path.join(this.deltaHolderPath, deltaDetails.path);

    if (fs.existsSync(deltaPath) && isSHACorrect(deltaPath, shaVal)) {
      this.logger.info('[Updater] 增量文件已存在 ', deltaPath);
      deltaDownloaded(deltaPath);
      return;
    }

    this.logger.info('[Updater] 开始下载增量文件 ', deltaURL);

    await fs.ensureDir(this.deltaHolderPath);

    const onProgressCb = ({
      percentage,
      transferred,
      total,
    }: {
      percentage: string;
      transferred: string;
      total: string;
    }) => {
      this.logger.info(
        `下载进度=${percentage}%, transferred = ${transferred} / ${total}`,
      );
      this.emit('download-progress', { percentage, transferred, total });
      dispatchEvent(this.updaterWindow!, 'download-progress', {
        percentage: parseFloat(percentage).toFixed(1),
        transferred: niceBytes(transferred),
        total: niceBytes(total),
      });
    };

    try {
      await downloadFile(deltaURL, deltaPath, onProgressCb.bind(this));
      if (!isSHACorrect(deltaPath, shaVal)) {
        this.logger.info('[Updater] 增量下载完成，SHA 校验失败，尝试全量下载');
        this.autoUpdater.downloadUpdate();
        return;
      }
      deltaDownloaded(deltaPath);
    } catch (err) {
      this.logger.error('[Updater] 增量下载失败，尝试全量下载', err);
      this.autoUpdater.downloadUpdate();
    }
  }

  /**
   * 清除增量缓存目录 (deltas/) 中的旧补丁文件。
   * 无更新或更新失败时调用，避免磁盘占用累积。
   */
  clearDeltaCache(): void {
    try {
      if (this.deltaHolderPath && fs.existsSync(this.deltaHolderPath)) {
        fs.emptyDirSync(this.deltaHolderPath);
        this.logger.info('[Updater] 已清理增量缓存目录');
      }
    } catch (err) {
      this.logger.error('[Updater] 清理增量缓存失败: ', err);
    }
  }

  async applyUpdate(version: string, forceRunAfter = true) {
    this.logger.info('[Updater] 正在应用全量更新');
    await this.writeAutoUpdateDetails({
      isDelta: false,
      attemptedVersion: version,
    });

    // 必须在 ensureSafeQuitAndInstall 之前移除，防止 onQuit 重复调用
    if (this.boundOnQuit) {
      app.removeListener('quit', this.boundOnQuit);
      this.boundOnQuit = null;
    }

    this.ensureSafeQuitAndInstall();
    setTimeout(
      () => this.autoUpdater.quitAndInstall(true, forceRunAfter),
      100,
    );
  }

  async applyDeltaUpdate(deltaPath: string, version: string) {
    await this.writeAutoUpdateDetails({
      isDelta: true,
      attemptedVersion: version,
    });

    // 必须在 ensureSafeQuitAndInstall 之前移除 quit 监听器，
    // 否则关闭窗口时可能触发 onQuit，导致重复 spawn delta.exe
    if (this.boundOnQuit) {
      app.removeListener('quit', this.boundOnQuit);
      this.boundOnQuit = null;
    }

    this.ensureSafeQuitAndInstall();

    let spawnFailed = false;
    let stderrLogs = '';

    try {
      const child = spawn(
        deltaPath,
        [`/APPPATH="${this.appPath}"`, '/RESTART="1"'],
        { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
      );

      child.stderr?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) {
          stderrLogs += msg + '\n';
          this.logger.error('[Updater] delta.exe stderr: ', msg);
        }
      });

      child.on('error', (err) => {
        spawnFailed = true;
        this.logger.error('[Updater] 增量安装器启动失败: ', err);
      });

      child.on('close', (code) => {
        this.logger.info(`[Updater] delta.exe 已退出, code=${code}`);
        if (stderrLogs) {
          this.logger.info('[Updater] delta.exe 完整日志:\n', stderrLogs);
        }
      });

      child.unref();

      // 给子进程 300ms 窗口期检测启动是否成功，
      // 若失败则回退到全量更新
      await new Promise<void>((resolve) => setTimeout(resolve, 300));

      if (spawnFailed) {
        this.logger.info('[Updater] 增量安装器启动失败，回退全量更新');
        // 重新注册 quit 监听器
        this.boundOnQuit = this.onQuit.bind(this);
        app.on('quit', this.boundOnQuit);
        await this.applyUpdate(version, true);
        return;
      }
    } catch (err) {
      // spawn 同步抛异常（如文件不存在），也回退全量更新
      this.logger.error('[Updater] 增量更新异常，回退全量更新: ', err);
      this.boundOnQuit = this.onQuit.bind(this);
      app.on('quit', this.boundOnQuit);
      await this.applyUpdate(version, true);
      return;
    }

    // 使用 app.exit() 确保 Electron 正确退出，释放文件锁给 delta.exe
    (app as any).isQuitting = true;
    app.exit(0);
  }
}

export default DeltaUpdater;
