<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import type { AgentAvatar } from '../../types.ts';
import AgentAvatarView from './AgentAvatar.vue';
import {
  AVATAR_BUILTIN_IMAGES,
  AVATAR_EMOJI_GROUPS,
  AVATAR_GRADIENTS,
  AVATAR_ICONS,
  compressAvatarFile,
  isSafeAvatarDataUrl,
  randomPresetAvatar,
} from './avatar-presets.ts';

type PickerTab = 'emoji' | 'image' | 'icon' | 'text' | 'upload';

const dialog = ref<HTMLDialogElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const tab = ref<PickerTab>('emoji');
const emojiGroup = ref(AVATAR_EMOJI_GROUPS[0].id);
const customEmoji = ref('');
const textValue = ref('');
const uploadError = ref('');
const uploading = ref(false);
const dragOver = ref(false);
const uploadedImage = ref('');
const ownerNickname = ref('AI');

const draft = reactive<{
  type: 'emoji' | 'image' | 'icon' | 'text';
  emoji: string;
  icon: string;
  image: string;
  text: string;
  color: string;
  gradient: [string, string];
}>({
  type: 'emoji',
  emoji: '🤖',
  icon: 'icon-a1',
  image: '6',
  text: 'AI',
  color: AVATAR_GRADIENTS[0][0],
  gradient: [AVATAR_GRADIENTS[0][0], AVATAR_GRADIENTS[0][1]],
});

let resolver: ((avatar: AgentAvatar | null) => void) | null = null;

const activeEmojiItems = computed(
  () => AVATAR_EMOJI_GROUPS.find((g) => g.id === emojiGroup.value)?.items || AVATAR_EMOJI_GROUPS[0].items,
);

const previewAvatar = computed<AgentAvatar>(() => {
  if (draft.type === 'image') {
    return { type: 'image', image: draft.image };
  }
  if (draft.type === 'emoji') {
    return {
      type: 'emoji',
      emoji: draft.emoji || '🤖',
      gradient: [...draft.gradient],
      color: draft.gradient[0],
    };
  }
  if (draft.type === 'text') {
    const clean = (draft.text || ownerNickname.value || 'AI').trim().slice(0, 2) || 'AI';
    return {
      type: 'text',
      text: clean,
      gradient: [...draft.gradient],
      color: draft.gradient[0],
    };
  }
  return {
    type: 'icon',
    icon: draft.icon || 'icon-a1',
    gradient: [...draft.gradient],
    color: draft.gradient[0],
  };
});

const previewAgent = computed(() => ({
  nickname: ownerNickname.value || 'AI',
  avatar: previewAvatar.value,
}));

const showPalette = computed(() => tab.value === 'emoji' || tab.value === 'icon' || tab.value === 'text');

const uploadedSizeHint = computed(() => {
  if (draft.type !== 'image' || !isSafeAvatarDataUrl(draft.image)) return '';
  const kb = Math.max(1, Math.round((draft.image.length * 0.75) / 1024));
  return `已压缩为 160×160 · 约 ${kb} KB`;
});

function syncGradientFromAvatar(src: AgentAvatar) {
  if (Array.isArray(src.gradient) && src.gradient.length >= 2) {
    draft.gradient = [String(src.gradient[0]), String(src.gradient[1])];
    draft.color = draft.gradient[0];
    return;
  }
  if (typeof src.color === 'string' && src.color) {
    const matched = AVATAR_GRADIENTS.find((g) => g[0].toLowerCase() === src.color?.toLowerCase());
    draft.gradient = matched ? [matched[0], matched[1]] : [src.color, src.color];
    draft.color = src.color;
    return;
  }
  draft.gradient = [AVATAR_GRADIENTS[0][0], AVATAR_GRADIENTS[0][1]];
  draft.color = AVATAR_GRADIENTS[0][0];
}

