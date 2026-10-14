import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { ALL_CATEGORY, MARKET_CATEGORIES, loadMarketAgents } from '../src/features/navigation/market-agents.ts';

test('每个分类 tab 都能单独加载，拿到的只有自己那一类', async () => {
  for (const category of MARKET_CATEGORIES) {
    const agents = await loadMarketAgents(category);
    assert.ok(agents.length, `分类「${category}」没加载到角色`);
    assert.deepEqual([...new Set(agents.map((agent) => agent.category))], [category]);
  }
});

// 这条是给 CATEGORY_FILES 守门的：新增一个分类文件却忘了登记，
// 「全部」里会多出一个不在 MARKET_CATEGORIES 里的分类，它就再也没有自己的 tab 了。
test('「全部」里的分类与 tab 列表严格对齐，没有角色因为漏登记而没了入口', async () => {
  const all = await loadMarketAgents(ALL_CATEGORY);
  assert.deepEqual([...new Set(all.map((agent) => agent.category))], MARKET_CATEGORIES, '分类顺序与登记表应一致');

  const counted = await Promise.all(MARKET_CATEGORIES.map((category) => loadMarketAgents(category)));
  assert.equal(all.length, counted.flat().length, '全部应当恰好等于各分类之和');
});

test('全量加载边下边回调，不必等最慢的那个文件', async () => {
  const snapshots: number[] = [];
  const all = await loadMarketAgents(ALL_CATEGORY, (partial) => { snapshots.push(partial.length); });
  assert.equal(snapshots.length, MARKET_CATEGORIES.length, '每到一个文件应回调一次');
  assert.ok(snapshots[0] > 0 && snapshots[0] < all.length, '第一次回调就该有角色可显示，且不是全部');
  assert.equal(snapshots.at(-1), all.length);
});

test('角色 id 不重复，否则列表渲染的 key 会撞车', async () => {
  const all = await loadMarketAgents(ALL_CATEGORY);
  assert.equal(new Set(all.map((agent) => agent.id)).size, all.length);
});
