import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

// KaTeX 的 20 条 @font-face 每条都把 woff2 / woff / ttf 三份字体一起列进 src，Vite 会把
// 引用到的全部打成产物：59 个文件共 1.2 MB，占整个 dist 的四成。插件跑在 uTools 的
// Chromium 里，浏览器只取第一个支持的格式（woff2），后两份 876 KB 一次都不会被请求。
// 在 CSS 进入 Vite 的 CSS 流程之前就把这些 url() 删掉，没有引用自然不会产出文件。
function dropLegacyKatexFonts(): Plugin {
  const legacySource = /\s*,\s*url\([^)]*\)\s*format\(\s*(['"]?)(?:woff|truetype)\1\s*\)/g;
  return {
    name: 'drop-legacy-katex-fonts',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.css') || !id.includes('katex')) return null;
      const next = code.replace(legacySource, '');
      // 要防的是「剥离悄悄失效」：上游改一下 src 的写法（引号、顺序、少个逗号）这条正则就
      // 什么都匹配不到，包会不声不响地胖回 1.2 MB。所以按结果验收，而不是比较替换前后有没
      // 有变化——后者在失效时同样是静默通过。
      // 反过来「剥得太狠」是不可能的：正则用 \1 闭合引号，format("woff2") 里的 woff 后面跟
      // 的是 2 而不是引号，woff2 永远配不上，所以剥完必然还留着 woff2。
      const leftover = next.match(/url\([^)]*\.(?:woff|ttf)(?:[?#][^)]*)?\)/g);
      if (leftover) {
        throw new Error(`[drop-legacy-katex-fonts] 仍有 ${leftover.length} 处 woff/ttf 引用没剥掉，katex 的 @font-face 写法可能变了`);
      }
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [vue(), dropLegacyKatexFonts()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'utools/dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // 把不随版本变动的第三方库拆出去。uTools 更新插件是整包替换，拆块省不了下载量，
        // 但首屏要解析的那个模块从 260 kB 降到 100 kB 上下，而且 vendor 块可以和应用代码
        // 并行编译；更实际的收益是产物可读——哪次提交把包撑胖了，一眼能看出来是谁。
        manualChunks: {
          vue: ['vue'],
          markdown: ['marked', 'dompurify'],
        },
      },
    },
  },
});
