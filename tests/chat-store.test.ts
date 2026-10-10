import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { computed, effect } from 'vue';
import { loadHistories } from '../src/services/storage.ts';
import { host } from '../src/services/utools.ts';
import { useChatStore } from '../src/stores/chat.ts';

const store = useChatStore();

async function setup({ contextLength = 16, agents = 1 } = {}) {
  for (const document of host.db.allDocs('')) host.db.remove(document._id);
  host.dbStorage.removeItem('sortAiIds');
  for (let index = 1; index <= agents; index += 1) {
    host.db.put({
      _id: `ai@${index}`,
      nickname: `好友${index}`,
      contextLength,
      params: { model: 'test', messages: [{ role: 'system', content: '系统提示' }] },
    });
  }
  store.state.settings.provider = 'utools';
  await store.init();
}

const replyWith = (text) => async (params, onChunk) => { onChunk({ content: text }); };

test('streams assistant deltas through the reactive proxy', async () => {
  await setup();
  const rendered = computed(() => store.state.messages.at(-1)?.content ?? '');
  const snapshots = [];
  const runner = effect(() => { snapshots.push(rendered.value); });
  host.ai = async (params, onChunk) => { onChunk({ content: '你好' }); onChunk({ content: '世界' }); };

  await store.send('提问');

  assert.equal(rendered.value, '你好世界');
  assert.ok(snapshots.includes('你好'), '每个数据块都应即时可见');
  runner.effect.stop();
});

test('persists every message instead of only the context window', async () => {
  await setup({ contextLength: 2 });
  host.ai = replyWith('好的');

  for (const question of ['问题1', '问题2', '问题3', '问题4']) await store.send(question);

  const [history] = await loadHistories();
  assert.equal(history.messages[0].role, 'system');
  assert.deepEqual(
    history.messages.filter((message) => message.role === 'user').map((message) => message.content),
    ['问题1', '问题2', '问题3', '问题4'],
  );
});

test('still truncates the outgoing request to the context window', async () => {
  await setup({ contextLength: 2 });
  let sent;
  host.ai = async (params, onChunk) => { sent = params.messages; onChunk({ content: '好的' }); };

  for (const question of ['问题1', '问题2', '问题3']) await store.send(question);

  assert.equal(sent[0].role, 'system');
  assert.deepEqual(sent.filter((message) => message.role === 'user').map((message) => message.content), ['问题2', '问题3']);
});

test('reopening a topic restores the whole conversation', async () => {
  await setup({ contextLength: 2 });
  host.ai = replyWith('好的');
  for (const question of ['问题1', '问题2', '问题3']) await store.send(question);
  const [history] = store.state.histories;

  store.newConversation();
  assert.deepEqual(store.state.messages, []);
  store.openHistory(history);

  assert.deepEqual(
    store.state.messages.filter((message) => message.role === 'user').map((message) => message.content),
    ['问题1', '问题2', '问题3'],
  );
});

test('surfaces a request failure inside the assistant bubble', async () => {
  await setup();
  host.ai = async () => { throw new Error('额度不足'); };

  await store.send('提问');

  const last = store.state.messages.at(-1);
  assert.match(last.content, /额度不足/u);
  assert.equal(last.error, true);
  assert.equal(store.state.loading, false);
});

test('ignores retry while a reply is still streaming', async () => {
  await setup();
  let release;
  host.ai = () => new Promise((resolve) => { release = resolve; });
  const sending = store.send('第一个问题');
  assert.equal(store.state.loading, true);

  await store.retryMessage(store.state.messages.length - 1);

  assert.deepEqual(store.state.messages.map((message) => message.role), ['user', 'assistant']);
  release();
  await sending;
});

test('retry replays the previous question', async () => {
  await setup();
  host.ai = replyWith('第一次回答');
  await store.send('提问');
  host.ai = replyWith('第二次回答');

  await store.retryMessage(store.state.messages.length - 1);

  assert.deepEqual(store.state.messages.map((message) => message.content), ['提问', '第二次回答']);
});

test('stop removes an empty reply bubble and clears the loading flag', async () => {
  await setup();
  let release;
  host.ai = () => new Promise((resolve) => { release = resolve; });
  const sending = store.send('提问');
  assert.equal(store.state.messages.length, 2);

  store.stop();

  assert.equal(store.state.loading, false);
  assert.deepEqual(store.state.messages.map((message) => message.role), ['user']);
  release();
  await sending;
});

