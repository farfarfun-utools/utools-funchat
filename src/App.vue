<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import AgentList from './features/agents/AgentList.vue';
import ChatView from './features/chat/ChatView.vue';
import FeatureView from './features/navigation/FeatureView.vue';
import SideMenu from './features/navigation/SideMenu.vue';
import SettingsView from './features/settings/SettingsView.vue';
import { useChatStore } from './stores/chat.js';
import { host } from './services/utools.js';

const store = useChatStore();
const logoUrl = `${import.meta.env.BASE_URL}logo.png`;
const compactWindow = globalThis.matchMedia?.('(max-width: 720px)');

function fitSidebar() {
  if (compactWindow?.matches) store.state.sidebarCollapsed = true;
}

// Esc 逐层后退，最后一层才退出插件。上面每一层浮层（输入框的浮层、导出菜单、好友右键菜单）
// 自己接住 Esc 后都会 preventDefault，所以到这里的一定是「没有浮层可关了」。
// 原生 dialog 由浏览器自己处理 Esc，函数开头的 dialog[open] 判断已经把它们拦在外面。
function escapeBack(): void {
  if (store.state.historyOpen) {
    store.state.historyOpen = false;
    return;
  }
  if (store.state.view !== 'chat') {
    store.state.view = 'chat';
    return;
  }
  // 退出插件在 uTools 里默认是转后台，下次进来还是这个会话。
  // 生成中的回复由 onPluginOut 落盘（见 stores/chat.ts），不会因为这一下丢掉。
  host.outPlugin?.();
}

function handleShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || document.querySelector('dialog[open]')) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (event.key === 'Escape' && !modifier && !event.shiftKey) {
    event.preventDefault();
    escapeBack();
    return;
  }
  if (modifier && !event.shiftKey) {
    const actions: Record<string, () => void> = {
      n: () => store.newConversation(),
      b: () => { store.state.sidebarCollapsed = !store.state.sidebarCollapsed; },
      h: () => { store.state.historyOpen = !store.state.historyOpen; },
    };
    const action = actions[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    store.state.view = 'chat';
    action();
    return;
  }
  if (event.shiftKey && !modifier && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    store.cycleAgent(event.key === 'ArrowUp' ? -1 : 1);
  }
}

// 流式回复期间会话还没落盘（persistCurrentConversation 要等流结束才调用），
// 此时关掉窗口整轮问答都会丢，所以卸载前补存一次。pagehide 在 Electron 关窗时会触发。
function persistBeforeUnload() {
  store.persistCurrentConversation();
}

onMounted(async () => {
  fitSidebar();
  compactWindow?.addEventListener('change', fitSidebar);
  document.addEventListener('keydown', handleShortcut);
  window.addEventListener('pagehide', persistBeforeUnload);
  try {
    await store.init();
  } catch (error) {
    store.state.error = error instanceof Error ? error.message : String(error);
    store.state.ready = true;
  }
});
onBeforeUnmount(() => {
  compactWindow?.removeEventListener('change', fitSidebar);
  document.removeEventListener('keydown', handleShortcut);
  window.removeEventListener('pagehide', persistBeforeUnload);
});
</script>

<template>
  <div v-if="!store.state.ready" class="app-loading"><img :src="logoUrl" alt=""><span>言来语往</span></div>
  <div v-else class="app-shell">
    <div v-if="store.state.error && !store.state.agents.length" class="fatal-error" role="alert">{{ store.state.error }}</div>
    <SideMenu :active="store.state.view" @navigate="store.state.view = $event" />
    <Transition name="page" mode="out-in">
      <div class="view-pane" :key="store.state.view">
        <template v-if="store.state.view === 'chat'">
          <AgentList />
          <ChatView />
        </template>
        <SettingsView v-else-if="store.state.view === 'settings'" />
        <FeatureView v-else :view="store.state.view" />
      </div>
    </Transition>
  </div>
</template>
