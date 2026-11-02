// 一条消息最多带几张图。不只是界面好看：图片会连同会话一起落进 uTools 文档库，
// 数量不设上限的话单条会话很快就会大到写不进去。
export const MAX_ATTACHMENTS = 4;
// 单张图压缩后的目标体积。截图随手就是 2~5MB，原图既顶爆文档库也让请求体大得发不出去。
export const MAX_IMAGE_BYTES = 360 * 1024;
// 逐级降档重编码，直到落进 MAX_IMAGE_BYTES；最长边同时受限于主流视觉模型的取块尺寸。
const ENCODE_STEPS = [
  { edge: 1280, quality: 0.82 },
  { edge: 1024, quality: 0.72 },
  { edge: 768, quality: 0.62 },
];
export const MAX_IMAGE_EDGE = ENCODE_STEPS[0].edge;
// 视觉接口普遍只认这几种格式，SVG、BMP 之类必须先栅格化再发
const SENDABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export type ImageAttachment = { id: string; url: string; name: string; bytes: number };

/**
 * 判断一个文件是否是可以作为图片附件的文件。
 * @param file 待判断的文件。
 * @returns MIME 类型属于 `image/*` 时返回 `true`。
 */
export function isImageFile(file: File | null | undefined): file is File {
  return Boolean(file && typeof file.type === 'string' && file.type.startsWith('image/'));
}

export function isPdfFile(file: File | null | undefined): file is File {
  return Boolean(file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')));
}

function filesFromTransfer(data: DataTransfer | null | undefined, accept: (file: File) => boolean): File[] {
  if (!data) return [];
  const fromItems = Array.from(data.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file && accept(file)));
  return fromItems.length ? fromItems : Array.from(data.files || []).filter(accept);
}

export function supportedFilesFromTransfer(data: DataTransfer | null | undefined): File[] {
  return filesFromTransfer(data, (file) => isImageFile(file) || isPdfFile(file));
}

/**
 * 从剪贴板或拖放数据里挑出图片文件。
 * @param data 粘贴事件的 `clipboardData` 或拖放事件的 `dataTransfer`。
 * @returns 图片文件列表；没有图片时返回空数组。
 */
export function imagesFromTransfer(data: DataTransfer | null | undefined): File[] {
  return filesFromTransfer(data, isImageFile);
}

/**
 * 判断一次拖拽是否带着文件。
 * dragover 阶段出于安全限制取不到文件内容，只能看 `types`，所以不能复用 imagesFromTransfer。
 * @param data 拖放事件的 `dataTransfer`。
 * @returns 拖的是文件时返回 `true`；拖的是文字等内容返回 `false`。
 */
export function transferHasFiles(data: DataTransfer | null | undefined): boolean {
  return Array.from(data?.types || []).includes('Files');
}

/**
 * 按最长边等比缩放尺寸，且不放大。
 * @param width 原始宽度。
 * @param height 原始高度。
 * @param maxEdge 最长边上限。
 * @returns 缩放后的整数宽高，最小为 1。
 */
export function fitSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  // 比上限小的图保持原样，放大只会既变模糊又变大
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 估算 data URL 里实际的字节数，不用解码出整个 Blob。
 * @param url data URL 或裸 base64 字符串。
 * @returns 解码后的字节数。
 */
export function dataUrlBytes(url: string): number {
  const base64 = url.slice(url.indexOf(',') + 1);
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * 判断一张图是否必须重新编码。
 * 体积合格也可能需要重编码：尺寸过大的图接口会拒，格式不受支持的图模型读不了。
 * @param image 图片的体积、像素尺寸和 MIME 类型。
 * @returns 需要重新编码时返回 `true`。
 */
export function needsReencode({ bytes, width, height, type }: { bytes: number; width: number; height: number; type: string }): boolean {
  if (!SENDABLE_TYPES.has(type)) return true;
  if (bytes > MAX_IMAGE_BYTES) return true;
  return Math.max(width, height) > MAX_IMAGE_EDGE;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片格式无法解析'));
    image.src = url;
  });
}

// JPEG 没有透明通道，把真的用到透明的图转过去会把透明区域填成黑块。
// 按 MIME 猜不准（截图几乎都是 PNG 但其实不透明），直接看像素。
function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const { data } = context.getImageData(0, 0, width, height);
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] < 255) return true;
    }
    return false;
  } catch {
    // 画布被跨域图污染时读不了像素，保守起见当作有透明
    return true;
  }
}

// fallback 是「实在编不出来时可以直接发的原图」：格式本身不被支持时传空串，
// 这样画布不可用就会得到空结果，由调用方报错，而不是把一张模型读不了的图发出去。
function encode(image: HTMLImageElement, width: number, height: number, fallback: string): string {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return fallback;

  let best = fallback;
  // 缩放既变不出透明通道也抹不掉透明通道，所以三档编码的答案必然相同，只用判一次。
  // getImageData 加逐像素扫描在 1280px 的图上就是几百万次循环，每档各跑一遍纯属白费。
  let transparent: boolean | null = null;
  for (const step of ENCODE_STEPS) {
    const size = fitSize(width, height, step.edge);
    canvas.width = size.width;
    canvas.height = size.height;
    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    transparent ??= hasTransparency(context, size.width, size.height);
    const type = transparent ? 'image/png' : 'image/jpeg';
    const encoded = canvas.toDataURL(type, step.quality);
    if (!best || dataUrlBytes(encoded) < dataUrlBytes(best)) best = encoded;
    if (best && dataUrlBytes(best) <= MAX_IMAGE_BYTES) break;
  }
  return best;
}

async function shrink(dataUrl: string, type: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  // 没有固有尺寸的图（典型是不带 width/height 的 SVG）画到画布上只会得到 1×1，
  // 宁可直接报错，也不要悄悄发出去一张空白图
  if (!width || !height) throw new Error('这种图片格式无法转换，换成 PNG 或 JPG 吧');
  if (!needsReencode({ bytes: dataUrlBytes(dataUrl), width, height, type })) return dataUrl;
  const encoded = encode(image, width, height, SENDABLE_TYPES.has(type) ? dataUrl : '');
  if (!encoded) throw new Error('这种图片格式无法转换，换成 PNG 或 JPG 吧');
  return encoded;
}

let attachmentSeed = 0;

/**
 * 把一个图片文件读成可以直接发给模型的附件。
 * @param file 剪贴板、拖放或文件选择得到的图片文件。
 * @returns 压缩后的附件；文件不是图片或无法解析时抛出错误。
 */
export async function readImageAttachment(file: File): Promise<ImageAttachment> {
  if (!isImageFile(file)) throw new Error('只支持图片文件');
  const url = await shrink(await readAsDataUrl(file), file.type);
  attachmentSeed += 1;
  return {
    id: `image-${Date.now().toString(36)}-${attachmentSeed}`,
    url,
    name: file.name || '剪贴板图片',
    bytes: dataUrlBytes(url),
  };
}
