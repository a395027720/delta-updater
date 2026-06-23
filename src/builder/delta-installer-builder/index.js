const fs = require("fs-extra");
const path = require("path");
const { extract7zip, downloadFile, safeSpawn } = require("../utils");

const defaultOptions = {
  logger: console,
  nsisURL: "https://github.com/electron-delta/nsis.zip/raw/main/nsis.zip",
};

class DeltaInstallerBuilder {
  constructor(options) {
    this.options = { ...defaultOptions, ...options };
    this.defines = {
      APP_GUID: this.options.APP_GUID || "",
      PRODUCT_NAME: this.options.PRODUCT_NAME,
      PROCESS_NAME: this.options.PROCESS_NAME || this.options.PRODUCT_NAME,
    };
  }

  get logger() {
    return this.options.logger;
  }

  async getNSISPath() {
    const deltaBinsDir = path.join(process.env.APPDATA, "electron-delta-bins");
    const nsisRootPath = path.join(deltaBinsDir, "nsis-3.0.5.0");
    const makeNSISPath = path.join(nsisRootPath, "Bin", "makensis.exe");

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

  static getNSISScript() {
    return path.resolve(path.join(__dirname, "installer.nsi"));
  }

  getNSISArgs() {
    const args = [];
    Object.keys(this.defines).forEach((key) => {
      args.push(`-D${key}=${this.defines[key]}`);
    });
    return args;
  }

  async executeNSIS() {
    const args = this.getNSISArgs();
    const { makeNSISPath, nsisRootPath } = await this.getNSISPath();
    args.push(this.installerNSIPath);

    this.logger.log("NSIS args ", args);
    try {
      this.logger.log("Compiling with makensis ", this.installerNSIPath);
      await safeSpawn(makeNSISPath, args, {
        cwd: path.dirname(this.installerNSIPath),
        env: { ...process.env, NSISDIR: nsisRootPath },
        stdio: "inherit",
      });
      return true;
    } catch (err) {
      this.logger.log(err);
      return false;
    }
  }

  async build({ installerOutputPath, deltaFilePath, deltaFileName, productIconPath }) {
    this.installerNSIPath = DeltaInstallerBuilder.getNSISScript();
    this.defines.INSTALLER_OUTPUT_PATH = installerOutputPath;
    this.defines.DELTA_FILE_PATH = deltaFilePath;
    this.defines.DELTA_FILE_NAME = deltaFileName;
    this.defines.PRODUCT_ICON_PATH = productIconPath;
    let created = false;
    try {
      created = await this.executeNSIS();
    } catch (err) {
      console.error(err);
    }
    if (!created) return null;
    return installerOutputPath;
  }
}

module.exports = DeltaInstallerBuilder;
