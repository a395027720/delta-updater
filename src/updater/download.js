const fs = require('fs-extra');
const https = require('https');
const http = require('http');

const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

function niceBytes(x) {
  let l = 0, n = parseInt(x, 10) || 0;
  while (n >= 1024 && ++l) n /= 1024;
  return n.toFixed(n < 10 && l > 0 ? 1 : 0) + ' ' + units[l];
}

function downloadFile(url, filePath, onProgressCb, _redirectCount) {
  const MAX_REDIRECTS = 10;
  _redirectCount = _redirectCount || 0;
  return new Promise((resolve, reject) => {
    let total = 0, totalLen = '0 MB', transferred = 0;
    const mod = url.startsWith('https') ? https : http;
    const request = mod.get(url, (response) => {
      if (response.statusCode === 200) {
        const file = fs.createWriteStream(filePath);
        file.on('error', (err) => { request.destroy(); reject(err); });
        response.on('data', (chunk) => {
          transferred += chunk.length;
          const pct = ((transferred * 100) / total).toFixed(2);
          if (onProgressCb) onProgressCb({ transferred: niceBytes(transferred), percentage: pct, total: totalLen });
        });
        response.on('end', () => file.end());
        response.on('error', (err) => { file.destroy(); fs.unlink(filePath, () => reject(err)); });
        response.pipe(file).once('finish', () => resolve());
      } else if ((response.statusCode === 302 || response.statusCode === 301) && _redirectCount < MAX_REDIRECTS) {
        downloadFile(response.headers.location, filePath, onProgressCb, _redirectCount + 1).then(resolve).catch(reject);
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        reject(new Error('Too many redirects (max ' + MAX_REDIRECTS + ')'));
      } else {
        reject(new Error('Network error ' + response.statusCode));
      }
    });
    request.on('response', (res) => { total = parseInt(res.headers['content-length'], 10) || 0; totalLen = niceBytes(total); });
    request.on('error', reject);
    request.end();
  });
}

module.exports = { downloadFile, niceBytes };
