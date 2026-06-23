/**
 * DeltaUpdater — 运行时增量更新主模块 (Windows-only)
 *
 * ============================================================
 * 整体流程
 * ============================================================
 *
 *  应用启动
 *    ↓
 *  new DeltaUpdater({ hostURL })  构造函数 → 读取配置 & 初始化路径
 *    ↓
 *  updater.setFeedURL(url)        设置 electron-updater 更新源
 *    ↓
 *  updater.boot({ splashScreen }) 启动更新检查
 *    ├── 显示闪屏窗口 (可选)
 *    ├── 调用 electron-updater.checkForUpdates()
 *    ├── 5 秒超时兜底 (防止网络慢阻塞启动)
 *    │
 *    ├── [无更新] → resolve → 关闭闪屏 → 应用正常启动
 *    │
 *    ├── [有更新] → update-available 事件
 *    │   ├── 1. 读取上次更新记录 (update-details.json)
 *    │   │     如果上次差量失败且版本未变 → 直接走全量回退
 *    │   │
 *    │   └── 2. doSmartDownload() 差量优先策略
 *    │       ├── 拉取 delta-win.json 索引文件
 *    │       ├── 查找匹配当前版本的差量补丁
 *    │       │    无匹配 → 回退全量 (electron-updater.downloadUpdate)
 *    │       ├── SHA256 校验 (本地缓存命中则跳过下载)
 *    │       ├── 下载 .delta.exe 到本地缓存
 *    │       ├── SHA256 校验通过 → emit update-downloaded
 *    │       └── 下载/校验失败 → 回退全量
 *    │
 *    └── [下载完成] → handleUpdateDownloaded()
 *        ├── 超时未发生 → quitAndInstall()
 *        ├── 超时已发生 → 仍执行 quitAndInstall() (不丢弃补丁)
 *        └── 窗口不存在 → 桌面通知 (用户点击后安装)
 *            │
 *            ├── [差量] applyDeltaUpdate()
 *            │   ├── 写入 update-details.json (记录差量尝试)
 *            │   ├── 移除 quit 监听器 (防止重复触发)
 *            │   ├── 关闭所有窗口
 *            │   ├── execSync 启动 delta.exe (阻塞等待)
 *            │   │   └── NSIS 内部: KillProcess → hpatchz 打补丁 → 重启
 *            │   ├── execSync 返回 → app.quit()
 *            │   └── execSync 失败 → 记录日志 + app.quit()
 *            │
 *            └── [全量] applyUpdate()
 *                ├── 写入 update-details.json (记录全量尝试)
 *                ├── 委托 electron-updater.quitAndInstall()
 *                └── electron-updater 处理安装 & 重启
 *
 * ============================================================
 * 缓存 & 文件位置
 * ============================================================
 *
 * 目录结构示意 (Windows):
 *   %LOCALAPPDATA%/<appName>-updater/        ← deltaUpdaterRootPath
 *   └── deltas/                               ← deltaHolderPath
 *       └── xxx-to-yyy-delta.exe              ← 下载的差量安装器
 *
 *   %APPDATA%/<appName>/                      ← app.getPath('userData')
 *   └── delta-update-details.json             ← updateDetailsJSON (失败记录)
 *
 *   <app>/resources/app-update.yml            ← electron-builder 生成的配置
 *
 * ============================================================
 * 数据结构说明
 * ============================================================
 *
 * delta-win.json (服务端构建产物):
 *   {
 *     "productName": "MyApp",
 *     "latestVersion": "1.0.16",
 *     "1.0.15": { "path": "xxx-delta.exe", "sha256": "abc..." },
 *     "1.0.14": { "path": "xxx-delta.exe", "sha256": "def..." }
 *   }
 *   → 以旧版本号为 key，查找本机当前版本对应的差量补丁
 *
 * update-details.json (本地失败记录):
 *   {
 *     "isDelta": true,              ← 上次尝试类型 (true=差量, false=全量)
 *     "attemptedVersion": "1.0.16", ← 尝试升级到的目标版本
 *     "appVersion": "1.0.15",       ← 尝试前的应用版本
 *     "timestamp": 1234567890,
 *     "timeHuman": "Tue Jun 23 2026 ..."
 *   }
 *   → 下次启动时读取，如果 isDelta=true 且 appVersion 仍不变 → 差量失败 → 回退全量
 */

import { EventEmitter } from 'events';
import { app, BrowserWindow, Notification } from 'electron';
import { autoUpdater as electronAutoUpdater } from 'electron-updater';

