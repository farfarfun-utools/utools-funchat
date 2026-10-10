import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { isEventStream, normalizeChatUrl, parseEventStream, streamChat } from '../src/services/chat.ts';
import { host } from '../src/services/utools.ts';

function collect(chunks, contentType = 'text/event-stream') {
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

async function runHttpStream(chunks) {
  const originalFetch = globalThis.fetch;
  let received = '';
  globalThis.fetch = async () => collect(chunks);
  try {
    await streamChat({
      settings: { provider: 'openai', baseUrl: 'https://example.com' },
      agent: { params: { model: 'test' } },
      messages: [],
      onDelta: (chunk) => { received += chunk; },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return received;
}

const delta = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

test('normalizes compatible API URLs', () => {
  assert.equal(normalizeChatUrl('https://api.openai.com'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(normalizeChatUrl('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
  assert.equal(normalizeChatUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');
  assert.equal(normalizeChatUrl(''), '');
});

test('keeps the URL untouched when it carries the # opt-out suffix', () => {
  assert.equal(normalizeChatUrl('https://example.com/custom/path#'), 'https://example.com/custom/path');
  assert.equal(normalizeChatUrl('https://example.com/v1/chat/completions#'), 'https://example.com/v1/chat/completions');
});

test('recognises event-stream blocks including comment-only heartbeats', () => {
  assert.equal(isEventStream(': OPENROUTER PROCESSING'), true);
  assert.equal(isEventStream('event: message\ndata: {}'), true);
  assert.equal(isEventStream('plain text body'), false);
});

test('parses data lines and drops comments, [DONE] and other SSE fields', () => {
  assert.equal(parseEventStream(`${delta('你好')}data: [DONE]`), '你好');
  assert.equal(parseEventStream(': keep-alive'), '');
  assert.equal(parseEventStream(`event: message\n${delta('世界')}`), '世界');
});

test('never leaks SSE heartbeats into the reply', async () => {
  const received = await runHttpStream([
    ': OPENROUTER PROCESSING\n\n',
    delta('你好'),
    ': keep-alive\n\n',
    `event: message\n${delta('世界')}`,
    'data: [DONE]\n\n',
  ]);
  assert.equal(received, '你好世界');
});

test('reassembles data lines split across network chunks', async () => {
  const payload = delta('分片内容');
  const received = await runHttpStream([payload.slice(0, 12), payload.slice(12)]);
  assert.equal(received, '分片内容');
});

test('handles CRLF-separated event blocks', async () => {
  const received = await runHttpStream([delta('甲').replace(/\n/gu, '\r\n'), delta('乙').replace(/\n/gu, '\r\n')]);
  assert.equal(received, '甲乙');
});

test('reads a non-streaming JSON reply', async () => {
  const originalFetch = globalThis.fetch;
  let received = '';
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '完整回复' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    await streamChat({
      settings: { provider: 'openai', baseUrl: 'https://example.com' },
      agent: { params: {} },
      messages: [],
      onDelta: (chunk) => { received += chunk; },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(received, '完整回复');
});

test('surfaces the server error message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: '额度不足' } }), { status: 402 });
  try {
    await assert.rejects(
      streamChat({ settings: { provider: 'openai', baseUrl: 'https://example.com' }, agent: { params: {} }, messages: [], onDelta() {} }),
      /额度不足/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uses the current agent model before the global fallback', async () => {
  const originalAi = host.ai;
  let received;
  host.ai = async (params) => { received = params; };
  try {
    await streamChat({ settings: { provider: 'utools', model: 'global-model' }, agent: { params: { model: 'agent-model' } }, messages: [], onDelta() {} });
    assert.equal(received.model, 'agent-model');
  } finally {
    host.ai = originalAi;
  }
});

test('sends only the fields uTools AI accepts', async () => {
  const originalAi = host.ai;
  let received;
  host.ai = async (params) => { received = params; };
  try {
    await streamChat({
      settings: { provider: 'utools' },
      agent: { params: { model: 'm', temperature: 0.2, top_p: 0.9, max_tokens: 100, presence_penalty: 1 }, un_stream: true },
      messages: [{ role: 'user', content: '你好' }],
      onDelta() {},
    });
    // AiOptions 只有 model / messages / tools。多发的字段不会报错，只会被静默丢掉——
    // 那比发不出去更糟：界面上调好的 temperature 看着生效了，其实一直是模型默认值。
    // 这条线路的参数限制由界面讲清楚，不在这里假装传过去了。
    assert.deepEqual(Object.keys(received).sort(), ['messages', 'model']);
  } finally {
    host.ai = originalAi;
  }
});

test('aborts an in-flight uTools AI request when the signal fires', async () => {
  const originalAi = host.ai;
  let aborted = false;
  host.ai = () => {
    const pending = new Promise((resolve) => { setTimeout(resolve, 50); });
    pending.abort = () => { aborted = true; };
    return pending;
  };
  const controller = new AbortController();
  try {
    const running = streamChat({
      settings: { provider: 'utools' },
      agent: { params: {} },
      messages: [],
      signal: controller.signal,
      onDelta() {},
    });
    controller.abort();
    await running;
  } finally {
    host.ai = originalAi;
  }
  assert.equal(aborted, true);
});