test('a stopped uTools stream can no longer write into the conversation', async () => {
  await setup();
  let emit;
  let release;
  host.ai = (params, onChunk) => new Promise((resolve) => { emit = onChunk; release = resolve; });
  const sending = store.send('提问');
  emit({ content: '开始' });
  assert.equal(store.state.messages.at(-1).content, '开始');

  store.stop();
  emit({ content: '不该出现' });
  release();
  await sending;

  assert.equal(store.state.messages.at(-1).content, '开始');
});

// 历史列表改成了原地增删（不再每次操作都整库重读），内存与库一旦分叉很难察觉，
// 所以把「状态等于重新读库的结果」作为不变量钉住。
test('the in-memory history list stays identical to a fresh read from the db', async () => {
  await setup({ agents: 2 });
  host.ai = replyWith('好的');

  await store.send('第一个话题');
  store.newConversation();
  await store.send('第二个话题');
  store.selectAgent(store.state.agents.find((agent) => agent._id === 'ai@1'));
  await store.send('另一个好友的话题');
  assert.deepEqual(store.state.histories, await loadHistories(), '连续发送后应一致');

  store.toggleFavorite(store.state.histories[0]);
  assert.deepEqual(store.state.histories, await loadHistories(), '收藏后应一致');

  store.deleteHistory(store.state.histories[1]);
  assert.deepEqual(store.state.histories, await loadHistories(), '删除话题后应一致');

  store.deleteAgent(store.state.agents.find((agent) => agent._id === 'ai@2'));
  assert.deepEqual(store.state.histories, await loadHistories(), '删除好友应连带清掉它的话题');
});

test('deleting the last agent clears the current selection', async () => {
  await setup({ agents: 1 });

  store.deleteAgent(store.state.agents[0]);

  assert.equal(store.state.agents.length, 0);
  assert.equal(store.state.currentAgent, null);
  assert.deepEqual(store.state.messages, []);
});

test('deleting the active agent falls back to a neighbour', async () => {
  await setup({ agents: 3 });
  store.selectAgent(store.state.agents[2]);

  store.deleteAgent(store.state.agents[2]);

  assert.equal(store.state.agents.length, 2);
  assert.equal(store.state.currentAgent._id, 'ai@2');
});

