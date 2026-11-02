// @vitest-environment jsdom
import { test, vi } from 'vitest';
import { strict as assert } from 'node:assert';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ChatComposer from '../src/features/chat/ChatComposer.vue';
import { host } from '../src/services/utools.ts';
import { useChatStore } from '../src/stores/chat.ts';

vi.mock('../src/features/chat/pdf-attachment.ts', () => ({
  extractPdfText: async () => ({ content: 'PDF：example.pdf\n\n第 1 页\nHello PDF', truncated: false }),
  renderPdfPages: async () => [{ id: 'page-1', url: 'data:image/png;base64,AAAA', name: 'example.pdf 第1页', bytes: 3 }],
}));

function pastePdf(element: Element) {
  const file = new File(['PDF'], 'example.pdf', { type: 'application/pdf' });
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [{ kind: 'file', getAsFile: () => file }],
    files: [file],
  } });
  element.dispatchEvent(event);
  return event;
}

test('pasting a PDF asks how to read it, then sends extracted text', async () => {
  const store = useChatStore();
  store.state.currentAgent = { _id: 'ai@pdf-test', nickname: 'PDF 测试', params: {} } as never;
  store.state.settings.provider = 'utools';
  store.state.settings.sendMode = 'ctrl-enter';
  store.state.loading = false;
  store.state.messages = [];
  let sent = [];
  host.ai = (async (options, callback) => {
    sent = options.messages;
    callback?.({ content: '收到' });
  }) as never;

  const wrapper = mount(ChatComposer);
  try {
    const event = pastePdf(wrapper.get('textarea').element);
    await nextTick();
    assert.equal(event.defaultPrevented, true);
    assert.equal(wrapper.get('.pdf-mode-dialog').element.open, true);
    assert.equal(wrapper.findAll('.pdf-mode-actions button').length, 2);

    await wrapper.get('.pdf-mode-actions button:first-child').trigger('click');
    await flushPromises();
    assert.match(wrapper.get('.pdf-attachment').text(), /example.pdf/);
    assert.match(wrapper.get('.pdf-attachment').text(), /文字/);

    await wrapper.get('textarea').setValue('请总结');
    const key = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
    wrapper.get('textarea').element.dispatchEvent(key);
    assert.equal(key.defaultPrevented, true, '发送快捷键应触发输入区处理');
    await flushPromises();
    assert.ok(sent.length, JSON.stringify({ messages: store.state.messages, error: store.state.error }));
    assert.match(sent.find((message) => message.role === 'user').content, /请总结\n\nPDF：example.pdf/);
  } finally {
    wrapper.unmount();
  }
});

test('PDF choice can be cancelled without adding an attachment', async () => {
  const wrapper = mount(ChatComposer);
  try {
    pastePdf(wrapper.get('textarea').element);
    await nextTick();
    await wrapper.get('.pdf-mode-cancel').trigger('click');
    assert.equal(wrapper.find('.pdf-attachment').exists(), false);
    assert.equal(wrapper.get('.pdf-mode-dialog').element.open, false);
  } finally {
    wrapper.unmount();
  }
});

test('page-image mode adds PDF pages as image attachments', async () => {
  const wrapper = mount(ChatComposer);
  try {
    pastePdf(wrapper.get('textarea').element);
    await nextTick();
    await wrapper.get('.pdf-mode-actions button:last-child').trigger('click');
    await flushPromises();
    assert.equal(wrapper.find('.pdf-attachment').exists(), false);
    assert.equal(wrapper.get('.attachment-open img').attributes('alt'), 'example.pdf 第1页');
  } finally {
    wrapper.unmount();
  }
});

test('uses native clipboard bytes when the paste event has only the PDF filename', async () => {
  window.readClipboardPdf = () => ({ name: 'example.pdf', bytes: new TextEncoder().encode('%PDF-1.4') });
  const wrapper = mount(ChatComposer);
  try {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      items: [], files: [], getData: () => 'example.pdf',
    } });
    wrapper.get('textarea').element.dispatchEvent(event);
    await nextTick();
    assert.equal(event.defaultPrevented, true);
    assert.equal(wrapper.get('.pdf-mode-dialog').element.open, true);
    assert.equal(wrapper.get('textarea').element.value, '');
  } finally {
    wrapper.unmount();
    delete window.readClipboardPdf;
  }
});

test('uses native clipboard bytes when Chromium exposes an empty PDF file', async () => {
  window.readClipboardPdf = () => ({ name: 'example.pdf', bytes: new TextEncoder().encode('%PDF-1.4') });
  const wrapper = mount(ChatComposer);
  try {
    const empty = new File([], 'example.pdf', { type: 'application/pdf' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      items: [{ kind: 'file', getAsFile: () => empty }], files: [empty], getData: () => '',
    } });
    wrapper.get('textarea').element.dispatchEvent(event);
    await nextTick();
    assert.equal(event.defaultPrevented, true);
    assert.equal(wrapper.get('.pdf-mode-dialog').element.open, true);
  } finally {
    wrapper.unmount();
    delete window.readClipboardPdf;
  }
});

test('warns when a pasted PDF name has no readable file data', async () => {
  window.readClipboardPdf = () => null;
  const wrapper = mount(ChatComposer);
  try {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      items: [], files: [], getData: () => 'example.pdf',
    } });
    wrapper.get('textarea').element.dispatchEvent(event);
    await nextTick();
    assert.equal(event.defaultPrevented, false);
    assert.match(wrapper.get('.composer-notice').text(), /只获取到文件名/);
  } finally {
    wrapper.unmount();
    delete window.readClipboardPdf;
  }
});
