// @vitest-environment jsdom
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mount } from '@vue/test-utils';
import AgentDialog from '../src/features/agents/AgentDialog.vue';
import { host } from '../src/services/utools.ts';
import { useChatStore } from '../src/stores/chat.ts';

test('the super panel switch defaults off, saves on submit and reopens with its saved value', async () => {
  const store = useChatStore();
  host.db.put({ _id: 'ai@panel-ui', nickname: '翻译官', params: {} });
  await store.init();
  const agent = store.state.agents.find((item) => item._id === 'ai@panel-ui');
  const wrapper = mount(AgentDialog);
  try {
    wrapper.vm.open(agent);
    await wrapper.get('.dialog-tabs button:last-child').trigger('click');
    const toggle = wrapper.get('input[aria-label="显示在超级面板"]');
    assert.equal(toggle.element.checked, false);
    await toggle.setValue(true);
    assert.equal(host.getFeatures().length, 0, '保存前不应注册入口');
    await wrapper.get('form').trigger('submit');
    assert.equal(host.db.get(agent._id).superPanel, true);
    assert.equal(host.getFeatures()[0].cmds[0].label, '翻译官');
    wrapper.vm.open(agent);
    await wrapper.get('.dialog-tabs button:last-child').trigger('click');
    assert.equal(wrapper.get('input[aria-label="显示在超级面板"]').element.checked, true);
  } finally {
    wrapper.unmount();
  }
});