import path from 'path';
import crypto from 'crypto';
import fs from 'fs-extra';
import fetch from 'cross-fetch';
import semver from 'semver';
import { execSync } from 'child_process';
import yaml from 'yaml';

import { downloadFile, niceBytes } from './download';
import { newUrlFromBase } from './utils';
import { getStartURL, getWindow, dispatchEvent } from './splash';

const fifteenMinutes = 15 * 60 * 1000;

// -------- 工具函数 --------------------------------------------------

/**
 * 从应用版本号推断更新频道
 *   1.0.0        → 'latest'  (正式版)
 *   1.0.0-beta.1 → 'beta'    (预发布版取第一个标识)
 */
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

// -------- 类型定义 --------------------------------------------------

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

/** update-details.json 的数据结构 (本地失败记录) */
interface AutoUpdateDetails {
  isDelta: boolean;
  attemptedVersion: string;
  appVersion: string;
  timestamp: number;
  timeHuman: string;
}

// ============================================================
// DeltaUpdater 主类
// ============================================================

class DeltaUpdater extends EventEmitter {
  autoUpdateInfo: UpdateInfo | null = null;
  logger: any;
  autoUpdater: any;
  hostURL: string | null = null;
  updateConfig!: any;
  appPath!: string;
  appName!: string;

  // -- 路径成员 (构造函数初始化) --
  deltaUpdaterRootPath!: string;   // %LOCALAPPDATA%/<updaterCacheDirName>/
  updateDetailsJSON!: string;       // %APPDATA%/<appName>/delta-update-details.json
  deltaHolderPath!: string;         // %APPDATA%/<appName>/deltas/ (userData 目录)

  updaterWindow: BrowserWindow | null = null;
  boundOnQuit: ((...args: any[]) => void) | null = null;
  private _timedOut = false;        // boot() 5 秒超时标志

  constructor(options: { logger?: any; autoUpdater?: any; hostURL?: string }) {
    super();
    this.autoUpdateInfo = null;
    this.logger = options.logger || console;
    this.autoUpdater = options.autoUpdater || electronAutoUpdater;
    this.hostURL = options.hostURL || null;

    // 仅在打包后执行初始化，开发环境跳过
    if (app.isPackaged) {
      this.setConfigPath();
      this.prepareUpdater();
      this.appPath = stripTrailingSlash(path.dirname(app.getPath('exe')));
      this.appName = getAppName();
      this.logger.info('[Updater] 应用路径 = ', this.appPath);
    }
  }

  // -------- 初始化 --------------------------------------------------

  /**
   * 读取 electron-builder 生成的 app-update.yml
   * 位置: <app>/resources/app-update.yml
   * 包含 updaterCacheDirName 等配置
   */
  setConfigPath() {
    const updateConfigPath = path.join(
      process.resourcesPath!,
      'app-update.yml',
    );
    this.updateConfig = yaml.parse(fs.readFileSync(updateConfigPath, 'utf8'));
  }

  /**
   * 初始化路径 & electron-updater 参数
   *
   * deltaUpdaterRootPath: electron-updater 缓存根目录
   *   → %LOCALAPPDATA%/<updaterCacheDirName>/  (例: C:\Users\xxx\AppData\Local\myapp-updater)
   *
   * deltaHolderPath: 差量补丁下载目录
   *   → %APPDATA%/<appName>/deltas/  (与配置文件同级，无权限问题)
   *
   * updateDetailsJSON: 上次更新失败记录
   *   → %APPDATA%/<appName>/delta-update-details.json
   *   放在 userData 而非 updaterCacheDir，避免被 electron-updater.clearUpdateCache() 误删
   */
  async prepareUpdater() {
    const channel = getChannel();
    if (!channel) return;

    this.logger.info('[Updater]  CHANNEL = ', channel);
    this.autoUpdater.channel = channel;
    this.autoUpdater.logger = this.logger;

    // 禁止 electron-updater 的默认自动行为，由 DeltaUpdater 完全接管
    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;

    this.deltaUpdaterRootPath = path.join(
      app.getPath('appData'),
      `../Local/${this.updateConfig.updaterCacheDirName}`,
    );

    this.updateDetailsJSON = path.join(
      app.getPath('userData'),
      'delta-update-details.json',
    );
    this.deltaHolderPath = path.join(app.getPath('userData'), 'deltas');
  }

  // -------- 更新检查 --------------------------------------------------