function open(current: AgentAvatar | undefined, nickname = 'AI'): Promise<AgentAvatar | null> {
  ownerNickname.value = nickname.trim() || 'AI';
  uploadError.value = '';
  uploading.value = false;
  dragOver.value = false;
  customEmoji.value = '';

  const src = current || { type: 'icon', icon: 'icon-a1', color: '#0ca47f' };
  syncGradientFromAvatar(src);
  draft.emoji = typeof src.emoji === 'string' && src.emoji ? src.emoji : '🤖';
  draft.icon = typeof src.icon === 'string' && src.icon ? src.icon : 'icon-a1';
  draft.image = typeof src.image === 'string' && src.image ? src.image : AVATAR_BUILTIN_IMAGES[0];
  uploadedImage.value = src.type === 'image' && isSafeAvatarDataUrl(src.image) ? src.image : '';
  draft.text =
    typeof src.text === 'string' && src.text.trim()
      ? src.text.trim().slice(0, 2)
      : ownerNickname.value.slice(0, 2);
  textValue.value = draft.text;

  if (src.type === 'image') {
    draft.type = 'image';
    tab.value = isSafeAvatarDataUrl(src.image) ? 'upload' : 'image';
  } else if (src.type === 'emoji') {
    draft.type = 'emoji';
    tab.value = 'emoji';
  } else if (src.type === 'text') {
    draft.type = 'text';
    tab.value = 'text';
  } else {
    draft.type = 'icon';
    tab.value = 'icon';
  }

  dialog.value?.showModal();
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

function settle(result: AgentAvatar | null) {
  const cb = resolver;
  resolver = null;
  if (dialog.value?.open) dialog.value.close();
  cb?.(result);
}

function selectTab(next: PickerTab) {
  tab.value = next;
  uploadError.value = '';
  if (next === 'emoji') draft.type = 'emoji';
  else if (next === 'icon') draft.type = 'icon';
  else if (next === 'text') {
    draft.type = 'text';
    draft.text = textValue.value.trim().slice(0, 2) || ownerNickname.value.slice(0, 2) || 'AI';
  } else if (next === 'image') {
    draft.type = 'image';
    if (!AVATAR_BUILTIN_IMAGES.includes(draft.image)) {
      draft.image = AVATAR_BUILTIN_IMAGES[0];
    }
  } else if (next === 'upload' && uploadedImage.value) {
    draft.type = 'image';
    draft.image = uploadedImage.value;
  }
}

function pickGradient(pair: readonly [string, string]) {
  draft.gradient = [pair[0], pair[1]];
  draft.color = pair[0];
}

function pickEmoji(emoji: string) {
  draft.type = 'emoji';
  draft.emoji = emoji;
}

function applyCustomEmoji() {
  const val = customEmoji.value.trim();
  if (!val) return;
  const firstGrapheme = Array.from(val).slice(0, 2).join('');
  draft.type = 'emoji';
  draft.emoji = firstGrapheme;
}

function pickBuiltinImage(id: string) {
  draft.type = 'image';
  draft.image = id;
}

function pickIcon(iconClass: string) {
  draft.type = 'icon';
  draft.icon = iconClass;
}

function onTextInput() {
  draft.type = 'text';
  draft.text = textValue.value.trim().slice(0, 2);
}

function pickRandom() {
  const next = randomPresetAvatar();
  draft.type = 'emoji';
  draft.emoji = next.emoji || '🤖';
  syncGradientFromAvatar(next);
  tab.value = 'emoji';
}

async function handleImageFile(file: File | null | undefined) {
  if (!file) return;
  uploadError.value = '';
  uploading.value = true;
  try {
    const dataUrl = await compressAvatarFile(file, 160);
    uploadedImage.value = dataUrl;
    draft.type = 'image';
    draft.image = dataUrl;
    tab.value = 'upload';
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : '图片处理失败，请重试';
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  void handleImageFile(input.files?.[0]);
}

function onDrop(event: DragEvent) {
  dragOver.value = false;
  const file = event.dataTransfer?.files?.[0];
  void handleImageFile(file);
}

function onPaste(event: ClipboardEvent) {
  if (!dialog.value?.open) return;
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        void handleImageFile(file);
        return;
      }
    }
  }
}

