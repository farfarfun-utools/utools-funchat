import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  dataUrlBytes,
  fitSize,
  imagesFromTransfer,
  isImageFile,
  isPdfFile,
  needsReencode,
  supportedFilesFromTransfer,
  transferHasFiles,
} from '../src/features/chat/attachments.ts';

const file = (type, name = 'x') => ({ type, name });
const transfer = ({ items = [], files = [] }) => ({
  items: items.map((entry) => ({ kind: entry.kind, getAsFile: () => entry.file ?? null })),
  files,
});

test('recognises image files by MIME type', () => {
  assert.equal(isImageFile(file('image/png')), true);
  assert.equal(isImageFile(file('text/plain')), false);
  assert.equal(isImageFile(null), false);
  assert.equal(isImageFile(undefined), false);
});

test('recognises PDFs from clipboard MIME or filename', () => {
  assert.equal(isPdfFile(file('application/pdf', 'report')), true);
  assert.equal(isPdfFile(file('', 'report.PDF')), true);
  assert.equal(isPdfFile(file('text/plain', 'notes.txt')), false);
  const pdf = file('application/pdf', 'report.pdf');
  const image = file('image/png', 'screenshot.png');
  assert.deepEqual(supportedFilesFromTransfer(transfer({
    items: [{ kind: 'string' }, { kind: 'file', file: pdf }, { kind: 'file', file: image }],
  })), [pdf, image]);
});

test('picks images out of a paste that also carries text', () => {
  const image = file('image/png', '截图.png');
  const picked = imagesFromTransfer(transfer({
    items: [{ kind: 'string' }, { kind: 'file', file: image }, { kind: 'file', file: file('application/pdf') }],
  }));
  assert.deepEqual(picked, [image]);
});

test('falls back to the files list when items carry nothing usable', () => {
  const image = file('image/jpeg', 'a.jpg');
  assert.deepEqual(imagesFromTransfer(transfer({ items: [{ kind: 'string' }], files: [image, file('text/csv')] })), [image]);
  assert.deepEqual(imagesFromTransfer(transfer({ items: [{ kind: 'file', file: file('application/pdf') }], files: [image] })), [image]);
  assert.deepEqual(imagesFromTransfer(transfer({})), []);
  assert.deepEqual(imagesFromTransfer(null), []);
});

test('only claims a drag that carries files', () => {
  assert.equal(transferHasFiles({ types: ['Files'] }), true);
  assert.equal(transferHasFiles({ types: ['text/plain'] }), false, '拖文字时要让输入框按默认行为处理');
  assert.equal(transferHasFiles({ types: [] }), false);
  assert.equal(transferHasFiles(null), false);
});

test('scales the long edge down without ever enlarging', () => {
  assert.deepEqual(fitSize(2560, 1440, 1280), { width: 1280, height: 720 });
  assert.deepEqual(fitSize(1440, 2560, 1280), { width: 720, height: 1280 });
  assert.deepEqual(fitSize(800, 600, 1280), { width: 800, height: 600 });
  assert.deepEqual(fitSize(2, 10000, 1280), { width: 1, height: 1280 }, '极端比例也不能缩成 0 像素');
});

test('re-encodes oversized, over-dimensioned or unsupported images only', () => {
  const small = { bytes: 1000, width: 800, height: 600, type: 'image/png' };
  assert.equal(needsReencode(small), false);
  assert.equal(needsReencode({ ...small, bytes: MAX_IMAGE_BYTES + 1 }), true);
  // 体积合格但像素过大的图接口会拒，所以不能只看字节数
  assert.equal(needsReencode({ ...small, width: MAX_IMAGE_EDGE + 1 }), true);
  assert.equal(needsReencode({ ...small, height: MAX_IMAGE_EDGE + 1 }), true);
  assert.equal(needsReencode({ ...small, type: 'image/svg+xml' }), true, 'SVG 必须先栅格化');
  assert.equal(needsReencode({ ...small, type: 'image/webp' }), false);
});

test('measures data URL payloads without decoding them', () => {
  assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3);
  assert.equal(dataUrlBytes('data:image/png;base64,AAA='), 2);
  assert.equal(dataUrlBytes('data:image/png;base64,AA=='), 1);
  assert.equal(dataUrlBytes('data:image/png;base64,'), 0);
});
