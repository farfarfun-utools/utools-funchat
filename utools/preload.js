const fs = require('fs');

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

// 不再自己 createBrowserWindow 开独立窗口：插件就在 uTools 主面板里跑，
// 需要独立窗口时用 uTools 自带的「分离」按钮，窗口尺寸也交给 uTools 记忆。
// 面板内的高度由应用侧调 utools.setExpendHeight 控制（对应设置里的「插件高度」）。
