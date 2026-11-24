<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import type { AgentAvatar } from '../../types.ts';
import { resolveAvatarImageUrl } from './avatar-presets.ts';

// 头像既要画好友文档，也要画市场里还没落盘的角色，所以只认 nickname + avatar 两个字段。
type AvatarOwner = { nickname?: string; avatar?: AgentAvatar };

const props = defineProps({
  agent: { type: Object as PropType<AvatarOwner | null>, required: true },
  size: { type: Number, default: 36 },
});

const avatar = computed<AgentAvatar>(() => props.agent?.avatar || {});

const imageUrl = computed(() => (avatar.value.type === 'image' ? resolveAvatarImageUrl(avatar.value.image) : ''));
const isEmoji = computed(() => avatar.value.type === 'emoji' && Boolean(avatar.value.emoji));
// types.ts 一直声明了 text 型头像，种子数据里也有，但以前没有对应分支，这些好友会静默退化成
// 通用的 icon-a1。最多取两个字——「医生」这类两字昵称在 36px 的圆里也还排得下。
const label = computed(() => (avatar.value.type === 'text' ? String(avatar.value.text || '').slice(0, 2) : ''));
const iconSize = computed(() => props.size === 26 ? 16 : props.size / 2 + 4);
// emoji 字形本身自带留白，比线性图标要略大才视觉等重
const emojiSize = computed(() => Math.round(props.size * 0.56));
const labelSize = computed(() => Math.round(props.size * (label.value.length > 1 ? 0.34 : 0.46)));
const iconName = computed(() => avatar.value.icon || 'icon-a1');

// gradient 为两色数组时走渐变，否则退回单色 color，两者都缺则用默认绿
const background = computed(() => {
  const gradient = avatar.value.gradient;
  if (Array.isArray(gradient) && gradient.length >= 2) {
    return `linear-gradient(135deg, ${gradient[0]} 0%, ${gradient[1]} 100%)`;
  }
  return avatar.value.color || '#0ca47f';
});

const failed = ref(false);
watch(imageUrl, () => {
  failed.value = false;
});
</script>

<template>
  <span
    class="agent-avatar"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      background,
      '--avatar-icon-size': `${iconSize}px`,
      '--avatar-emoji-size': `${emojiSize}px`,
      '--avatar-label-size': `${labelSize}px`,
    }"
  >
    <img v-if="imageUrl && !failed" :src="imageUrl" :alt="agent?.nickname" @error="failed = true">
    <span v-else-if="isEmoji" class="emoji" role="img" :aria-label="agent?.nickname">{{ avatar.emoji }}</span>
    <span v-else-if="label" class="label" aria-hidden="true">{{ label }}</span>
    <i v-else class="icon" :class="iconName" aria-hidden="true"></i>
  </span>
</template>

<style scoped>
.agent-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  color: #fff;
  box-shadow: var(--avatar-ring);
}
.agent-avatar img { width: 100%; height: 100%; object-fit: cover; }
.agent-avatar .icon { font-size: var(--avatar-icon-size); font-weight: 500; line-height: 1; }
.agent-avatar .label { font-size: var(--avatar-label-size); font-weight: 500; line-height: 1; user-select: none; }
.agent-avatar .emoji {
  font-size: var(--avatar-emoji-size);
  line-height: 1;
  /* 彩色 emoji 字体优先，避免部分 Linux 环境回退成单色轮廓 */
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  user-select: none;
}
</style>
