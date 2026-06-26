# HIS 客户端

基于 **electron-egg v4** + **Electron 22** + **TypeScript** 的医院信息系统桌面客户端。

主窗口以 Remote 模式加载远端 Web 应用，Electron 主进程负责打印机、串口/网口通讯、HL7 医疗数据交换、本地文件读写、Firebird/SQLite 数据库访问、医保 DLL 读卡等原生能力。

## 技术栈

| 层面     | 技术                                                   |
| -------- | ------------------------------------------------------ |
| 框架     | ee-core v4 / Electron 22.3.7 / Node 16.20.0 32 位      |
| 语言     | TypeScript（electron/），esbuild 编译                  |
| 前端     | Vue 3 + Vite + TypeScript（仅开发预览，生产走 Remote） |
| 医保 DLL | koffi 2.x（替代 ffi-napi）                             |
| 数据库   | Firebird（node-firebird）+ SQLite（better-sqlite3）    |
| 增量更新 | electron-delta（HDiffPatch 二进制差分）                |
| 打包     | electron-builder 23                                    |

## 核心架构

### 启动流程

`package.json` main → `public/electron/main.js`（编译产物），注册 4 个生命周期到 ee-core：

1. **ready** — 命令行参数检查、安全服务
2. **electronAppReady** — Electron 就绪
3. **windowReady** — 主窗口加载完成，初始化打印拦截、打印窗口、菜单、网络检测
4. **beforeClose** — 注销全局快捷键

### Remote 模式

生产环境主窗口加载远程 Web 应用（地址由 `package.json` 的 `remoteUrl` 字段决定），不走本地前端路由。本地前端 (`frontend/`) 仅用于开发预览。

### IPC 通信

- ee-core 自动注册 Controller 方法为 IPC handler
- Channel 命名规则: `controller.<name>.<method>`，分隔符为 `.`
- Channel 常量分两个文件维护：
  - `electron/utils/channels.ts` — Controller 模式通道（`controller.xxx.yyy`），用于 `ipcRenderer.invoke()`
  - `electron/utils/events.ts` — 事件类型通道（`renderPrint`、`startPrint` 等），用于 `send/on/once`

### 打印子系统

支持两种打印方式：

1. **Hiprint 模板打印**：前端调用 `controller.printer.print(data)` → 隐藏打印窗口加载 `public/html/print.html` → 渲染 hiprint 模板 → 调用 `webContents.print()`（默认静默打印，传 `silent: false` 弹出对话框）
2. **PDF 打印**：拦截 blob URL iframe 的 `print()` → 读取 Blob → base64 → IPC `controller.printer.printPdfBlob` → 打开隐藏窗口加载 `public/html/pdf.html` → pdf.js 渲染到 Canvas → 弹出系统打印对话框

打印使用 `concurrent-tasks`（concurrency=1）串行执行，防止并发崩溃。

### 配置系统

三层配置，按优先级合并：默认配置 → `extraResources` 资源目录 → userData 用户目录。

### 安全

启动时检测并阻止 `--inspect` / `--remote-debugging-port` 命令行参数，防止远程调试。

## 环境搭建

### 安装 Node（32 位）

```bash
nvm install 16.20.0 32
nvm use 16.20.0 32
```

```bash
npm i -g nrm
nrm use taobao
```

### 安装 Python3

两个版本都需要，安装目录： `C:\Python311`。复制一份 `C:\Python311\python` 改名为 `C:\Python311\python3`。

- https://www.python.org/downloads/release/python-3110/

### C++ 构建工具 2022

管理员模式打开 PowerShell，安装 BuildTools（勾选 C++ 桌面开发，注意 **x86 工具链**）：

- 自动安装：`npm install --global --production windows-build-tools`
- 手动安装：https://visualstudio.microsoft.com/zh-hans/thank-you-downloading-visual-studio/?sku=BuildTools

```bash
# 清除让 node-gyp 自动检测
npm config delete msvs_version
npm config delete python
或
npm config set python "C:\Program Files\Python311\python.exe"
```

### 编译工具

```bash
npm i -g node-gyp
npm cache clean --force
```

## 快速开始

```bash
# 安装依赖
npm install

# 编译原生模块（odbc / firebird / serialport 等）
npx electron-rebuild

# 安装前端依赖
cd frontend && npm install

# 开发
npm run dev               # 同时启动前端 + Electron
npm run dev-frontend      # 仅前端
npm run dev-electron      # 仅 Electron
```

## Controller 开发约定

所有 controller 放在 `electron/controller/`，必须遵循固定模式：

