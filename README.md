# @jake-gao/delta-updater

基于 HDiffPatch 的 Electron 增量更新工具包（**仅 Windows**），适用于任何使用 NSIS 安装器的 Electron 应用（不限于特定框架如 ee-core）。

> 增量更新原理：将新旧版本二进制差分 → 生成 `.delta` 补丁 → NSIS 打包为 `.exe` 安装器。客户端下载补丁后通过 hpatchz 应用到本地安装目录，更新速度比全量下载快 10-50 倍。
>
> **开箱即用**：NSIS 编译器已内置在包中，无需额外下载配置。

---

## 安装

```bash
npm install @jake-gao/delta-updater
```

**前置依赖（peerDependencies）：**

| 包 | 用途 | 必需 |
|---|---|---|
| `electron` | Electron 运行时 API | ✅ |
| `electron-updater` | 全量更新 fallback | ✅ |
| `electron-builder` | 构建时生成补丁 | ✅（dev） |

---

## 快速开始

### 1. 构建时：生成增量补丁

在 `electron-builder` 配置中引用钩子：

```json
// cmd/builder-test.json
{
  "afterAllArtifactBuild": "@jake-gao/delta-updater/builder"
}
```

构建前将**上一版本 NSIS 安装器**放入项目根目录的 `delta-releases/`：

```
项目根/
├── delta-releases/
│   └── YourApp Setup 1.0.15-test.exe   ← 上一版本安装器
├── package.json
└── cmd/
    └── builder-test.json
```

构建完成后自动：
- 扫描 `delta-releases/` → 生成差分补丁（`.delta` + `.exe`）
- 将本次安装器存档到 `delta-releases/`（供下次使用）
- 清理旧版本（仅保留最近一次）

### 2. 运行时：检查并应用更新

```typescript
import DeltaUpdater from "@jake-gao/delta-updater";

async function checkUpdate() {
  const updater = new DeltaUpdater({
    hostURL: "https://your-cdn.com/app-updates/",
  });

  await updater.setFeedURL("https://your-cdn.com/app-updates/");
  // splashLogo: 闪屏窗口的 logo，支持文字或图片路径
  await updater.boot({ splashScreen: true, splashLogo: 'MyApp' });
  // resolve → 无更新，应用正常启动
  // 有更新 → 自动下载补丁 → 应用退出 → 应用补丁 → 重启
}
```

---

## API 参考

### Builder Hook 配置

#### 零配置（默认值）

在你的 `cmd/builder-xxx.json` 中只需一行：

```json
{
  "afterAllArtifactBuild": "@jake-gao/delta-updater/builder"
}
```

**什么都不用配，hook 自动工作**。以下是默认行为详解：

##### 默认配置值

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 历史安装器目录 | `项目根/delta-releases/` | 从此目录扫描旧版 .exe 安装器 |
| 应用图标 | `项目根/build/icons/icon.ico` | 差分安装器的图标 |
| 构建缓存 | `~/.electron-delta/` | 安装器下载 + 解压的临时目录 |
| NSIS 编译器 | 包内置（自动解压） | 首次构建自动解压到 `%APPDATA%/electron-delta-bins/` |

##### 你必须准备什么

只需要把上一版安装器放入 `delta-releases/` 目录：

```
项目根/
├── delta-releases/                        ← 手动创建，放上一版安装器
│   └── YourApp Setup 1.0.15-test.exe       ← 上一版本（文件名需含版本号）
└── cmd/
    └── builder-test.json                   ← 引用 hook 的 builder 配置
```

**首次构建**：`delta-releases/` 为空 → 跳过差分生成 → 全量安装器正常产出，hook 会自动把本次安装器存档进去。**第二次构建开始**自动生效。

> NSIS 编译器（makensis.exe）已内置在 npm 包中，首次构建时自动解压到 `%APPDATA%/electron-delta-bins/`，无需手动配置。

##### 环境自动检测

hook 从 `process.env.npm_lifecycle_event` 推断当前环境，然后只匹配对应环境的安装器：

| 你的 npm script | 检测为 | 只扫描文件名以...结尾的 |
|----------------|--------|----------------------|
| `build-w-32:test` | `test` | `-test.exe` |
| `build-w-32:stage` | `stage` | `-stage.exe` |
| `build-w-32:prod` | `prod` | `-prod.exe` |
| 无法识别 | 全部 | `.exe`（不筛选） |

##### 钩子执行步骤

