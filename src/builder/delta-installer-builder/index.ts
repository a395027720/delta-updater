/**
 * NSIS 编译器封装 — Windows only
 *
 * ============================================================
 * 职责
 * ============================================================
 *
 *   1. 获取 makensis.exe (从 %APPDATA%/electron-delta-bins/)
 *      - 如果不存在: 从 nsis.zip 下载/解压
 *   2. 调用 makensis.exe 编译 installer.nsi 生成 -delta.exe
 *
 * ============================================================
 * installer.nsi 模板参数 (通过 -D 传递)
 * ============================================================
 *
 *   PRODUCT_NAME          应用名称
 *   PROCESS_NAME          进程名 (用于 KillProcess)
 *   APP_GUID              应用 GUID (可选)
 *   INSTALLER_OUTPUT_PATH  .exe 安装器输出路径
 *   DELTA_FILE_PATH        .delta 文件路径 (嵌入安装器)
 *   DELTA_FILE_NAME        .delta 文件名 (安装器内引用)
 *   PRODUCT_ICON_PATH      安装器图标 (可选)
 */
import fs from "fs-extra";
import path from "path";
import { extract7zip, downloadFile, safeSpawn } from "../utils";

interface DeltaInstallerOptions {
  PRODUCT_NAME: string;
  PROCESS_NAME?: string;
  APP_GUID?: string;
}

interface BuildParams {
  installerOutputPath: string;
  deltaFilePath: string;
  deltaFileName: string;
  productIconPath?: string;
}

const defaultOptions = {
  nsisURL:
    "https://github.com/electron-delta/nsis.zip/raw/main/nsis.zip",
};

export class DeltaInstallerBuilder {
  private options: any;
  private defines: Record<string, string>;
  private installerNSIPath!: string;

  constructor(options: DeltaInstallerOptions) {
    this.options = { ...defaultOptions, ...options };
    this.defines = {
      APP_GUID: this.options.APP_GUID || "",
      PRODUCT_NAME: this.options.PRODUCT_NAME,
      PROCESS_NAME: this.options.PROCESS_NAME || this.options.PRODUCT_NAME,
    };
  }

  /** installer.nsi 模板位置 (与编译后 JS 同目录) */
  private getNSISScriptPath(): string {
    return path.resolve(path.join(__dirname, "installer.nsi"));
  }

  /** 获取 makensis.exe 路径，不存在则自动下载解压 */
  private async getNSISPath(): Promise<{
    makeNSISPath: string;
    nsisRootPath: string;
  }> {
    const deltaBinsDir = path.join(
      process.env.APPDATA!,
      "electron-delta-bins"
    );
    const nsisRootPath = path.join(deltaBinsDir, "nsis-3.0.5.0");
    const makeNSISPath = path.join(
      nsisRootPath,
      "Bin",
      "makensis.exe"
    );

    if (fs.existsSync(makeNSISPath)) {
      return { makeNSISPath, nsisRootPath };
    }

    // 下载 + 解压 NSIS
    await fs.ensureDir(deltaBinsDir);
    const filePath = await downloadFile(
      this.options.nsisURL,
      path.join(deltaBinsDir, "nsis.zip")
    );
    await extract7zip(filePath, deltaBinsDir);
    return { makeNSISPath, nsisRootPath };
  }

  /** 组装 NSIS 编译参数 */
  private getNSISArgs(): string[] {
    const args: string[] = [];
    Object.keys(this.defines).forEach((key) => {
      args.push(`-D${key}=${this.defines[key]}`);
    });
    return args;
  }

  /** 执行 makensis 编译 */
  private async executeNSIS(): Promise<boolean> {
    const args = this.getNSISArgs();
    const { makeNSISPath, nsisRootPath } = await this.getNSISPath();
    args.push(this.installerNSIPath);

    try {
      await safeSpawn(makeNSISPath, args, {
        cwd: path.dirname(this.installerNSIPath),
        env: { ...process.env, NSISDIR: nsisRootPath },
        stdio: "inherit",
      });
      return true;
    } catch (err: any) {
      console.error(err);
      return false;
    }
  }

  /**
   * 编译差量安装器
   * @returns 生成的 .exe 路径，失败返回 null
   */
  async build(params: BuildParams): Promise<string | null> {
    this.installerNSIPath = this.getNSISScriptPath();

    // 将文件路径传递给 NSIS 编译参数
    this.defines.INSTALLER_OUTPUT_PATH = params.installerOutputPath;
    this.defines.DELTA_FILE_PATH = params.deltaFilePath;
    this.defines.DELTA_FILE_NAME = params.deltaFileName;

    if (params.productIconPath) {
      this.defines.PRODUCT_ICON_PATH = params.productIconPath;
    }

    const created = await this.executeNSIS();
    if (!created) return null;

    return params.installerOutputPath;
  }
}
