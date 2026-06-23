/**
 * Build script: compile TS → JS + copy binary assets
 */
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "dist");

// Clean dist
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}

const shared = {
  platform: "node",
  target: "node16",
  format: "cjs",
  sourcemap: false,
  minify: false,
};

// Compile builder → dist/builder/
esbuild.buildSync({
  ...shared,
  entryPoints: [
    "src/builder/hook.ts",
    "src/builder/index.ts",
    "src/builder/create-all-deltas.ts",
    "src/builder/utils.ts",
    "src/builder/delta-installer-builder/index.ts",
    "src/builder/delta-installer-builder/create-delta.ts",
  ],
  outdir: "dist/builder",
});

// Compile updater → dist/updater/
esbuild.buildSync({
  ...shared,
  entryPoints: [
    "src/updater/index.ts",
    "src/updater/download.ts",
    "src/updater/utils.ts",
    "src/updater/splash/index.ts",
    "src/updater/splash/preload.ts",
  ],
  outdir: "dist/updater",
});

// Copy binary assets
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy assets (hdiffz.exe, hpatchz.exe, nsis.zip)
const assetsDir = path.join(__dirname, "assets");
if (fs.existsSync(assetsDir)) {
  copyDir(assetsDir, path.join(DIST, "builder", "assets"));
  console.log("  ✓ assets copied (hdiffz, hpatchz, nsis.zip)");
}

// Copy installer.nsi
const nsiSrc = path.join(__dirname, "src", "builder", "delta-installer-builder", "installer.nsi");
const nsiDest = path.join(DIST, "builder", "delta-installer-builder", "installer.nsi");
fs.mkdirSync(path.dirname(nsiDest), { recursive: true });
if (fs.existsSync(nsiSrc)) {
  fs.copyFileSync(nsiSrc, nsiDest);
  console.log("  ✓ installer.nsi copied");
}

console.log("  ✓ Build complete");
