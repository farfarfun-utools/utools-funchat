import { afterEach, beforeEach, test, vi } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { agentFormValues } from '../src/features/agents/agent-form.ts';
import { host } from '../src/services/utools.ts';
import { useChatStore } from '../src/stores/chat.ts';

const store = useChatStore();
const originalAi = host.ai;
let entered;
let pulled;
const action = (payload = 'Hello', code = 'funchat-agent-ai@translator') => ({ code, type: 'over', payload, from: 'panel' });

beforeEach(async () => {
  for (const document of host.db.allDocs()) host.db.remove(document);
  for (const feature of host.getFeatures()) host.removeFeature(feature.code);
  host.db.put({ _id: 'ai@other', nickname: '其他角色', params: {} });
  host.db.put({
    _id: 'ai@translator', nickname: '中英翻译官', superPanel: true, autoPrefix: '请翻译:',
    params: { model: 'translator-model', messages: [{ role: 'system', content: '只输出译文' }] },
  });
  vi.spyOn(host, 'onPluginEnter').mockImplementation((callback) => { entered = callback; });
  vi.spyOn(host, 'onDbPull').mockImplementation((callback) => { pulled = callback; });
  host.ai = vi.fn(async (_params, onChunk) => { onChunk({ content: '你好' }); });
  store.state.settings.provider = 'utools';
  await store.init();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  store.stop();
  host.ai = originalAi;
});

test('registers only opted-in roles and updates, disables and deletes their entries', () => {
  assert.equal(host.getFeatures().length, 1);
  const agent = store.state.agents.find((item) => item._id === 'ai@translator');
  const [feature] = host.getFeatures();
  assert.deepEqual(feature.cmds, [{ type: 'over', label: '中英翻译官', minLength: 1, maxLength: 100_000 }]);
  store.updateAgent(agent, { ...agentFormValues(agent), nickname: '翻译助手' });
  assert.equal(host.getFeatures()[0].code, feature.code);
  assert.equal(host.getFeatures()[0].cmds[0].label, '翻译助手');
  store.updateAgent(agent, { ...agentFormValues(agent), superPanel: false });
  assert.deepEqual(host.getFeatures(), []);
  assert.equal(host.db.get(agent._id).superPanel, false);
  store.updateAgent(agent, { ...agentFormValues(agent), superPanel: true });
  store.deleteAgent(agent);
  assert.deepEqual(host.getFeatures(), []);
  store.addAgent({ ...agentFormValues(null), nickname: '新翻译官', superPanel: true });
  assert.equal(host.getFeatures()[0].cmds[0].label, '新翻译官');
  assert.equal(host.db.get(store.state.currentAgent._id).superPanel, true);
});

