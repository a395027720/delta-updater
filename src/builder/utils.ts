/**
 * Builder utility functions — vendored & trimmed from @electron-delta/builder
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

/**
 * Download file only if it doesn't already exist at destination.
 */
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

/**
 * Download file if it doesn't already exist.
 */
export const downloadFileIfNotExists = async (
  url: string,
  dest: string
): Promise<string> => {
  if (fs.existsSync(dest)) return dest;
  return downloadFile(url, dest);
};

/**
 * Extract NSIS installer using bundled 7za.exe.
 */
export const extract7zip = (archivePath: string, dest: string): void => {
  fs.ensureDirSync(dest);

  const sza = path.join(__dirname, "assets", "7za.exe");

  execSync(`"${sza}" x "${archivePath}" -o"${dest}" -y`, {
    stdio: "pipe",
    timeout: 300000,
  });
};
