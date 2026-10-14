// @vitest-environment jsdom
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mount } from '@vue/test-utils';
import AgentList from '../src/features/agents/AgentList.vue';
import { host } from '../src/services/utools.ts';
import { useChatStore } from '../src/stores/chat.ts';

const store = useChatStore();

async function setup() {
  for (const document of host.db.allDocs('')) host.db.remove(document._id);
  host.dbStorage.removeItem('sortAiIds');
  for (const index of [1, 2]) {
    host.db.put({ _id: `ai@${index}`, nickname: `好友${index}`, params: { model: 'test' } });
  }
  await store.init();
}

test('好友行能用键盘选中，不是只能点', async () => {
  await setup();
  const wrapper = mount(AgentList);
  const rows = wrapper.findAll('.agent-item');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].attributes('tabindex'), '0', '行要能被 Tab 走到');

  // 列表按活跃度排序，别假设谁在第一行：找到不是当前选中的那位，敲回车
  const target = store.state.agents.find((agent) => agent._id !== store.state.currentAgent?._id);
  await rows[store.state.agents.indexOf(target)].trigger('keydown.enter');

  assert.equal(store.state.currentAgent?._id, target._id, '回车应当切到这一行的好友');
  wrapper.unmount();
});

test('当前好友在无障碍树里是能被认出来的', async () => {
  await setup();
  const wrapper = mount(AgentList);
  const rows = wrapper.findAll('.agent-item');
  assert.equal(rows[0].attributes('aria-current'), 'true');
  assert.equal(rows[1].attributes('aria-current'), undefined);
  wrapper.unmount();
});
