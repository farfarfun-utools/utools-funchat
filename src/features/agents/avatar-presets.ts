import type { AgentAvatar } from '../../types.ts';

export const AVATAR_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['#0ca47f', '#047857'],
  ['#38bdf8', '#2563eb'],
  ['#a855f7', '#6d28d9'],
  ['#f472b6', '#db2777'],
  ['#fb923c', '#ea580c'],
  ['#fbbf24', '#d97706'],
  ['#f87171', '#dc2626'],
  ['#34d399', '#0d9488'],
  ['#60a5fa', '#4f46e5'],
  ['#818cf8', '#7c3aed'],
  ['#22d3ee', '#0284c7'],
  ['#a3e635', '#16a34a'],
  ['#64748b', '#334155'],
  ['#334155', '#0f172a'],
];

export interface EmojiGroup {
  id: string;
  label: string;
  items: readonly string[];
}

export const AVATAR_EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    id: 'tech',
    label: 'AI 科技',
    items: ['🤖', '✨', '🧠', '⚡', '🛸', '💻', '🧪', '🔮', '🛰️', '🎯', '⚙️', '🦾', '🧬'],
  },
  {
    id: 'work',
    label: '办公创作',
    items: ['✍️', '📚', '🎨', '🎬', '🎵', '📊', '📝', '💼', '📐', '🧭', '🗂️', '💡', '🔍'],
  },
  {
    id: 'pet',
    label: '萌宠自然',
    items: ['🐱', '🐶', '🦊', '🐼', '🦉', '🐙', '🦄', '🐸', '🦁', '🐧', '🌸', '🌿', '🌈'],
  },
  {
    id: 'role',
    label: '人物角色',
    items: ['👩‍💻', '👨‍🏫', '👩‍⚕️', '🧑‍🎨', '🕵️', '🧙', '👩‍🍳', '🧑‍🚀', '🥷', '👸', '🦸', '🧑‍⚖️', '🎭'],
  },
  {
    id: 'fun',
    label: '趣味心情',
    items: ['😎', '🥳', '🤔', '🫡', '🔥', '💎', '☕', '🍵', '🎮', '🚀', '🏆', '🌟', '❤️'],
  },
];

export interface BuiltinImageGroup {
  id: string;
  label: string;
  items: readonly string[];
}

export const AVATAR_BUILTIN_IMAGE_GROUPS: readonly BuiltinImageGroup[] = [
  {
    id: 'pro',
    label: '人物职场',
    items: [
      'pro-01', 'pro-02', 'pro-03', 'pro-04',
      'pro-05', 'pro-06', 'pro-07', 'pro-08',
      'pro-09', 'pro-10', 'pro-11', 'pro-12',
      'pro-13', 'pro-14', 'pro-15', 'pro-16',
    ],
  },
  {
    id: 'pet',
    label: '萌宠伙伴',
    items: [
      'pet-01', 'pet-02', 'pet-03', 'pet-04',
      'pet-05', 'pet-06', 'pet-07', 'pet-08',
      'pet-09', 'pet-10', 'pet-11', 'pet-12',
      'pet-13', 'pet-14', 'pet-15', 'pet-16',
    ],
  },
  {
    id: 'sci',
    label: '科幻奇幻',
    items: [
      'sci-01', 'sci-02', 'sci-03', 'sci-04',
      'sci-05', 'sci-06', 'sci-07', 'sci-08',
      'sci-09', 'sci-10', 'sci-11', 'sci-12',
      'sci-13', 'sci-14', 'sci-15', 'sci-16',
    ],
  },
  {
    id: 'classic',
    label: '经典角色',
    items: ['6', '7', '14', '15', '16', '18', '24', '37', '38', '39', '42'],
  },
];

export const AVATAR_BUILTIN_IMAGES: readonly string[] = AVATAR_BUILTIN_IMAGE_GROUPS.flatMap((g) => g.items);

