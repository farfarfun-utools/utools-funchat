<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import AgentAvatar from '../agents/AgentAvatar.vue';
import { useChatStore } from '../../stores/chat.js';
import ChatComposer from './ChatComposer.vue';
import ChatExportMenu from './ChatExportMenu.vue';
import HistoryPanel from './HistoryPanel.vue';
import ImageLightbox from './ImageLightbox.vue';
import MessageItem from './MessageItem.vue';
import { capturing } from './message-tools.js';

const store = useChatStore();
const scroll = ref();
const content = ref();
const greeting = computed(() => ({ role: 'assistant', content: store.state.currentAgent?.content || '' }));
const needsApiSetup = store.needsApiSetup;
const quickQuestions = computed(() => (store.state.messages.length ? [] : store.state.currentAgent?.quick_questions || []));
const apiSetup = reactive({ apiKey: store.state.settings.apiKey || '', baseUrl: store.state.settings.baseUrl || '' });
// 标题栏显示的话题名：已落盘的话题取它的标题，新话题还没有标题就先留空
const topicTitle = computed(() => store.agentHistories.value
  .find((history) => history._id === store.state.currentAgent?.chatId)?.title || '');
const headerModel = computed(() => store.activeModel.value);

const messageKeys = new WeakMap();
let messageKeySeed = 0;

function messageKey(message: unknown, index: number) {
  if (!message || typeof message !== 'object') return `${store.state.currentAgent?._id}-${index}`;
  if (!messageKeys.has(message)) messageKeys.set(message, `message-${++messageKeySeed}`);
  return messageKeys.get(message);
}

function saveApiSetup() {
  if (!apiSetup.apiKey.trim() && !apiSetup.baseUrl.trim()) return;
  // 走线路系统，否则这里存的配置在「API路线管理」里看不见
  store.saveApiRoute({
    id: '',
    name: '默认线路',
    provider: 'openai',
    apiKey: apiSetup.apiKey.trim(),
    baseUrl: apiSetup.baseUrl.trim(),
  });
}

// 距底多少像素以内仍算「贴着底」。留一点余量，避免行高抖动导致误判为用户已滚开。
const STICK_THRESHOLD = 60;
const stick = ref(true);

function atBottom() {
  const el = scroll.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
}

function onScroll() {
  stick.value = atBottom();
}

// 容器上有 scroll-behavior: smooth。程序化滚动若走平滑动画，
// 中途触发的 scroll 事件位置离底尚远，会把 stick 误判成 false 而中断跟随，
// 所以自动跟随一律用 instant；只有用户点「回到底部」才值得平滑。
function jumpToBottom(behavior = 'instant') {
  const el = scroll.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior });
  stick.value = true;
}

function scrollToBottom() {
  jumpToBottom('smooth');
}

