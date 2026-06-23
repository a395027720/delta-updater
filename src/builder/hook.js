const path = require('path');
const fs = require('fs');
const os = require('os');
const { build } = require('./index');
const { execSync } = require('child_process');

const STEP = (msg) => console.log(`\n\x1b[36m[delta] ${msg}\x1b[0m`);
const OK = (msg) => console.log(`\x1b[32m  ✓\x1b[0m ${msg}`);
const WARN = (msg) => console.log(`\x1b[33m  ⚠\x1b[0m ${msg}`);
const INFO = (msg) => console.log(`  • ${msg}`);

function extractVersion(fileName) {
  const match = fileName.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function matchEnvironment(fileName, env) {
  if (!env) return true;
  const baseName = path.basename(fileName, path.extname(fileName));
  if (env === 'test') return baseName.endsWith('-test');
  if (env === 'stage') return baseName.endsWith('-stage');
  if (env === 'prod') return baseName.endsWith('-prod');
  return true;
}

function scanReleases(projectRoot, releasesDir, env) {
  const localDir = path.join(projectRoot, releasesDir);
  const releases = [];
  if (!fs.existsSync(localDir)) { WARN(releasesDir + '/ 目录不存在，跳过'); return releases; }
  const files = fs.readdirSync(localDir).filter(f => f.endsWith('.exe')).filter(f => matchEnvironment(f, env));
  if (!files.length) { WARN('无匹配历史版本，跳过'); return releases; }
  STEP('扫描历史安装器: ' + releasesDir + ' [环境: ' + (env || '未知') + ']');
  files.forEach(f => {
    const v = extractVersion(f);
    if (v) { INFO(f + ' -> ' + v); releases.push({ version: v, url: f }); }
    else WARN('无法识别版本: ' + f);
  });
  return releases;
}

function syncToCache(projectRoot, cacheDir, releasesDir, releases) {
  const dataDir = path.join(cacheDir, 'data');
  const localDir = path.join(projectRoot, releasesDir);
  if (!fs.existsSync(localDir) || !releases.length) return;
  fs.mkdirSync(dataDir, { recursive: true });
  releases.forEach(r => {
    const f = path.basename(r.url);
    const cache = path.join(dataDir, f);
    if (!fs.existsSync(cache)) {
      fs.copyFileSync(path.join(localDir, f), cache);
      INFO('同步到缓存: ' + f);
    }
  });
}

function archiveInstaller(projectRoot, releasesDir, latestVersion, env) {
  const outDir = path.join(projectRoot, 'out');
  const prevDir = path.join(projectRoot, releasesDir);
  if (!fs.existsSync(outDir)) return;
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.exe') && matchEnvironment(f, env) && extractVersion(f) === latestVersion);
  if (!files.length) return;
  fs.mkdirSync(prevDir, { recursive: true });
  files.forEach(f => {
    fs.copyFileSync(path.join(outDir, f), path.join(prevDir, f));
    OK('存档: ' + f);
  });
  // 清理旧版
  fs.readdirSync(prevDir).filter(f => f.endsWith('.exe') && matchEnvironment(f, env) && extractVersion(f) !== latestVersion)
    .forEach(f => { fs.unlinkSync(path.join(prevDir, f)); INFO('清理: ' + f); });
}

function createHook(userConfig) {
  const cfg = {
    releasesDir: userConfig && userConfig.releasesDir || process.env.DELTA_RELEASES_DIR || 'delta-releases',
    productIconPath: userConfig && userConfig.productIconPath || process.env.DELTA_PRODUCT_ICON || 'build/icons/icon.ico',
    cacheDir: userConfig && userConfig.cacheDir || process.env.DELTA_CACHE_DIR || path.join(os.homedir(), '.electron-delta'),
  };

  return async function (context) {
    const projectRoot = process.env.INIT_CWD || process.cwd();
    const options = {
      productIconPath: path.isAbsolute(cfg.productIconPath) ? cfg.productIconPath : path.join(projectRoot, cfg.productIconPath),
      productName: context.configuration.productName,
      latestVersion: context.configuration.extraMetadata && context.configuration.extraMetadata.version
        || (context.packager && context.packager.appInfo && context.packager.appInfo.version) || '1.0.0',
      cache: cfg.cacheDir,
      sign: (userConfig && userConfig.sign) || (async () => {}),
      getPreviousReleases: async () => scanReleases(projectRoot, cfg.releasesDir, null),
    };

    console.log('\n\xd5\xc9\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xd7');
    console.log('\xba   delta-updater builder              \xba');
    console.log('\xc8\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xcd\xbc');

    STEP('产品: ' + options.productName + '  版本: ' + options.latestVersion);

    let previousReleases = await options.getPreviousReleases();
    previousReleases = previousReleases.filter(r => r.version !== options.latestVersion);
    options.getPreviousReleases = async () => previousReleases;

    if (!previousReleases.length) {
      INFO('首次构建，无历史版本');
      archiveInstaller(projectRoot, cfg.releasesDir, options.latestVersion, null);
      return [];
    }

    STEP('检查缓存...');
    syncToCache(projectRoot, cfg.cacheDir, cfg.releasesDir, previousReleases);

    STEP('生成差分补丁...');
    // 静默输出
    const noop = () => {};
    const orig = { log: console.log, info: console.info, warn: console.warn, out: process.stdout.write, err: process.stderr.write };
    console.log = noop; console.info = noop; console.warn = noop;
    process.stdout.write = noop; process.stderr.write = noop;
    let files;
    try { files = await build({ context, options }); }
    finally {
      console.log = orig.log; console.info = orig.info; console.warn = orig.warn;
      process.stdout.write = orig.out; process.stderr.write = orig.err;
    }
    if (files && files.length) OK('完成，共 ' + files.length + ' 个文件');
    archiveInstaller(projectRoot, cfg.releasesDir, options.latestVersion, null);
    return files;
  };
}

module.exports = createHook();
module.exports.createHook = createHook;