```
afterAllArtifactBuild 触发
  ↓
1. 检查 NSIS（makensis.exe）
   ├── 已缓存 → 跳过
   ├── scripts/lib/nsis.zip 存在 → 解压到 %APPDATA%/electron-delta-bins/
   └── 都没有 → 打印提示，跳过差分，继续全量构建
  ↓
2. 扫描 delta-releases/
   ├── 匹配当前环境的安装器
   ├── 提取版本号（从文件名正则 \d+\.\d+\.\d+）
   └── 过滤掉当前版本（不能自己和自己比）
  ↓
3. 同步到缓存
   └── 把 delta-releases/ 的安装器拷贝到 ~/.electron-delta/data/
  ↓
4. 生成差分补丁（对每个历史版本）
   ├── 7z 解压新旧安装器 → 提取 exe
   ├── hdiffz 生成 .delta 补丁
   ├── makensis 打包为 -delta.exe
   └── SHA256 校验 → 写入 delta-win.json
  ↓
5. 存档
   └── 把本次安装器从 out/ 拷贝到 delta-releases/
   └── 清理旧版本（同环境仅保留当前版本）
```

##### 产物位置

```
out/
├── YourApp Setup 1.0.16-test.exe              ← 全量安装器
├── YourApp Setup 1.0.16-test.exe.blockmap     ← electron-updater 块映射
├── latest.yml                                  ← 全量更新清单
└── 1.0.16-win-deltas/                          ← 增量产物目录
    ├── delta-win.json                          ← 补丁索引
    ├── YourApp-1.0.15-to-1.0.16-delta.exe      ← 差分安装器
    └── ...（每个历史版本一个）
```

##### 如何覆盖默认值

不想用默认值？两种方式，按优先级排序：

1. **环境变量**（不需要改 builder 配置）：
   ```bash
   export DELTA_RELEASES_DIR="my-releases"
   export DELTA_PRODUCT_ICON="assets/logo.ico"
   npm run build-w-32:test
   ```

2. **createHook 工厂**（见下方"自定义配置"章节）

#### 自定义配置

创建 `electron-delta.hook.js`：

```js
const { createHook } = require("@jake-gao/delta-updater/builder");

module.exports = createHook({
  // 全部可选，不传则使用默认值
  releasesDir: "my-releases",           // 历史安装器目录
  productIconPath: "resources/icon.ico", // 应用图标
  cacheDir: "D:/electron-delta-cache",   // 构建缓存
  sign: async (filePath) => {
    // 自定义签名逻辑
  },
  detectEnvironment: () => {
    // 自定义环境检测
    return process.env.BUILD_ENV || "test";
  },
});
```

```json
{ "afterAllArtifactBuild": "./electron-delta.hook.js" }
```

#### Builder 配置项

| 参数 | 类型 | 默认值 | 环境变量 | 说明 |
|------|------|--------|----------|------|
| `releasesDir` | `string` | `"delta-releases"` | `DELTA_RELEASES_DIR` | 历史安装器存放目录（相对于项目根） |
| `productIconPath` | `string` | `"build/icons/icon.ico"` | `DELTA_PRODUCT_ICON` | 应用图标路径（相对于项目根） |
| `cacheDir` | `string` | `~/.electron-delta` | `DELTA_CACHE_DIR` | 增量构建缓存目录 |
| `nsisZipPath` | `string` | `"scripts/lib/nsis.zip"` | `DELTA_NSIS_ZIP` | NSIS zip 本地路径（离线环境预置） |
| `nsisBinsDir` | `string` | `%APPDATA%/electron-delta-bins` | `DELTA_NSIS_BINS_DIR` | NSIS 编译器缓存目录 |
| `nsisDownloadUrl` | `string` | GitHub 地址 | `DELTA_NSIS_DOWNLOAD_URL` | NSIS zip 下载地址 |
| `sign` | `(filePath: string) => Promise<void>` | 空函数 | — | 差分安装器签名回调 |
| `detectEnvironment` | `() => string \| null` | 自动检测 | — | 环境检测函数（影响安装器文件名匹配） |

#### 环境自动检测

`detectEnvironment` 默认从 `npm_lifecycle_event` 推断：

| npm script 包含 | 检测环境 | 匹配的安装器文件名 |
|----------------|---------|-------------------|
| `test` | `test` | `xxx-test.exe` |
| `stage` | `stage` | `xxx-stage.exe` |
| `prod` | `prod` | `xxx-prod.exe` |
| 其他 | `null` | 所有 `.exe` |

---

### DeltaUpdater 运行时

#### 构造函数

