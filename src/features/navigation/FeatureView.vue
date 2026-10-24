<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { host } from '../../services/utools.js';
import { useChatStore } from '../../stores/chat.js';
import { agentFormValues } from '../agents/agent-form.js';
import AgentAvatar from '../agents/AgentAvatar.vue';
import { ALL_CATEGORY, MARKET_CATEGORIES, loadMarketAgents, type MarketAgent } from './market-agents.js';
import { NOTIFICATIONS } from './notifications.js';

const props = defineProps({ view: { type: String, required: true } });

const store = useChatStore();
const query = ref('');
const category = ref(ALL_CATEGORY);
const activeNotice = ref(NOTIFICATIONS[0]?.id || '');

const ORG_URL = 'https://github.com/farfarfun';
const REPO_URL = 'https://github.com/farfarfun-utools/utools-funchat';

// 市场角色按分类各成一个 chunk，点到哪个分类下哪一个。
// 分类名是静态的，所以 tab 不用等任何下载就能画出来。
const categories = [ALL_CATEGORY, ...MARKET_CATEGORIES];
const catalog = ref<MarketAgent[]>([]);
const loaded = ref('');
const catalogLoading = ref(false);
const catalogError = ref('');
let request = 0;

async function loadCatalog(): Promise<void> {
  const wanted = category.value;
  // 搜索框只在当前分类里筛（一直如此），所以它不影响该下哪些文件
  if (props.view !== 'prompts' || loaded.value === wanted) return;
  const seq = (request += 1);
  catalog.value = [];
  catalogLoading.value = true;
  catalogError.value = '';
  try {
    // 连点几个 tab 时后发的先回是常事，过期的那份直接丢掉
    const agents = await loadMarketAgents(wanted, (partial) => {
      if (seq === request) catalog.value = partial;
    });
    if (seq !== request) return;
    catalog.value = agents;
    loaded.value = wanted;
  } catch (error) {
    if (seq === request) catalogError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (seq === request) catalogLoading.value = false;
  }
}

watch([() => props.view, category], loadCatalog, { immediate: true });
const installedNames = computed(() => new Set(store.state.agents.map((agent) => agent.nickname)));
const marketAgents = computed(() => {
  const value = query.value.trim().toLocaleLowerCase('zh-CN');
  return catalog.value.filter((item) => {
    if (category.value !== ALL_CATEGORY && item.category !== category.value) return false;
    if (!value) return true;
    return `${item.nickname} ${item.info} ${item.prompt}`.toLocaleLowerCase('zh-CN').includes(value);
  });
});
const notice = computed(() => NOTIFICATIONS.find((item) => item.id === activeNotice.value));
const unreadCount = computed(() => NOTIFICATIONS.filter((item) => item.unread).length);

function addFromMarket(item: MarketAgent) {
  if (installedNames.value.has(item.nickname)) return;
  store.addAgent({
    ...agentFormValues(null),
    nickname: item.nickname,
    info: item.info,
    content: item.content,
    prompt: item.prompt,
    avatar: item.avatar,
    autoPrefix: item.autoPrefix || '',
    contextLength: item.contextLength || 16,
    temperature: item.temperature ?? 0.6,
    quick_questions: [...(item.quick_questions || [])],
  });
}

function openUrl(url: string) {
  host.shellOpenExternal(url);
}
</script>

