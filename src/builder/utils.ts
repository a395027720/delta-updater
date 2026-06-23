/**
 * Builder 工具函数
 *
 * ============================================================
 * 7z 解压: 使用包内置的 7za.exe (assets/7za.exe)
 * 下载: 使用 cross-fetch (一次性 buffer, 无需进度)
 * ============================================================
 */
import path from "path";
import fs from "fs-extra";
import crypto from "crypto";
import fetch from "cross-fetch";
import { spawn, execSync } from "child_process";

export const removeExt = (str: string): string =>
  str.replace(/\.[^/.]+$/, "");

export const fileNameFromUrl = (url: string): string =>
  path.basename(url);

export const computeSHA256 = (filePath: string): string => {
  const fileBuffer = fs.readFileSync(filePath);
  const sum = crypto.createHash("sha256");
  sum.update(fileBuffer);
  return sum.digest("hex");
};

/** 安全 spawn: Promise 化, 非零退出码 reject */
export const safeSpawn = (
  command: string,
  args: string[],
  options: Record<string, any>
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
  });
};

/** 下载文件到指定路径 (无条件覆盖) */
export const downloadFile = async (
  url: string,
  dest: string
): Promise<string> => {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  fs.ensureDirSync(path.dirname(dest));
  fs.writeFileSync(dest, Buffer.from(buffer));
  return dest;
};

/** 下载文件 (仅当目标不存在时) */
export const downloadFileIfNotExists = async (
  url: string,
  dest: string
): Promise<string> => {
  if (fs.existsSync(dest)) return dest;
  return downloadFile(url, dest);
};

/**
 * 使用 7za.exe 解压 NSIS 安装器
 * 7za.exe 位于 dist/builder/assets/ (包内置)
 * 超时 5 分钟 (大安装器解压较慢)
 */
export const extract7zip = (archivePath: string, dest: string): void => {
  fs.ensureDirSync(dest);

  const sza = path.join(__dirname, "assets", "7za.exe");

  execSync(`"${sza}" x "${archivePath}" -o"${dest}" -y`, {
    stdio: "pipe",
    timeout: 300000,
  });
};
