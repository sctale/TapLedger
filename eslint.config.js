// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'android/**',
      'ios/**',
      'dist/**',
      'server/node_modules/**',
      'server/dist/**',
      'server/data/**',
      'coverage/**',
    ],
  },
  expoConfig,
  prettierConfig,
  {
    rules: {
      // 项目沿用 JSX runtime，允许按需/统一引入 React
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      // 记账逻辑里对返回 Promise 的 fire-and-forget 调用较多（触感 / 落库）
      'no-floating-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      // 本 app 在 effect 里加载 SQLite 数据 / 订阅 DeviceEventEmitter（外部系统），
      // 载入函数为 async、setState 发生在回调中——这是刻意且正确的模式，
      // 新引入的 set-state-in-effect 规则会大面积误报，关掉以免为无收益的写法重构全部页面。
      'react-hooks/set-state-in-effect': 'off',
      // 组件里用 useRef(...).current 拿稳定的 Animated.Value、以及回调存 ref 的经典写法
      // 会被新的 react-hooks/refs 判为“渲染期访问 ref”，这些是刻意且正确的 RN 惯用法，关掉。
      'react-hooks/refs': 'off',
      // 事件订阅 / 跨页刷新依赖里刻意只依赖 [active] 等，exhaustive-deps 降为提醒
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // 后端是 Node 环境，放宽仅适用于 RN 的规则
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
]);
