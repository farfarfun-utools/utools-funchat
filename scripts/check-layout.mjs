// 真浏览器才能发现 overflow 裁头像、flex 挤出窗口；jsdom 不计算布局。
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
await server.listen();
let browser;
try {
  browser = await launch({ url: server.resolvedUrls.local[0] });
  const s = browser.session;
  const errors = [];
  s.on('Runtime.exceptionThrown', (event) => errors.push(event.exceptionDetails.text));
  await browser.navigate();
  await s.waitForExpression('document.querySelector(".app-shell")');
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await s.evaluate(`(async () => {
    window.store = (await import('/src/stores/chat.ts')).useChatStore();
    const { host } = await import('/src/services/utools.ts');
    host.ai = async (_params, onChunk) => onChunk({ content: '布局检查回复，未调用真实 AI 服务。' });
    store.state.settings.provider = 'utools';
    store.state.currentAgent.nickname = '一个很长的角色名称，用来检查头像和操作按钮是否被挤出窗口';
    await store.send('布局检查的历史话题');
  })()`);

  const settle = () => s.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const click = async (selector) => {
    await s.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await settle();
  };
  const closeDialogs = async () => {
    await s.evaluate('document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close())');
    await settle();
  };
  const navigate = async (name) => {
    await s.evaluate(`store.state.view = ${JSON.stringify(name)}`);
    await s.waitForExpression(`document.querySelector(${JSON.stringify(name === 'chat' ? '.chat-view' : name === 'settings' ? '.reference-settings' : `.${name}-view`)})`);
    await settle();
  };
  const check = async (selector, fullyVisible = false) => {
    const boxes = await s.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .filter(el => el.getClientRects().length).map(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight,
          overflow: el.scrollWidth > el.clientWidth + 2 };
      })`);
    assert.ok(boxes.length, `找不到 ${selector}`);
    for (const box of boxes) {
      assert.ok(box.left >= -1 && box.right <= box.width + 1 && !box.overflow, `${selector} 横向溢出: ${JSON.stringify(box)}`);
      if (fullyVisible) assert.ok(box.top >= -1 && box.bottom <= box.height + 1, `${selector} 被窗口裁切: ${JSON.stringify(box)}`);
    }
  };
  const checkAvatar = async () => {
    await check('.agent-dialog[open] .agent-avatar, .agent-dialog[open] footer', true);
    assert.ok(await s.evaluate(`(() => {
      const avatar = document.querySelector('.agent-dialog[open] .agent-avatar');
      const rect = avatar.getBoundingClientRect();
      return avatar.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + 2));
    })()`), '头像上沿被父容器裁切');
  };

  for (const theme of ['light', 'dark']) {
    await s.evaluate(`store.updateSettings({ theme: ${JSON.stringify(theme)} })`);
    for (const [width, height] of [[1000, 660], [800, 600], [640, 480], [375, 667], [667, 375]]) {
      await navigate('chat');
      await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await settle();
      await check('.side-menu, .chat-view, .chat-header, .composer-tools', true);
      if (width <= 720) {
        assert.ok(await s.evaluate('store.state.sidebarCollapsed'), '窄窗口没有自动收起好友栏');
        await click('.collapse-button');
        await check('.side-menu, .agent-list', true);
        await click('.agent-item');
        assert.ok(await s.evaluate('store.state.sidebarCollapsed'), '选择好友后应收起遮挡会话的列表');
      }
      await s.evaluate(`store.state.settings.provider = 'openai'; store.state.settings.apiKey = ''; store.state.settings.baseUrl = ''`);
      await settle();
      await check('.api-setup-card');
      await s.evaluate(`store.state.settings.provider = 'utools'`);
      await click('.add-button');
      await check('.agent-dialog[open]', true);
      await checkAvatar();
      await s.evaluate(`document.querySelector('.dialog-pane').scrollTop = 9999`);
      await checkAvatar();
      for (const tab of [2, 3]) {
        await click(`.dialog-tabs button:nth-child(${tab})`);
        await check('.agent-dialog[open]', true);
        await checkAvatar();
      }
      await click('.stream-row .switch i');
      assert.ok(await s.evaluate('document.querySelector(".stream-row input").checked'), '可见开关必须能点击');
      await s.evaluate(`(() => {
        const input = document.querySelector('.tag-input input');
        input.value = '一条很长的问题示例，应该完整换行而不是挤掉输入框和删除按钮'.repeat(3);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await settle();
      await check('.tag-input');
      await checkAvatar();
      await closeDialogs();
      for (const label of ['API 设置', '模型参数']) {
        await click(`button[aria-label="${label}"]`);
        await check('.chat-popover', true);
        if (label === 'API 设置') await check('.api-form footer', true);
      }
      await click('.params-popover .model-browse');
      await check('.model-picker[open], .model-picker[open] footer', true);
      await closeDialogs();
      await click('button[aria-label="模型参数"]');
      await click('button[aria-label="话题记录"]');
      await check('.history-panel, .history-identity', true);
      await click('button[aria-label="关闭话题记录"]');
      assert.equal(await s.evaluate('store.state.historyOpen'), false);
      await click('button[aria-label="导出对话"]');
      await check('.export-dropdown.is-open', true);
      await click('button[aria-label="导出对话"]');
      await s.evaluate(`(async () => {
        const { previewImage } = await import('/src/features/chat/image-preview.ts');
        previewImage('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="teal"/></svg>'));
      })()`);
      await settle();
      await check('.image-lightbox[open]', true);
      await closeDialogs();
      await navigate('prompts');
      await s.waitForExpression('document.querySelector(".market-card")');
      await check('.market-grid, .market-card');
      for (const name of ['notify', 'settings', 'help']) {
        await navigate(name);
        await check(name === 'notify' ? '.notify-list, .notify-content' : name === 'settings' ? '.reference-settings, .reference-card, .model-transfer' : '.help-view, .help-row, .common-links');
      }
      await navigate('settings');
      await click('.backup-actions button');
      await check('.confirm-dialog[open]', true);
      await closeDialogs();
      console.log(`✓ ${theme} ${width}×${height}: 页面、弹窗、头像、关闭入口`);
    }
  }
  assert.deepEqual(errors, [], '页面不应抛出异常');
} finally {
  await browser?.close();
  await server.close();
}
