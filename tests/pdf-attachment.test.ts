import { test, vi } from 'vitest';
import { strict as assert } from 'node:assert';
import { extractPdfText, MAX_PDF_BYTES } from '../src/features/chat/pdf-attachment.ts';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href,
}));

function pdfFile(content: string, pageCount = 1): File {
  const runs = content.match(/.{1,1000}/g)?.map((part) => `(${part}) Tj`).join(' ') || '';
  const stream = `BT /F1 12 Tf 20 100 Td ${runs} ET`;
  const contentId = pageCount + 3;
  const fontId = pageCount + 4;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 30000 200] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`),
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([body], 'example.pdf', { type: 'application/pdf' });
}

test('extracts PDF text locally and labels the source', async () => {
  const result = await extractPdfText(pdfFile('Hello PDF'));
  assert.equal(result.truncated, false);
  assert.match(result.content, /PDF：example\.pdf（共 1 页）/);
  assert.match(result.content, /第 1 页\nHello PDF/);
});

test('rejects a PDF that exceeds the size limit before parsing', async () => {
  await assert.rejects(extractPdfText({ size: MAX_PDF_BYTES + 1 } as File), /最大支持 20 MB/);
});

test('a PDF without selectable text asks for page-image mode', async () => {
  await assert.rejects(extractPdfText(pdfFile('')), /没有可提取的文字/);
});

test('long PDF text is explicitly marked as truncated', async () => {
  const result = await extractPdfText(pdfFile('x'.repeat(5_000), 8));
  assert.equal(result.truncated, true);
  assert.match(result.content, /仅含前 30000 字/);
  assert.equal(result.content.endsWith('x'), true);
});
