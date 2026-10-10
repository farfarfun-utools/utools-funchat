<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { filterHistoryRecords } from '../search/search.js';
import { useChatStore } from '../../stores/chat.js';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import AgentAvatar from './AgentAvatar.vue';
import AgentDialog from './AgentDialog.vue';
import type { Agent, History } from '../../types.ts';

const store = useChatStore();
const query = ref('');
const agentDialog = ref();
const confirmDialog = ref();
const menuElement = ref();
const contextMenu = reactive<{ open: boolean; x: number; y: number; agent: Agent | null }>({ open: false, x: 0, y: 0, agent: null });

const filteredAgents = computed(() => {
  const value = query.value.trim().toLocaleLowerCase('zh-CN');
  if (!value) return store.state.agents;
  return store.state.agents.filter((agent) => `${agent.nickname} ${agent.info || ''}`.toLocaleLowerCase('zh-CN').includes(value));
});
const historyResults = computed(() => filterHistoryRecords(store.state.histories, query.value, 12));

function selectAgent(agent: Agent) {
  store.selectAgent(agent);
  query.value = '';
}

function selectHistory(history: History) {
  store.openHistory(history);
  query.value = '';
}

async function deleteSelectedAgent(agent: Agent) {
  if (await confirmDialog.value.open({ title: '删除好友', message: `确定删除好友【${agent.nickname}】吗？`, confirmText: '删除' })) store.deleteAgent(agent);
}

function openContextMenu(event: MouseEvent, agent: Agent) {
  contextMenu.agent = agent;
  contextMenu.x = Math.max(4, Math.min(event.clientX - 59, window.innerWidth - 122));
  contextMenu.y = Math.max(4, Math.min(event.clientY + 4, window.innerHeight - 162));
  contextMenu.open = true;
}

function closeContextMenu(event: Event) {
  if (!menuElement.value?.contains(event.target as Node)) contextMenu.open = false;
}

function editAgent() {
  const agent = contextMenu.agent;
  contextMenu.open = false;
  agentDialog.value.open(agent);
}

function togglePin() {
  if (contextMenu.agent) store.togglePin(contextMenu.agent);
  contextMenu.open = false;
}

function deleteFromMenu() {
  const agent = contextMenu.agent;
  contextMenu.open = false;
  if (agent) deleteSelectedAgent(agent);
}

// 关掉右键菜单就算消费掉这次 Esc：App 那层的 Esc 是「退出插件」，一次按键只剥一层
function closeOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !contextMenu.open) return;
  event.preventDefault();
  contextMenu.open = false;
}

onMounted(() => {
  document.addEventListener('pointerdown', closeContextMenu);
  document.addEventListener('keydown', closeOnEscape);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeContextMenu);
  document.removeEventListener('keydown', closeOnEscape);
});
</script>