export const AVATAR_ICONS: readonly string[] = [
  'icon-a1', 'icon-a2', 'icon-a3', 'icon-a4', 'icon-a5', 'icon-a6', 'icon-a7', 'icon-a8',
  'icon-a9', 'icon-a10', 'icon-a11', 'icon-a12', 'icon-a13', 'icon-a14', 'icon-a15', 'icon-a16',
  'icon-a17', 'icon-a18', 'icon-a19', 'icon-a20', 'icon-a21', 'icon-a22', 'icon-a23', 'icon-a24',
  'icon-a25', 'icon-a26', 'icon-a27', 'icon-a28', 'icon-a29', 'icon-a30', 'icon-a31', 'icon-a32',
  'icon-a33', 'icon-a34', 'icon-a35', 'icon-a36', 'icon-a37', 'icon-a38', 'icon-a39', 'icon-a40',
  'icon-b1', 'icon-b2', 'icon-b3', 'icon-b4', 'icon-b5', 'icon-b6', 'icon-b7', 'icon-b8',
  'icon-b9', 'icon-b10', 'icon-b11', 'icon-b12', 'icon-b13', 'icon-b14', 'icon-b15', 'icon-b16',
  'icon-b21', 'icon-b22', 'icon-b25', 'icon-b28', 'icon-b30', 'icon-b45', 'icon-b50', 'icon-b60',
];

const SAFE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
const BUILTIN_IMAGE_ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const SAFE_ICON_CLASS_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_STORED_DATA_URL_LEN = 260_000;
const BUILTIN_IMAGE_SET = new Set(AVATAR_BUILTIN_IMAGES);
const iconGlyphCache = new Map<string, string>();
const iconPngCache = new Map<string, string>();

export function isSafeAvatarDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_STORED_DATA_URL_LEN && SAFE_DATA_URL_RE.test(value);
}

export function resolveAvatarImageUrl(image: unknown): string {
  if (typeof image !== 'string' || !image) return '';
  if (isSafeAvatarDataUrl(image)) return image;
  if (BUILTIN_IMAGE_ID_RE.test(image)) return `./avatars/${image}.jpg`;
  return '';
}

function safeColor(color: unknown, fallback = '#0ca47f'): string {
  return typeof color === 'string' && SAFE_COLOR_RE.test(color.trim()) ? color.trim() : fallback;
}

