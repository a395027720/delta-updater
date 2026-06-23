const path = require('path');
const { spawnSync } = require('child_process');

const hdiffz = path.join(__dirname, '..', 'assets', 'hdiffz.exe');

function createDelta(oldDir, newDir, patchOut) {
  try {
    spawnSync(hdiffz, ['-f', '-c-lzma2', oldDir, newDir, patchOut], {
      stdio: 'inherit',
    });
    return true;
  } catch (err) {
    console.log('Compute hdiffz error ', err);
    return false;
  }
}

module.exports = createDelta;
