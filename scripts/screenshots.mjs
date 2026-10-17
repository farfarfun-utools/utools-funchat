// 【生成文件，请勿手改】由 https://github.com/farfarfun-utools/utools-shots 的
// build-scripts.mjs 拼出来：公用骨架 (_prelude.mjs) + 本插件的演示数据与分镜
// (_tail-<app>.mjs)。四个插件仓库里的这个文件骨架部分一字不差，所以只维护一份、分发
// 过来。要改就回那边改，再重新生成 —— 直接改这里，下次生成就没了。scripts/cdp.mjs 同理。
//
// 生成 README 里的界面截图。
//
// 为什么要有这个脚本：README 里的图最容易过期 —— 改完界面没人记得重截一遍，而图和
// 实物对不上比没有图更糟。所以把它做成可重跑的：打版本标签时 CI 跑一遍，图真变了才
// 提交回仓库（见 .github/workflows/screenshots.yml）。
//
// 插件窗口本质就是一个 Chromium 页面，所以「起个静态服务器打开 utools/dist 再拍照」
// 拍到的就是真机上的样子。视口严格按 utools/plugin.json 里的 pluginSetting.height 来。
//
// 用法：
//   pnpm screenshots              # 先构建再截
//   pnpm screenshots --no-build   # 用现有 utools/dist（反复调版式时快得多）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch } from './cdp.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'utools/dist');
const OUT = path.join(ROOT, 'docs/screenshots');

// 时间冻在一个固定时刻。
//
// 不冻的话每跑一遍都会生成一批像素不同的图（倒计时、动态验证码这类随时间变的东西），
// CI 就会每次都提交一笔「截图变了」，而界面其实一个像素都没改。秒数取 07：
// 任何整分钟的 Unix 时间戳都能被 30 整除，所以 07 秒落在 30 秒周期的第 7 秒上，
// 离周期末尾还远，不会触发「最后 5 秒」那类临界态的版式。
const FROZEN_AT = Date.parse('2026-10-16T20:00:07+08:00');

const FREEZE_CLOCK = `(() => {
  const Real = Date;
  const fixed = ${FROZEN_AT};
  class Frozen extends Real {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }
  Frozen.parse = Real.parse;
  Frozen.UTC = Real.UTC;
  globalThis.Date = Frozen;
})()`;

// 冻住时钟管不到 CSS 动画和过渡 —— 它们跟的是文档时间轴，不是 Date.now()。
// 所以还得把过渡关掉，拍到的才是终态而不是某一帧中间态。
// 跟时间有关的动画（比如倒计时圆环）由各自的 extraCss 钉到固定进度上。
const BASE_CSS = `
  /* 滚动条是浏览器预览的产物，uTools 窗口里没有。
     两条都要写：元素一旦设了标准属性 scrollbar-width，Chrome 就完全忽略
     ::-webkit-scrollbar 那套，只写 webkit 的那条对它不起作用。 */
  * { scrollbar-width: none !important }
  *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important }
  *, *::before, *::after { transition: none !important; caret-color: transparent !important }
`;

/** 本轮要注入页面的样式，reload 之后也要重新贴一遍。 */
let pageCss = BASE_CSS;

/** 把样式贴进当前文档。 */
const injectCss = (session) =>
  session.evaluate(`(() => {
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(pageCss)};
    (document.head || document.documentElement).append(style);
    return true;
  })()`);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 起一个只读静态服务器。端口交给系统分配，不会和别的东西撞。
 * @param root 根目录。
 * @returns 地址和 close()。
 */
async function serve(root) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.join(root, relative);
    if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' });
    fs.createReadStream(target).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

// ───────────────────────── 操作界面的几个小动作 ─────────────────────────
// 每个都返回 (session) => Promise，交给 shot.before 串起来。

/** 点一个选择器命中的元素。 */
const click = (selector) => (session) =>
  session.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click(), true`);

/** 按可见文字点，用在没有稳定选择器的对话框按钮、标签页上。 */
const clickText = (text, selector = 'button') => (session) =>
  session.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((node) => node.textContent.trim() === ${JSON.stringify(text)})?.click(), true`);