  checkForUpdates(resolve: () => void, reject: (err: Error) => void) {
    this.logger.log('[Updater] 正在检查更新...');
    this.autoUpdater.checkForUpdates();
  }

  /** 每 15 分钟轮询一次 (兜底，正常情况下事件驱动) */
  pollForUpdates(resolve: () => void, reject: (err: Error) => void) {
    this.checkForUpdates(resolve, reject);
    setInterval(() => {
      this.checkForUpdates(resolve, reject);
    }, fifteenMinutes);
  }

  // -------- 窗口清理 --------------------------------------------------

  /**
   * 关闭所有主窗口，但不退出进程
   * 移除 window-all-closed 和 close 监听器，防止自动退出
   * splash 窗口保留不关 (更新进度展示)
   */
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

  // -------- 失败记录读写 (update-details.json) ------------------------

  /**
   * 写入上次更新尝试记录
   *
   * 写入时机: 在执行 update / delta 操作之前
   * 读取时机: 下次启动 update-available 事件中
   *
   * 用途: 差量→全量回退判断
   *   如果 isDelta=true 且 appVersion 与当前版本相同
   *   → 说明上次差量更新未生效 → 本次跳过差量直接走全量
   */
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

  /**
   * 读取上次更新尝试记录
   * 找不到文件时返回 null (不是错误，首次启动或文件被清理)
   */
  async getAutoUpdateDetails(): Promise<AutoUpdateDetails | null> {
    let data = null;
    try {
      data = await fs.readJSON(this.updateDetailsJSON);
    } catch (e) {
      this.logger.error(`[Updater] ${this.updateDetailsJSON} 文件未找到`);
    }
    return data;
  }

  // -------- 公开 API --------------------------------------------------

  async setFeedURL(feedURL: string) {
    try {
      this.logger.log('[Updater] 设置更新源: ', feedURL);
      await this.autoUpdater.setFeedURL(feedURL);
    } catch (e) {
      this.logger.error('[Updater] 设置更新源失败 ', e);
    }
  }

  // -------- 闪屏 ------------------------------------------------------

  createSplashWindow() {
    this.updaterWindow = getWindow();
  }

  // -------- 事件监听绑定 (boot 内部调用) ------------------------------