test('super panel features use each role avatar and refresh when the avatar changes', () => {
  const agent = store.state.agents.find((item) => item._id === 'ai@translator');
  const uploaded = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // 默认无 avatar 时生成基于昵称首字的渐变 SVG 图标，而非插件通用 logo.png
  const initialIcon = host.getFeatures()[0].icon;
  assert.ok(initialIcon?.startsWith('data:image/svg+xml;base64,'), '无自定义头像时应生成角色专属 SVG 图标');
  assert.match(Buffer.from(initialIcon.split(',')[1], 'base64').toString('utf8'), /中英/);

  // 更换为内置头像
  store.updateAgent(agent, { ...agentFormValues(agent), avatar: { type: 'image', image: '18' } });
  assert.equal(host.getFeatures()[0].icon, 'dist/avatars/18.jpg');

  // 更换为 Emoji 渐变头像
  store.updateAgent(agent, {
    ...agentFormValues(agent),
    avatar: { type: 'emoji', emoji: '🦊', gradient: ['#fb923c', '#ea580c'], color: '#fb923c' },
  });
  const emojiIcon = host.getFeatures()[0].icon;
  assert.ok(emojiIcon?.startsWith('data:image/svg+xml;base64,'));
  const decodedEmojiSvg = Buffer.from(emojiIcon.split(',')[1], 'base64').toString('utf8');
  assert.match(decodedEmojiSvg, /🦊/);
  assert.match(decodedEmojiSvg, /#fb923c/);

  // 更换为本地上传的 Base64 头像
  store.updateAgent(agent, { ...agentFormValues(agent), avatar: { type: 'image', image: uploaded } });
  assert.equal(host.getFeatures()[0].icon, uploaded);

  // 更换为文字头像
  store.updateAgent(agent, {
    ...agentFormValues(agent),
    avatar: { type: 'text', text: '翻译', gradient: ['#38bdf8', '#2563eb'], color: '#38bdf8' },
  });
  const textIcon = host.getFeatures()[0].icon;
  assert.ok(textIcon?.startsWith('data:image/svg+xml;base64,'));
  assert.match(Buffer.from(textIcon.split(',')[1], 'base64').toString('utf8'), /翻译/);
});

test('reload and device sync reconcile restored roles without deleting unrelated features', async () => {
  host.setFeature({ code: 'unrelated', cmds: ['其他功能'] });
  host.setFeature({ code: 'funchat-agent-ai@deleted', cmds: ['旧角色'] });
  const agent = host.db.get('ai@translator');
  host.db.put({ ...agent, nickname: '恢复的翻译官' });
  await store.reload();
  assert.deepEqual(host.getFeatures().map((feature) => feature.code).sort(), ['funchat-agent-ai@translator', 'unrelated']);
  assert.equal(host.getFeatures(['funchat-agent-ai@translator'])[0].cmds[0].label, '恢复的翻译官');
  host.db.put({ ...host.db.get('ai@translator'), superPanel: false });
  pulled();
  await vi.waitFor(() => assert.deepEqual(host.getFeatures().map((feature) => feature.code), ['unrelated']));
});

test('a long selection is sent once to the selected role in a fresh conversation', async () => {
  store.selectAgent(store.state.agents.find((agent) => agent._id === 'ai@other'));
  await store.send('其他角色的对话');
  const oldChatId = store.state.currentAgent.chatId;
  host.ai.mockClear();
  store.state.view = 'settings';
  const text = 'Long text\n'.repeat(1000);
  await entered(action(text));
  assert.equal(store.state.view, 'chat');
  assert.equal(store.state.currentAgent._id, 'ai@translator');
  assert.equal(host.ai.mock.calls.length, 1);
  const request = host.ai.mock.calls[0][0];
  assert.equal(request.model, 'translator-model');
  assert.deepEqual(request.messages, [
    { role: 'system', content: '只输出译文' },
    { role: 'user', content: `请翻译:${text.trim()}` },
  ]);
  assert.equal(store.enterIntent.value.text, '');
  assert.ok(host.db.get(oldChatId), '之前的话题应保留');
  assert.equal(store.state.messages.at(-1).content, '你好');
  const firstTranslationId = store.state.currentAgent.chatId;
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
  await entered(action('Second translation'));
  assert.notEqual(store.state.currentAgent.chatId, firstTranslationId);
  assert.equal(store.state.messages.filter((message) => message.role === 'user').length, 1);
});

test('normal entry only prefills; invalid, disabled and missing role entries never send', async () => {
  await entered(action('手动编辑', 'funchat-over'));
  assert.equal(store.enterIntent.value.text, '手动编辑');
  for (const payload of ['', '   ', {}, null]) await entered(action(payload));
  await entered({ ...action('keyword'), type: 'text' });
  await entered(action('Hello', 'funchat-agent-ai@missing'));
  assert.match(store.state.error, /已删除或关闭/);
  await entered(action('Hello', 'funchat-agent-ai@other'));
  assert.equal(host.ai.mock.calls.length, 0);
});

test('an active stream is not interrupted by a role entry', async () => {
  let release;
  host.ai.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  store.selectAgent(store.state.agents.find((agent) => agent._id === 'ai@other'));
  const sending = store.send('生成中');
  await entered(action());
  assert.equal(store.state.currentAgent._id, 'ai@other');
  assert.equal(store.state.loading, true);
  assert.equal(host.ai.mock.calls.length, 1);
  assert.match(store.state.error, /正在生成/);
  release();
  await sending;
});

test('failure to save the old conversation prevents sending to either role', async () => {
  store.selectAgent(store.state.agents.find((agent) => agent._id === 'ai@other'));
  const put = host.db.put;
  vi.spyOn(host.db, 'put').mockImplementation((document) => document._id.startsWith('chatbody@')
    ? { error: true, message: 'disk full' } : put(document));
  await store.send('必须保留');
  host.ai.mockClear();
  await entered(action());
  assert.equal(host.ai.mock.calls.length, 0);
  assert.equal(store.state.currentAgent._id, 'ai@other');
  assert.equal(store.state.messages[0].content, '必须保留');
  assert.match(store.state.saveError, /disk full/);
});

test('registration errors are visible without blocking startup', async () => {
  vi.spyOn(host, 'setFeature').mockImplementation(() => { throw new Error('host unavailable'); });
  await store.reload();
  assert.match(store.state.error, /超级面板入口更新失败.*host unavailable/);
});

test('preload delivers the cold-start selection after roles load and forwards later entries', async () => {
  const window = {};
  const preload = readFileSync(new URL('../utools/preload.js', import.meta.url), 'utf8');
  host.onPluginEnter.mockReset().mockImplementation((callback) => { entered = callback; });
  runInNewContext(preload, { window, utools: host, require: createRequire(import.meta.url) });
  assert.equal(host.onPluginEnter.mock.calls.length, 1);
  await entered(action());
  store.state.agents = [];
  store.state.currentAgent = null;
  vi.stubGlobal('window', window);
  await store.init();
  await vi.waitFor(() => assert.equal(store.state.messages.at(-1)?.content, '你好'));
  assert.equal(store.state.currentAgent._id, 'ai@translator');
  assert.equal(store.state.messages[0].content, 'Hello');
  assert.equal(host.ai.mock.calls.length, 1);
  assert.equal(host.onPluginEnter.mock.calls.length, 1);
  await entered(action('稍后选中的文字', 'funchat-over'));
  assert.equal(store.enterIntent.value.text, '稍后选中的文字');
  assert.equal(host.ai.mock.calls.length, 1);
});
