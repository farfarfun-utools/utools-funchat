import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// 跑测试时沿用构建用的那份 vite 配置（vue 插件、别名都在里面），只补测试自己的部分。
// 默认环境仍是 node：大部分测试是纯函数和 store，不需要 DOM，装一套 DOM 只会拖慢它们。
// 需要 DOM 的测试在文件顶部写 `// @vitest-environment jsdom` 自己声明。
export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      // 入口与类型声明没有可执行逻辑；market/ 下是 300 条提示词数据，不是代码
      exclude: ['src/main.ts', 'src/types.ts', 'src/features/navigation/market/**'],
      reporter: ['text', 'html'],
    },
  },
}));