<template>
  <main v-if="view === 'prompts'" class="feature-view prompts-view">
    <header class="market-header">
      <div class="market-toolbar">
        <label class="market-search">
          <i class="iconfont icon-search" aria-hidden="true"></i>
          <input v-model="query" type="search" placeholder="搜一搜 AI 市场!" aria-label="搜索 AI 市场">
        </label>
      </div>
      <nav class="market-tabs" aria-label="角色分类">
        <button v-for="item in categories" :key="item" type="button"
          :class="{ active: category === item }" @click="category = item">{{ item }}</button>
      </nav>
    </header>

    <div class="market-grid">
      <article v-for="item in marketAgents" :key="item.id" class="market-card">
        <AgentAvatar :agent="item" :size="42" />
        <div class="market-copy">
          <b>{{ item.nickname }}</b>
          <small>{{ item.info }}</small>
        </div>
        <p class="market-prompt">{{ item.prompt }}</p>
        <button v-if="installedNames.has(item.nickname)" class="market-add added" type="button" disabled>已添加</button>
        <button v-else class="market-add" type="button" @click="addFromMarket(item)">添加并开始</button>
      </article>
      <div v-if="catalogLoading" class="market-empty">
        <i class="iconfont icon-bot" aria-hidden="true"></i><span>正在加载角色…</span>
      </div>
      <div v-else-if="catalogError" class="market-empty" role="alert">
        <i class="iconfont icon-bot" aria-hidden="true"></i><span>角色加载失败：{{ catalogError }}</span>
      </div>
      <div v-else-if="!marketAgents.length" class="market-empty">
        <i class="iconfont icon-bot" aria-hidden="true"></i><span>没有匹配的角色</span>
      </div>
    </div>
  </main>

  <main v-else-if="view === 'notify'" class="feature-view notify-view">
    <aside class="notify-list">
      <header>
        <i class="iconfont icon-notice" aria-hidden="true"></i>
        <span>{{ unreadCount ? `${unreadCount} 条未读通知` : '暂无新通知' }}</span>
      </header>
      <button v-for="item in NOTIFICATIONS" :key="item.id" type="button"
        :class="{ active: activeNotice === item.id }" @click="activeNotice = item.id">
        <b>{{ item.title }}<i v-if="item.unread" class="unread-dot" aria-label="未读"></i></b>
        <small>{{ item.date }}</small>
      </button>
    </aside>
    <section class="notify-content">
      <article v-if="notice" class="notify-detail">
        <h1>{{ notice.title }}</h1>
        <span class="notify-date">{{ notice.date }}</span>
        <blockquote v-if="notice.poem" class="notify-poem">
          <p v-for="line in notice.poem.lines" :key="line">{{ line }}</p>
          <cite>{{ notice.poem.author }}</cite>
        </blockquote>
        <p v-for="(paragraph, index) in notice.body" :key="index">{{ paragraph }}</p>
      </article>
    </section>
  </main>

  <main v-else class="feature-view help-view">
    <div class="help-row">
      <section>
        <h2>言来语往 FunChat 是什么</h2>
        <p>一款运行在 uTools 里的多角色 AI 对话插件。把常用模型、角色设定、历史会话和内容导出集中在一个桌面工作区，适合持续对话、提示词调试和内容整理。</p>
        <ul class="help-points">
          <li>多 AI 好友：为每个角色保存独立设定与上下文，随时切换</li>
          <li>多模型接入：uTools AI、OpenAI 兼容接口，或自定义 API 地址</li>
          <li>话题管理：历史回溯、收藏、搜索，随时继续之前的对话</li>
          <li>内容导出：整段会话导出 Markdown / HTML / PDF，单条消息存为图片</li>
          <li>本地优先：会话与配置都存在 uTools 本地数据库，不经过第三方服务</li>
        </ul>
      </section>
      <section>
        <h2>插件快捷键</h2>
        <p><kbd>Ctrl</kbd> + <kbd>N</kbd> 发起新话题</p>
        <p><kbd>Ctrl</kbd> + <kbd>B</kbd> 切换侧边栏</p>
        <p><kbd>Ctrl</kbd> + <kbd>H</kbd> 切换历史记录</p>
        <p><kbd>Shift</kbd> + <kbd>↑</kbd> 向上切换 AI 好友</p>
        <p><kbd>Shift</kbd> + <kbd>↓</kbd> 向下切换 AI 好友</p>
        <h2 class="second-title">怎么开始</h2>
        <p>点击输入框上方的 <i class="iconfont icon-key" aria-hidden="true"></i> 填入 API Key 与接口地址；或在其中选择 uTools AI，直接使用客户端内置能力。</p>
      </section>
    </div>

    <section class="common-links">
      <h2>项目与反馈</h2>
      <ul>
        <li>
          <button type="button" @click="openUrl(REPO_URL)">
            <b>项目主页</b><span>源码、构建说明与更新日志</span>
          </button>
        </li>
        <li>
          <button type="button" @click="openUrl(`${REPO_URL}/issues`)">
            <b>问题反馈</b><span>提交 Bug 与功能建议</span>
          </button>
        </li>
        <li>
          <button type="button" @click="openUrl(ORG_URL)">
            <b>farfarfun</b><span>看看我们的其他开源项目</span>
          </button>
        </li>
      </ul>
    </section>

    <section class="support">
      <h2>关于 farfarfun</h2>
      <p>
        <button class="inline-link" type="button" @click="openUrl(ORG_URL)">github.com/farfarfun</button>
        是一个专注实用小工具与 AI 应用的开源组织，言来语往 FunChat 是其中之一。
        如果这个插件帮到了你，欢迎给仓库点个 Star —— 那是我们判断该往哪个方向继续投入的主要依据。
        也欢迎直接提 PR，无论是修 bug、补角色，还是改进界面。
      </p>
      <p class="thanks">界面与交互设计致谢 uTools 插件「ChatGPT.好友」。</p>
    </section>
  </main>
