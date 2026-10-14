import { nextTick, ref } from 'vue';
import { host } from '../../services/utools.ts';

export const COLLAPSE_THRESHOLD = 900;

// 折叠状态分散在每个 MessageItem 自己身上，整段对话出图时得有个总开关统一压制，
// 否则图里是被 max-height 截断、还烤进了渐变遮罩的半截气泡。
export const expandAllForExport = ref(false);

/**
 * 在「所有长消息都展开」的状态下执行出图动作，结束后恢复折叠。
 * @param action 真正的出图动作。
 * @returns action 的返回值；无论成败都会恢复折叠状态。
 */
export async function withAllExpanded<T>(action: () => Promise<T>): Promise<T> {
  expandAllForExport.value = true;
  await nextTick();
  try {
    return await action();
  } finally {
    expandAllForExport.value = false;
  }
}

/**
 * 判断消息文本是否超过折叠阈值。
 * @param value 待判断的消息内容。
 * @returns 内容是否需要折叠显示。
 */
export function isLongMessage(value: unknown): boolean {
  return String(value || '').length > COLLAPSE_THRESHOLD;
}

/**
 * 将时间格式化为用于导出文件名的本地时间戳。
 * @param date 要格式化的本地时间。
 * @returns 格式为 YYYYMMDD-HHmmss 的时间戳。
 */
export function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * 调用宿主文件保存接口。
 * @param dialogOptions 保存对话框配置。
 * @param data 要写入的内容。
 * @param encoding 内容编码，默认 utf-8。
 * @returns 是否已由宿主保存文件。
 */
export async function saveToDisk(dialogOptions: unknown, data: unknown, encoding = 'utf-8'): Promise<boolean> {
  if (typeof window.saveFile !== 'function') return false;
  await window.saveFile(dialogOptions, data, encoding);
  return true;
}

/**
 * 触发浏览器下载指定链接。
 * @param filename 建议的下载文件名。
 * @param href 要下载的资源地址。
 * @returns 无返回值。
 */
export function downloadInBrowser(filename: string, href: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = href;
  link.click();
}

// 视口外的消息靠 content-visibility 跳过布局，而 html2canvas 量的就是布局：
// 出图期间得把那层优化关掉，否则图里是一串按占位高度排开的空白。
// 单条消息出图也走这里，所以开关放在这个唯一的入口上。
export const capturing = ref(false);

// 存文件与复制到剪贴板共用同一份渲染，保证两种导出的成像完全一致
/**
 * 将页面元素渲染为 PNG Data URL。
 * @param element 要导出的页面元素。
 * @returns PNG 图片的 Data URL。
 */
export async function renderElementImage(element: HTMLElement): Promise<string> {
  const { default: html2canvas } = await import('html2canvas');
  capturing.value = true;
  await nextTick();
  try {
    const canvas = await html2canvas(element, {
      backgroundColor: getComputedStyle(document.body).getPropertyValue('--color-bg-2').trim() || '#fff',
      scale: Math.min(devicePixelRatio || 1, 2),
      useCORS: true,
      ignoreElements: (node) => node.classList?.contains('message-actions'),
    });
    return canvas.toDataURL('image/png');
  } finally {
    capturing.value = false;
  }
}

/**
 * 将页面元素导出为 PNG 文件。
 * @param element 要导出的页面元素。
 * @param filenamePrefix 导出文件名的前缀。
 * @returns 无返回值。
 */
export async function saveElementImage(element: HTMLElement, filenamePrefix = 'chat-message'): Promise<void> {
  const dataUrl = await renderElementImage(element);
  const filename = `${filenamePrefix}-${formatTimestamp(new Date())}.png`;
  const saved = await saveToDisk({
    title: '保存消息图片',
    defaultPath: filename,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  }, dataUrl.split(',')[1], 'base64');
  if (!saved) downloadInBrowser(filename, dataUrl);
}

/**
 * 将页面元素复制为 PNG 图片。
 * @param element 要复制的页面元素。
 * @returns 图片是否已复制到宿主剪贴板。
 */
export async function copyElementImage(element: HTMLElement): Promise<boolean> {
  const dataUrl = await renderElementImage(element);
  await host.copyImage(dataUrl);
  return true;
}
