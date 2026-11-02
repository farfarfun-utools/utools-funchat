import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { generateImage, normalizeImageUrl } from '../src/services/image-generation.ts';

test('uses the image endpoint and retains returned image bytes', async () => {
  const original = globalThis.fetch;
  let requested: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (url, init) => {
    requested = { url: String(url), init: init! };
    return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const image = await generateImage('一只杯子', { provider: 'openai', baseUrl: 'https://api.example.com/v1/chat/completions', apiKey: 'secret' });
    assert.equal(image, 'data:image/png;base64,AAAA');
    assert.equal(requested?.url, 'https://api.example.com/v1/images/generations');
    assert.equal(requested?.init.headers.Authorization, 'Bearer secret');
    assert.deepEqual(JSON.parse(requested?.init.body), { model: 'gpt-image-1.5', prompt: '一只杯子', n: 1 });
  } finally {
    globalThis.fetch = original;
  }
});

test('rejects missing image support and missing image data', async () => {
  await assert.rejects(generateImage('图', { provider: 'utools' }), /uTools AI/u);
  assert.equal(normalizeImageUrl('https://api.example.com/v1'), 'https://api.example.com/v1/images/generations');
  assert.equal(normalizeImageUrl('https://api.example.com/v1/chat/completions#'), 'https://api.example.com/v1/images/generations');
  assert.equal(normalizeImageUrl('https://api.example.com/custom#'), '');
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } });
  try {
    await assert.rejects(generateImage('图', { provider: 'openai', baseUrl: 'https://api.example.com' }), /没有返回图片数据/u);
  } finally {
    globalThis.fetch = original;
  }
});

test('an official API key without an address uses the official image endpoint', async () => {
  const original = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async (url) => {
    requested = String(url);
    return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await generateImage('图', { provider: 'openai', apiKey: 'secret' });
    assert.equal(requested, 'https://api.openai.com/v1/images/generations');
  } finally {
    globalThis.fetch = original;
  }
});

test('downloads URL responses before keeping them in a conversation', async () => {
  const original = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return requested.length === 1
      ? new Response(JSON.stringify({ data: [{ url: 'https://images.example.com/result.png' }] }), { headers: { 'Content-Type': 'application/json' } })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
  };
  try {
    assert.equal(await generateImage('图', { provider: 'openai', baseUrl: 'https://api.example.com' }), 'data:image/png;base64,AQID');
    assert.deepEqual(requested, ['https://api.example.com/v1/images/generations', 'https://images.example.com/result.png']);
  } finally {
    globalThis.fetch = original;
  }
});