</template>

<style scoped>
.feature-view { min-width: 0; height: 100%; flex: 1; overflow: auto; background: transparent; }

.prompts-view { display: flex; flex-direction: column; }
.market-header { padding: 24px 0 0; flex: 0 0 auto; background: var(--color-bg-2); }
.market-toolbar { width: 80%; margin: 0 auto; display: flex; align-items: center; }
.market-search { height: 36px; min-width: 0; padding: 0 12px; display: flex; flex: 1; align-items: center; border-radius: 12px; background: var(--color-fill-2); }
.market-search i { width: 14px; height: 14px; margin-right: 4px; color: var(--color-text-3); font-size: 14px; line-height: 14px; }
.market-search input { min-width: 0; height: 34px; padding: 6px 0; flex: 1; border: 0; outline: 0; background: transparent; line-height: 22px; }
/* 15 个分类横排必然溢出，改成换行；多行下用胶囊底色比下划线更容易定位当前项 */
.market-tabs { width: 80%; min-height: 44px; margin: 0 auto; padding: 8px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.market-tabs button { height: 28px; padding: 0 12px; border-radius: 14px; color: var(--color-text-2); font-size: 13px; line-height: 28px; }
.market-tabs button:hover { background: var(--color-fill-1); }
.market-tabs button.active { color: #fff; background: var(--color-primary); font-weight: 500; }
.market-tabs button.active:hover { background: var(--color-primary); }
.market-grid { width: 80%; margin: 0 auto; padding: 20px 0 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.market-card { position: relative; padding: 16px; display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 4px 12px; border: 1px solid var(--color-border-2); border-radius: 12px; background: var(--color-bg-2); }
.market-card:hover { border-color: var(--color-primary); box-shadow: 0 4px 10px #0000000f; }
.market-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.market-copy b { overflow: hidden; color: var(--color-text-1); font-size: 15px; font-weight: 500; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.market-copy small { overflow: hidden; color: var(--color-text-3); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.market-prompt { grid-column: 1 / -1; margin: 8px 0 12px; display: -webkit-box; overflow: hidden; color: var(--color-text-3); font-size: 12px; line-height: 19px; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.market-add { grid-column: 1 / -1; height: 32px; border-radius: 12px; color: #fff; background: var(--color-primary); font-size: 13px; }
.market-add:hover { opacity: .88; }
.market-add.added { color: var(--color-text-3); background: var(--color-fill-2); }
.market-empty { grid-column: 1 / -1; padding: 80px 0; display: flex; flex-direction: column; align-items: center; gap: 4px; color: #a9aeb8; }
.market-empty i { color: #c9cdd4; font-size: 32px; }

.notify-view { display: flex; overflow: hidden; }
.notify-list { width: 240px; height: 100%; flex: 0 0 240px; overflow-y: auto; background: var(--color-bg-2); border-right: 1px solid var(--color-border-2); }
.notify-list header { height: 56px; padding: 0 16px; display: flex; align-items: center; border-bottom: 1px solid var(--color-border-2); color: var(--color-text-3); }
.notify-list header i { margin-right: 4px; font-size: 16px; }
.notify-list > button { width: 100%; padding: 12px 16px; display: flex; flex-direction: column; gap: 3px; border-bottom: 1px solid var(--color-border-2); text-align: left; }
.notify-list > button:hover { background: var(--color-fill-1); }
.notify-list > button.active { background: var(--color-primary-light-1); }
.notify-list > button b { display: flex; align-items: center; gap: 6px; overflow: hidden; color: var(--color-text-1); font-size: 14px; font-weight: 500; line-height: 21px; text-overflow: ellipsis; white-space: nowrap; }
.notify-list > button small { color: var(--color-text-3); font-size: 12px; }
.unread-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: #f53f3f; }
.notify-content { min-width: 0; height: 100%; flex: 1; overflow-y: auto; background: var(--color-fill-1); }
:global(body.dark .notify-content) { background: var(--color-bg-3); }
.notify-detail { max-width: 680px; margin: 0 auto; padding: 32px 24px; line-height: 1.9; }
.notify-detail h1 { color: var(--color-text-1); font-size: 20px; font-weight: 600; line-height: 30px; }
.notify-date { display: block; margin: 4px 0 20px; color: var(--color-text-3); font-size: 12px; }
.notify-detail p { margin-bottom: 12px; color: var(--color-text-2); }
.notify-poem { margin: 0 0 20px; padding: 18px 22px; border-left: 3px solid var(--color-primary); border-radius: 0 8px 8px 0; background: var(--color-bg-2); }
.notify-poem p { margin: 0; color: var(--color-text-1); font-size: 16px; letter-spacing: .06em; line-height: 32px; }
.notify-poem cite { display: block; margin-top: 8px; color: var(--color-text-3); font-size: 12px; font-style: normal; text-align: right; }

.help-view { padding: 20px; line-height: 1.8; }
.help-view section { padding: 32px; border-radius: 20px; background: var(--color-bg-3); }
.help-view h2 { margin: 0 0 20px; color: var(--color-text-2); font-size: 16px; font-weight: 700; line-height: 24px; }
.help-view .second-title { margin-top: 28px; }
.help-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.help-row section { min-height: 281px; }
.help-view ul { margin: 0; padding: 0; }
.help-points { margin-top: 12px; padding-left: 1.2em; list-style: disc; line-height: 28px; }
.help-row p { margin: 0; line-height: 33.6px; }
.help-row p i { display: inline; color: var(--color-primary); font-size: 15px; }
kbd { min-width: 28px; padding: 2px 8px; display: inline-block; border: 1px solid var(--color-border-2); border-radius: 6px; background: var(--color-bg-2); box-shadow: 0 1px 2px #0000000a; font-family: inherit; line-height: 20px; text-align: center; }
.common-links { min-height: 184px; margin-top: 16px; }
.common-links ul { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; list-style: none; }
.common-links li { min-width: 0; }
.common-links button { width: 100%; height: 77px; padding: 12px 20px; display: flex; flex-direction: column; justify-content: center; border: 1px solid var(--color-border-2); border-radius: 12px; background: var(--color-bg-2); box-shadow: 0 2px 4px #0000000a; text-align: left; }
.common-links button:hover { color: var(--color-primary); transform: scale(1.02); }
.common-links b { font-weight: 500; }
.common-links span { color: var(--color-text-3); font-size: 12px; }
.support { min-height: 133px; margin-top: 16px; }
.support p { margin: 0; }
.support .thanks { margin-top: 12px; color: var(--color-text-3); font-size: 12px; }
.inline-link { display: inline; color: var(--color-primary); font-weight: 500; text-decoration: underline; }
</style>
