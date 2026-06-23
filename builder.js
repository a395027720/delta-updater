/**
 * electron-builder 钩子入口 (JS bridge)
 *
 * electron-builder 在 afterAllArtifactBuild 阶段加载此文件
 * 该文件作为 npm package exports 的 ./builder 入口
 */
const hook = require("./dist/builder/hook.js");
module.exports = hook.default;
module.exports.createHook = hook.createHook;
