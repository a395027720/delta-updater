/**
 * 文件下载工具 (updater 运行时使用)
 *
 * ============================================================
 * 与 builder/utils.ts 中 downloadFile 的区别
 * ============================================================
 *
 *   本文件:   updater 运行时 → 使用原生 http/https + Stream 流式下载 → 支持进度回调
 *   builder:  builder 构建时 → 使用 cross-fetch → 一次性下载到 buffer
 *
 *   原因: 运行时需要实时进度展示到闪屏，Stream 模式更适合
 */

import fs from 'fs-extra';
import https from 'https';
import http from 'http';

const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 字节数转可读格式 */
export function niceBytes(x: number | string): string {
  let l = 0;
  let n = parseInt(x as string, 10) || 0;
  while (n >= 1024 && ++l) {
    n /= 1024;
  }
  return `${n.toFixed(n < 10 && l > 0 ? 1 : 0)} ${units[l]}`;
}

/**
 * 下载文件到本地 (支持进度回调, 301/302 跟随, 最大 10 次重定向)
 *
 * @param url           - 下载地址
 * @param filePath      - 本地保存路径
 * @param onProgressCb  - 进度回调 { transferred, percentage, total }
 * @param _redirectCount - 内部参数: 重定向计数 (外部调用不传)
 */
export function downloadFile(
  url: string,
  filePath: string,
  onProgressCb?: (info: { transferred: string; percentage: string; total: string }) => void,
  _redirectCount = 0,
): Promise<void> {
  const MAX_REDIRECTS = 10;
  return new Promise((resolve, reject) => {
    let total = 0;
    let totalLen = '0 MB';
    let transferred = 0;

    const httpOrHttps = url.startsWith('https') ? https : http;

    const request = httpOrHttps.get(url, (response) => {
      // ---- 200 正常下载 ----
      if (response.statusCode === 200) {
        const file = fs.createWriteStream(filePath);

        file.on('error', (err) => {
          request.destroy();
          reject(err);
        });

        // 进度计算: 基于 content-length
        response.on('data', (chunk: Buffer) => {
          transferred += chunk.length;
          const percentage = parseFloat((transferred * 100) / total).toFixed(2);
          if (onProgressCb && typeof onProgressCb === 'function') {
            onProgressCb({
              transferred: niceBytes(transferred),
              percentage,
              total: totalLen,
            });
          }
        });

        response.on('end', () => {
          file.end();
        });

        response.on('error', (err) => {
          file.destroy();
          fs.unlink(filePath, () => reject(err));
        });

        // pipe 到文件流，finish 时 resolve
        response.pipe(file).once('finish', () => {
          resolve();
        });

      // ---- 重定向 (限制最大次数防止循环) ----
      } else if ((response.statusCode === 302 || response.statusCode === 301) && _redirectCount < MAX_REDIRECTS) {
        downloadFile(response.headers.location!, filePath, onProgressCb, _redirectCount + 1).then(() => resolve());
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));

      // ---- 其他错误 ----
      } else {
        reject(new Error(`Network error ${response.statusCode}`));
      }
    });

    // 获取总大小 (content-length header)
    request.on('response', (res) => {
      total = parseInt(res.headers['content-length'] as string, 10);
      totalLen = niceBytes(total);
    });

    request.on('error', (e) => {
      reject(e);
    });

    request.end();
  });
}
