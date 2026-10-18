// @vitest-environment jsdom
// 备份按钮到数据库之间的那段线。
//
// backup.test.ts 盯的是数据本身，这里盯的是「点了到底有没有发生」：确认框没点确定就不该
// 写盘、点了取消不该谎报成功、恢复完界面要跟着换掉。这类故障在界面上看不出来 —— 按钮按下
// 去、什么都没变，用户只会以为是自己没点中。
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mount } from '@vue/test-utils';
import SettingsView from '../src/features/settings/SettingsView.vue';
import { serializeBackup } from '../src/services/backup.ts';
import { saveSettings } from '../src/services/storage.ts';
import { host } from '../src/services/utools.ts';
import { useChatStore } from '../src/stores/chat.ts';

const store = useChatStore();

async function setup() {
  for (const document of host.db.allDocs('')) host.db.remove(document._id);
  host.dbStorage.removeItem('funchat.settings');
  host.dbStorage.setItem('funchat.documents.migrated', true);
  host.db.put({ _id: 'ai@1', nickname: '小助手', params: { model: 'test' } });
  // 走 saveSettings 而不是直接写 dbStorage：键名只该有 storage.ts 一处知道
  saveSettings({
    apiRoutes: [{ id: 'r1', name: '私有线路', provider: 'openai', baseUrl: 'https://api.example.com', apiKey: 'sk-secret-123' }],
    activeRouteId: 'r1',
  } as never);
  await store.init();
}

/** 点开某个按钮弹出的确认框，并按下「确定」那一侧。 */
async function confirmDialog(wrapper: ReturnType<typeof mount>, ok: boolean) {
  const dialog = wrapper.find('.confirm-dialog');
  assert.ok(dialog.exists(), '确认框没弹出来');
  await dialog.find(ok ? '.primary' : 'button').trigger('click');
  // confirm() 走的是 dialog.close() → close 事件 → resolve，不是同步返回
  await new Promise((resolve) => setTimeout(resolve));
  await wrapper.vm.$nextTick();
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll('.backup-actions button').find((item) => item.text().includes(label));
  assert.ok(button, `找不到「${label}」按钮`);
  return button;
}

test('导出要先过确认框，确认后写出的备份里有好友和明文密钥', async () => {
  await setup();
  const saved: string[] = [];
  window.saveFile = async (_options, data) => { saved.push(String(data)); return true; };

  const wrapper = mount(SettingsView);
  await findButton(wrapper, '导出备份').trigger('click');
  await wrapper.vm.$nextTick();
  assert.equal(saved.length, 0, '确认框还没点，不该已经写盘');

  await confirmDialog(wrapper, true);
  assert.equal(saved.length, 1, '确认之后应当写出一份备份');
  const backup = JSON.parse(saved[0]);
  assert.ok(backup.documents.some((document: { _id: string }) => document._id === 'ai@1'));
  assert.equal(backup.settings.apiRoutes[0].apiKey, 'sk-secret-123');
  assert.match(wrapper.find('.backup-status').text(), /已导出/);
});

test('在保存对话框里取消，不报「已导出」', async () => {
  await setup();
  // preload 的 saveFile 在用户取消时返回 false。原来这条路径一律当成功，用户取消了
  // 界面照样说「已导出」，下次要用备份时才发现根本没有这个文件。
  window.saveFile = async () => false;

  const wrapper = mount(SettingsView);
  await findButton(wrapper, '导出备份').trigger('click');
  await wrapper.vm.$nextTick();
  await confirmDialog(wrapper, true);

  assert.equal(wrapper.find('.backup-status').exists(), false, '取消之后不该出现任何「已导出」');
});

test('恢复整库替换：旧好友没了，设置跟着换，界面也跟着换', async () => {
  await setup();
  const other = serializeBackup({
    funchat: 1,
    exportedAt: 1,
    settings: { apiRoutes: [{ id: 'r9', name: '备份里的线路', provider: 'openai', baseUrl: '', apiKey: 'sk-from-backup' }], activeRouteId: 'r9' },
    documents: [{ _id: 'ai@9', nickname: '备份里的好友', params: { model: 'test' } }],
  } as never);
  window.openTextFile = async () => other;

  const wrapper = mount(SettingsView);
  await findButton(wrapper, '恢复备份').trigger('click');
  await new Promise((resolve) => setTimeout(resolve));
  await wrapper.vm.$nextTick();
  await confirmDialog(wrapper, true);
  await new Promise((resolve) => setTimeout(resolve));

  assert.equal(host.db.get('ai@1'), null, '旧好友应当被替换掉');
  assert.equal(host.db.get('ai@9')?.nickname, '备份里的好友');
  assert.equal(store.state.settings.apiKey, 'sk-from-backup', '镜像字段要跟着备份里的线路走');
  // 界面不跟着重载的话，用户看到的还是已经不存在的那位好友
  assert.equal(store.state.agents.map((agent) => agent._id).join(), 'ai@9');
  assert.match(wrapper.find('.backup-status').text(), /已恢复/);
});

test('恢复时点取消，数据一个字节都不动', async () => {
  await setup();
  window.openTextFile = async () => serializeBackup({
    funchat: 1, exportedAt: 1, settings: {}, documents: [{ _id: 'ai@9', nickname: '不该出现' }],
  } as never);

  const wrapper = mount(SettingsView);
  await findButton(wrapper, '恢复备份').trigger('click');
  await new Promise((resolve) => setTimeout(resolve));
  await wrapper.vm.$nextTick();
  await confirmDialog(wrapper, false);

  assert.equal(host.db.get('ai@1')?.nickname, '小助手');
  assert.equal(host.db.get('ai@9'), null);
});

test('选到不是备份的文件：直接说清楚，而不是弹确认框问要不要替换', async () => {
  await setup();
  window.openTextFile = async () => '{"hello":1}';

  const wrapper = mount(SettingsView);
  await findButton(wrapper, '恢复备份').trigger('click');
  await new Promise((resolve) => setTimeout(resolve));
  await wrapper.vm.$nextTick();

  assert.match(wrapper.find('.backup-status').text(), /不是 FunChat 备份/);
  assert.equal(host.db.get('ai@1')?.nickname, '小助手');
});
