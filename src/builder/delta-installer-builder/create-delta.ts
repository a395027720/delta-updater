/**
 * hdiffz-based delta creation — Windows only
 */
import path from "path";
import { spawnSync } from "child_process";

const hdiffz = path.join(__dirname, "..", "assets", "hdiffz.exe");

export function createDelta(
  oldDir: string,
  newDir: string,
  patchOut: string
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