```ts
// @ts-nocheck
class someController {
  async methodName(args, event) {
    /* args: 前端传参, event: IPC event */
  }
}
someController.toString = () => "[class someController]";
export default someController;
```

- 每个方法接收 `(args, event)` 两个参数
- 必须定义 `toString()` 返回类名字符串
- 使用 `export default` 导出
- 顶部加 `// @ts-nocheck` 跳过 TS 检查

Service 放在 `electron/service/`，作为单例导出。

## 医保 DLL

使用 **koffi** 替代 ffi-napi/ref-napi，无需额外编译：

```ts
import koffi from "koffi";
const lib = koffi.load("nybcard.dll");
const readCard = lib.func("__stdcall", "_DataDown_card@16", "void", [...]);
```

> koffi 2.x 中 `koffi.alloc()` 返回的指针包装没有 `.indexOf()`/`.slice()` 方法，临时 Buffer 操作直接用 `Buffer.alloc()`。

测试环境可用 `electron/worker/testCard.ts` 模拟刷卡。

## 打包

```bash
# 生产环境（32 位）
npm run build-w-32:prod

# 测试环境（32 位）
npm run build-w-32:test

# 预发布环境（32 位）
npm run build-w-32:stage

# 64 位
npm run build-w-64
```

命令组成：编译 electron → `scripts/build.js`（注入环境变量）→ electron-builder → `scripts/delta-summary.js`（打印产物清单）。

## 版本升级

### 全量更新

更新服务器地址默认从 `package.json` 的 `extraMetadata.resourceUrl` 读取（构建时写入），当 `localConfig.json` 中配置了 `resourceUrl` 时则优先使用该值。

构建产物上传到 MinIO `app-resources/electron-updates/his/` 路径：

- `ee-win-x.x.x-x64.exe`
- `ee-win-x.x.x-x64.exe.blockmap`
- `latest.yml`

### 增量更新（electron-delta）

基于 HDiffPatch 二进制差分技术，从 NSIS 安装器级别生成增量补丁。客户端优先尝试增量补丁（~0.5-20MB），失败则回退到全量更新（~80MB）。

**缓存目录**：`%LOCALAPPDATA%\jx-his-pc-client-updater\`，结构如下：

```
jx-his-pc-client-updater/
├── pending/          ← 全量安装器缓存（electron-updater）
└── deltas/           ← 增量补丁缓存（electron-delta）
```

**自动清理机制**：

| 时机         | 触发条件                         | 清理范围                              |
| ------------ | -------------------------------- | ------------------------------------- |
| 启动后无更新 | `DeltaUpdater.boot()` 完成未重启 | 整个 `jx-his-pc-client-updater/` 目录 |
| 开始新下载前 | electron-updater 内部开始新下载  | 仅 `pending/` 子目录                  |
| 缓存校验失败 | SHA512 不一致、文件损坏或缺失    | 仅 `pending/` 子目录                  |
| 更新安装成功 | NSIS 安装器执行后自清理          | 安装器 exe 自身                       |

> 即使因崩溃等异常导致缓存残留，下次启动时也会被第一条机制兜底清理。

#### 首次构建（无历史版本）

直接执行打包命令即可，脚本会自动将本次安装器存档到 `out/previous-releases/`。

#### 后续构建（生成增量补丁）

1. 确保上一版本安装器已放入 `out/previous-releases/`（脚本自动识别版本号，存档时也会自动清理旧版本，始终只保留最近一次构建的安装器）
2. 执行构建命令，`delta/.electron-delta.js` 会自动基于上一版本生成差分补丁
3. `scripts/delta-summary.js` 打印产物清单和上传指引

#### VPN/离线环境

增量构建需要 NSIS 编译器。项目预置 `delta/nsis.zip`，构建时自动检测并解压到 `%APPDATA%\electron-delta-bins\`。若 NSIS 不可用会跳过增量构建，全量安装器正常生成。

#### 构建产物

```
out/
├── HIS系统-测试版-win-x.x.x-ia32-test.exe              # 全量安装器
├── HIS系统-测试版-win-x.x.x-ia32-test.exe.blockmap     # 全量块映射
├── latest.yml                                           # 全量更新信息
└── x.x.x-win-deltas/                                    # 增量补丁（从第二个版本开始）
    ├── delta-win.json                                   # 增量更新清单
    └── HIS系统-测试版-上版本-to-x.x.x-delta.exe          # 差分安装器（基于上一版本）
