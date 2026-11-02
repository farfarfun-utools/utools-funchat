import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const preload = readFileSync(new URL('../utools/preload.js', import.meta.url), 'utf8');

function readClipboardPdf(formats: Record<string, Buffer>, text = '', size = 12) {
  let readPath = '';
  const window = {} as { readClipboardPdf: () => { name?: string; bytes?: Buffer; error?: string } | null };
  const fileBytes = Buffer.from('%PDF-1.4\nbody');
  runInNewContext(preload, {
    window,
    require: (name: string) => {
      if (name === 'fs') return {
        statSync: (filePath: string) => { readPath = filePath; return { isFile: () => true, size }; },
        readFileSync: () => fileBytes,
      };
      if (name === 'path') return path;
      if (name === 'url') return { fileURLToPath };
      if (name === 'electron') return { clipboard: {
        availableFormats: () => Object.keys(formats),
        readBuffer: (format: string) => formats[format],
        readText: () => text,
      } };
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  return { result: window.readClipboardPdf(), readPath };
}

test('reads a copied PDF from a Linux file manager URI', () => {
  const { result, readPath } = readClipboardPdf({
    'x-special/gnome-copied-files': Buffer.from('copy\nfile:///home/me/report%20draft.pdf\n'),
  });
  assert.equal(readPath, '/home/me/report draft.pdf');
  assert.equal(result?.name, 'report draft.pdf');
  assert.equal(result?.bytes?.toString(), '%PDF-1.4\nbody');
});

test('reads a Windows copied-file path and ignores a bare filename', () => {
  const copied = readClipboardPdf({ FileNameW: Buffer.from('C:\\Docs\\report.pdf\0', 'utf16le') });
  assert.equal(copied.readPath, 'C:\\Docs\\report.pdf');
  assert.equal(copied.result?.name, 'report.pdf');
  assert.equal(readClipboardPdf({}, 'report.pdf').result, null);
  assert.equal(readClipboardPdf({}, '/home/me/private.pdf').result, null, 'plain text must not trigger local file reads');
});

test('uses clipboard.has when Windows does not list FileNameW', () => {
  const window = {} as { readClipboardPdf: () => { name?: string } | null };
  runInNewContext(preload, {
    window,
    require: (name: string) => {
      if (name === 'fs') return {
        statSync: () => ({ isFile: () => true, size: 12 }),
        readFileSync: () => Buffer.from('%PDF-1.4\nbody'),
      };
      if (name === 'path') return path;
      if (name === 'url') return { fileURLToPath };
      if (name === 'electron') return { clipboard: {
        availableFormats: () => [],
        has: (format: string) => format === 'FileNameW',
        readBuffer: () => Buffer.from('C:\\Docs\\report.pdf\0', 'utf16le'),
      } };
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  assert.equal(window.readClipboardPdf()?.name, 'report.pdf');
});

test('reads a copied PDF from Windows CF_HDROP', () => {
  const names = Buffer.from('C:\\Docs\\report.pdf\0\0', 'utf16le');
  const drop = Buffer.alloc(20 + names.length);
  drop.writeUInt32LE(20, 0);
  drop.writeUInt32LE(1, 16);
  names.copy(drop, 20);
  const { result, readPath } = readClipboardPdf({ CF_HDROP: drop });
  assert.equal(readPath, 'C:\\Docs\\report.pdf');
  assert.equal(result?.name, 'report.pdf');
});

test('rejects an oversized clipboard PDF before reading its bytes', () => {
  const { result } = readClipboardPdf({ 'text/uri-list': Buffer.from('file:///home/me/report.pdf') }, '', 21 * 1024 * 1024);
  assert.match(result?.error || '', /20 MB/);
});

test('does not attach a non-PDF file renamed with a PDF extension', () => {
  const window = {} as { readClipboardPdf: () => { error?: string } | null };
  runInNewContext(preload, {
    window,
    require: (name: string) => {
      if (name === 'fs') return {
        statSync: () => ({ isFile: () => true, size: 12 }),
        readFileSync: () => Buffer.from('not a PDF'),
      };
      if (name === 'path') return path;
      if (name === 'url') return { fileURLToPath };
      if (name === 'electron') return { clipboard: {
        availableFormats: () => ['text/uri-list'],
        readBuffer: () => Buffer.from('file:///home/me/renamed.pdf'),
      } };
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  assert.match(window.readClipboardPdf()?.error || '', /不是有效 PDF/);
});

test('reads a macOS file URL when Electron exposes it as text', () => {
  const window = {} as { readClipboardPdf: () => { name?: string } | null };
  runInNewContext(preload, {
    window,
    Buffer,
    require: (name: string) => {
      if (name === 'fs') return {
        statSync: () => ({ isFile: () => true, size: 12 }),
        readFileSync: () => Buffer.from('%PDF-1.4\nbody'),
      };
      if (name === 'path') return path;
      if (name === 'url') return { fileURLToPath };
      if (name === 'electron') return { clipboard: {
        availableFormats: () => ['public.file-url'],
        readBuffer: () => Buffer.alloc(0),
        read: () => 'file:///Users/me/report.pdf',
      } };
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  assert.equal(window.readClipboardPdf()?.name, 'report.pdf');
});
