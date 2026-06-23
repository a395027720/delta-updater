/**
 * hdiffz-based delta creation — Windows only
 *
 * 调用包内置的 hdiffz.exe 生成差分文件
 *
 * 算法: LZMA2 压缩
 * 输入: 旧版本目录 (解压后的安装器) + 新版本目录 → 输出 .delta 文件
 */
import path from "path";
import { spawnSync } from "child_process";

// hdiffz.exe 位于 assets/ (dist/builder/assets/)
const hdiffz = path.join(__dirname, "..", "assets", "hdiffz.exe");

/**
 * 生成差量补丁
 *
 * @param oldDir - 旧版本解压目录 (包含 exe 等文件)
 * @param newDir - 新版本解压目录
 * @param patchOut - 输出 .delta 文件路径
 * @returns 成功 true, 失败 false
 */
export function createDelta(
  oldDir: string,
  newDir: string,
  patchOut: string,
): boolean {
  try {
    spawnSync(hdiffz, ["-f", "-c-lzma2", oldDir, newDir, patchOut], {
      stdio: "inherit",
    });
    return true;
  } catch (err) {
    console.log("Compute hdiffz error ", err);
    return false;
  }
}
