const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
let clipboard;
try { ({ clipboard } = require('electron')); } catch { /* 浏览器预览没有 Electron */ }

window.saveFile = async (options, data, encoding = 'utf-8') => {
  const filePath = utools.showSaveDialog(options);
  if (!filePath) return false;
  await fs.promises.writeFile(filePath, data, encoding);
  return true;
};

// 恢复备份要读用户选的文件。渲染层也有一个 <input type="file"> 兜底（浏览器里调试时走它），
// 但在 uTools 里走原生对话框：能记住上次的目录，也能按扩展名过滤。
// 返回 null 表示用户取消了 —— 和 saveFile 返回 false 一样，调用方据此保持安静。
window.openTextFile = async (options) => {
  const [filePath] = utools.showOpenDialog({ properties: ['openFile'], ...options }) || [];
  if (!filePath) return null;
  return fs.promises.readFile(filePath, 'utf-8');
};

// 文件管理器复制文件时，Electron 的 paste 事件有时只给文本文件名；原始文件路径仍在系统剪贴板的文件格式里。
window.readClipboardPdf = () => {
  if (!clipboard?.availableFormats) return null;
  let formats;
  try { formats = clipboard.availableFormats(); } catch { return null; }
  const candidates = [];
  for (const format of ['x-special/gnome-copied-files', 'text/uri-list', 'public.file-url', 'FileNameW', 'FileName', 'CF_HDROP', 'FileDrop']) {
    let present = formats.includes(format);
    if (!present) {
      try { present = Boolean(clipboard.has?.(format)); } catch { /* 旧版 Electron 不认识此格式 */ }
    }
    if (!present) continue;
    let data;
    try { data = clipboard.readBuffer?.(format); } catch { /* 某些系统格式不能按 Buffer 读取 */ }
    if (!data?.length && (format.includes('/') || format === 'public.file-url')) {
      try { data = Buffer.from(clipboard.read?.(format) || '', 'utf8'); } catch { continue; }
    }
    if (!data?.length) continue;
    if (format === 'CF_HDROP' || format === 'FileDrop') {
      if (data.length < 20) continue;
      const offset = data.readUInt32LE(0);
      if (offset < 20 || offset >= data.length) continue;
      candidates.push(...data.subarray(offset).toString(data.readUInt32LE(16) ? 'utf16le' : 'utf8').split('\0'));
    } else {
      candidates.push(...data.toString(format === 'FileNameW' ? 'utf16le' : 'utf8').split(/[\r\n\0]+/));
    }
  }
  for (const candidate of candidates) {
    let filePath = candidate.trim();
    if (filePath.startsWith('file://')) {
      try { filePath = fileURLToPath(filePath); } catch { continue; }
    }
    if (!/\.pdf$/i.test(filePath) || !(path.isAbsolute(filePath) || path.win32.isAbsolute(filePath))) continue;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      if (stat.size > 20 * 1024 * 1024) return { error: 'PDF 最大支持 20 MB' };
      const bytes = fs.readFileSync(filePath);
      if (!bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) return { error: '剪贴板里的文件不是有效 PDF' };
      return { name: path.win32.isAbsolute(filePath) ? path.win32.basename(filePath) : path.basename(filePath), bytes };
    } catch { return { error: '无法读取剪贴板中的 PDF 文件' }; }
  }
  return null;
};

// 不再自己 createBrowserWindow 开独立窗口：插件就在 uTools 主面板里跑，
// 需要独立窗口时用 uTools 自带的「分离」按钮，窗口尺寸也交给 uTools 记忆。
// 面板内的高度由应用侧调 utools.setExpendHeight 控制（对应设置里的「插件高度」）。