// 跟随底部要盯容器高度，不能盯消息内容：有三种情况高度变了而数据没变——渲染是节流的，
// 最后一次尾随渲染落在数据变化之后；KaTeX 是懒加载的，到位后整条消息的公式会重排；
// 图片也是加载完才占到位置。盯 content 的那一版在每条回复收尾时都会停在离底一两行的地方。
// 顺带也省掉了每个 chunk 一次 nextTick 加一次 scrollHeight 读取。
// 只在用户贴着底时才跟随，否则他往上翻看上文会被每个新 token 拽回底部。
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (typeof ResizeObserver !== 'function' || !content.value) return;
  observer = new ResizeObserver(() => { if (stick.value) jumpToBottom(); });
  observer.observe(content.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

// 自己刚发出消息，无论此前滚到哪都回到底部
watch(() => store.state.messages.length, async (next, previous) => {
  if (next <= previous || store.state.messages.at(-1)?.role !== 'user') return;
  await nextTick();
  jumpToBottom();
});

watch(() => [store.state.currentAgent?._id, store.state.currentAgent?.chatId], async () => {
  await nextTick();
  if (scroll.value) scroll.value.scrollTop = 0;
  // 按实际位置判定：短会话本来就在底部则继续跟随，长会话停在顶部则不跟随
  stick.value = atBottom();
});

</script>

<template>
  <main class="chat-view">
    <header v-if="store.state.currentAgent" class="chat-header">
      <AgentAvatar :agent="store.state.currentAgent" :size="34" />
      <div class="header-text">
        <b>{{ store.state.currentAgent.nickname }}</b>
        <small>
          <span v-if="topicTitle" class="header-topic">{{ topicTitle }}</span>
          <span v-if="headerModel">{{ headerModel }}</span>
          <span v-if="store.tokenCount.value > 0">{{ store.tokenCount.value.toLocaleString() }} tokens</span>
        </small>
      </div>
      <div class="header-actions">
        <button type="button" title="新话题" aria-label="新话题" @click="store.newConversation">
          <i class="iconfont icon-clear" aria-hidden="true"></i>
        </button>
        <button type="button" title="话题记录" aria-label="话题记录" @click="store.state.historyOpen = true">
          <i class="iconfont icon-huati" aria-hidden="true"></i>
        </button>
        <ChatExportMenu />
      </div>
    </header>
    <!-- 包一层定位容器：输入区带图时会变高，按钮按「消息区底部」定位才不会被压住 -->
    <div class="messages-area">
      <button v-if="!stick" class="back-to-bottom" type="button" title="回到底部" @click="scrollToBottom">
        <i class="iconfont icon-down" aria-hidden="true"></i>
      </button>
      <section ref="scroll" class="messages" aria-live="polite" @scroll.passive="onScroll">
        <div ref="content" class="messages-content" :class="{ capturing }">
          <div v-if="needsApiSetup" class="api-setup-wrap">
            <form class="api-setup-card" @submit.prevent="saveApiSetup">
              <AgentAvatar class="setup-avatar" :agent="store.state.currentAgent" :size="60" />
              <h1>只差一步，<button type="button" @click="store.state.view = 'help'">点击查看解锁绑定API教程</button></h1>
              <label class="setup-field required"><span>API KEY秘钥</span><input v-model="apiSetup.apiKey" type="password" autocomplete="off" placeholder="请复制或输入KEY秘钥（令牌）"></label>
              <label class="setup-field"><span>API地址（转发API必填，官方KEY请忽略）</span><input v-model="apiSetup.baseUrl" placeholder="示例: https://api.gpt.ge"></label>
              <button class="setup-save" type="submit">保存并开始</button>
            </form>
            <div class="setup-tips"><p>1、API管理：可点击聊天窗口 <i class="iconfont icon-key" aria-hidden="true"></i> API管理按钮，进行管理-支持无限添加API。</p><p>2、免费体验：可使用客户端内置 AI，或绑定自己的API使用。</p></div>
          </div>
          <template v-else>
            <MessageItem v-if="greeting.content" :message="greeting" :agent="store.state.currentAgent" />
            <div v-if="quickQuestions.length" class="quick-questions">
              <button v-for="item in quickQuestions" :key="item" type="button" :disabled="store.state.loading" @click="store.send(item)">{{ item }}</button>
            </div>
            <MessageItem v-for="(message, index) in store.state.messages" :key="messageKey(message, index)"
              :message="message" :index="index" :agent="store.state.currentAgent" :last="index === store.state.messages.length - 1"
              :busy="store.state.loading" @delete="store.deleteMessage" @retry="store.retryMessage" />
            <div v-if="store.state.loading" class="typing" role="status"><span></span><span></span><span></span></div>
          </template>
        </div>
      </section>
    </div>
    <ChatComposer />
    <ImageLightbox />
    <Transition name="history-drawer"><HistoryPanel v-if="store.state.historyOpen" /></Transition>
  </main>
</template>

<style scoped>
.chat-view { position: relative; min-width: 0; height: 100vh; display: flex; flex: 1; flex-direction: column; background: var(--chat-bg); }
.chat-header { height: 56px; padding: 0 12px 0 16px; display: flex; flex: 0 0 56px; align-items: center; gap: 10px; border-bottom: 1px solid var(--color-border-2); background: var(--color-bg-2); }
.header-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.header-text b { color: var(--color-text-1); font-size: 14px; font-weight: 600; line-height: 1.2; }
.header-text small { display: flex; align-items: center; gap: 6px; overflow: hidden; color: var(--color-text-3); font-size: 12px; line-height: 1.2; white-space: nowrap; }
/* 话题名可能很长，让它独占伸缩空间并省略，模型名和 token 数始终可见 */
.header-text small > span { flex: 0 0 auto; }
.header-text small > .header-topic { min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; }
.header-text small > span + span::before { content: "·"; margin-right: 6px; color: var(--color-text-4, var(--color-text-3)); }
.header-actions { position: relative; margin-left: auto; display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.header-actions > button { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; color: var(--color-icon); }
.header-actions > button:hover { color: var(--color-primary); background: var(--color-fill-1); }
.header-actions .iconfont { font-size: 17px; line-height: 1; }
.messages-area { position: relative; min-height: 0; display: flex; flex: 1; }
.messages { flex: 1; overflow-y: auto; scrollbar-width: none; scroll-behavior: smooth; will-change: transform; }
.back-to-bottom { position: absolute; z-index: 20; bottom: 12px; left: 50%; width: 32px; height: 32px; display: grid; place-items: center; transform: translateX(-50%); border: 1px solid var(--color-border-2); border-radius: 50%; color: var(--color-text-2); background: var(--color-bg-2); box-shadow: 0 2px 8px #00000024; }
.back-to-bottom:hover { color: var(--color-primary); border-color: var(--color-primary); }
@media (prefers-reduced-motion: reduce) { .messages { scroll-behavior: auto; } }
.messages::-webkit-scrollbar { width: 0; }
/* 不要给会话列加宽度上限：这是双边气泡布局，头像就该贴着窗口两侧，
   居中限宽会在左右各留出一大片空白 */
.messages-content { min-height: 100%; padding-top: 20px; }
/* 几百条消息的会话里，每次滚动浏览器都要把全部气泡重新布局、重新绘制一遍——而屏幕上
   同时也就放得下三四条。content-visibility 让视口外的气泡跳过布局和绘制，DOM 还在，
   所以导出、查找、滚动位置都不受影响；contain-intrinsic-size 的 auto 会记住它上次的真实
   高度，首次用 120px 占位，滚动条长度不至于来回跳。出图时整段都要量真实布局，故除外。 */
.messages-content:not(.capturing) > :deep(.chat-box-item) { content-visibility: auto; contain-intrinsic-size: auto 120px; }
.api-setup-wrap { margin: 40px 52px 0; }
.api-setup-card { position: relative; height: 337px; padding: 110px 32px 32px; border-radius: 12px; background: var(--color-bg-5); }
.setup-avatar { position: absolute; top: -26px; left: calc(50% - 30px); }
.api-setup-card h1 { position: absolute; top: 53px; right: 0; left: 0; color: var(--color-text-2); font-size: 20px; font-weight: 700; line-height: 23px; text-align: center; }
.api-setup-card h1 button { margin-right: 8px; color: #3b82f6; font-weight: inherit; text-decoration: underline; }
.setup-field { display: block; margin-right: 1px; margin-bottom: 20px; margin-left: 1px; color: var(--color-text-2); line-height: 22px; }
.setup-field:first-of-type { margin-bottom: 22px; }
.setup-field.required > span::before { content: "*"; margin-right: 4px; color: #f53f3f; }
.setup-field input { width: 100%; height: 32px; margin-top: 6px; padding: 0 13px; border: 1px solid transparent; border-radius: 12px; outline: 0; background: var(--color-fill-2); }
.setup-field input:focus { border-color: var(--color-primary); background: var(--color-bg-2); }
.setup-save { width: calc(100% - 2px); height: 32px; margin-left: 1px; border-radius: 12px; color: #fff; background: var(--color-primary); line-height: 22px; }
.setup-tips { margin-top: 12px; color: var(--color-text-3); font-size: 12px; line-height: 19.2px; }
.setup-tips i { display: inline; color: var(--color-primary); font-size: 14px; }
.quick-questions { margin: -18px 20px 30px 66px; display: flex; flex-wrap: wrap; gap: 8px; }
.quick-questions button { height: 30px; padding: 0 14px; border: 1px solid var(--color-border-2); border-radius: 15px; color: var(--color-text-2); background: var(--color-bg-2); font-size: 13px; }
.quick-questions button:hover:not(:disabled) { color: var(--color-primary); border-color: var(--color-primary); }
.quick-questions button:disabled { opacity: .5; }
.typing { width: 62px; height: 34px; margin: -18px 0 18px 66px; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 3px 14px 14px; background: var(--color-bg-3); }
.typing span { width: 5px; height: 5px; border-radius: 50%; background: var(--color-text-3); animation: typing 1.2s infinite; }
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes typing { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-3px); opacity: 1; } }
</style>
