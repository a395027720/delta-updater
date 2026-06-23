# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Publish

```bash
npm run build      # esbuild 编译 TS → dist/ + 拷贝二进制资源
npm publish        # 自动触发 prepublishOnly → npm run build
```

编译入口是 `build.js`（纯 JS 脚本，非 tsc），使用 esbuild 将 `src/` 下的 TS 文件打包为 CommonJS 格式（target: node16），输出到 `dist/builder/` 和 `dist/updater/`，再拷贝 `assets/` 下的二进制文件（hdiffz.exe、hpatchz.exe、7za.exe、nsis.zip）到 dist 对应目录。

**没有 lint / test 脚本。** 项目目前无测试覆盖。

## Architecture

项目分为两个独立模块，分别运行在 Electron 应用的不同生命周期：

### Builder 模块（构建时，`src/builder/`）

electron-builder 的 `afterAllArtifactBuild` 钩子。入口是 `builder.js`（根目录），它 re-export `dist/builder/hook.js`。

**调用链：**
```
builder.js → hook.ts (createHook / default export)
  → index.ts (build function)
    → create-all-deltas.ts (核心管道)
      → delta-installer-builder/index.ts (NSIS 编译器封装)
      → delta-installer-builder/create-delta.ts (hdiffz 调用)
      → utils.ts (7z 解压、SHA256、下载)
```

**核心流程：** 扫描 `delta-releases/` 目录中的历史 NSIS 安装器 → 7z 解压提取 exe → hdiffz 生成 `.delta` 差分文件 → makensis 打包为 `-delta.exe` 安装器 → SHA256 校验写入 `delta-win.json`。

**关键设计点：**
- 零配置：默认 export 就是 `createHook()`，一行 JSON 即可使用
- 环境自动检测：从 `npm_lifecycle_event` 推断 test/stage/prod，过滤文件名匹配的安装器
- 首次构建时 `delta-releases/` 为空则跳过差分生成，仅存档本次安装器
- NSIS 编译器（makensis.exe）内置在 `assets/nsis.zip`，首次构建时自动解压到 `%APPDATA%/electron-delta-bins/`
- 构建日志静默：`hook.ts:408-419` 临时覆盖 console/process.stdout 来压制底层噪声
- `createDelta()` 使用 `spawnSync` + `-c-lzma2` 压缩算法

### Updater 模块（运行时，`src/updater/`）

运行在 Electron 主进程，负责检查更新、下载补丁、应用补丁。

**调用链：**
```
用户代码 new DeltaUpdater() → boot()
  → attachListeners() → pollForUpdates()
    → electron-updater.checkForUpdates()
      → doSmartDownload() → 拉取 delta-win.json
        → downloadFile() → SHA256 校验
          → handleUpdateDownloaded() → quitAndInstall()
            → applyDeltaUpdate() → execSync delta.exe
              → installer.nsi → hpatchz 打补丁 → 重启
```

**关键设计点：**
- 差量优先策略：先尝试从 `delta-win.json` 匹配差量补丁，失败/不存在则回退到 `electron-updater.downloadUpdate()`（全量）
- 5 秒超时兜底：`boot()` 用 `Promise.race` 防止无限阻塞启动
- 上次增量更新失败记录：写入 `delta-update-details.json`（userData 目录），下次同版本启动时自动跳过差量走全量更新
- `onQuit` 监听 app quit 事件，有更新时自动执行 delta.exe
- `applyDeltaUpdate` 必须在调 `execSync` 前移除 quit 监听器，防止重复调用 delta.exe
- `applyDeltaUpdate` 用 `execSync` 阻塞主进程（而非 spawn），目的是保持主进程存活，避免 Windows Job Object 因主进程退出而连累 delta.exe 被终止

### Splash 窗口（`src/updater/splash/`）

独立的 BrowserWindow（无框、置顶、360×150），通过 data URL 加载内嵌 HTML，通过 custom DOM events + IPC bridge 与主进程通信。

- `index.ts`：创建窗口、生成 HTML（支持 text/SVG/图片 logo 自动转 base64）
- `preload.ts`：IPC 桥接，安全隔离（sandbox + contextIsolation）

### 外部二进制工具（`assets/`）

| 文件 | 用途 | 使用方 |
|------|------|--------|
| `hdiffz.exe` | 生成 .delta 差分文件 | Builder |
| `hpatchz.exe` | 应用 .delta 补丁到安装目录 | NSIS 安装器（运行时） |
| `7za.exe` | 解压 NSIS 安装器 | Builder |
| `nsis.zip` | NSIS 编译器（makensis.exe） | Builder |

## Key Technical Notes

- **仅 Windows**：整个工具链依赖 NSIS + exe 工具，跨平台无意义
- **TSConfig** 设置了 `strict: false`，修改时注意不要引入依赖严格模式的写法
- `app-update.yml` 由 electron-builder 生成在 `process.resourcesPath` 下，`updaterCacheDirName` 字段决定增量补丁缓存路径
- package.json 的 `exports` 字段：`.` → updater入口，`./builder` / `./builder/hook` → builder 钩子入口
- `electron-updater` 是 `peerDependencies` 且标记为 `optional`（差量优先模式下理论上只需差量更新，但全量回退仍需要它）