/** 点第一个文字里含有 text 的元素，用在列表项上。 */
const clickContains = (selector, text) => (session) =>
  session.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((node) => node.textContent.includes(${JSON.stringify(text)}))?.click(), true`);

/** 在元素中心按右键，用来调出右键菜单。 */
const rightClick = (selector) => (session) =>
  session.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    const box = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(box.left + box.width / 2),
      clientY: Math.round(box.top + box.height / 2),
    }));
    return true;
  })()`);

/** 把滚动容器拉到底，用在消息列表这种新内容在下面的地方。 */
const scrollToBottom = (selector) => (session) =>
  session.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    node.scrollTop = node.scrollHeight;
    return true;
  })()`);

/** 重新加载页面，让下一张图从干净的初始界面开始。 */
const reload = async (session) => {
  await session.send('Page.reload');
  await session.waitForExpression('document.readyState === "complete"');
  await injectCss(session);
  await sleep(1200);
};

/** 依次执行若干个动作。 */
const steps = (...actions) => async (session) => {
  for (const action of actions) {
    await action(session);
    await sleep(350);
  }
};

/**
 * 跑一组截图。
 *
 * @param options.width/height 视口尺寸，对齐 plugin.json 的插件窗口。
 * @param options.scale 像素密度，2 出高清图。
 * @param options.seed 页面首次加载后执行的表达式，用来塞演示数据；执行完会 reload 一次。
 * @param options.extraCss 额外样式，用来把跟时间有关的动画钉到固定进度上，保证可重复。
 * @param options.shots `[{ name, before, wait }]`，before 负责把界面点到位。
 */
async function shoot({ width, height, scale = 2, seed, extraCss = '', shots }) {
  pageCss = BASE_CSS + extraCss;
  const server = await serve(DIST);
  const browser = await launch({ headless: true });
  const { session } = browser;
  const failures = [];
  session.on('Runtime.exceptionThrown', (event) => {
    failures.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text);
  });

  try {
    await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    // 冻时钟必须赶在页面脚本之前，所以走 addScriptToEvaluateOnNewDocument 而不是 evaluate。
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE_CLOCK });
    await browser.navigate(server.origin);
    await session.waitForExpression('document.readyState === "complete"');

    if (seed) {
      await session.evaluate(seed);
      await session.send('Page.reload');
      await session.waitForExpression('document.readyState === "complete"');
    }
    await injectCss(session);
    await sleep(900);

    fs.mkdirSync(OUT, { recursive: true });
    for (const shot of shots) {
      if (shot.before) await shot.before(session);
      await sleep(shot.wait ?? 500);
      const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${shot.name}.png`), Buffer.from(data, 'base64'));
      console.log(`  ✓ docs/screenshots/${shot.name}.png`);
    }
  } finally {
    await browser.close();
    await server.close();
  }

  // 页面里的报错不让截图失败（图照样拍出来了），但要打出来，别让它悄悄烂掉。
  if (failures.length) console.warn('  页面抛错：', failures.slice(0, 5));
}

// 没有浏览器就跳过而不是失败：这是开发期的辅助命令，没装 Chrome 的机器不该因此卡住。
if (!findBrowser()) {
  console.warn('[截图] 找不到 Chromium 系浏览器，跳过');
  process.exit(0);
}

