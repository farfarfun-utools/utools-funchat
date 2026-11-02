<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useDismissable } from '../../composables/use-dismissable.js';
import { useChatStore } from '../../stores/chat.js';
import { supportsVision } from '../../services/models.js';
import ChatPopover from './ChatPopover.vue';
import { MAX_ATTACHMENTS, isImageFile, isPdfFile, readImageAttachment, supportedFilesFromTransfer, transferHasFiles } from './attachments.js';
import type { ImageAttachment } from './attachments.ts';
import { previewImage } from './image-preview.js';
import { extractPdfText, renderPdfPages } from './pdf-attachment.js';
import { IMAGE_TOKEN_ESTIMATE, estimateTokens } from './token-count.js';

// 压缩完成前先占位显示转圈，所以 bytes 要到就绪后才有
type PendingImage = Partial<ImageAttachment> & { id: string; url: string; name: string; loading?: boolean };

const store = useChatStore();
const text = ref('');
const textarea = ref();
const root = ref();
const popup = ref('');
const picker = ref<HTMLInputElement>();
const pdfDialog = ref<HTMLDialogElement>();
const pdfFile = ref<File | null>(null);
const pdfAttachment = ref<{ id: number; name: string; content: string; loading: boolean; truncated: boolean } | null>(null);
const attachments = ref<PendingImage[]>([]);
const dragging = ref(false);
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSeed = 0;
const needsApiSetup = store.needsApiSetup;
const displayedTokens = computed(() => needsApiSetup.value
  ? 0
  : store.tokenCount.value + estimateTokens(text.value) + estimateTokens(pdfAttachment.value?.content || '') + attachments.value.length * IMAGE_TOKEN_ESTIMATE);
// uTools AI 的模型清单会标明每个模型吃不吃图片。确定不支持时才提醒——拿不到清单
// （私有 API 线路）一律当作支持，不能凭猜测拦住用户的图片。
const noVision = computed(() => !supportsVision(store.activeModel.value));

function warn(message: string) {
  notice.value = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 2600);
}

// 读图和压缩都要时间，先占一个位显示转圈，成功后原地替换成缩略图。
// 期间用户可能继续粘贴，所以每一步都基于当前列表重新算，不缓存快照。
async function addImages(files: File[]) {
  // 不拦，只提醒：模型清单可能滞后于实际能力，而且用户也许正打算顺手换个模型再发。
  if (noVision.value) warn(`${store.activeModel.value} 不识图，发之前先换个支持识图的模型`);
  const room = MAX_ATTACHMENTS - attachments.value.length;
  if (files.length > room) warn(`一条消息最多带 ${MAX_ATTACHMENTS} 张图片`);
  for (const file of files.slice(0, Math.max(room, 0))) {
    pendingSeed += 1;
    const id = `pending-${pendingSeed}`;
    attachments.value = [...attachments.value, { id, url: '', name: file.name || '图片', loading: true }];
    try {
      const ready = await readImageAttachment(file);
      attachments.value = attachments.value.map((item) => (item.id === id ? ready : item));
    } catch (error) {
      attachments.value = attachments.value.filter((item) => item.id !== id);
      warn(error instanceof Error ? error.message : '这张图片读不出来，换一张试试');
    }
  }
}

function addFiles(files: File[]) {
  const images = files.filter(isImageFile);
  if (images.length) void addImages(images);
  const pdfs = files.filter(isPdfFile);
  if (!pdfs.length) return;
  if (pdfs.length > 1 || pdfFile.value || pdfAttachment.value) {
    warn('一条消息只能添加一份 PDF');
    return;
  }
  pdfFile.value = pdfs[0];
  void nextTick(() => pdfDialog.value?.showModal());
}

async function choosePdf(mode: 'text' | 'images') {
  const file = pdfFile.value;
  pdfDialog.value?.close();
  pdfFile.value = null;
  if (!file) return;
  const pending = { id: ++pendingSeed, name: file.name, content: '', loading: true, truncated: false };
  pdfAttachment.value = pending;
  try {
    if (mode === 'text') {
      const result = await extractPdfText(file);
      if (pdfAttachment.value?.id !== pending.id) return;
      pdfAttachment.value = { ...pending, ...result, loading: false };
      if (result.truncated) warn('PDF 较长，仅提取了前 30000 字');
    } else {
      if (noVision.value) warn(`${store.activeModel.value} 不识图，请换一个支持识图的模型`);
      const pages = await renderPdfPages(file, MAX_ATTACHMENTS - attachments.value.length);
      if (pdfAttachment.value?.id !== pending.id) return;
      attachments.value = [...attachments.value, ...pages];
      pdfAttachment.value = null;
    }
  } catch (error) {
    if (pdfAttachment.value?.id === pending.id) pdfAttachment.value = null;
    warn(error instanceof Error ? error.message : 'PDF 处理失败');
  }
}

