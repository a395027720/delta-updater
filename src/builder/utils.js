const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const fetch = require('cross-fetch');
const { spawnSync } = require('child_process');

function safeSpawn(exe, args, options) {
  return new Promise((resolve, reject) => {
    try {
      spawnSync(exe, args, options);
      resolve(true);
    } catch (error) {
      reject(error);
    }
  });
}

const downloadFile = async (url, filePath) => {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
};

const downloadFileIfNotExists = async (url, filePath) => {
  if (fs.existsSync(filePath)) return filePath;
  return downloadFile(url, filePath);
};

const extract7zip = (archivePath, dest) => {
  fs.ensureDirSync(dest);
  const sza = path.join(__dirname, '..', 'assets', '7za.exe');
  spawnSync(sza, ['x', archivePath, `-o${dest}`, '-y'], {
    stdio: 'pipe',
    timeout: 300000,
  });
};

const removeExt = (str) => str.replace(/\.[^/.]+$/, '');

const computeSHA256 = (filePath) => {
  const fileBuffer = fs.readFileSync(filePath);
  const sum = crypto.createHash('sha256');
  sum.update(fileBuffer);
  return sum.digest('hex');
};

function fileNameFromUrl(url) {
  return path.basename(url);
}

module.exports = {
  downloadFile,
  safeSpawn,
  downloadFileIfNotExists,
  extract7zip,
  removeExt,
  computeSHA256,
  fileNameFromUrl,
};
