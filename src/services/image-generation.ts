import { trimEndpoint, withApiVersion } from './api-url.ts';
import type { Settings } from '../types.ts';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = /^image\/(?:png|jpeg|webp|gif)$/iu;
const BASE64_CHUNK_SIZE = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)));
  }
  return btoa(parts.join(''));
}

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
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let message = '';
    try {
      message = JSON.parse(body)?.error?.message || '';
    } catch {
      // 非 JSON 错误体直接退回原文或状态码
    }
    throw new Error(message || body.trim() || `图片生成失败：HTTP ${response.status}`);
  }
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new Error('图片生成接口返回了无效的 JSON 响应');
  }
  const image = payload?.data?.[0];
  if (typeof image?.b64_json === 'string' && image.b64_json) {
    if (image.b64_json.length > MAX_IMAGE_BYTES) throw new Error('生成图片超过 20 MB 上限');
    return `data:image/png;base64,${image.b64_json}`;
  }
  if (typeof image?.url === 'string' && /^https:\/\//u.test(image.url)) {
    const downloaded = await fetch(image.url, { signal });
    if (!downloaded.ok) throw new Error(`下载生成图片失败：HTTP ${downloaded.status}`);
    const contentLength = Number(downloaded.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error('生成图片超过 20 MB 上限');
    }
    const blob = await downloaded.blob();
    const mime = blob.type.split(';')[0]?.trim().toLowerCase() || '';
    if (!ALLOWED_IMAGE_MIME.test(mime)) throw new Error('生成接口没有返回受支持的图片文件');
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('生成图片超过 20 MB 上限');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('生成图片超过 20 MB 上限');
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }
  throw new Error('生成接口没有返回图片数据');
}
