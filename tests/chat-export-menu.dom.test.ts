// @vitest-environment jsdom
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mount } from '@vue/test-utils';
import ChatExportMenu from '../src/features/chat/ChatExportMenu.vue';
import { useChatStore } from '../src/stores/chat.ts';

test('HTML 导出会转义标题中的 HTML 并清洗文件名中的路径字符', async () => {
  const store = useChatStore();
  store.state.currentAgent = {
    _id: 'ai@xss',
    nickname: '../<script>alert(1)</script>:foo/bar',
  } as never;
  store.state.messages = [{ role: 'user', content: '你好' }];

  let savedPath = '';
  let savedHtml = '';
  window.saveFile = async (options: any, data: unknown) => {
    savedPath = String(options?.defaultPath || '');
    savedHtml = String(data || '');
    return true;
  };

  const wrapper = mount(ChatExportMenu);
  const htmlButton = wrapper.findAll('[role="menuitem"]').find((item) => item.text().includes('导出HTML'));
  assert.ok(htmlButton);
  await htmlButton.trigger('click');

  assert.ok(savedHtml.includes('<title>_&#47;') || savedHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), `标题应当被转义，实际是 ${savedHtml}`);
  assert.ok(!savedHtml.includes('<script>alert(1)</script>'), '未转义的 script 不得进入导出的 HTML');
  const basename = savedPath.slice(savedPath.lastIndexOf('/') + 1);
  assert.ok(!basename.includes('..'), `文件名不应含 ..，实际是 ${basename}`);
  assert.ok(!/[\\:*?"<>|]/u.test(basename), `文件名不应含非法字符，实际是 ${basename}`);
});
