/**
 * NSIS installer builder for delta patches — Windows only
 * Vendored & trimmed from @electron-delta/builder
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

  private getNSISScriptPath(): string {
    return path.resolve(path.join(__dirname, "installer.nsi"));
  }

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

    await fs.ensureDir(deltaBinsDir);
    const filePath = await downloadFile(
      this.options.nsisURL,
      path.join(deltaBinsDir, "nsis.zip")
    );
    await extract7zip(filePath, deltaBinsDir);
    return { makeNSISPath, nsisRootPath };
  }

  private getNSISArgs(): string[] {
    const args: string[] = [];
    Object.keys(this.defines).forEach((key) => {
      args.push(`-D${key}=${this.defines[key]}`);
    });
    return args;
  }

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

  async build(params: BuildParams): Promise<string | null> {
    this.installerNSIPath = this.getNSISScriptPath();

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
