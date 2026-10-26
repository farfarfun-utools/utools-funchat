<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type PropType } from 'vue';
import type { Agent } from '../../types.ts';
import { host } from '../../services/utools.js';
import AgentAvatar from '../agents/AgentAvatar.vue';
import { previewImage } from './image-preview.js';
import { renderMarkdown } from './markdown.js';
import { droppedImageCount, imageUrls } from './message-content.js';
import { copyElementImage, expandAllForExport, isLongMessage, saveElementImage } from './message-tools.js';
import { messageText } from './token-count.js';

const props = defineProps({
  message: { type: Object, required: true },
  index: { type: Number, default: -1 },
  agent: { type: Object as PropType<Agent | null>, required: true },
  last: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['delete', 'retry']);
// 截图只抓这一块：不含头像、昵称和操作按钮，宽度也就等于气泡自身的宽度
const body = ref();
const copied = ref(false);
const imageCopied = ref(false);
const exporting = ref(false);
// 流式回复期间 content 每来一个 chunk 就变一次，而一次 renderMarkdown 要把整条消息重新过
// 一遍 marked + DOMPurify，v-html 随后还会把整块 DOM 拆掉重建。这里节流到约 12 次/秒：
// 视觉上比逐 token 刷新更稳，开销却低一个数量级。首次变化立即生效，所以非流式场景不会变慢。
const RENDER_INTERVAL = 80;
const source = ref(messageText(props.message));
let lastRender = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

watch(() => messageText(props.message), (value) => {
  const wait = RENDER_INTERVAL - (Date.now() - lastRender);
  if (wait > 0) {
    // 已经排过一次尾随渲染就不必再排，回调读的是届时最新的内容，最后一个 chunk 不会漏
    pending ||= setTimeout(() => {
      pending = null;
      lastRender = Date.now();
      source.value = messageText(props.message);
    }, wait);
    return;
  }
  if (pending) clearTimeout(pending);
  pending = null;
  lastRender = Date.now();
  source.value = value;
});

onBeforeUnmount(() => { if (pending) clearTimeout(pending); });

const long = computed(() => isLongMessage(source.value));
const collapsed = ref(long.value);
const html = computed(() => renderMarkdown(source.value));
const images = computed(() => imageUrls(props.message));
const dropped = computed(() => droppedImageCount(props.message));

watch(long, (value) => { if (value) collapsed.value = true; });

function openLink(event: MouseEvent) {
  const anchor = (event.target as Element).closest?.('a[href]');
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute('href') || '';
  if (/^https?:\/\//iu.test(href)) host.shellOpenExternal(href);
}

async function copy() {
  await host.copyText(messageText(props.message));
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1000);
}

// 出图前必须先展开，否则折叠的长消息只会截到一半
async function withExpanded(action: () => Promise<unknown>) {
  exporting.value = true;
  const previous = collapsed.value;
  collapsed.value = false;
  await nextTick();
  try {
    await action();
  } finally {
    collapsed.value = previous;
    exporting.value = false;
  }
}

async function exportImage() {
  await withExpanded(() => saveElementImage(body.value));
}

async function copyImage() {
  await withExpanded(async () => {
    await copyElementImage(body.value);
    imageCopied.value = true;
    setTimeout(() => { imageCopied.value = false; }, 1000);
  });
}
</script>

<template>
  <article class="chat-box-item" :class="[`chat-${message.role}`, { 'is-last': last, 'has-error': message.error }]">
    <AgentAvatar v-if="message.role === 'assistant'" :agent="agent" :size="26" />
    <span v-else class="user-avatar"><i class="iconfont icon-user" aria-hidden="true"></i></span>
    <div class="chat-content">
      <span class="nickname">{{ message.role === 'assistant' ? agent?.nickname : '我' }}</span>
      <div ref="body" class="message-body" :class="{ exporting }">
        <div v-if="images.length || dropped" class="message-images">
          <button v-for="image in images" :key="image" class="message-image" type="button" title="查看大图" @click="previewImage(image)">
            <img :src="image" alt="消息图片">
          </button>
          <span v-if="dropped" class="message-image-dropped">{{ dropped }} 张图片因体积超限未保存</span>
        </div>
        <div class="prose-chat" :class="{ collapsed: collapsed && !expandAllForExport }" v-html="html" @click="openLink"></div>
      </div>
      <div v-if="index >= 0" class="message-actions">
        <button type="button" :title="copied ? '已复制' : '复制'" :aria-label="copied ? '已复制' : '复制'" @click="copy">
          <i class="iconfont" :class="copied ? 'icon-success' : 'icon-copy'" aria-hidden="true"></i>
        </button>
        <button type="button" :title="imageCopied ? '图片已复制' : '复制为图片'" :aria-label="imageCopied ? '图片已复制' : '复制为图片'" :disabled="exporting" @click="copyImage">
          <i v-if="imageCopied" class="iconfont icon-success" aria-hidden="true"></i>
          <!-- 图标字体里没有语义明确的图片图标，内联 SVG 保证画出来确实是「图片」 -->
          <svg v-else class="action-svg" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.75" stroke="currentColor" stroke-width="1.3" />
            <circle cx="6" cy="6.6" r="1.05" fill="currentColor" />
            <path d="M3 11.2 6.1 8.5l2.2 1.9 2.2-2.4 2.5 2.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button type="button" title="保存此条消息为图片" aria-label="保存此条消息为图片" :disabled="exporting" @click="exportImage">
          <i class="iconfont icon-file" aria-hidden="true"></i>
        </button>
        <button v-if="long" type="button" :title="collapsed ? '展开此条消息' : '收起此条消息'"
          :aria-expanded="!collapsed" @click="collapsed = !collapsed">
          <i class="iconfont icon-down" :class="{ rotated: !collapsed }" aria-hidden="true"></i>
        </button>
        <button v-if="message.role === 'assistant'" type="button" title="重新生成" aria-label="重新生成" :disabled="busy" @click="emit('retry', index)">
          <i class="iconfont icon-refresh" aria-hidden="true"></i>
        </button>
        <button type="button" title="删除消息" aria-label="删除消息" :disabled="busy" @click="emit('delete', index)">
          <i class="iconfont icon-delete" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.chat-box-item { position: relative; display: flex; margin: 0 20px; padding: 0 0 30px; }
.chat-content { position: relative; min-width: 0; max-width: min(840px, calc(100% - 54px)); margin: 3px 12px 0; }
.nickname { display: block; margin-bottom: 6px; color: var(--color-text-3); font-size: 12px; line-height: 1.15; }
.prose-chat { margin-right: 28px; padding: 10px 16px; overflow: hidden; border-radius: 3px 16px 16px; color: var(--color-text-2); background: var(--color-bg-3); line-height: 1.8; overflow-wrap: anywhere; }
.prose-chat.collapsed { position: relative; max-height: 280px; }
.prose-chat.collapsed::after { content: ""; position: absolute; right: 0; bottom: 0; left: 0; height: 70px; background: linear-gradient(transparent, var(--color-bg-3)); pointer-events: none; }
.chat-user { justify-content: flex-end; }
.chat-user .chat-content { order: 1; }
.chat-user .user-avatar { order: 2; }
.chat-user .nickname { text-align: right; }
.chat-user .prose-chat { margin-right: 0; margin-left: 28px; border-radius: 16px 3px 16px 16px; background: var(--user-bubble); }
.chat-user .prose-chat.collapsed::after { background: linear-gradient(transparent, var(--user-bubble)); }
.user-avatar { width: 26px; height: 26px; display: grid; flex: 0 0 26px; place-items: center; border-radius: 50%; color: #fff; background: #0ca47f; }
/* 这 28px 是给对侧留的呼吸位，但出图时它就是一条纯空白，所以导出期间去掉 */
.message-body.exporting .prose-chat { margin-right: 0; margin-left: 0; }
.message-actions { position: absolute; bottom: -29px; left: 12px; display: flex; opacity: 0; transition: opacity .2s ease; }
.chat-user .message-actions { right: 12px; left: auto; }
.chat-box-item:hover .message-actions, .chat-box-item:focus-within .message-actions { opacity: 1; }
.message-actions button { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; color: var(--color-icon); }
.message-actions button:hover { color: var(--color-primary); background: var(--color-bg-2); }
.message-actions button:disabled { opacity: .45; }
/* 与相邻 iconfont 图标视觉等重 */
.action-svg { width: 14px; height: 14px; }
.rotated { transform: rotate(180deg); }
.has-error .prose-chat { border: 1px solid rgba(243, 94, 81, .35); color: #d94b40; }
.message-images { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 8px; }
.message-image { display: block; border-radius: 6px; overflow: hidden; cursor: zoom-in; }
.message-images img { max-width: 260px; max-height: 260px; display: block; border-radius: 6px; object-fit: contain; }
.message-image-dropped { padding: 4px 8px; border: 1px dashed var(--color-border-2); border-radius: 6px; color: var(--color-text-3); font-size: 12px; }
:deep(.prose-chat p + p), :deep(.prose-chat ul), :deep(.prose-chat ol), :deep(.prose-chat pre), :deep(.prose-chat blockquote) { margin-top: .8em; }
:deep(.prose-chat ul), :deep(.prose-chat ol) { padding-left: 1.4em; }
:deep(.prose-chat ul) { list-style: disc; }
:deep(.prose-chat ol) { list-style: decimal; }
:deep(.prose-chat a) { color: var(--color-primary); text-decoration: underline; }
:deep(.prose-chat pre) { padding: 12px 14px; overflow-x: auto; border-radius: 5px; color: #e8eaed; background: #282c34; line-height: 1.55; }
:deep(.prose-chat code:not(pre code)) { padding: 2px 5px; border-radius: 3px; color: #d84d73; background: var(--color-fill-2); }
/* KaTeX 还在下载时公式先以原文占位，别让它闪成行内代码那种高亮粉 */
:deep(.prose-chat code.math-pending) { padding: 0; color: inherit; background: transparent; opacity: .7; }
:deep(.prose-chat blockquote) { padding-left: 12px; border-left: 3px solid var(--color-primary); color: var(--color-text-3); }
:deep(.prose-chat table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
:deep(.prose-chat th), :deep(.prose-chat td) { padding: 6px 10px; border: 1px solid var(--color-border-2); }
@media (max-width: 600px) {
  .chat-box-item { margin-right: 12px; margin-left: 12px; }
  .chat-content { max-width: calc(100% - 42px); margin-right: 8px; margin-left: 8px; }
  .prose-chat { margin-right: 0; padding: 10px 12px; }
  .chat-user .prose-chat { margin-left: 0; }
  .message-images img { max-width: 100%; }
}
</style>