  /**
   * 绑定 electron-updater 各事件，正式开始更新检查流程
   *
   * 开发模式 (非打包): 1 秒后直接 resolve，跳过更新检查
   * 生产模式: 启动轮询 + 绑定事件
   *
   * @param resolve - boot promise 的 resolve
   * @param reject  - boot promise 的 reject
   */
  attachListeners(resolve: () => void, reject: (err: Error) => void) {
    if (!app.isPackaged) {
      setTimeout(() => resolve(), 1000);
      return;
    }
    this.autoUpdater.removeAllListeners();
    this.pollForUpdates(resolve, reject);

    this.logger.log('[Updater] 绑定监听器');

    // -- checking-for-update --
    this.autoUpdater.on('checking-for-update', () => {
      this.logger.log('[Updater] 正在检查更新');
      dispatchEvent(this.updaterWindow!, 'checking-for-update');
    });

    // -- error --
    this.autoUpdater.on('error', (error: Error) => {
      this.logger.error('[Updater] 更新出错: ', error);
      this.emit('error', error);
      dispatchEvent(this.updaterWindow!, 'error', error);
      reject(error);
    });

    // -- update-available (发现新版本后决定走差量还是全量) --
    this.autoUpdater.on('update-available', async (info: any) => {
      this.logger.info('[Updater] 发现新版本 ', info);
      this.emit('update-available', info);
      dispatchEvent(this.updaterWindow!, 'update-available', info);

      // ========================================================
      // 差量→全量回退判断
      //   读取 update-details.json (上次更新尝试记录)
      //   如果上次是差量 (isDelta=true) 且版本未变 → 差量失败
      //   → 跳过 doSmartDownload, 直接走全量
      // ========================================================
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

      // 正常情况: 优先尝试差量
      this.doSmartDownload(info);
    });

    // -- download-progress --
    this.autoUpdater.on('download-progress', (info: any) => {
      this.emit('download-progress', info);
      dispatchEvent(this.updaterWindow!, 'download-progress', {
        percentage: parseFloat(info.percent).toFixed(1),
        transferred: niceBytes(info.transferred),
        total: niceBytes(info.total),
      });
    });

    // -- quit 事件 (用户手动退出时也尝试安装更新) --
    this.logger.info('[Updater] 已添加退出监听器');
    this.boundOnQuit = this.onQuit.bind(this);
    app.on('quit', this.boundOnQuit);

    // -- update-not-available --
    this.autoUpdater.on('update-not-available', () => {
      this.logger.info('[Updater] 无可用更新');
      this.emit('update-not-available');
      dispatchEvent(this.updaterWindow!, 'update-not-available');
      resolve();
    });

    // -- update-downloaded (下载完成，触发安装) --
    this.autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.logger.info('[Updater] 更新已下载 ', info);
      this.emit('update-downloaded', info);
      dispatchEvent(this.updaterWindow!, 'update-downloaded', info);
      this.handleUpdateDownloaded(info, resolve);
    });
  }

  // -------- quit 事件处理 --------------------------------------------

  /**
   * 应用退出时自动安装已下载的更新
   * 注意: applyDeltaUpdate/applyUpdate 中已移除此监听器，防止重复执行
   */
  async onQuit(_event?: Event, _exitCode?: number) {
    this.logger.info('[Updater] onQuit');
    if (this.autoUpdateInfo) {
      this.logger.info('[Updater] On Quit ', this.autoUpdateInfo);
      if (this.autoUpdateInfo.delta) {
        this.logger.info('[Updater] 退出时应用增量更新');
        try {
          execSync(
            `"${this.autoUpdateInfo.deltaPath}" /APPPATH="${this.appPath}" /RESTART="0"`,
            { stdio: 'ignore' },
          );
        } catch (err) {
          this.logger.error('[Updater] delta.exe(onQuit) 执行失败: ', err);
        }
      } else {
        await this.applyUpdate(this.autoUpdateInfo.version, false);
      }
    } else {
      this.logger.info('[Updater] 正在退出，无可用更新');
    }
  }

  // -------- 安装触发 --------------------------------------------------

  /**
   * 触发安装 (公开 API，也由 handleUpdateDownloaded 调用)
   * 根据 autoUpdateInfo.delta 决定走差量还是全量
   */
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

  // -------- 下载完成处理 ----------------------------------------------

  async handleUpdateDownloaded(info: UpdateInfo, resolve: () => void) {
    this.autoUpdateInfo = info;

    // 超时后 splash 已关闭，但更新仍要安装，不丢弃已下载的补丁
    if (this._timedOut) {
      this.logger.info('[Updater] 启动已超时，后台安装更新');
      await this.quitAndInstall();
      return;
    }

    if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
      this.logger.info('[Updater] 触发更新');
      await this.quitAndInstall();
      // 注意: 更新已触发，进程即将退出，不应 resolve boot promise
      // 否则旧进程会继续执行后续逻辑，创建无效窗口
    } else {
      this.logger.info('[Updater] 未找到启动窗口，仅显示通知');
      this.showUpdateNotification(this.autoUpdateInfo);
    }
  }

  // -------- 桌面通知 (非 splash 路径的备选) ---------------------------

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

  // -------- boostrap --------------------------------------------------

  /**
   * 启动入口 (用户调用)
   *
   * 1. 可选显示闪屏窗口
   * 2. 启动更新检查 (attachListeners)
   * 3. 5 秒超时兜底 — 防止网络问题阻塞启动
   * 4. Promise.race 竞速:
   *    - updateCheckPromise: 无更新 / 超时 → resolve → 关闭闪屏
   *    - timeoutPromise:     5 秒 → 设置 _timedOut = true
   *
   * 关键: 超时不等于取消，下载仍在后台继续
   *       handleUpdateDownloaded 中 _timedOut 只影响 UI, 不丢弃已下载的更新
   */
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

  // -------- URL 工具 --------------------------------------------------

  getDeltaURL({ deltaPath }: { deltaPath: string }) {
    return newUrlFromBase(deltaPath, this.hostURL!);
  }

  getDeltaJSONUrl() {
    return newUrlFromBase('delta-win.json', this.hostURL!);
  }

  // -------- 智能下载 (差量优先策略) -----------------------------------

  /**
   * 差量优先下载策略
   *
   * 流程:
   *   1. 拉取服务端 delta-win.json (差量补丁索引)
   *      → 失败 → 回退全量
   *
   *   2. 以 app.getVersion() 为 key 查找匹配的差量补丁
   *      例: 当前版本 1.0.15, deltaJSON["1.0.15"] = { path: "xxx-delta.exe", sha256: "..." }
   *      → 无匹配 → 回退全量
   *
   *   3. 检查本地缓存 (deltaHolderPath)
   *      → 已存在且 SHA256 一致 → 直接使用，跳过下载
   *      → 不存在或校验失败 → 下载到 deltaHolderPath
   *
   *   4. SHA256 校验
   *      → 通过 → emit update-downloaded (delta: true)
   *      → 失败 → 回退全量
   *
   * 设计意图: 差量补丁体积通常只有全量的 1/50~1/10
   *          差量不可用时自动降级，不影响更新功能
   */
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

    // ---- 1. 拉取差量索引 ----
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
      this.autoUpdater.downloadUpdate();   // ← 回退全量
      return;
    }

    // ---- 2. 查找当前版本对应的补丁 ----
    const deltaDetails = deltaJSON[appVersion];

    if (!deltaDetails) {
      this.logger.error('[Updater] 未找到此版本的增量更新 ', appVersion);
      this.autoUpdater.downloadUpdate();   // ← 回退全量
      return;
    }

    const deltaURL = this.getDeltaURL({ deltaPath: deltaDetails.path });
    this.logger.info('[Updater] Delta URL ', deltaURL);

    const shaVal = deltaDetails.sha256;

    if (!shaVal) {
      this.logger.info('[Updater] 无法获取增量 SHA，尝试全量下载');
      this.autoUpdater.downloadUpdate();   // ← 回退全量
      return;
    }

    // ---- 3. 检查本地缓存 ----
    const deltaPath = path.join(this.deltaHolderPath, deltaDetails.path);

    if (fs.existsSync(deltaPath) && isSHACorrect(deltaPath, shaVal)) {
      this.logger.info('[Updater] 增量文件已存在 ', deltaPath);
      deltaDownloaded(deltaPath);
      return;
    }

    // ---- 4. 下载差量文件 ----
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

      // ---- 5. SHA256 校验 ----
      if (!isSHACorrect(deltaPath, shaVal)) {
        this.logger.info('[Updater] 增量下载完成，SHA 校验失败，尝试全量下载');
        this.autoUpdater.downloadUpdate();   // ← 回退全量
        return;
      }
      deltaDownloaded(deltaPath);
    } catch (err) {
      this.logger.error('[Updater] 增量下载失败，尝试全量下载', err);
      this.autoUpdater.downloadUpdate();     // ← 回退全量
    }
  }

  // -------- 缓存清理 --------------------------------------------------

  /**
   * 清除增量缓存目录 (deltas/) 中的旧补丁文件
   * 无更新或更新失败时调用，避免磁盘占用累积
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

  // -------- 安装执行 --------------------------------------------------

  /**
   * 执行全量更新
   *
   * 1. 写入失败记录 (isDelta=false)
   * 2. 移除 quit 监听器 (防止 onQuit 重复调用)
   * 3. 关闭所有窗口
   * 4. 委托 electron-updater.quitAndInstall() 完成安装 & 重启
   */
  async applyUpdate(version: string, forceRunAfter = true) {
    this.logger.info('[Updater] 正在应用全量更新');
    await this.writeAutoUpdateDetails({
      isDelta: false,
      attemptedVersion: version,
    });

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

  /**
   * 执行差量更新
   *
   * 1. 写入失败记录 (isDelta=true)
   * 2. 移除 quit 监听器，防止重复执行
   * 3. 关闭所有窗口
   * 4. 通过 PowerShell Start-Process -Verb RunAs 启动 delta.exe
   *    - execSync 无法触发 UAC → 改用 ShellExecute + runas
   *    - 用户同意 UAC 后以管理员权限运行 → hpatchz 可写 Program Files
   *    - -Wait 阻塞等待，保持主进程存活
   * 5. 成功后 app.quit()
   * 6. 失败后记录日志 + app.quit()
   */
  async applyDeltaUpdate(deltaPath: string, version: string) {
    await this.writeAutoUpdateDetails({
      isDelta: true,
      attemptedVersion: version,
    });

    if (this.boundOnQuit) {
      app.removeListener('quit', this.boundOnQuit);
      this.boundOnQuit = null;
    }

    this.ensureSafeQuitAndInstall();

    try {
      this.logger.log(
        deltaPath,
        [`/APPPATH="${this.appPath}"`, '/RESTART="1"'],
      );
      execSync(
        `"${deltaPath}" /APPPATH="${this.appPath}" /RESTART="1"`,
        { stdio: 'ignore' },
      );
      (app as any).isQuitting = true;
      app.quit();
    } catch (err) {
      this.logger.error('[Updater] 增量更新执行失败: ', err);
      (app as any).isQuitting = true;
      app.quit();
    }
  }
}

export default DeltaUpdater;