function resolveAvatarColors(avatar: AgentAvatar | undefined): [string, string] {
  if (Array.isArray(avatar?.gradient) && avatar.gradient.length >= 2) {
    return [safeColor(avatar.gradient[0]), safeColor(avatar.gradient[1], '#047857')];
  }
  const single = safeColor(avatar?.color, '');
  if (single) return [single, single];
  return ['#0ca47f', '#047857'];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function utf8ToBase64(input: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(input, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildSvgBadgeIcon(label: string, colors: [string, string], isEmoji: boolean): string {
  const clean = label.trim() || 'AI';
  const charCount = Array.from(clean).length;
  const fontSize = isEmoji ? 66 : charCount > 1 ? 44 : 60;
  const y = isEmoji ? 68 : 66;
  const fontWeight = isEmoji ? '400' : '600';
  const fontFamily = isEmoji
    ? 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif'
    : 'PingFang SC, Microsoft YaHei, Helvetica Neue, Arial, sans-serif';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="${colors[0]}"/>` +
    `<stop offset="100%" stop-color="${colors[1]}"/>` +
    `</linearGradient></defs>` +
    `<circle cx="64" cy="64" r="62" fill="url(#g)"/>` +
    `<text x="64" y="${y}" text-anchor="middle" dominant-baseline="central" fill="#ffffff" ` +
    `font-size="${fontSize}" font-weight="${fontWeight}" font-family="${fontFamily}">${escapeXml(clean)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}

export function isIconFontReady(): boolean {
  try {
    return typeof document !== 'undefined' && Boolean(document.fonts?.check('64px "icon"'));
  } catch {
    return false;
  }
}

function resolveIconfontGlyph(iconClass: string): string {
  if (!SAFE_ICON_CLASS_RE.test(iconClass) || typeof document === 'undefined' || !document.body) return '';
  const cached = iconGlyphCache.get(iconClass);
  if (cached !== undefined) return cached;
  const probe = document.createElement('span');
  probe.className = `icon ${iconClass}`;
  probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  let glyph = '';
  try {
    const raw = window.getComputedStyle(probe, '::before').content;
    if (raw && raw !== 'none' && raw !== 'normal') {
      const stripped = raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
        ? raw.slice(1, -1)
        : raw;
      if (stripped && stripped !== 'none') glyph = stripped;
    }
  } catch {
    glyph = '';
  } finally {
    probe.remove();
  }
  iconGlyphCache.set(iconClass, glyph);
  return glyph;
}

function renderIconfontPng(iconClass: string, colors: [string, string]): string {
  if (!isIconFontReady()) return '';
  const key = `${iconClass}|${colors[0]}|${colors[1]}`;
  const cached = iconPngCache.get(key);
  if (cached) return cached;
  const glyph = resolveIconfontGlyph(iconClass);
  if (!glyph) return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const grad = ctx.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '500 66px "icon"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 64, 65);
    const png = canvas.toDataURL('image/png');
    if (isSafeAvatarDataUrl(png)) {
      iconPngCache.set(key, png);
      return png;
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * 为 uTools 动态功能（超级面板）生成对应角色自己的图标：
 * - 上传的图片头像：直接使用安全的 Base64 DataURL
 * - 内置头像图片：指向插件目录相对路径 `dist/avatars/<id>.jpg`
 * - 矢量图标：字体就绪时用 Canvas 栅格化为 128×128 PNG，否则平滑退回同色渐变徽章 SVG
 * - Emoji / 文字头像 / 无头像：生成 128×128 矢量 SVG DataURL
 */
export function buildAgentFeatureIcon(agent: { nickname?: string; avatar?: AgentAvatar }): string {
  const avatar = agent.avatar;
  const colors = resolveAvatarColors(avatar);

  if (avatar?.type === 'image' && typeof avatar.image === 'string') {
    if (isSafeAvatarDataUrl(avatar.image)) return avatar.image;
    if (BUILTIN_IMAGE_SET.has(avatar.image)) return `dist/avatars/${avatar.image}.jpg`;
  }

  if (avatar?.type === 'emoji' && typeof avatar.emoji === 'string' && avatar.emoji.trim()) {
    return buildSvgBadgeIcon(avatar.emoji.trim(), colors, true);
  }

  if (avatar?.type === 'text') {
    const label = String(avatar.text || agent.nickname || 'AI').trim();
    const short = Array.from(label).slice(0, 2).join('') || 'AI';
    return buildSvgBadgeIcon(short, colors, false);
  }

  if (avatar?.type === 'icon' || (!avatar?.type && avatar?.icon)) {
    const iconClass = avatar?.icon || 'icon-a1';
    const png = renderIconfontPng(iconClass, colors);
    if (png) return png;
  }

  const fallbackText = Array.from((agent.nickname || avatar?.text || 'AI').trim()).slice(0, 2).join('') || 'AI';
  return buildSvgBadgeIcon(fallbackText, colors, false);
}

export function randomPresetAvatar(): AgentAvatar {
  const allEmojis = AVATAR_EMOJI_GROUPS.flatMap((g) => g.items);
  const emoji = allEmojis[Math.floor(Math.random() * allEmojis.length)] || '🤖';
  const grad = AVATAR_GRADIENTS[Math.floor(Math.random() * AVATAR_GRADIENTS.length)] || AVATAR_GRADIENTS[0];
  return {
    type: 'emoji',
    emoji,
    gradient: [grad[0], grad[1]],
    color: grad[0],
  };
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('读取图片失败'));
    };
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片格式无法解析，请更换 PNG / JPG / WebP'));
    img.src = src;
  });
}

/**
 * 校验并将上传图片居中裁切、压缩为正方形头像 DataURL（默认 160×160），
 * 控制体积在 ~10–35 KB，避免撑大 uTools dbStorage 与云同步文档。
 */
export async function compressAvatarFile(file: File, targetSize = 160): Promise<string> {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('仅支持上传图片文件（PNG / JPG / WebP / GIF）');
  }
  if (file.type === 'image/svg+xml') {
    throw new Error('暂不支持 SVG 图片，请上传 PNG / JPG / WebP');
  }
  if (file.size === 0) {
    throw new Error('图片文件为空');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('图片超过 10 MB，请选择更小的图片');
  }

  const rawUrl = await readFileAsDataUrl(file);
  if (typeof document === 'undefined') {
    if (isSafeAvatarDataUrl(rawUrl)) return rawUrl;
    throw new Error('图片体积过大');
  }

  const img = await loadImage(rawUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) {
    throw new Error('图片尺寸无效');
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (isSafeAvatarDataUrl(rawUrl)) return rawUrl;
    throw new Error('浏览器画布初始化失败');
  }

  const side = Math.min(w, h);
  const sx = Math.floor((w - side) / 2);
  const sy = Math.floor((h - side) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);

  const candidates = [
    canvas.toDataURL('image/webp', 0.86),
    canvas.toDataURL('image/jpeg', 0.86),
    canvas.toDataURL('image/jpeg', 0.72),
    canvas.toDataURL('image/png'),
  ];
  for (const dataUrl of candidates) {
    if (isSafeAvatarDataUrl(dataUrl)) return dataUrl;
  }
  throw new Error('压缩后的头像仍然过大，请换一张更简单的图片');
}
