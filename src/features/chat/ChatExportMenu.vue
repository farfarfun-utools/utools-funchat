<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useDismissable } from '../../composables/use-dismissable.js';
import { host } from '../../services/utools.js';
import { useChatStore } from '../../stores/chat.js';
import { renderMarkdown } from './markdown.js';
import { downloadInBrowser, saveElementImage, saveToDisk, withAllExpanded } from './message-tools.js';
import { messageText } from './token-count.js';

const store = useChatStore();
const root = ref<HTMLElement>();
const open = ref(false);
const closing = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

const items = [
  { label: '一键复制', value: 'copy', icon: 'copy' },
  { label: '导出图片', value: 'image', icon: 'image' },
  { label: '导出Markdown', value: 'markdown', icon: 'markdown' },
  { label: '导出HTML', value: 'html', icon: 'html' },
  { label: '导出Word', value: 'word', icon: 'docx' },
  { label: '导出PDF', value: 'pdf', icon: 'pdf' },
];

const markdown = computed(() => store.state.messages.map((message) => {
  const speaker = message.role === 'assistant' ? store.state.currentAgent?.nickname : host.getUser()?.nickname || '我';
  const content = messageText(message);
  return content.startsWith('|') ? `**${speaker}：**\n${content}` : `**${speaker}：** ${content}`;
}).join('\n\n'));

function filename(extension: string): string {
  const now = new Date();
  return `${store.state.currentAgent?.nickname || 'AI'}_${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}.${extension}`;
}

function openMenu() {
  clearTimeout(hoverTimer);
  clearTimeout(closeTimer);
  closing.value = false;
  open.value = true;
}

function scheduleClose() {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(closeMenu, 120);
}

function closeMenu() {
  if (!open.value) return;
  open.value = false;
  closing.value = true;
  closeTimer = setTimeout(() => { closing.value = false; }, 150);
}

function toggleMenu() {
  if (open.value) closeMenu();
  else openMenu();
}