if (!process.argv.includes('--no-build')) {
  const built = spawnSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

// ───────────────────────────── 演示数据 ─────────────────────────────
// 对话和配置都是编的，不含任何真实 API Key。

// 内置好友里的 GPT-5.4（utools/dist/data/agents.json 自带，首次运行会自动入库）。
const AGENT = 'ai@0000000000002';

const ANSWER = `快排的核心是「选一个基准，把比它小的扔左边、大的扔右边，再分别递归」。

\`\`\`python
def quicksort(items: list[int]) -> list[int]:
    if len(items) <= 1:
        return items
    pivot = items[len(items) // 2]
    left = [x for x in items if x < pivot]
    middle = [x for x in items if x == pivot]
    right = [x for x in items if x > pivot]
    return quicksort(left) + middle + quicksort(right)
\`\`\`

平均时间复杂度是 $O(n \\log n)$，推导来自这条递归式：

$$T(n) = 2T\\!\\left(\\frac{n}{2}\\right) + O(n) = O(n \\log n)$$

最坏情况是 $O(n^2)$：数据已经有序、又每次都拿端点当基准。`;

const CONVERSATIONS = [
  {
    at: Date.parse('2026-10-15T21:12:00+08:00'),
    title: '用 Python 写一个快速排序',
    messages: [
      { role: 'user', content: '用 Python 写一个快速排序，顺便说说它的复杂度。' },
      { role: 'assistant', content: ANSWER },
    ],
  },
  {
    at: Date.parse('2026-10-15T16:40:00+08:00'),
    title: '把这段周报改得通顺一点',
    messages: [
      { role: 'user', content: '帮我把这段周报改得通顺一点。' },
      { role: 'assistant', content: '改好了，主要是把三处被动句换成了主动句，并把结论提到了开头。' },
    ],
  },
  {
    at: Date.parse('2026-10-14T10:05:00+08:00'),
    title: 'Vite 的 HMR 是怎么工作的',
    favorite: true,
    messages: [
      { role: 'user', content: 'Vite 的 HMR 到底是怎么工作的？' },
      { role: 'assistant', content: 'Vite 的开发服务器用原生 ESM 直接喂给浏览器，改动哪个模块就只推哪个模块的更新。' },
    ],
  },
  {
    at: Date.parse('2026-10-13T09:30:00+08:00'),
    title: '这段正则匹配不到中文',
    messages: [
      { role: 'user', content: '这段正则为什么匹配不到中文？' },
      { role: 'assistant', content: '因为 \\w 只覆盖 ASCII。加上 u 标志再用 \\p{Script=Han} 就能匹配汉字了。' },
    ],
  },
];

// 索引（chat@）和正文（chatbody@）分开存，和 services/storage.ts 里的拆法一致。
function documents() {
  const docs = {};
  for (const item of CONVERSATIONS) {
    const id = `chat@${AGENT}#${item.at}`;
    const date = new Date(item.at).toLocaleString('zh-CN', { hour12: false });
    docs[id] = {
      _id: id,
      title: item.title,
      isFavorite: Boolean(item.favorite),
      createdDate: date,
      updatedDate: date,
      updatedAt: item.at,
      tokens: item.messages.reduce((sum, message) => sum + message.content.length, 0),
      searchText: item.messages.map((message) => message.content).join(' '),
    };
    docs[`chatbody@${AGENT}#${item.at}`] = { _id: `chatbody@${AGENT}#${item.at}`, messages: item.messages };
  }
  return docs;
}

const seedFor = (theme) => `
  localStorage.setItem('funchat.db.documents', ${JSON.stringify(JSON.stringify(documents()))});
  localStorage.setItem('funchat.funchat.settings', ${JSON.stringify(JSON.stringify({
    // provider 必须是 utools（走客户端内置 AI），否则没填 Key 时整屏被「绑定 API」引导页占住。
    theme, dark: theme === 'dark', provider: 'utools', model: 'deepseek-v3.2', sendMode: 'ctrl-enter',
  }))});
  true;
`;

/** 选中 GPT-5.4，打开话题记录，点进最近那条，再把消息区拉到底。 */
const openTopConversation = steps(
  clickContains('.agent-item', 'GPT-5.4'),
  click('[aria-label="话题记录"]'),
  click('.history-list article'),
  scrollToBottom('.messages'),
);

// 视口对齐 utools/plugin.json 的 pluginSetting.height。
const VIEWPORT = { width: 800, height: 660 };

await shoot({
  ...VIEWPORT,
  seed: seedFor('light'),
  shots: [
    { name: 'chat', before: openTopConversation, wait: 1500 },
    { name: 'history', before: steps(reload, clickContains('.agent-item', 'GPT-5.4'), click('[aria-label="话题记录"]')), wait: 900 },
    { name: 'market', before: steps(reload, click('[aria-label="AI 市场"]')), wait: 1000 },
    { name: 'agent', before: steps(reload, rightClick('.agent-item'), clickText('编辑', '.agent-context-menu button')), wait: 900 },
  ],
});

await shoot({
  ...VIEWPORT,
  seed: seedFor('dark'),
  shots: [{ name: 'dark', before: openTopConversation, wait: 1500 }],
});
