import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 必须走 fileURLToPath，不能图省事取 .pathname：Windows 上 file:// 的 pathname 是
// `/D:/a/...`，前面那个斜杠让 Node 按「当前盘符下的绝对路径」解析，scandir 拿到的
// 就成了 `D:\D:\a\...`，这条测试在三平台矩阵里只有 windows 作业会红。
const SRC = fileURLToPath(new URL('../src', import.meta.url));

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return vueFiles(path);
    return entry.name.endsWith('.vue') ? [path] : [];
  });
}

// <dialog> 的隐藏完全依赖 UA 样式表里的 dialog:not([open]) { display: none }，
// 而作者样式的层叠来源优先级高于 UA 样式——跟选择器权重无关。所以只要在 dialog 元素
// 自身无条件写了 display，弹窗就会从一开始留在页面流里，且 showModal 之前就可见。
// 这个坑踩过一次（ModelPickerDialog 的 display: flex），用静态检查钉住。
test('no component sets display on a dialog element outside [open]', () => {
  const offenders: string[] = [];

  for (const file of vueFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    // 要求 class 前面是空白，否则 :class="{...}" 里的那个 class 也会被匹配到
    const classes = [...source.matchAll(/<dialog\b[^>]*\sclass="([^"]+)"/gu)]
      .flatMap((match) => match[1].split(/\s+/u))
      .filter((name) => /^[\w-]+$/u.test(name));

    for (const name of new Set(classes)) {
      // 只看「选择器就是这个类本身」的规则；.x[open]、.x .child、.x > y 都是安全的
      const rule = new RegExp(String.raw`^\s*\.${name}\s*\{([^}]*)\}`, 'gmu');
      for (const match of source.matchAll(rule)) {
        if (/(^|[;{\s])display\s*:/u.test(match[1])) offenders.push(`${file} → .${name}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `这些规则会让 <dialog> 未打开就显示，display 请改挂到 [open] 上：\n${offenders.join('\n')}`);
});