function htmlDocument() {
  const body = renderMarkdown(markdown.value);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${store.state.currentAgent?.nickname || 'AI'} 对话</title><style>body{max-width:860px;margin:40px auto;padding:0 24px;color:#374151;font:14px/1.8 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}pre{padding:14px;overflow:auto;color:#e8eaed;background:#282c34;border-radius:5px}img{max-width:100%}table{border-collapse:collapse}th,td{padding:6px 10px;border:1px solid #e5e6eb}</style></head><body>${body}</body></html>`;
}

// Word 认这组 office 命名空间：带上它，打开的是一份排好版的 Word 文档而不是一张网页
function wordDocument() {
  return htmlDocument().replace(
    '<html lang="zh-CN">',
    '<html lang="zh-CN" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">',
  );
}

async function save(content: string, extension: string, type: string) {
  const name = filename(extension);
  const saved = await saveToDisk({
    title: '保存位置',
    defaultPath: `${host.getPath?.('downloads') || ''}/${name}`,
    buttonLabel: '保存',
  }, content);
  if (saved) return;
  const href = URL.createObjectURL(new Blob([content], { type }));
  downloadInBrowser(name, href);
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

function printPdf() {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.srcdoc = htmlDocument();
  frame.onload = () => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  document.body.append(frame);
}

async function select(value: string) {
  closeMenu();
  if (value === 'copy') await host.copyText(markdown.value.replace(/\*\*(.*?)：\*\*/gu, '$1：'));
  // 消息区还没挂载时 querySelector 会是 null，直接跳过而不是把 null 丢给 html2canvas
  const messages = value === 'image' ? document.querySelector<HTMLElement>('.messages-content') : null;
  if (messages) await withAllExpanded(() => saveElementImage(messages, store.state.currentAgent?.nickname || 'chat'));
  if (value === 'markdown') await save(markdown.value, 'md', 'text/markdown;charset=utf-8');
  if (value === 'html') await save(htmlDocument(), 'html', 'text/html;charset=utf-8');
  // 导出的其实是一份 HTML，不是 OOXML。以前它叫 .docx——Word 看到扩展名和内容对不上会
  // 直接弹警告甚至拒绝打开。换成 .doc 就是 Word 一直认的那种「HTML 版 Word 文档」，
  // 双击能开、排版也在；想要真 docx 得引一个几百 KB 的生成库，不值当。
  if (value === 'word') await save(wordDocument(), 'doc', 'application/msword');
  if (value === 'pdf') printPdf();
}

useDismissable(root, () => open.value, closeMenu);

onBeforeUnmount(() => {
  clearTimeout(hoverTimer);
  clearTimeout(closeTimer);
});
</script>

<template>
  <div ref="root" class="export-anchor" @pointerenter="openMenu" @pointerleave="scheduleClose">
    <button class="chat-more" type="button" title="导出对话" aria-label="导出对话" :aria-expanded="open" @click="toggleMenu">
      <svg width="20" height="20" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="12" r="3" fill="var(--color-text-3)"></circle>
        <circle cx="24" cy="24" r="3" fill="var(--color-text-3)"></circle>
        <circle cx="24" cy="35" r="3" fill="var(--color-text-3)"></circle>
      </svg>
    </button>
    <div class="export-dropdown t-dropdown" :class="{ 'is-open': open, 'is-closing': closing }" data-origin="top-right" role="menu">
      <button v-for="item in items" :key="item.value" type="button" role="menuitem" @click="select(item.value)">
        <svg v-if="item.icon === 'copy'" class="export-icon export-copy" viewBox="0 0 1024 1024" aria-hidden="true">
          <path d="M626.432 934.195H223.846c-73.523 0-133.12-59.597-133.12-133.12V398.49c0-73.524 59.597-133.12 133.12-133.12h402.586c73.523 0 133.12 59.596 133.12 133.12v402.585c0 73.523-59.597 133.12-133.12 133.12z" fill="#4BE2AC"></path>
          <path d="M806.144 754.483H403.61c-73.524 0-133.12-59.597-133.12-133.12V218.778c0-73.524 59.596-133.12 133.12-133.12h402.585c73.523 0 133.12 59.596 133.12 133.12v402.585c-.051 73.523-59.648 133.12-133.171 133.12z" fill="#4BE2AC"></path>
          <path d="M623.514 265.37H270.49v353.075c0 75.11 60.928 136.038 136.038 136.038h353.075V401.408c-.051-75.11-60.928-136.038-136.09-136.038z" fill="#06CC76"></path>
        </svg>
        <svg v-else-if="item.icon === 'image'" class="export-icon" viewBox="0 0 1024 1024" aria-hidden="true">
          <path d="M128 0h597.3l227.6 227.9v739.2c0 31.4-25.5 56.9-56.9 56.9H128c-31.4 0-56.9-25.5-56.9-56.9V56.9C71.1 25.5 96.6 0 128 0z" fill="#13BE93"></path>
          <path d="M630.5 1024H128c-25.7 0-47.4-17-54.4-40.4l218.1-218.1c22.2-22.2 58.2-22.2 80.5 0L630.5 1024z" fill="#6BD8BD"></path>
          <path d="M952.9 858v109.1c0 31.4-25.5 56.9-56.9 56.9H322.4l-4.7-4.7 358-358c22.2-22.2 58.2-22.2 80.5 0L952.9 858z" fill="#9CF9E2"></path>
          <path d="M725.3 0l227.6 227.6H782.2c-31.4 0-56.9-25.5-56.9-56.9V0z" fill="#69DCC0"></path>
          <path d="M241.8 483.6a85.3 85.3 0 1 0 170.6 0 85.3 85.3 0 1 0-170.6 0z" fill="#E9FFFA"></path>
        </svg>
        <svg v-else-if="item.icon === 'markdown'" class="export-icon" viewBox="0 0 1024 1024" aria-hidden="true">
          <path d="M662.8 0H199.1C136.3 0 85.3 50.9 85.3 113.8v796.4c0 62.8 50.9 113.8 113.8 113.8h625.8c62.8 0 113.8-50.9 113.8-113.8V316.1L662.8 0zM543.3 811.8h-58.9V600.6l-84.6 82.1-86.9-81.7v210.8h-54.4V503.5h54.2l87.1 97.6 91.4-97.6h52.2v308.3zm146.5 0l-65.7-113.7h40.8V497.8h49.8v200.3h40.8l-65.7 113.7z" fill="#41B3CE"></path>
          <path d="M938.7 452.5V316.1l-75-85.9-200.9 3.3z" fill="#328C9B"></path>
          <path d="M662.8 0v259.2c0 31.4 25.5 56.9 56.9 56.9h219L662.8 0z" fill="#8FD0DB"></path>
        </svg>
        <svg v-else-if="item.icon === 'html'" class="export-icon" viewBox="0 0 1024 1024" aria-hidden="true">
          <path d="M868.658 1023.984H142.97c-44.5 0-80.599-36.1-80.599-80.599V80.7C62.471 36.199 98.471.1 142.97.1h524.092l282.195 282.196v661.19c0 44.399-36 80.498-80.599 80.498z" fill="#FE6638"></path>
          <path d="M667.162 0l282.195 282.196H731.661c-35.6 0-64.5-28.9-64.5-64.5V0z" fill="#FFB19B"></path>
          <path d="M404.666 530.392L249.068 591.79l155.598 61.399v48.699L189.769 616.19v-48.699l214.897-85.799v48.7zm154.597-103.299h48.7L489.364 744.688h-48.699l118.598-317.595zm72.2 227.297l155.597-61.4-155.598-61.398v-48.7l214.897 84.7v49.798L631.462 703.09v-48.7z" fill="#FFF"></path>
        </svg>
        <svg v-else-if="item.icon === 'docx'" class="export-icon" viewBox="0 0 1024 1024" aria-hidden="true">
          <path d="M192 0h448.154L960 320v576c0 70.694-57.306 128-128 128H192c-70.694 0-128-57.306-128-128V128C64 57.306 121.306 0 192 0z" fill="#387EFA"></path>
          <path d="M311.59 701.082c25.088 0 45.76-7.847 62.016-23.54 16.256-15.68 24.372-35.93 24.372-60.736v-33.472c0-24.704-8.128-44.966-24.372-60.748-16.256-15.783-36.928-23.68-62.016-23.68H240v202.176h71.59zm0-31.104h-30.438V530.176h30.438c13.53 0 24.436 4.94 32.692 14.848 8.268 9.907 12.416 22.592 12.416 38.054v33.741c0 15.552-4.148 28.288-12.416 38.247-8.256 9.958-19.162 14.924-32.692 14.924zM511.142 704c25.472 0 45.132-8.077 62.016-24.23 15.872-16.154 23.808-36.685 23.808-61.568v-36.39c0-24.718-7.974-45.198-23.948-61.44C557.043 504.114 536.32 496 510.86 496c-25.267 0-45.773 8.128-61.517 24.371-15.731 16.243-23.603 36.723-23.603 61.44v36.378c0 24.806 7.897 45.312 23.68 61.517C465.203 695.898 485.773 704 511.142 704zm0-31.514c-13.99 0-24.896-5.056-32.69-15.142-7.809-10.086-11.7-23.142-11.7-39.155v-36.66c0-15.743 3.878-28.646 11.635-38.732 7.744-10.1 18.573-15.143 32.474-15.143 14.093 0 25.139 5.044 33.126 15.143 7.987 10.086 11.981 23.001 11.981 38.733v36.659c0 16.013-3.955 29.056-11.84 39.168-7.898 10.073-18.893 15.13-32.986 15.13zM706.892 704c24.154 0 43.086-6.106 56.794-18.33 13.722-12.224 20.39-29.107 20.02-50.688l-.282-.819h-39.885c0 13.133-3.033 22.887-9.088 29.223-6.067 6.336-15.245 9.51-27.558 9.51-12.967 0-23.079-4.902-30.362-14.72-7.296-9.805-10.931-22.49-10.931-38.042v-40.422c0-15.45 3.456-28.07 10.368-37.837 6.912-9.766 16.512-14.643 28.813-14.643 13.248 0 23.04 3.162 29.389 9.51 6.336 6.336 9.51 16 9.51 28.954h40.026l.281-.832c.384-21.85-6.49-38.784-20.582-50.816-14.08-12.032-33.626-18.06-58.624-18.06-23.962 0-43.315 7.846-58.061 23.538-14.746 15.693-22.131 35.84-22.131 60.468v40.128c0 24.704 7.565 44.876 22.694 60.467 15.13 15.616 34.995 23.411 59.61 23.411z" fill="#FFF" opacity=".9"></path>
          <path d="M640 0l320 320H768c-70.694 0-128-57.306-128-128V0z" fill="#97CEF9"></path>
        </svg>
        <svg v-else class="export-icon" viewBox="0 0 1024 1024" aria-hidden="true">
          <path d="M658.286 0v219.429a73.143 73.143 0 0 0 73.143 73.142h219.428v585.143A146.286 146.286 0 0 1 804.571 1024H219.43A146.286 146.286 0 0 1 73.143 877.714V146.286A146.286 146.286 0 0 1 219.429 0h438.857zm43.885 720.677c20.48 0 68.243 0 68.243-47.763 0-20.48-6.803-47.762-68.243-47.762-27.282 0-54.637 6.802-81.92 6.802-34.157-27.282-68.242-61.44-88.722-102.4 20.48-75.117 20.48-122.88 6.802-150.162a52.15 52.15 0 0 0-34.157-13.678c-20.48 0-34.085 6.803-40.96 20.48-20.48 40.96 13.677 116.078 27.355 150.163-20.48 54.637-40.96 109.275-68.315 163.84-129.683 54.637-129.683 88.795-129.683 102.4 0 13.677 6.803 27.355 20.48 34.157 6.803 6.803 13.678 6.803 20.48 6.803 34.158 0 68.243-34.085 116.078-109.203 54.565-20.48 102.4-40.96 156.965-47.762 27.355 20.48 61.44 34.085 95.597 34.085zM511.05 406.674c6.802 20.48 6.802 47.763 0 68.243-13.678-20.48-13.678-40.96-13.678-68.243h13.678zM333.531 802.597c20.48-6.803 34.158-20.48 47.763-40.96-20.48 13.677-34.085 20.48-47.763 40.96zm184.32-204.8c13.678 20.48 34.158 47.835 54.638 68.315h-6.875c-27.283 6.802-61.44 13.605-88.723 27.282 13.678-34.157 27.283-61.44 40.96-95.597zm177.518 68.315c27.282 0 34.085 6.802 34.085 13.605-6.803 0-20.48 6.875-27.283 0-13.677 0-27.282-6.803-40.96-13.605h34.158z" fill="#FF5562"></path>
          <path d="M658.286 0v219.429a73.143 73.143 0 0 0 73.143 73.142h219.428L658.286 0z" fill="#FF949C"></path>
        </svg>
        <span>{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.export-anchor { position: relative; z-index: 10; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; }
.export-anchor:hover { background: var(--color-fill-1); }
.chat-more { width: 20px; height: 20px; color: var(--color-text-3); }
.chat-more:hover { color: var(--color-primary); }
.export-dropdown { position: absolute; top: 30px; right: 0; width: 163px; max-height: 260px; padding: 6px; overflow: hidden; border: 1px solid var(--color-border-2); border-radius: 4px; background: var(--color-bg-2); box-shadow: 0 4px 10px #0000001a; }
.export-dropdown button { width: 100%; height: 36px; padding: 0 12px; display: flex; align-items: center; gap: 8px; color: var(--color-text-2); text-align: left; white-space: nowrap; }
.export-dropdown button:hover, .export-dropdown button:focus-visible { color: var(--color-text-1); background: var(--color-fill-2); }
.export-icon { width: 16px; height: 16px; flex: 0 0 16px; }
.export-copy { width: 18px; height: 18px; }
.t-dropdown {
  transform-origin: top left;
  transform: scale(.97);
  opacity: 0;
  pointer-events: none;
  transition:
    transform 250ms cubic-bezier(.22, 1, .36, 1),
    opacity 250ms cubic-bezier(.22, 1, .36, 1);
  will-change: transform, opacity;
}
.t-dropdown[data-origin="top-right"] { transform-origin: top right; }
.t-dropdown.is-open { transform: scale(1); opacity: 1; pointer-events: auto; }
.t-dropdown.is-closing {
  transform: scale(.99);
  opacity: 0;
  pointer-events: none;
  transition:
    transform 150ms cubic-bezier(.22, 1, .36, 1),
    opacity 150ms cubic-bezier(.22, 1, .36, 1);
}
@media (prefers-reduced-motion: reduce) { .t-dropdown { transition: none !important; } }
</style>
