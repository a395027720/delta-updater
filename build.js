const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });

// Copy src/ to dist/
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach(function (entry) {
    var srcPath = path.join(src, entry.name);
    var destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) { copyDir(srcPath, destPath); }
    else { fs.copyFileSync(srcPath, destPath); }
  });
}
copyDir(path.join(__dirname, 'src'), DIST);

// Copy assets to dist/builder/assets/
var assetsDir = path.join(__dirname, 'assets');
if (fs.existsSync(assetsDir)) {
  copyDir(assetsDir, path.join(DIST, 'builder', 'assets'));
  console.log('  ✓ assets copied');
}

// Copy installer.nsi and hpatchz.exe to delta-installer-builder/
var installerDir = path.join(DIST, 'builder', 'delta-installer-builder');
var nsiSrc = path.join(__dirname, 'src', 'builder', 'delta-installer-builder', 'installer.nsi');
if (fs.existsSync(nsiSrc)) { fs.copyFileSync(nsiSrc, path.join(installerDir, 'installer.nsi')); }
var hpatchzSrc = path.join(__dirname, 'assets', 'hpatchz.exe');
if (fs.existsSync(hpatchzSrc)) { fs.copyFileSync(hpatchzSrc, path.join(installerDir, 'hpatchz.exe')); }

console.log('  ✓ Build complete');