```typescript
new DeltaUpdater(options: DeltaUpdaterOptions)
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `hostURL` | `string` | `null` | 更新服务器地址 |
| `logger` | `object` | `console` | 日志对象（需实现 `log/info/warn/error`） |
| `autoUpdater` | `object` | `electron-updater` | 自定义 autoUpdater 实例 |

#### 方法

| 方法 | 说明 |
|------|------|
| `boot({ splashScreen, splashLogo })` | 启动更新检查。splashScreen=true 显示闪屏；splashLogo 支持文字、图片路径（自动转 base64）或 SVG；无更新时自动清理旧补丁缓存 |
| `setFeedURL(url)` | 设置更新源地址 |
| `quitAndInstall()` | 立即退出并安装更新 |
| `clearDeltaCache()` | 手动清理增量补丁缓存目录（`deltas/`），一般无需手动调用，`boot()` 无更新时会自动清理 |

#### 事件

DeltaUpdater 继承 EventEmitter，可监听：

| 事件 | 说明 |
|------|------|
| `update-available` | 发现新版本 |
| `update-not-available` | 无可用更新 |
| `update-downloaded` | 更新已下载 |
| `download-progress` | 下载进度 `{ percentage, transferred, total }` |
| `error` | 更新出错 |

---

## 前置条件

- **Electron >= 22**（开发 + 运行）
- **electron-builder**（开发时生成补丁，配置 `afterAllArtifactBuild` 钩子）
- **Windows** 操作系统（仅支持 NSIS 安装器）

NSIS 编译器已内置在 npm 包中（`assets/nsis.zip`），首次构建时自动解压，无需手动安装。

若需自定义 NSIS 来源，可通过 `createHook({ nsisZipPath })` 或环境变量 `DELTA_NSIS_ZIP` 指定。

### 服务器目录结构

更新服务器需提供以下文件（构建产物上传）：

```
/app-updates/
├── latest.yml                                     ← 全量更新清单
├── YourApp Setup 1.0.16-test.exe                   ← 全量安装器
├── YourApp Setup 1.0.16-test.exe.blockmap          ← 块映射文件
├── delta-win.json                                 ← 增量补丁索引
├── YourApp-1.0.15-to-1.0.16-delta.exe              ← 差分安装器
├── YourApp-1.0.14-to-1.0.16-delta.exe
```

`delta-win.json` 格式：

```json
{
  "productName": "YourApp",
  "latestVersion": "1.0.16",
  "1.0.15": {
    "path": "YourApp-1.0.15-to-1.0.16-delta.exe",
    "sha256": "abc123..."
  }
}
```

---

## 工作流程

### 构建流程

```
npm run build-w-32:test
  ↓
1. electron-builder 打包 → out/YourApp Setup 1.0.16-test.exe
  ↓
2. afterAllArtifactBuild hook
  ├── 扫描 delta-releases/ → 找到 1.0.15-test.exe
  ├── 7z 解压新旧安装器 → 提取 exe 文件
  ├── hdiffz 生成 .delta 补丁文件
  ├── makensis 打包为 -delta.exe 安装器
  ├── 计算 SHA256 → 写入 delta-win.json
  └── 存档 1.0.16-test.exe → delta-releases/
  ↓
3. 产物在 out/1.0.16-win-deltas/
```

### 更新流程

```
应用启动
  ↓
DeltaUpdater.boot()
  ├── 检查 update.json → 获取最新版本
  ├── 获取 delta-win.json → 查找匹配当前版本的补丁
  ├── 下载 .delta.exe
  ├── 闪屏显示进度
  └── 下载完成
      ├── spawn: delta.exe /APPPATH="..." /RESTART="1"
      ├── hpatchz 应用补丁到安装目录
      └── 重启应用 → 新版本运行

无更新时
  ↓
boot() resolve
  ├── 记录日志 [Updater] 启动完成
  ├── 自动清理旧补丁缓存 (clearDeltaCache)
  └── 关闭闪屏 → 应用正常启动
```

#### 缓存目录与清理

增量补丁下载到以下目录：

```
%APPDATA%/../Local/<updaterCacheDirName>/deltas/
```

其中 `<updaterCacheDirName>` 由 `app-update.yml` 配置（通常为 `<appName>-updater`）。

**自动清理**：`boot()` 无可用更新时（即应用正常启动），会自动清空 `deltas/` 目录，避免补丁文件累积占用磁盘。有更新时不清除（增量安装器正在使用）。

**手动清理**：也可调用 `updater.clearDeltaCache()` 强制清空。

---

## 目录结构

```
@jake-gao/delta-updater/
├── builder.js                # electron-builder 钩子入口
├── package.json
├── dist/                     # 编译产物（发布到 npm）
│   ├── builder/
│   │   ├── hook.js           # afterAllArtifactBuild 钩子
│   │   ├── index.js          # DeltaBuilder
│   │   ├── create-all-deltas.js
│   │   ├── utils.js
│   │   ├── assets/
│   │   │   ├── hdiffz.exe
│   │   │   └── hpatchz.exe
│   │   └── delta-installer-builder/
│   │       ├── index.js
│   │       ├── create-delta.js
│   │       └── installer.nsi
│   └── updater/
│       ├── index.js          # DeltaUpdater
│       ├── download.js
│       ├── utils.js
│       └── splash/
│           ├── index.js
│           └── preload.js
└── src/                      # TypeScript 源码
    ├── builder/
    └── updater/
```

---

## License

MIT
