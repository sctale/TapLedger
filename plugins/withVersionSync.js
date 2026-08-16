/**
 * Expo Config Plugin：自动从 expo.version 派生 Android versionCode
 *
 * 单一数据源：app.json.expo.version
 *
 * versionName 由 expo prebuild 模板自动从 app.json.expo.version 读取，无需此 plugin 处理。
 * versionCode 计算规则：major * 10000 + minor * 100 + patch
 *   例：0.2.1 → 0*10000 + 2*100 + 1 = 201
 *
 * 使用方式：在 app.json 的 expo.plugins 数组中注册即可。
 */
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = (config) => {
  const version = config.version;
  if (!version) return config;

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`withVersionSync: app.json.expo.version "${version}" 不符合 X.Y.Z 格式`);
  }
  const [, majorStr, minorStr, patchStr] = match;
  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  const patch = parseInt(patchStr, 10);
  if (minor >= 100 || patch >= 100) {
    throw new Error(`withVersionSync: minor/patch 必须 < 100（当前 ${major}.${minor}.${patch}）`);
  }
  const versionCode = major * 10000 + minor * 100 + patch;

  return withAppBuildGradle(config, (config) => {
    if (!config.modResults?.contents) {
      throw new Error('withVersionSync: 无法读取 build.gradle 内容');
    }
    let contents = config.modResults.contents;
    const regex = /versionCode\s*=?\s*\d+/;
    if (!regex.test(contents)) {
      throw new Error('withVersionSync: 在 build.gradle 中未找到 versionCode 字段');
    }
    contents = contents.replace(regex, `versionCode ${versionCode}`);
    config.modResults.contents = contents;
    return config;
  });
};