<template>
  <aside class="agent-list" :class="{ collapsed: store.state.sidebarCollapsed }" aria-label="好友列表">
    <div class="agent-toolbar">
      <label v-if="!store.state.sidebarCollapsed" class="search-box">
        <i class="iconfont icon-search" aria-hidden="true"></i>
        <input v-model="query" type="search" placeholder="搜索好友" aria-label="搜索好友或历史话题">
      </label>
      <button class="add-button" type="button" title="创建好友" aria-label="创建好友" @click="agentDialog.open()">
        <i class="iconfont icon-add" aria-hidden="true"></i>
      </button>
    </div>

    <div v-if="query && !store.state.sidebarCollapsed" class="search-results">
      <template v-if="filteredAgents.length">
        <strong>好友 {{ filteredAgents.length }}</strong>
        <button v-for="agent in filteredAgents.slice(0, 10)" :key="agent._id" type="button" @click="selectAgent(agent)">
          <AgentAvatar :agent="agent" :size="30" />
          <span><b>{{ agent.nickname }}</b><small>{{ agent.info }}</small></span>
        </button>
      </template>
      <template v-if="historyResults.length">
        <strong>历史话题 {{ historyResults.length }}</strong>
        <button v-for="history in historyResults" :key="history._id" type="button" @click="selectHistory(history)">
          <i class="iconfont icon-chat" aria-hidden="true"></i>
          <span><b>{{ history.title || '无标题' }}</b><small>{{ store.state.agents.find(item => item._id === history.agentId)?.nickname }}</small></span>
        </button>
      </template>
      <p v-if="!filteredAgents.length && !historyResults.length">没有匹配的好友或历史话题</p>
    </div>

    <div v-if="!store.state.sidebarCollapsed" class="group-tabs">
      <button type="button" class="active"><span>默认</span></button>
    </div>
    <div class="agents-scroll">
      <article v-for="agent in filteredAgents" :key="agent._id" class="agent-item"
        :class="{ active: store.state.currentAgent?._id === agent._id }" @click="selectAgent(agent)" @contextmenu.prevent="openContextMenu($event, agent)">
        <AgentAvatar :agent="agent" :size="36" />
        <div v-if="!store.state.sidebarCollapsed" class="agent-copy">
          <b>{{ agent.nickname }}</b>
          <small><svg v-if="agent.is_top" class="pin-marker" width="14" height="14" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <path d="M24.0083 12.1006V36.0001" stroke="var(--color-icon)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M12 24L24 12L36 24" stroke="var(--color-icon)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>{{ agent.info }}</small>
        </div>
      </article>
      <p v-if="!filteredAgents.length" class="empty">查无此人</p>
    </div>
    <button class="collapse-button" type="button" :title="store.state.sidebarCollapsed ? '展开好友栏' : '收起好友栏'"
      @click="store.state.sidebarCollapsed = !store.state.sidebarCollapsed">
      <span aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="butt" stroke-linejoin="miter"
        :class="{ expanded: store.state.sidebarCollapsed }"><path d="M32 8.4 16.444 23.956 32 39.513"></path></svg></span>
    </button>
  </aside>

  <AgentDialog ref="agentDialog" />
  <ConfirmDialog ref="confirmDialog" />

  <Teleport to="body">
    <div v-if="contextMenu.open" ref="menuElement" class="agent-context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" role="menu" @contextmenu.prevent>
      <button type="button" role="menuitem" @click="togglePin">
        <svg v-if="contextMenu.agent?.is_top" width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24.0083 33.8995V6" stroke="var(--color-icon)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path><path d="M36 22L24 34L12 22" stroke="var(--color-icon)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path><path d="M36 42H12" stroke="var(--color-icon)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        <svg v-else width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 14V42" stroke="var(--color-icon)" stroke-width="3" stroke-linecap="round"></path><path d="M12 26L24 14L36 26" stroke="var(--color-icon)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 6H36" stroke="var(--color-icon)" stroke-width="3" stroke-linecap="round"></path></svg>
        {{ contextMenu.agent?.is_top ? '取消置顶' : '置顶' }}
      </button>
      <button type="button" role="menuitem" @click="editAgent"><svg width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="11" r="7" stroke="var(--color-icon)" stroke-width="3"></circle><path d="M4 41C4 32.1634 12.0589 25 22 25" stroke="var(--color-icon)" stroke-width="3" stroke-linecap="round"></path><path d="M31 42L41 32L37 28L27 38V42H31Z" stroke="var(--color-icon)" stroke-width="3" stroke-linejoin="round"></path></svg>编辑</button>
      <button type="button" role="menuitem" :disabled="contextMenu.agent?._id === 'ai@0000000000001'" @click="deleteFromMenu"><svg width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M19 20C22.866 20 26 16.866 26 13S22.866 6 19 6 12 9.134 12 13s3.134 7 7 7Z" stroke="var(--color-icon)" stroke-width="3"></path><path d="M33 31L41 39M33 39L41 31" stroke="var(--color-icon)" stroke-width="3" stroke-linecap="round"></path><path d="M27 28H18.8C9.2 28 6 31.2 6 40.8V42H27" stroke="var(--color-icon)" stroke-width="3" stroke-linecap="round"></path></svg>删除</button>
    </div>
  </Teleport>
</template>