```

#### 上传到更新服务器

将以下文件上传到 MinIO `app-resources/electron-updates/his/` 路径：

```
his/
├── delta-win.json                              # 覆盖（唯一的更新清单）
├── HIS系统-测试版-x.x.x-to-x.x.x-delta.exe      # 覆盖（新版本差分文件）
├── latest.yml                                   # 覆盖（全量更新信息）
├── HIS系统-测试版-win-x.x.x-ia32-test.exe        # 覆盖（全量安装器）
└── HIS系统-测试版-win-x.x.x-ia32-test.exe.blockmap  # 覆盖
```

## 项目结构

```
├── electron/                    # 主进程（TypeScript）
│   ├── main.ts                  # 入口，含 electron-delta 增量更新
│   ├── shared.ts                # 共享状态（IS_QUITTING / 打印队列等）
│   ├── config/                  # 配置
│   ├── controller/              # 控制器（IPC 接口，约定见上方）
│   ├── service/                 # 服务层
│   │   ├── os/                  # 系统级服务（安全、更新等）
│   │   ├── config/              # 配置服务
│   │   └── database/            # 数据库服务
│   ├── preload/                 # 预加载脚本
│   ├── worker/                  # Worker 线程（读卡模拟等）
│   ├── utils/                   # 工具库
│   │   ├── channels.ts          # Controller 模式 IPC 通道常量
│   │   ├── events.ts            # 事件类型 IPC 通道常量
│   │   ├── print.ts             # 打印窗口创建与管理
│   │   ├── print-interceptor.ts # 主窗口/iframe 打印拦截
│   │   └── eventEmitter.ts      # 事件总线
│   └── jobs/                    # 定时任务
├── types/                       # 全局类型声明
├── frontend/                    # 渲染进程（Vue 3，开发预览用）
├── cmd/                         # 构建配置
│   ├── bin.js                   # ee-bin 配置
│   └── builder*.json            # electron-builder 配置（分环境）
├── public/                      # 静态资源
│   └── html/                    # 子窗口页面
│       ├── print.html           # Hiprint 模板打印页
│       └── pdf.html             # PDF 打印页（pdf.js）
├── build/                       # 打包资源（图标等）
├── out/                         # 构建产物
│   └── previous-releases/       # 上一版本安装器（自动存档，始终只保留一个）
├── delta/                       # 增量更新配置
│   ├── .electron-delta.js       # builder 钩子（自动生成差分补丁）
│   └── nsis.zip                 # NSIS 编译器（离线环境备用）
├── scripts/                     # 构建脚本
│   ├── build.js                 # 构建前注入环境变量
│   ├── delta-summary.js         # 构建后打印产物清单
│   └── clear-delta-cache.js     # 清除增量更新缓存
└── data/                        # 运行时数据
```

## 注意事项

- 32 位 Node 16.20.0：部分原生模块（odbc、firebird）需要 32 位编译
- esbuild 编译 TypeScript 时，import 不能写在函数体内部
- koffi 2.x 中 `koffi.alloc()` 返回的指针包装没有 `.indexOf()`/`.slice()` 方法
- `windowService.create()` 扩展运算符会整体替换 `webPreferences`，传入 option 时必须显式包含 `contextIsolation: false, nodeIntegration: true`
- `print.html` 不要用 `<script type="module">`，ES module 中 `require` 不可用
- Mac 环境下不要执行 `npm install`（32 位原生模块不兼容）
- 密钥、token、密码不进代码不进 commit

## 常见问题

### npm install 报错：Could not find any Visual Studio installation to use

通常因为 `msvs_version` 或 `python` 配置与实际环境不匹配。

```bash
# 查看当前配置
npm config get msvs_version
npm config get python

# 清除让 node-gyp 自动检测
npm config delete msvs_version
npm config delete python
# 或显式指向 Python 3
npm config set python "C:\Python311\python.exe"

# 清理重装
npm cache clean --force
rd /s /q node_modules & del package-lock.json
npm install
```

> VS2022 用户：需在 Visual Studio Installer 中确认勾选了 C++ 桌面开发的 **x86 工具链**。

### npm install 报错：Could not find any Visual Studio installation

```bash
npm cache clean --force
rd /s /q node_modules & del package-lock.json
npm i -g node-gyp
npm install
```

### odbc.node is not a valid Win32 application

需要用 32 位 Node 重新编译：

```bash
cd node_modules/odbc
node-gyp configure
node-gyp build
```

### 启动报错 GPUCache / Unable to move cache folder

删除 `%APPDATA%/jx-his-pc-client/GPUCache` 文件夹。
