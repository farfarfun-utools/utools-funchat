import { trimEndpoint, withApiVersion } from './api-url.ts';
import type { Settings } from '../types.ts';

export function normalizeImageUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (raw.endsWith('#') && !/\/(?:chat\/completions|images\/generations)#$/u.test(raw)) return '';
  const base = trimEndpoint(raw).replace(/\/(?:chat\/completions|images\/generations)$/u, '');
  return base ? withApiVersion(base, 'images/generations') : '';
}

export async function generateImage(prompt: string, settings: Settings, signal?: AbortSignal): Promise<string> {
  if (settings.provider === 'utools') throw new Error('uTools AI 线路暂不提供图片生成接口，请切换到支持图片生成的 API 线路');
  const url = normalizeImageUrl(settings.baseUrl || (settings.apiKey ? 'https://api.openai.com' : ''));
  if (!url) throw new Error('请先配置支持图片生成的 API 线路');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: settings.imageModel || 'gpt-image-1.5', prompt, n: 1 }),
    signal,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `图片生成失败：HTTP ${response.status}`);
  const image = payload?.data?.[0];
  if (typeof image?.b64_json === 'string' && image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  if (typeof image?.url === 'string' && /^https:\/\//u.test(image.url)) {
    const downloaded = await fetch(image.url, { signal });
    if (!downloaded.ok) throw new Error(`下载生成图片失败：HTTP ${downloaded.status}`);
    const blob = await downloaded.blob();
    if (!blob.type.startsWith('image/')) throw new Error('生成接口没有返回图片文件');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${blob.type};base64,${btoa(binary)}`;
  }
  throw new Error('生成接口没有返回图片数据');
}
