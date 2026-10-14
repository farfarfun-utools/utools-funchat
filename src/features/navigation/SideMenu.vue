<script setup lang="ts">
import { ref } from 'vue';
import { useDismissable } from '../../composables/use-dismissable.js';
import { host } from '../../services/utools.js';
import { useChatStore } from '../../stores/chat.js';
import type { ThemePreference } from '../../types.ts';

defineProps({ active: { type: String, required: true } });
const emit = defineEmits(['navigate']);
const user = host.getUser?.() || { nickname: '用户', avatar: '' };
const fallbackAvatar = `${import.meta.env.BASE_URL}user-avatar.jpg`;
const store = useChatStore();
const themeOpen = ref(false);
const themeAnchor = ref();

const topItems = [
  { id: 'chat', icon: 'icon-msg', label: 'AI 对话' },
  { id: 'prompts', icon: 'icon-bot', label: 'AI 市场' },
];

const themes: { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'light', label: '浅色主题', icon: 'icon-light' },
  { value: 'dark', label: '深色主题', icon: 'icon-dark' },
  { value: 'system', label: '跟随系统', icon: 'icon-system' },
];

function setTheme(theme: ThemePreference) {
  store.updateSettings({ theme });
  themeOpen.value = false;
}

useDismissable(themeAnchor, () => themeOpen.value, () => { themeOpen.value = false; });
</script>

<template>
  <aside class="side-menu" aria-label="主导航">
    <div class="menu-start">
      <span class="user-avatar" :title="user.nickname">
        <img :src="user.avatar || fallbackAvatar" :alt="user.nickname">
      </span>
      <nav>
        <button v-for="item in topItems" :key="item.id" type="button" :class="{ active: active === item.id }"
          :title="item.label" :aria-label="item.label" @click="emit('navigate', item.id)">
          <i class="iconfont" :class="item.icon" aria-hidden="true"></i>
        </button>
      </nav>
    </div>
    <nav class="menu-mid">
      <button type="button" :class="{ active: active === 'notify' }" title="系统通知" aria-label="系统通知"
        @click="emit('navigate', 'notify')">
        <i class="iconfont icon-notice" aria-hidden="true"></i>
      </button>
    </nav>
    <nav class="menu-end">
      <button type="button" :class="{ active: active === 'settings' }" title="更多设置" aria-label="更多设置"
        @click="emit('navigate', 'settings')">
        <i class="iconfont icon-setting" aria-hidden="true"></i>
      </button>
      <div ref="themeAnchor" class="theme-anchor">
        <button type="button" title="主题" aria-label="主题" :aria-expanded="themeOpen" data-step="btheme" @click="themeOpen = !themeOpen">
          <i class="iconfont" :class="themes.find((item) => item.value === store.state.settings.theme)?.icon || 'icon-system'" aria-hidden="true"></i>
        </button>
        <div v-if="themeOpen" class="theme-menu" role="menu">
          <button v-for="item in themes" :key="item.value" type="button" role="menuitemradio"
            :aria-checked="store.state.settings.theme === item.value" :class="{ active: store.state.settings.theme === item.value }" @click="setTheme(item.value)">
            <i class="iconfont" :class="item.icon" aria-hidden="true"></i><span>{{ item.label }}</span>
          </button>
        </div>
      </div>
      <button type="button" :class="{ active: active === 'help' }" title="帮助中心" aria-label="帮助中心"
        @click="emit('navigate', 'help')">
        <i class="iconfont icon-help" aria-hidden="true"></i>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.side-menu {
  width: 52px;
  height: 100%;
  flex: 0 0 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  background: var(--color-bg-3);
  border-right: 1px solid var(--color-border-2);
}
.menu-start, .menu-mid, .menu-end, nav { display: flex; flex-direction: column; align-items: center; }
.menu-start nav { gap: 20px; margin-top: 32px; }
.menu-mid, .menu-end { gap: 16px; }
.theme-anchor { position: relative; width: 36px; height: 36px; }
button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: var(--color-icon);
  background: transparent;
  transition: background .15s ease, color .15s ease;
}
button:hover { background: var(--color-fill-2); color: var(--color-text-1); }
button.active { color: var(--color-primary); background: var(--color-primary-light-1); }
button .iconfont { font-size: 22px; line-height: 1.15; }
.user-avatar {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  color: #fff;
  background: var(--color-fill-2);
}
.user-avatar img { width: 100%; height: 100%; object-fit: cover; }
.theme-menu { position: absolute; z-index: 120; bottom: 40px; left: -7.5px; width: 120px; padding: 6px; border: 1px solid var(--color-border-2); border-radius: 4px; background: var(--color-bg-2); box-shadow: 0 4px 10px #0000001a; }
.theme-menu button { width: 106px; height: 36px; padding: 0 12px; display: flex; grid: none; align-items: center; justify-content: flex-start; gap: 8px; border-radius: 3px; color: var(--color-text-2); font-size: 14px; white-space: nowrap; }
.theme-menu button.active { color: var(--color-text-2); background: var(--color-primary-light-1); }
.theme-menu button .iconfont { width: 16px; color: var(--color-icon); font-size: 16px; }
</style>
