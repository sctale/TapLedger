const { withAppBuildGradle } = require("expo/config-plugins");

// ===== 私有 release 签名注入（v0.11.0，审查 P0）=====
// 背景：prebuild 生成的 build.gradle 默认让 release 用 debug keystore 签名，
// 而 debug key 是公开已知的——他人可用同包名恶意 APK 覆盖安装用户设备。
// 本插件在 prebuild 时把 release 签名改为读取根目录 keystore.properties（不入库）；
// 文件不存在时回落 debug（仅开发用），发布脚本会校验签名者并拦截 debug 签名的 release 包。

const PROPS_LOADER = `
// TapLedger: release 签名配置（由 plugins/withReleaseSigning.js 注入，勿手改）
def tapledgerKeystorePropsFile = rootProject.file('../keystore.properties')
def tapledgerKeystoreProps = new Properties()
if (tapledgerKeystorePropsFile.exists()) {
    tapledgerKeystorePropsFile.withInputStream { tapledgerKeystoreProps.load(it) }
}
`;

const RELEASE_SIGNING_CONFIG = `
        if (tapledgerKeystorePropsFile.exists()) {
            release {
                storeFile file(tapledgerKeystoreProps.getProperty('storeFile'))
                storePassword tapledgerKeystoreProps.getProperty('storePassword')
                keyAlias tapledgerKeystoreProps.getProperty('keyAlias')
                keyPassword tapledgerKeystoreProps.getProperty('keyPassword')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    // 幂等：已注入过则跳过（prebuild --clean 重跑时防重复）
    if (!contents.includes("tapledgerKeystorePropsFile")) {
      // 1) android { 之前插入 properties 加载器
      contents = contents.replace(
        /\r?\nandroid \{/,
        `${PROPS_LOADER}\nandroid {`,
      );

      // 2) signingConfigs 块内追加 release 配置（debug 块之后、闭合括号之前）
      contents = contents.replace(
        /(signingConfigs \{)([\s\S]*?)(\r?\n    \})/,
        `$1$2${RELEASE_SIGNING_CONFIG}$3`,
      );

      // 3) release buildType 的签名从 debug 切到私有 key（缺配置时回落 debug）
      contents = contents.replace(
        /signingConfig signingConfigs\.debug(\s*\r?\n\s*def enableShrinkResources)/,
        "signingConfig tapledgerKeystorePropsFile.exists() ? signingConfigs.release : signingConfigs.debug$1",
      );
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
};
