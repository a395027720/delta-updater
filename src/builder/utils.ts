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
 * Extract NSIS installer using 7z.
 * Uses electron-builder's built-in 7za (SZA_PATH) or system 7z.
 */
export const extract7zip = (
  archivePath: string,
  dest: string
): void => {
  fs.ensureDirSync(dest);

  // electron-builder sets SZA_PATH to its bundled 7za binary
  const szaPath = process.env.SZA_PATH;

  try {
    if (szaPath && fs.existsSync(szaPath)) {
      execSync(`"${szaPath}" x "${archivePath}" -o"${dest}" -y`, {
        stdio: "pipe",
        timeout: 300000,
      });
    } else {
      execSync(`7z x "${archivePath}" -o"${dest}" -y`, {
        stdio: "pipe",
        timeout: 300000,
      });
    }
  } catch {
    // Last resort: try system 7z or fail with clear message
    try {
      execSync(`7za x "${archivePath}" -o"${dest}" -y`, {
        stdio: "pipe",
        timeout: 300000,
      });
    } catch {
      throw new Error(
        `7z not found. Install 7-Zip or set SZA_PATH.\n` +
        `Tried to extract: ${archivePath}`
      );
    }
  }
};
