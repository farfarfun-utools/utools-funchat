// @vitest-environment jsdom
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mount } from '@vue/test-utils';
import AgentDialog from '../src/features/agents/AgentDialog.vue';
import ChatComposer from '../src/features/chat/ChatComposer.vue';
import ChatExportMenu from '../src/features/chat/ChatExportMenu.vue';
import SettingsView from '../src/features/settings/SettingsView.vue';
import { host } from '../src/services/utools.ts';
import { useChatStore } from '../src/stores/chat.ts';

const store = useChatStore();

async function resetStore() {
  for (const doc of host.db.allDocs('')) host.db.remove(doc._id);
  host.dbStorage.removeItem('funchat.settings');
  host.dbStorage.setItem('funchat.documents.migrated', true);
  host.db.put({ _id: 'ai@1', nickname: '小助手', params: { model: 'gpt-4o' } });
  store.state.settings.provider = 'utools';
  await store.init();
}

test('ChatComposer 在输入法组合态按 Enter 不误发消息', async () => {
  await resetStore();
  store.updateSettings({ sendMode: 'enter' });
  let sentCount = 0;
  host.ai = async (_params, onChunk) => {
    sentCount += 1;
    onChunk({ content: 'ok' });
  };

  const wrapper = mount(ChatComposer);
  const textarea = wrapper.find('textarea');
  await textarea.setValue('zhongwen');
  await textarea.trigger('keydown', { key: 'Enter', isComposing: true });

  assert.equal(sentCount, 0, '输入法选词回车不应直接发送');
  assert.equal((textarea.element as HTMLTextAreaElement).value, 'zhongwen');
  wrapper.unmount();
});

test('AgentDialog 函数对象 JSON 非法时展示明确错误提示且不关闭弹窗', async () => {
  await resetStore();
  const wrapper = mount(AgentDialog, { attachTo: document.body });
  const vm = wrapper.vm as unknown as { open: () => void };
  vm.open();
  await wrapper.vm.$nextTick();

  const radios = wrapper.findAll('input[type="radio"]');
  await radios[1].setValue(true);
  await wrapper.find('input[placeholder="Ai昵称"]').setValue('函数助手');
  await wrapper.find('textarea').setValue('{bad json');
  await wrapper.find('form').trigger('submit');

  assert.ok(wrapper.find('.dialog-error').exists(), '应展示格式错误提示');
  assert.match(wrapper.find('.dialog-error').text(), /有效的 JSON/);
  assert.equal((wrapper.find('dialog').element as HTMLDialogElement).open, true);
  wrapper.unmount();
});

test('SettingsView 夹紧窗口高度范围并在批量替换模型后反馈结果', async () => {
  await resetStore();
  const wrapper = mount(SettingsView);

  const numberInput = wrapper.find('.height-number');
  await numberInput.setValue('1500');
  await numberInput.trigger('change');
  assert.equal(store.state.settings.windowHeight, 1000);
  assert.match(wrapper.find('input[type="range"]').attributes('style') || '', /--pct:\s*100%/);

  await wrapper.find('.source-view .transfer-list button').trigger('click');
  await wrapper.find('.target-model input').setValue('gpt-5');
  await wrapper.find('.replace-button').trigger('click');

  assert.equal(store.state.agents[0]?.params?.model, 'gpt-5');
  assert.match(wrapper.find('.model-status').text(), /已为 1 位好友替换为 gpt-5/);
  wrapper.unmount();
});

test('ChatExportMenu 一键复制后显示已复制状态反馈', async () => {
  await resetStore();
  store.state.messages = [{ role: 'user', content: '你好' }];
  const wrapper = mount(ChatExportMenu);
  const copyButton = wrapper.findAll('[role="menuitem"]').find((item) => item.text().includes('一键复制'));
  assert.ok(copyButton);
  await copyButton.trigger('click');
  await wrapper.vm.$nextTick();

  assert.ok(wrapper.find('.chat-more.is-copied').exists());
  wrapper.unmount();
});