test('sends pasted images as multi-part content', async () => {
  await setup();
  let sent;
  host.ai = async (params, onChunk) => { sent = params.messages; onChunk({ content: '是一只猫' }); };

  await store.send('这是什么', ['data:image/png;base64,AAAA']);

  assert.deepEqual(sent.at(-1).content, [
    { type: 'text', text: '这是什么' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
  ]);
  assert.equal(store.state.messages.at(-1).content, '是一只猫');
});

test('an image alone is enough to send a message', async () => {
  await setup();
  host.ai = replyWith('收到图片');

  assert.equal(await store.send('', ['data:image/png;base64,AAAA']), true);
  assert.deepEqual(store.state.messages[0].content, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
  assert.equal(await store.send('', []), false, '没文字也没图时不该发出去');
});

test('images survive a round trip through the stored history', async () => {
  await setup();
  host.ai = replyWith('收到');
  await store.send('看图', ['data:image/png;base64,AAAA']);
  const [history] = store.state.histories;

  store.newConversation();
  store.openHistory(history);

  assert.deepEqual(store.state.messages[0].content.at(-1), { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
});

test('retry replays the question together with its image', async () => {
  await setup();
  host.ai = replyWith('第一次回答');
  await store.send('这是什么', ['data:image/png;base64,AAAA']);
  let sent;
  host.ai = async (params, onChunk) => { sent = params.messages; onChunk({ content: '第二次回答' }); };

  await store.retryMessage(store.state.messages.length - 1);

  assert.deepEqual(sent.at(-1).content.at(-1), { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  assert.equal(store.state.messages.at(-1).content, '第二次回答');
  assert.equal(store.state.messages.length, 2, '重试不该留下旧的回答');
});

test('autoPrefix lands on the text part of a message that carries an image', async () => {
  await setup();
  store.state.currentAgent.autoPrefix = '请翻译:';
  let sent;
  host.ai = async (params, onChunk) => { sent = params.messages; onChunk({ content: 'ok' }); };

  await store.send('这是什么', ['data:image/png;base64,AAAA']);

  assert.deepEqual(sent.at(-1).content[0], { type: 'text', text: '请翻译:这是什么' });
  assert.deepEqual(store.state.messages[0].content[0], { type: 'text', text: '这是什么' }, '界面与历史里不应带前缀');
});

test('autoPrefix is prepended to the outgoing question only', async () => {
  await setup();
  store.state.currentAgent.autoPrefix = '请翻译:';
  let sent;
  host.ai = async (params, onChunk) => { sent = params.messages; onChunk({ content: 'hello' }); };

  await store.send('你好');

  assert.equal(sent.at(-1).content, '请翻译:你好');
  assert.equal(store.state.messages[0].content, '你好', '界面与历史里不应带前缀');
  assert.equal((await loadHistories())[0].messages.at(-2).content, '你好');
});

test('un_stream decides whether uTools AI gets a stream callback', async () => {
  await setup();
  // uTools AI 判断流式与否只看有没有传回调，AiOptions 里压根没有 `stream` 这个键。
  // 这个测试以前断言的是 `sent.stream`——一个发过去就被丢掉的字段，于是「非流输出」开关
  // 在这条线路上怎么拨都是流式，测试却一直是绿的。
  let gotCallback;
  host.ai = async (params, onChunk) => {
    gotCallback = typeof onChunk === 'function';
    onChunk?.({ content: '好的' });
    return { content: '好的' };
  };

  await store.send('提问');
  assert.equal(gotCallback, true);
  assert.equal(store.state.messages.at(-1).content, '好的');

  store.state.currentAgent.un_stream = true;
  await store.send('再提问');
  assert.equal(gotCallback, false, '关掉流式输出时不该传回调');
  assert.equal(store.state.messages.at(-1).content, '好的', '非流式要把整条消息一次写进来');
});

test('only a match-command payload gets prefilled into the composer', async () => {
  const originalEnter = host.onPluginEnter;
  let entered;
  host.onPluginEnter = (callback) => { entered = callback; };
  try {
    await setup();
    const before = store.enterIntent.value.seq;

    // 敲关键字进来时 payload 就是关键字本身，照着预填会往输入框里塞一句 "funchat"
    entered({ code: 'funchat', type: 'text', payload: 'funchat', from: 'main' });
    assert.deepEqual(store.enterIntent.value, { seq: before + 1, text: '' });

    // 划词进来的才是用户真想问的内容
    entered({ code: 'funchat-over', type: 'over', payload: '帮我翻译这段', from: 'hotkey' });
    assert.deepEqual(store.enterIntent.value, { seq: before + 2, text: '帮我翻译这段' });
  } finally {
    host.onPluginEnter = originalEnter;
  }
});

test('cycleAgent walks the list and wraps around', async () => {
  await setup({ agents: 3 });
  // 没有任何会话记录时，好友按创建顺序倒序排列（最近创建的在前）。
  assert.equal(store.state.currentAgent._id, 'ai@3');
  store.cycleAgent(1);
  assert.equal(store.state.currentAgent._id, 'ai@2');
  store.cycleAgent(-1);
  assert.equal(store.state.currentAgent._id, 'ai@3');
  store.cycleAgent(-1);
  assert.equal(store.state.currentAgent._id, 'ai@1', '应回绕到末尾');
});

test('sends agents to the top of the list when a new message is sent to them', async () => {
  await setup({ agents: 3 });
  assert.deepEqual(store.state.agents.map((agent) => agent._id), ['ai@3', 'ai@2', 'ai@1']);

  store.selectAgent(store.state.agents.find((agent) => agent._id === 'ai@1'));
  host.ai = replyWith('好的');
  await store.send('你好');

  assert.deepEqual(store.state.agents.map((agent) => agent._id), ['ai@1', 'ai@3', 'ai@2'], '刚互动过的好友应排到最前面');
});

test('pinned agents stay ahead of everyone else regardless of recent activity', async () => {
  await setup({ agents: 3 });
  const oldest = store.state.agents.find((agent) => agent._id === 'ai@1');
  store.togglePin(oldest);

  store.selectAgent(store.state.agents.find((agent) => agent._id === 'ai@2'));
  host.ai = replyWith('好的');
  await store.send('你好');

  assert.deepEqual(store.state.agents.map((agent) => agent._id), ['ai@1', 'ai@2', 'ai@3'], '置顶好友应始终排在最前');
});
