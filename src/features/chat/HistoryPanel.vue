<script setup lang="ts">
import { computed, ref } from 'vue';
import { useChatStore } from '../../stores/chat.js';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import AgentAvatar from '../agents/AgentAvatar.vue';
import { historyMatcher } from '../search/search.js';
import type { History } from '../../types.ts';

const store = useChatStore();
const confirmDialog = ref();
const query = ref('');
const tab = ref('history');

function formatTokens(count: number): string {
  if (count >= 10000) return `${(count / 1000).toFixed(0)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

const filtered = computed(() => {
  // 搜索词解析一次就够，不必每条话题都重新归一化、切分
  const matches = historyMatcher(query.value);
  return store.agentHistories.value
    .filter((history) => (tab.value === 'history' ? !history.isFavorite : history.isFavorite) && matches(history))
    // Token 数在落盘时就算好了，列表不必再把正文翻一遍
    .map((history) => ({ history, tokens: history.tokens || 0 }));
});

const totalTokens = computed(() => filtered.value.reduce((sum, item) => sum + item.tokens, 0));

function formatDate(value: string | undefined): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return value || '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function deleteSelectedHistory(history: History) {
  if (await confirmDialog.value.open({ title: '删除话题', message: '确定删除这条话题吗？', confirmText: '删除' })) store.deleteHistory(history);
}

async function clearHistories() {
  if (!filtered.value.length || !await confirmDialog.value.open({ title: '清空话题', message: '确定清空全部话题吗？', confirmText: '清空' })) return;
  for (const item of [...filtered.value]) store.deleteHistory(item.history);
}
</script>

<template>
  <div class="history-mask" role="presentation" tabindex="-1" @mousedown.self="store.state.historyOpen = false" @keydown.esc="store.state.historyOpen = false">
    <section class="history-panel" role="dialog" aria-modal="true" aria-label="话题记录">
      <header>
        <div class="history-identity">
          <AgentAvatar :agent="store.state.currentAgent" :size="42" />
          <span class="history-copy">
            <b>{{ store.state.currentAgent?.nickname || '小助理' }}</b>
            <small>
              {{ tab === 'history' ? `最近60#话题 (${filtered.length}条)` : `已收藏话题 (${filtered.length}条)` }}
              <template v-if="totalTokens"> · 共 {{ formatTokens(totalTokens) }} tokens</template>
            </small>
          </span>
          <button v-if="tab === 'history' && filtered.length" class="clear-button" type="button" @click="clearHistories">清空话题</button>
          <button class="history-close" type="button" title="关闭话题记录" aria-label="关闭话题记录" @click="store.state.historyOpen = false"><i class="iconfont icon-close" aria-hidden="true"></i></button>
        </div>
        <label class="history-search">
          <i class="iconfont icon-search" aria-hidden="true"></i>
          <input v-model="query" type="search" placeholder="搜索历史话题" aria-label="搜索历史话题">
        </label>
      </header>

      <nav class="history-tabs" aria-label="话题分类">
        <button type="button" :class="{ active: tab === 'history' }" @click="tab = 'history'">历史话题</button>
        <button type="button" :class="{ active: tab === 'favorite' }" @click="tab = 'favorite'">收藏的话题</button>
      </nav>

      <div class="history-list">
        <article v-for="{ history, tokens } in filtered" :key="history._id" tabindex="0" @click="store.openHistory(history)" @keydown.enter="store.openHistory(history)">
          <div class="history-row">
            <i class="iconfont icon-chat history-chat" aria-hidden="true"></i>
            <b>{{ history.title || '无标题' }}</b>
            <div class="history-actions">
              <button type="button" :title="history.isFavorite ? '取消收藏' : '收藏'" @click.stop="store.toggleFavorite(history)">
                <i class="iconfont" :class="history.isFavorite ? 'icon-stars-fill' : 'icon-stars'" aria-hidden="true"></i>
              </button>
              <button type="button" title="删除话题" @click.stop="deleteSelectedHistory(history)">
                <i class="iconfont icon-delete" aria-hidden="true"></i>
              </button>
            </div>
            <i class="iconfont icon-arrow-right history-arrow" aria-hidden="true"></i>
          </div>
          <small>
            {{ formatDate(history.createdDate) }}
            <span class="history-tokens" :title="`约 ${tokens.toLocaleString()} tokens`">{{ formatTokens(tokens) }} tokens</span>
          </small>
        </article>
        <div v-if="!filtered.length" class="history-empty">
          <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="m24 4 16 9v21l-16 10L8 34V13zM8 13l16 10 16-10M24 23v21" stroke="currentColor" stroke-width="2"></path></svg>
          <span>没有记录</span>
        </div>
      </div>
    </section>
    <ConfirmDialog ref="confirmDialog" />
  </div>
</template>

<style scoped>
.history-mask { position: fixed; z-index: 100; inset: 0; display: flex; justify-content: flex-end; background: rgba(29, 33, 41, .6); }
.history-panel { width: min(360px, 100vw); height: 100%; display: flex; flex-direction: column; overflow: hidden; color: var(--color-text-2); background: var(--color-bg-2); box-shadow: -4px 0 12px #00000014; }
header { padding: 11px 16px 8px; flex: 0 0 auto; }
.history-identity { min-height: 42px; display: flex; align-items: center; }
.history-copy { min-width: 0; margin-left: 12px; display: flex; flex: 1; flex-direction: column; }
.history-identity b { overflow: hidden; color: var(--color-text-1); font-size: 15px; font-weight: 500; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.history-identity small { color: var(--color-text-3); font-size: 12px; line-height: 18px; }
.clear-button { margin-left: auto; padding: 5px 9px; flex: 0 0 auto; border-radius: 3px; color: var(--color-text-2); font-size: 12px; background: var(--color-fill-2); }
.history-close { width: 28px; height: 28px; margin-left: 8px; flex: 0 0 28px; border-radius: 50%; color: var(--color-icon); }
.history-close:hover { color: var(--color-primary); background: var(--color-fill-2); }
.clear-button:hover { color: var(--color-primary); background: var(--color-fill-3); }
.history-search { position: relative; height: 32px; margin-top: 17px; display: block; }
.history-search i { position: absolute; top: 8px; left: 13px; color: var(--color-icon); font-size: 14px; }
.history-search input { width: 100%; height: 32px; padding: 0 13px 0 36px; border: 1px solid var(--color-border-2); border-radius: 16px; outline: none; color: var(--color-text-2); background: transparent; box-shadow: 0 2px 5px #0000000f; }
.history-search input:focus { border-color: var(--color-primary); }
.history-tabs { height: 42px; padding: 0 16px; display: flex; flex: 0 0 42px; gap: 32px; border-bottom: 1px solid var(--color-border-2); }
.history-tabs button { position: relative; height: 42px; color: var(--color-text-1); font-size: 14px; }
.history-tabs button.active { color: var(--color-primary); }
.history-tabs button.active::after { content: ""; position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--color-primary); }
.history-list { flex: 1; padding: 0 12px 12px; overflow-y: auto; }
article { height: 71px; padding: 12px 16px; overflow: hidden; border-radius: 3px; cursor: pointer; content-visibility: auto; contain-intrinsic-height: 71px; }
article:hover, article:focus-visible { outline: 0; background: var(--color-fill-1); }
.history-row { height: 22px; display: flex; align-items: center; }
.history-chat { margin-right: 8px; color: var(--color-icon); }
.history-row b { min-width: 0; flex: 1; overflow: hidden; color: var(--color-text-1); font-size: 14px; font-weight: 500; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
article > small { display: flex; align-items: center; gap: 8px; margin-top: 3px; color: var(--color-text-3); font-size: 12px; line-height: 18px; }
.history-tokens { padding: 0 6px; border-radius: 9px; background: var(--color-fill-2); font-variant-numeric: tabular-nums; }
.history-actions { display: none; align-items: center; flex: 0 0 auto; }
.history-actions button { width: 28px; height: 28px; color: var(--color-icon); }
.history-actions button:hover { color: var(--color-primary); }
.history-arrow { width: 18px; margin-left: 8px; color: var(--color-text-2); font-size: 14px; text-align: center; }
article:hover .history-actions, article:focus-within .history-actions { display: flex; }
article:hover .history-arrow, article:focus-within .history-arrow { display: none; }
.history-empty { padding-top: 38px; display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--color-text-3); }
.history-empty svg { width: 50px; height: 50px; color: #c9cdd4; }
.history-empty span { font-size: 13px; }
.history-drawer-enter-active, .history-drawer-leave-active { transition: background-color 250ms cubic-bezier(.22, 1, .36, 1); }
.history-drawer-enter-active .history-panel, .history-drawer-leave-active .history-panel { transition: transform 250ms cubic-bezier(.22, 1, .36, 1); will-change: transform; }
.history-drawer-enter-from, .history-drawer-leave-to { background-color: #17171a00; }
.history-drawer-enter-from .history-panel, .history-drawer-leave-to .history-panel { transform: translateX(100%); }
@media (prefers-reduced-motion: reduce) {
  .history-drawer-enter-active, .history-drawer-leave-active, .history-drawer-enter-active .history-panel, .history-drawer-leave-active .history-panel { transition: none !important; }
}
</style>
