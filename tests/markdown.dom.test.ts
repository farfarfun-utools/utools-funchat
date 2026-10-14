// @vitest-environment jsdom
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { renderMarkdown } from '../src/features/chat/markdown.ts';

// 这里渲染的是模型吐回来的内容，等于把一段不可信的 HTML 插进自家界面。
// 下面几条守的就是这件事，没有 DOM 就跑不起来，所以这个文件单独跑在 jsdom 上。

test('脚本和事件处理器一概不留', () => {
  const html = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">');
  assert.ok(!html.includes('<script'), '不该留下 script 标签');
  assert.ok(!html.includes('onerror'), '不该留下事件处理器');
});

test('普通内容里的内联 style 一律丢掉', () => {
  // 留着它，模型回一句定位到全屏的 div 就能糊住整个界面冒充插件 UI
  const html = renderMarkdown('<span style="position:fixed;inset:0;z-index:9">假的插件界面</span>');
  assert.ok(html.includes('假的插件界面'), '文字本身要留下');
  assert.ok(!html.includes('style='), `style 应当被删掉，实际是 ${html}`);
});

test('公式里的 style 要留着，否则 KaTeX 的排版就散了', () => {
  const html = renderMarkdown('<span class="katex"><span class="strut" style="height:1.2em;vertical-align:-0.3em"></span></span>');
  assert.ok(html.includes('height:1.2em'), `公式内部的 style 应当保留，实际是 ${html}`);
});

test('链接一律在外部浏览器打开，且带上 noopener', () => {
  const html = renderMarkdown('[去看看](https://example.com)');
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('javascript: 协议的链接不会被当成可点的地址', () => {
  const html = renderMarkdown('[点我](javascript:alert(1))');
  assert.ok(!html.includes('javascript:'), `危险协议应当被清掉，实际是 ${html}`);
});

test('代码块按 markdown 渲染，内容原样保留', () => {
  const html = renderMarkdown('```js\nconst a = 1 < 2;\n```');
  assert.ok(html.includes('<pre>'));
  assert.ok(html.includes('const a = 1 &lt; 2;'));
});

test('KaTeX 还没到位时，公式先以原文占位显示', () => {
  // 懒加载的 KaTeX 在测试里不会到位，这时候宁可显示源码也不能把内容吞掉
  const html = renderMarkdown('质能方程 $E=mc^2$');
  assert.ok(html.includes('E=mc^2'), `公式原文不该丢，实际是 ${html}`);
});