function paste(event: ClipboardEvent) {
  const files = supportedFilesFromTransfer(event.clipboardData).filter((file) => !isPdfFile(file) || file.size !== 0);
  if (files.length) {
    event.preventDefault();
    addFiles(files);
    return;
  }
  const native = window.readClipboardPdf?.();
  if (native) {
    event.preventDefault();
    if ('error' in native) warn(native.error);
    else addFiles([new File([Uint8Array.from(native.bytes)], native.name, { type: 'application/pdf' })]);
    return;
  }
  // 复制的只是文字时仍由输入框正常粘贴；文件剪贴板不可读时明确提醒。
  if (/^[^\r\n]+\.pdf$/i.test(event.clipboardData?.getData('text/plain')?.trim() || '')) {
    warn('只获取到文件名，请拖入 PDF 或点击附件按钮选择文件');
  }
}

// 只有拖的是文件才接管：拖选中的文字进输入框仍然走浏览器默认行为
function dragOver(event: DragEvent) {
  if (!transferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  dragging.value = true;
}

function dragLeave(event: DragEvent) {
  // 在子元素之间移动也会触发 dragleave，只有真的移出整个输入区才取消高亮
  if (!root.value?.contains(event.relatedTarget as Node)) dragging.value = false;
}

function drop(event: DragEvent) {
  dragging.value = false;
  if (!transferHasFiles(event.dataTransfer)) return;
  // 文件拖放一律拦下：非图片文件要是走了默认行为，Electron 会把整个窗口导航到那个文件
  event.preventDefault();
  const files = supportedFilesFromTransfer(event.dataTransfer);
  if (files.length) addFiles(files);
  else warn('只支持拖入图片或 PDF');
}

function pick(event: Event) {
  const input = event.target as HTMLInputElement;
  addFiles(Array.from(input.files || []));
  // 清空选择，否则连着选同一张图不会再触发 change
  input.value = '';
}

function removeImage(id: string) {
  attachments.value = attachments.value.filter((item) => item.id !== id);
}

async function submit() {
  const value = text.value;
  const pending = attachments.value;
  const pdf = pdfAttachment.value;
  if ((!value.trim() && !pending.length && !pdf) || store.state.loading || !store.state.currentAgent) return;
  if (pending.some((item) => item.loading) || pdf?.loading || pdfFile.value) {
    warn('附件还在处理，稍等一下');
    return;
  }
  text.value = '';
  attachments.value = [];
  pdfAttachment.value = null;
  const message = [value.trim(), pdf?.content].filter(Boolean).join('\n\n');
  if (!await store.send(message, pending.map((item) => item.url))) {
    text.value = value;
    attachments.value = pending;
    pdfAttachment.value = pdf;
  }
}

function keydown(event: KeyboardEvent) {
  const ctrlMode = (store.state.settings.sendMode || 'ctrl-enter') === 'ctrl-enter';
  if (event.key === 'Enter' && !event.shiftKey && (ctrlMode ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey)) {
    event.preventDefault();
    submit();
  }
}

function togglePopup(value: string) {
  popup.value = popup.value === value ? '' : value;
}

function updateSetting(key: string, value: unknown) {
  // updateSettings 本身就是 Object.assign 语义，再展开一遍当前设置是多余的——
  // 还会把此刻可能处于中间态的字段原样写回去
  store.updateSettings({ [key]: value });
  popup.value = '';
}

useDismissable(root, () => Boolean(popup.value), () => { popup.value = ''; });

// 每次进入插件都把焦点放回输入框。uTools 里「唤出 → 敲 funchat → 回车」之后插件就该能直接
// 打字，以前中间还要补一次点击；而且退到后台再回来时焦点是丢了的。
// 带着选中文字进来（plugin.json 的 over 指令）就预填进去，但不覆盖用户已经写了的草稿。
function applyEnterIntent(prefill: string) {
  if (prefill && !text.value.trim()) text.value = prefill;
  // 等 DOM 更新完再 focus，预填的文字这时才真的在 textarea 里，光标才能停到末尾
  void nextTick(() => {
    const element = textarea.value;
    if (!element) return;
    element.focus();
    // 光标停在末尾，方便接着补充要求
    element.setSelectionRange(text.value.length, text.value.length);
  });
}

onMounted(() => {
  applyEnterIntent(store.enterIntent.value.text);
  watch(() => store.enterIntent.value.seq, () => { applyEnterIntent(store.enterIntent.value.text); });
});
onBeforeUnmount(() => clearTimeout(noticeTimer));
</script>

<template>
  <footer ref="root" class="chat-composer" :class="{ 'has-images': attachments.length || pdfAttachment, dragging }"
    @dragover="dragOver" @dragleave="dragLeave" @drop="drop">
    <ChatPopover v-if="popup === 'api' || popup === 'params'" :kind="popup" @close="popup = ''" />
    <dialog ref="pdfDialog" class="pdf-mode-dialog" aria-labelledby="pdf-mode-title" @close="pdfFile = null">
      <h2 id="pdf-mode-title">如何读取 {{ pdfFile?.name }}</h2>
      <div class="pdf-mode-actions">
        <button type="button" @click="choosePdf('text')"><b>提取文字</b><span>适合可选中文字的 PDF</span></button>
        <button type="button" @click="choosePdf('images')"><b>按页面图片识别</b><span>适合扫描件，需识图模型，最多 4 页</span></button>
      </div>
      <button class="pdf-mode-cancel" type="button" @click="pdfDialog?.close()">取消</button>
    </dialog>
    <!-- 隐藏在布局之外，避免它参与 tool-group 的间距和分隔线计算 -->
    <input ref="picker" class="image-picker" type="file" accept="image/*,application/pdf,.pdf" multiple tabindex="-1" aria-hidden="true" @change="pick">
    <div class="composer-tools">
      <div class="tool-group">
        <button v-if="store.state.loading" type="button" title="停止生成" aria-label="停止生成" @click="store.stop">
          <i class="iconfont icon-close" aria-hidden="true"></i>
        </button>
        <button class="attach-button" type="button" :title="`添加图片或 PDF（也可直接粘贴或拖入；图片最多 ${MAX_ATTACHMENTS} 张）`" aria-label="添加图片或 PDF" @click="picker?.click()">
          <i class="iconfont icon-file" aria-hidden="true"></i>
        </button>
      </div>
      <div class="tool-group tool-group-end">
        <button type="button" title="API 设置" aria-label="API 设置" :aria-expanded="popup === 'api'" @click="togglePopup('api')"><i class="iconfont icon-key" aria-hidden="true"></i></button>
        <button type="button" title="模型参数" aria-label="模型参数" :aria-expanded="popup === 'params'" @click="togglePopup('params')"><i class="iconfont icon-params" aria-hidden="true"></i></button>
        <div class="popup-anchor more-anchor">
          <button class="more-button" type="button" title="更多设置" aria-label="更多设置" :aria-expanded="popup === 'more'" @click="togglePopup('more')"><span aria-hidden="true"><svg width="18" height="18" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="12" r="3" fill="var(--color-text-3)"></circle><circle cx="24" cy="24" r="3" fill="var(--color-text-3)"></circle><circle cx="24" cy="35" r="3" fill="var(--color-text-3)"></circle></svg></span></button>
          <div v-if="popup === 'more'" class="composer-menu more-menu" role="menu">
            <button type="button" role="menuitem" @click="store.state.view = 'help'; popup = ''">帮助中心</button>
            <button :class="{ active: store.state.settings.sendMode === 'enter' }" type="button" role="menuitemradio" @click="updateSetting('sendMode', 'enter')">Enter发送</button>
            <button :class="{ active: (store.state.settings.sendMode || 'ctrl-enter') === 'ctrl-enter' }" type="button" role="menuitemradio" @click="updateSetting('sendMode', 'ctrl-enter')">Ctrl+Enter发送</button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="attachments.length || pdfAttachment" class="attachment-strip">
      <div v-if="pdfAttachment" class="pdf-attachment">
        <i class="iconfont icon-file" aria-hidden="true"></i>
        <span :title="pdfAttachment.name">{{ pdfAttachment.name }}</span>
        <small>{{ pdfAttachment.loading ? '处理中' : pdfAttachment.truncated ? '前 30000 字' : '文字' }}</small>
        <button type="button" :title="`移除 ${pdfAttachment.name}`" :aria-label="`移除 ${pdfAttachment.name}`" @click="pdfAttachment = null"><i class="iconfont icon-close" aria-hidden="true"></i></button>
      </div>
      <div v-for="item in attachments" :key="item.id" class="attachment" :class="{ loading: item.loading }">
        <span v-if="item.loading" class="attachment-spinner" role="status" aria-label="图片处理中"></span>
        <button v-else class="attachment-open" type="button" :title="`查看 ${item.name}`" @click="previewImage(item.url)">
          <img :src="item.url" :alt="item.name">
        </button>
        <button class="attachment-remove" type="button" :title="`移除 ${item.name}`" :aria-label="`移除 ${item.name}`" @click="removeImage(item.id)">
          <i class="iconfont icon-close" aria-hidden="true"></i>
        </button>
      </div>
      <span v-if="attachments.length" class="attachment-hint" :class="{ blocked: noVision }">{{ noVision ? `${store.activeModel.value} 不支持识图` : '图片需所选模型支持识图' }}</span>
    </div>
    <div class="textarea-wrap" @click="textarea?.focus()"><textarea ref="textarea" v-model="text" placeholder="聊点什么吧...（可粘贴图片或 PDF）" spellcheck="false" @keydown="keydown" @paste="paste"></textarea></div>
    <div class="composer-footer">
      <span v-if="notice" class="composer-notice" role="status">{{ notice }}</span>
      <span class="token-count" :class="{ 'has-token': displayedTokens > 0 }">{{ displayedTokens.toLocaleString() }}</span>
    </div>
  </footer>
</template>

<style scoped>
/* 高度走变量：ChatPopover 的上沿要贴着输入区顶部，带图变高后它得跟着走 */
.chat-composer { --composer-height: 160px; position: relative; height: var(--composer-height); padding-top: 3px; display: flex; flex: 0 0 var(--composer-height); flex-direction: column; overflow: visible; background: var(--color-bg-2); border-top: 1px solid var(--color-border-2); }
/* 带图时整条输入区变高，缩略图不挤占本就只有两行的输入框 */
.chat-composer.has-images { --composer-height: 232px; }
.chat-composer.dragging { border-top-color: var(--color-primary); box-shadow: inset 0 0 0 1px var(--color-primary); }
.image-picker { display: none; }
.composer-tools .attach-button { display: grid; place-items: center; }
.composer-tools .attach-button .icon-file { font-size: 18px; }
.pdf-mode-dialog { width: min(420px, calc(100vw - 32px)); margin: auto; padding: 20px; border: 0; border-radius: 8px; color: var(--color-text-2); background: var(--color-bg-3); box-shadow: 0 12px 35px #0003; }
.pdf-mode-dialog::backdrop { background: #1d212980; }
.pdf-mode-dialog h2 { overflow-wrap: anywhere; color: var(--color-text-1); font-size: 16px; line-height: 1.4; }
.pdf-mode-actions { display: grid; gap: 8px; margin-top: 18px; }
.pdf-mode-actions button { min-height: 58px; padding: 10px 12px; border: 1px solid var(--color-border-2); border-radius: 6px; background: var(--color-bg-2); text-align: left; }
.pdf-mode-actions button:hover, .pdf-mode-actions button:focus-visible { border-color: var(--color-primary); }
.pdf-mode-actions b, .pdf-mode-actions span { display: block; line-height: 1.4; }
.pdf-mode-actions b { color: var(--color-text-1); }
.pdf-mode-actions span { margin-top: 3px; color: var(--color-text-3); font-size: 12px; }
.pdf-mode-cancel { display: block; margin: 16px 0 0 auto; color: var(--color-text-3); }
.attachment-strip { height: 72px; padding: 0 16px; display: flex; flex: 0 0 72px; align-items: center; gap: 8px; overflow-x: auto; scrollbar-width: none; }
.attachment-strip::-webkit-scrollbar { height: 0; }
.pdf-attachment { min-width: 0; max-width: 220px; height: 56px; padding: 7px 8px; display: grid; grid-template-columns: 18px minmax(0, 1fr) 18px; grid-template-rows: 22px 16px; column-gap: 5px; flex: 0 0 180px; align-items: center; border: 1px solid var(--color-border-2); border-radius: 6px; background: var(--color-fill-1); }
.pdf-attachment > .icon-file { grid-row: 1 / 3; color: var(--color-primary); font-size: 18px; }
.pdf-attachment > span { overflow: hidden; color: var(--color-text-1); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.pdf-attachment small { grid-column: 2; grid-row: 2; color: var(--color-text-3); font-size: 11px; }
.pdf-attachment button { grid-column: 3; grid-row: 1; width: 18px; height: 18px; }
.attachment { position: relative; width: 56px; height: 56px; flex: 0 0 56px; border: 1px solid var(--color-border-2); border-radius: 6px; background: var(--color-fill-1); }
.attachment-open { width: 100%; height: 100%; display: block; border-radius: 5px; overflow: hidden; cursor: zoom-in; }
.attachment-open img { width: 100%; height: 100%; display: block; object-fit: cover; }
.attachment-remove { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #4e5969; box-shadow: 0 1px 3px #00000033; }
.attachment-remove:hover { background: #f53f3f; }
.attachment-remove .iconfont { font-size: 10px; line-height: 1; }
.attachment.loading { display: grid; place-items: center; }
.attachment-spinner { width: 18px; height: 18px; border: 2px solid var(--color-fill-3); border-top-color: var(--color-primary); border-radius: 50%; animation: attachment-spin .8s linear infinite; }
@keyframes attachment-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .attachment-spinner { animation-duration: 2.4s; } }
.attachment-hint { color: var(--color-text-3); font-size: 11px; white-space: nowrap; }
.attachment-hint.blocked { color: #f53f3f; }
.composer-notice { padding-top: 10px; color: #f53f3f; font-size: 12px; line-height: 1.15; }
.composer-tools { height: 42px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; }
.tool-group { display: flex; align-items: center; gap: 25px; }
.composer-tools button { position: relative; width: 28px; height: 28px; border-radius: 50%; color: var(--color-icon); }
.tool-group > :not(:last-child) { position: relative; }
.tool-group > :not(:last-child)::after { content: ""; position: absolute; top: 8px; right: -13px; width: 1px; height: 14px; background: var(--color-fill-2); pointer-events: none; }
.composer-tools button:hover { color: var(--color-primary); background: var(--color-fill-1); }
.composer-tools button:disabled { opacity: 1; color: var(--color-icon); }
.composer-tools .more-button { width: 18px; height: 18px; border-radius: 0; color: var(--color-text-3); }
.popup-anchor { position: relative; width: 28px; height: 28px; flex: 0 0 28px; }
.more-anchor { width: 18px; height: 18px; flex-basis: 18px; }
.composer-menu { position: absolute; z-index: 90; bottom: 32px; padding: 7px; display: flex; flex-direction: column; border-radius: 4px; color: var(--color-text-2); background: var(--color-bg-2); box-shadow: 0 4px 10px #0000001a; font-size: 14px; font-style: normal; font-weight: 400; line-height: 22px; white-space: nowrap; }
.composer-tools .composer-menu > button { width: 100%; height: 36px; padding: 0 8px; display: flex; align-items: center; gap: 8px; border-radius: 3px; color: var(--color-text-2); text-align: left; }
.composer-tools .composer-menu > button:hover, .composer-tools .composer-menu > button.active { color: var(--color-text-2); background: var(--color-primary-light-1); }
.composer-menu i { width: 16px; font-size: 16px !important; }
.more-menu { right: -16px; bottom: 22px; width: 140px; }
.tool-group-end button:nth-child(2) .iconfont { font-size: 18px; line-height: 28px; }
.composer-tools .iconfont, .composer-tools .icon { display: block; line-height: 1.5715; }
.tool-group-end { margin-left: auto; }
.textarea-wrap { height: 64px; flex: 0 0 64px; cursor: text; }
textarea { width: 100%; height: 50px; padding: 5px 16px 0; overflow-y: auto; border: 0; outline: 0; resize: none; color: var(--color-text-2); background: transparent; font-size: 15px; line-height: 1.5; }
textarea:focus, textarea:focus-visible { outline: 0; }
textarea::placeholder { color: #9ca3af; }
.composer-footer { height: 50px; padding: 0 16px 0 12px; display: flex; flex: 0 0 50px; align-items: center; overflow: hidden; }
.token-count { margin-left: auto; padding-top: 10px; color: #c9cdd4; font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1.15; }
.token-count.has-token { color: var(--color-text-3); font-size: 12px; }
</style>