function onNativeCancel() {
  settle(null);
}

function onBackdropClick(event: MouseEvent) {
  if (event.target === dialog.value) settle(null);
}

onBeforeUnmount(() => {
  resolver = null;
});

defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="avatar-picker-dialog"
    aria-label="选择角色头像"
    @cancel.prevent="onNativeCancel"
    @click="onBackdropClick"
    @paste="onPaste"
  >
    <div class="picker-shell">
      <header class="picker-header">
        <div class="picker-preview">
          <AgentAvatarView :agent="previewAgent" :size="56" />
          <div class="preview-meta">
            <strong>选择角色头像</strong>
            <small>{{ uploadedSizeHint || '挑选预设头像、配色，或上传本地图片' }}</small>
          </div>
        </div>
        <button type="button" class="random-btn" @click="pickRandom">🎲 随机换一个</button>
      </header>

      <nav class="picker-tabs" aria-label="头像类型">
        <button type="button" :class="{ active: tab === 'emoji' }" @click="selectTab('emoji')">Emoji</button>
        <button type="button" :class="{ active: tab === 'image' }" @click="selectTab('image')">内置头像</button>
        <button type="button" :class="{ active: tab === 'icon' }" @click="selectTab('icon')">矢量图标</button>
        <button type="button" :class="{ active: tab === 'text' }" @click="selectTab('text')">文字头像</button>
        <button type="button" :class="{ active: tab === 'upload' }" @click="selectTab('upload')">上传图片</button>
      </nav>

      <div class="picker-body">
        <!-- 1. Emoji -->
        <section v-if="tab === 'emoji'" class="tab-panel">
          <div class="emoji-toolbar">
            <div class="group-pills">
              <button
                v-for="g in AVATAR_EMOJI_GROUPS"
                :key="g.id"
                type="button"
                class="pill-btn"
                :class="{ active: emojiGroup === g.id }"
                @click="emojiGroup = g.id"
              >
                {{ g.label }}
              </button>
            </div>
            <input
              v-model="customEmoji"
              class="custom-emoji-input"
              maxlength="4"
              placeholder="自填 Emoji"
              aria-label="自定义 Emoji"
              @input="applyCustomEmoji"
            />
          </div>

          <div class="emoji-grid">
            <button
              v-for="item in activeEmojiItems"
              :key="item"
              type="button"
              class="emoji-cell"
              :class="{ active: draft.type === 'emoji' && draft.emoji === item }"
              @click="pickEmoji(item)"
            >
              <span>{{ item }}</span>
            </button>
          </div>
        </section>

        <!-- 2. Built-in Portrait Images -->
        <section v-else-if="tab === 'image'" class="tab-panel">
          <div class="image-grid">
            <button
              v-for="id in AVATAR_BUILTIN_IMAGES"
              :key="id"
              type="button"
              class="image-cell"
              :class="{ active: draft.type === 'image' && draft.image === id }"
              @click="pickBuiltinImage(id)"
            >
              <img :src="`./avatars/${id}.jpg`" :alt="`内置头像 ${id}`" />
            </button>
          </div>
        </section>

        <!-- 3. Built-in Vector Icons -->
        <section v-else-if="tab === 'icon'" class="tab-panel">
          <div class="icon-grid">
            <button
              v-for="iconClass in AVATAR_ICONS"
              :key="iconClass"
              type="button"
              class="icon-cell"
              :class="{ active: draft.type === 'icon' && draft.icon === iconClass }"
              @click="pickIcon(iconClass)"
            >
              <span
                class="icon-badge"
                :style="{ background: `linear-gradient(135deg, ${draft.gradient[0]} 0%, ${draft.gradient[1]} 100%)` }"
              >
                <i class="icon" :class="iconClass" aria-hidden="true"></i>
              </span>
            </button>
          </div>
        </section>

        <!-- 4. Text Monogram -->
        <section v-else-if="tab === 'text'" class="tab-panel text-panel">
          <label class="text-label">
            <span>头像文字（1–2 个字符）</span>
            <input
              v-model="textValue"
              maxlength="2"
              placeholder="如：助、AI、翻译"
              @input="onTextInput"
            />
          </label>
          <p class="panel-tip">支持汉字、英文字母或数字，搭配下方渐变背景色即可生成极简头像。</p>
        </section>

        <!-- 5. Upload Custom Image -->
        <section v-else class="tab-panel upload-panel">
          <input
            ref="fileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            class="sr-input"
            @change="onFileChange"
          />
          <div
            class="dropzone"
            :class="{ 'is-dragover': dragOver }"
            role="button"
            tabindex="0"
            @click="fileInput?.click()"
            @keydown.enter.prevent="fileInput?.click()"
            @keydown.space.prevent="fileInput?.click()"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="onDrop"
          >
            <span class="drop-icon">🖼️</span>
            <strong>{{ uploading ? '正在裁切与压缩…' : '点击选择本地图片，或拖拽 / Ctrl+V 粘贴到此处' }}</strong>
            <small>支持 PNG / JPG / WebP / GIF（≤ 10 MB），自动居中裁切为 160×160 高清头像并随 uTools 同步</small>
          </div>
          <p v-if="uploadError" class="upload-error" role="alert">{{ uploadError }}</p>
        </section>

        <!-- Shared Gradient / Color Palette -->
        <div v-if="showPalette" class="palette-bar">
          <span class="palette-label">背景配色</span>
          <div class="palette-dots">
            <button
              v-for="(pair, idx) in AVATAR_GRADIENTS"
              :key="idx"
              type="button"
              class="swatch-dot"
              :class="{ active: draft.gradient[0] === pair[0] && draft.gradient[1] === pair[1] }"
              :style="{ background: `linear-gradient(135deg, ${pair[0]} 0%, ${pair[1]} 100%)` }"
              :aria-label="`配色 ${idx + 1}`"
              @click="pickGradient(pair)"
            />
          </div>
        </div>
      </div>

      <footer class="picker-footer">
        <button type="button" @click="settle(null)">取消</button>
        <button type="button" class="primary" :disabled="uploading" @click="settle(previewAvatar)">使用此头像</button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.avatar-picker-dialog {
  width: 520px;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 28px);
  margin: auto;
  padding: 0;
  border: 1px solid var(--color-border-2);
  border-radius: 14px;
  background: var(--color-bg-3);
  color: var(--color-text-2);
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28);
}
.avatar-picker-dialog::backdrop {
  background: rgba(15, 23, 42, 0.56);
}
.picker-shell {
  max-height: calc(100dvh - 28px);
  display: flex;
  flex-direction: column;
}
.picker-header {
  padding: 16px 20px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.picker-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.preview-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.preview-meta strong {
  color: var(--color-text-1);
  font-size: 15px;
  font-weight: 600;
}
.preview-meta small {
  color: var(--color-text-3);
  font-size: 12px;
}
.random-btn {
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--color-border-2);
  background: var(--color-fill-1);
  color: var(--color-text-2);
  font-size: 12px;
  white-space: nowrap;
  flex: 0 0 auto;
  transition: border-color .14s ease, color .14s ease, background .14s ease;
}
.random-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light-1);
}
.picker-tabs {
  margin: 0 20px;
  display: flex;
  gap: 20px;
  border-bottom: 1px solid var(--color-border-2);
  flex: 0 0 auto;
}
.picker-tabs button {
  position: relative;
  height: 36px;
  font-size: 13px;
  color: var(--color-text-3);
  transition: color .14s ease;
}
.picker-tabs button:hover {
  color: var(--color-text-1);
}
.picker-tabs button.active {
  color: var(--color-primary);
  font-weight: 600;
}
.picker-tabs button.active::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: var(--color-primary);
}
.picker-body {
  padding: 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
}
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.emoji-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.group-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pill-btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--color-fill-2);
  color: var(--color-text-2);
  font-size: 12px;
  transition: background .14s ease, color .14s ease;
}
.pill-btn.active {
  background: var(--color-primary);
  color: #fff;
}
.custom-emoji-input {
  width: 88px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--color-border-2);
  border-radius: 8px;
  background: var(--color-fill-2);
  font-size: 12px;
  text-align: center;
}
.custom-emoji-input:focus {
  border-color: var(--color-primary);
  outline: 0;
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(46px, 1fr));
  gap: 8px;
}
.emoji-cell {
  height: 44px;
  border-radius: 10px;
  border: 1.5px solid transparent;
  background: var(--color-fill-1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  transition: transform .12s ease, border-color .14s ease, background .14s ease;
}
.emoji-cell:hover {
  transform: scale(1.06);
  background: var(--color-fill-2);
}
.emoji-cell.active {
  border-color: var(--color-primary);
  background: var(--color-primary-light-1);
}
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
  gap: 10px;
}
.image-cell {
  padding: 4px;
  border-radius: 50%;
  border: 2px solid transparent;
  aspect-ratio: 1;
  transition: transform .12s ease, border-color .14s ease;
}
.image-cell img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}
.image-cell:hover {
  transform: scale(1.05);
}
.image-cell.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-light-1);
}
.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
  gap: 8px;
  max-height: 210px;
  overflow-y: auto;
  padding: 2px;
}
.icon-cell {
  padding: 3px;
  border-radius: 50%;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .12s ease, border-color .14s ease;
}
.icon-cell:hover {
  transform: scale(1.06);
}
.icon-cell.active {
  border-color: var(--color-primary);
}
.icon-badge {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-badge .icon {
  font-size: 18px;
}
.text-panel {
  padding: 8px 0;
}
.text-label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.text-label span {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
}
.text-label input {
  width: 220px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-border-2);
  border-radius: 10px;
  background: var(--color-fill-2);
  font-size: 15px;
}
.text-label input:focus {
  border-color: var(--color-primary);
  outline: 0;
}
.panel-tip {
  font-size: 12px;
  color: var(--color-text-3);
  line-height: 1.5;
}
.sr-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.dropzone {
  padding: 26px 18px;
  border: 1.5px dashed var(--color-border-2);
  border-radius: 12px;
  background: var(--color-fill-1);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease;
}
.dropzone:hover,
.dropzone.is-dragover {
  border-color: var(--color-primary);
  background: var(--color-primary-light-1);
}
.drop-icon {
  font-size: 28px;
  line-height: 1;
}
.dropzone strong {
  font-size: 13px;
  color: var(--color-text-1);
}
.dropzone small {
  font-size: 12px;
  color: var(--color-text-3);
  line-height: 1.5;
}
.upload-error {
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(217, 75, 64, 0.12);
  color: #d94b40;
  font-size: 12px;
}
.palette-bar {
  padding-top: 10px;
  border-top: 1px solid var(--color-border-2);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.palette-label {
  font-size: 12px;
  color: var(--color-text-3);
  flex: 0 0 auto;
}
.palette-dots {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.swatch-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  transition: transform .12s ease, box-shadow .14s ease;
}
.swatch-dot:hover {
  transform: scale(1.12);
}
.swatch-dot.active {
  box-shadow: 0 0 0 2px var(--color-bg-3), 0 0 0 4px var(--color-primary);
}
.picker-footer {
  padding: 12px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid var(--color-border-2);
  flex: 0 0 auto;
}
.picker-footer button {
  height: 32px;
  padding: 0 16px;
  border-radius: 10px;
  background: var(--color-fill-2);
  color: var(--color-text-2);
  font-size: 13px;
  transition: background .14s ease, filter .14s ease;
}
.picker-footer button:hover {
  background: var(--color-fill-3);
}
.picker-footer button.primary {
  background: var(--color-primary);
  color: #fff;
}
.picker-footer button.primary:hover {
  filter: brightness(1.06);
}
</style>