<style scoped>
.agent-list {
  position: relative;
  width: 200px;
  height: 100%;
  flex: 0 0 200px;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-3);
  border-right: 1px solid var(--color-border-2);
  transition: width .2s ease, flex-basis .2s ease;
}
.agent-list.collapsed { width: 65px; flex-basis: 65px; }
.agent-toolbar { height: 56px; padding: 12px 14px; display: flex; flex: 0 0 56px; align-items: center; gap: 8px; }
.search-box { position: relative; height: 32px; flex: 1; min-width: 0; border-radius: 16px; background: var(--color-fill-2); }
.search-box i { position: absolute; left: 13px; top: 4px; color: var(--color-icon); line-height: 24px; }
.search-box input {
  width: 100%; height: 32px; padding: 0 10px 0 36px; border: 1px solid transparent; border-radius: 16px;
  outline: none; color: var(--color-text-2); background: transparent;
}
.search-box input:focus { border-color: rgba(12, 164, 127, .55); background: var(--color-bg-2); }
.add-button { width: 36px; height: 32px; flex: 0 0 36px; border-radius: 12px; color: #ff7d00; background: #fff7e8; }
.add-button i { display: block; font-size: 14px; line-height: 1.5715; }
.add-button:hover { background: #ffefd0; }
:global(body.dark) .add-button { color: #ff9626; background: rgba(255, 150, 38, .2); }
.collapsed .agent-toolbar { justify-content: center; padding: 12px 14px; }
.group-tabs { height: 37.84375px; padding: 0 13px; flex: 0 0 37.84375px; border-top: 1px solid var(--color-border-2); border-bottom: 1px solid var(--color-border-2); }
.group-tabs button { position: relative; height: 36.84375px; padding: 8px 0; display: inline-flex; color: var(--color-primary); font-size: 12px; font-weight: 500; line-height: 1.5715; }
.group-tabs button::after { content: ""; position: absolute; right: 0; bottom: 0; left: 0; height: 2px; background: var(--color-primary); }
.group-tabs button span { display: block; padding: 1px 0; line-height: 1.5715; will-change: transform; }
.agents-scroll { flex: 1; margin-bottom: 3px; overflow-y: auto; }
.agents-scroll { scrollbar-width: none; }
.agents-scroll::-webkit-scrollbar { width: 0; height: 0; }
.agent-item { position: relative; height: 60px; padding: 0 16px; display: flex; align-items: center; cursor: pointer; transition: background .15s ease; }
.agent-item:hover, .agent-item.active { background: var(--color-fill-2); }
.agent-copy { min-width: 0; margin-left: 12px; display: flex; flex: 1; flex-direction: column; }
.agent-copy b { overflow: hidden; font-size: 13px; font-weight: 500; line-height: 1.5715; color: var(--color-text-2); text-overflow: ellipsis; white-space: nowrap; }
.agent-copy small { overflow: hidden; display: flex; align-items: center; color: var(--color-text-3); font-size: 12px; line-height: 1.5715; text-overflow: ellipsis; white-space: nowrap; }
.pin-marker { width: 14px; height: 14px; margin-right: 1px; flex: 0 0 14px; }
.collapsed .agent-item { justify-content: center; padding: 0; }
.empty { padding: 30px 10px; text-align: center; color: var(--color-text-3); }
.collapse-button { width: calc(100% + 1px); height: 48px; display: flex; flex: 0 0 48px; align-items: center; justify-content: center; color: var(--color-text-1); background: var(--color-bg-3); border-right: 1px solid var(--color-border-2); }
.collapse-button span { width: 14px; height: 16.09375px; }
.collapse-button svg { width: 14px; height: 14px; display: inline-block; vertical-align: middle; }
.collapse-button svg.expanded { transform: rotate(180deg); }
.collapse-button:hover { color: var(--color-primary); background: var(--color-fill-1); }
.search-results {
  position: absolute; z-index: 20; top: 50px; left: 10px; right: 10px; max-height: calc(100vh - 74px); padding: 8px;
  overflow-y: auto; border: 1px solid var(--color-border-2); border-radius: 6px; background: var(--color-bg-2); box-shadow: 0 8px 24px #0002;
}
.search-results strong { display: block; padding: 7px 8px 4px; font-size: 11px; color: var(--color-text-3); }
.search-results button { width: 100%; padding: 8px; display: flex; align-items: center; gap: 10px; border-radius: 4px; text-align: left; }
.search-results button:hover { background: var(--color-fill-2); }
.search-results button > i { width: 30px; text-align: center; color: var(--color-primary); }
.search-results span { min-width: 0; display: flex; flex-direction: column; }
.search-results b, .search-results small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-results b { color: var(--color-text-1); font-size: 13px; font-weight: 500; }
.search-results small, .search-results p { color: var(--color-text-3); font-size: 11px; }
.search-results p { padding: 20px 8px; text-align: center; }
</style>

<style>
.agent-context-menu { position: fixed; z-index: 300; width: 118px; height: 158px; padding: 6px; border: 1px solid var(--color-border-2); border-radius: 4px; color: var(--color-text-2); background: var(--color-bg-2); box-shadow: 0 4px 10px #0000001a; }
.agent-context-menu button { width: 104px; height: 36px; padding: 0 12px; display: flex; align-items: center; gap: 8px; border-radius: 3px; color: var(--color-text-2); text-align: left; white-space: nowrap; }
.agent-context-menu button:hover { background: var(--color-fill-2); }
.agent-context-menu button:disabled { color: #c9cdd4; }
.agent-context-menu button svg { width: 16px; height: 16px; flex: 0 0 16px; }
.agent-context-menu button:disabled svg { opacity: .45; }
</style>
