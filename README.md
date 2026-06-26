# @jake-gao/delta-updater

> 基于 electron-updater 的增量更新模块 — 下载 .delta 补丁文件替代全量安装包，大幅节省带宽。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#许可证)

## 特性

- 启动时展示 splash 窗口，实时显示更新进度
- 自动下载增量补丁（.delta 文件），节省 70%+ 下载流量
- SHA256 校验确保补丁完整性
- 支持自定义 splash 窗口 logo 和标题
- 增量下载失败时自动 fallback 到全量安装包
- 自动清理旧增量文件，保留最近 N 个
- 支持通用 S3/GitHub/Generic 等多种更新源
- Windows 更新缓存存放于 `%PROGRAMDATA%`，避免杀软误报

## 安装

```bash
npm install @jake-gao/delta-updater
```

## 使用

```js
const DeltaUpdater = require("@jake-gao/delta-updater");
const { app } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
  const deltaUpdater = new DeltaUpdater({
    // 更新源地址
    hostURL: "https://example.com/updates/windows/",
    // 更新 feed URL，boot() 内部自动调用 setFeedURL
    feedURL: "https://example.com/updates/windows/",
    // 可选：日志实例
    logger: require("electron-log"),
    // 可选：splash 窗口自定义 logo（支持本地图片路径或 data URI）
    logo: path.join(app.getAppPath(), "public/images/logo.png"),
    // 可选：splash 窗口标题前缀，默认取 app.getName()
    splashTitle: "His系统",
    // 可选：是否显示 splash 窗口，默认 true
    splashScreen: true,
    // 可选：保留的增量文件数量，默认 3
    keepDeltaCount: 3,
  });

  try {
    await deltaUpdater.boot();
  } catch (error) {
    // 更新失败不阻塞应用启动
    logger.error(error);
  }

  createMainWindow();

  // 主窗口就绪后关闭 splash
  deltaUpdater.closeSplash();
});
```

## API

### `new DeltaUpdater(options)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `hostURL` | `string` | - | 更新服务器根地址 |
| `feedURL` | `string` | - | electron-updater feed URL，`boot()` 内部自动调用 `setFeedURL()` |
| `splashTitle` | `string` | `app.getName()` | splash 窗口标题前缀，显示为 `{title} 检查更新`、`{title} 正在启动` 等 |
| `splashScreen` | `boolean` | `true` | 是否显示 splash 窗口 |
| `logo` | `string` | - | splash 窗口 logo，支持本地文件路径或 data URI |
| `keepDeltaCount` | `number` | `3` | 增量文件保留数量，清理时保留最新的 N 个 |
| `logger` | `object` | `console` | 日志实例 |
| `autoUpdater` | `object` | `require("electron-updater").autoUpdater` | electron-updater 实例 |

### `deltaUpdater.boot()`

启动更新检查流程。无参数，splash 配置在构造函数中统一传入。

返回 `Promise`：
- 有增量更新：下载补丁 → 应用 → 自动重启
- 无更新或失败：resolve，继续启动应用

### `deltaUpdater.closeSplash()`

关闭 splash 窗口。主应用窗口加载就绪后调用。

splash 默认不自动关闭，需外部调用此方法。若 10 秒内未调用，内部 fallback 定时器会自动关闭。

## 工作原理

```
启动 → 显示 splash → 检查更新 → 发现新版本
  → 拉取 delta-win.json（或 delta-mac.json）
  → 下载 .delta 补丁文件（SHA256 校验）
  → 清理旧增量文件（保留最近 N 个）
  → 应用补丁 → 重启
```

无更新时：
```
启动 → 显示 splash（标题: "{splashTitle} 正在启动"）
  → 主窗口加载就绪 → closeSplash() → splash 关闭
```

## Splash 窗口

splash 窗口在不同阶段自动更新标题和状态文案：

| 阶段 | 标题 | 状态 |
|------|------|------|
| 检查更新 | `{splashTitle} 检查更新` | 正在检查更新... |
| 发现新版本 | `{splashTitle} 发现新版本` | 发现新版本，准备下载... |
| 下载中 | `{splashTitle} 正在更新` | 正在下载 X% |
| 安装中 | `{splashTitle} 安装更新` | 正在安装更新... |
| 启动中 | `{splashTitle} 正在启动` | 正在启动... |

不传 `logo` 时，splash 默认显示更新下载图标。

传入自定义 logo 和 `splashTitle` 后，splash 窗口 header 将显示你的应用图标和名称。

## 许可证

[MIT](./LICENSE) © Jake Gao
