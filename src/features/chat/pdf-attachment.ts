import { MAX_ATTACHMENTS, MAX_IMAGE_EDGE, readImageAttachment } from './attachments.ts';
import type { ImageAttachment } from './attachments.ts';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_TEXT = 30_000;

async function openPdf(file: File) {
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF 最大支持 20 MB');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
  try {
    return { pdf: await task.promise, task };
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

export async function extractPdfText(file: File): Promise<{ content: string; truncated: boolean }> {
  const { pdf, task } = await openPdf(file);
  try {
    let body = '';
    let truncated = false;
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const { items } = await page.getTextContent();
      const pageText = items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join('').trim();
      if (!pageText) continue;
      const next = `\n\n第 ${index} 页\n${pageText}`;
      const room = MAX_PDF_TEXT - body.length;
      if (next.length > room) {
        body += next.slice(0, Math.max(room, 0));
        truncated = true;
        break;
      }
      body += next;
    }
    if (!body.trim()) throw new Error('PDF 中没有可提取的文字，请选择按页面图片识别');
    const heading = `PDF：${file.name}（共 ${pdf.numPages} 页${truncated ? '，仅含前 30000 字' : ''}）`;
    return { content: `${heading}${body}`, truncated };
  } finally {
    await task.destroy();
  }
}

export async function renderPdfPages(file: File, room: number): Promise<ImageAttachment[]> {
  const { pdf, task } = await openPdf(file);
  try {
    if (pdf.numPages > MAX_ATTACHMENTS) throw new Error(`按页面图片识别最多支持 ${MAX_ATTACHMENTS} 页，请改用提取文字`);
    if (pdf.numPages > room) throw new Error(`当前最多还能添加 ${room} 张图片；这份 PDF 有 ${pdf.numPages} 页，请选较短的 PDF 或提取文字`);
    const images: ImageAttachment[] = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1, MAX_IMAGE_EDGE / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法绘制 PDF 页面');
      await page.render({ canvasContext: context, viewport, background: '#fff' }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PDF 页面无法转成图片')), 'image/jpeg', 0.7));
      images.push(await readImageAttachment(new File([blob], `${file.name} 第${index}页.jpg`, { type: 'image/jpeg' })));
      canvas.width = canvas.height = 0;
    }
    return images;
  } finally {
    await task.destroy();
  }
}
