import { computed, reactive, ref, watch } from 'vue';
import { streamChat } from '../services/chat.ts';
import { host } from '../services/utools.ts';
import { clonePlain } from '../services/plain-clone.ts';
import { loadUtoolsModelInfo } from '../services/models.ts';
import {
  loadAgents,
  loadHistories,
  loadSettings,
  removeAgent,
  removeHistory,
  saveAgent,
  saveHistory,
  saveSettings,
  createRouteId,
  syncActiveRoute,
  activeRoute,
} from '../services/storage.ts';
import { buildUserContent, hasContent, withPrefix } from '../features/chat/message-content.ts';
import { estimateConversationTokens, messageText } from '../features/chat/token-count.ts';
import { writeOptionalParams } from '../features/agents/agent-form.ts';
import type {
  Agent,
  AgentFormValues,
  AgentParams,
  ApiRoute,
  AppState,
  ChatMessage,
  History,
  Settings,
} from '../types.ts';

// 这些字段在原插件的导出数据里是可选的：值等于默认值且文档原本没有，就不要写进去，
// 否则「打开设置再保存」会凭空给文档加字段（见 tests/agent-compat.test.ts）。
const OPTIONAL_AGENT_FIELDS: Record<string, string | boolean> = {
  autoPrefix: '',
  status: '',
  callback: '',
  api_id: '',
  isFly: false,
  isOverall: false,
  isFlyNewChat: true,
  isFollowQuestion: false,
  isFunAi: false,
  un_stream: false,
  isAiSummary: false,
};

const state = reactive<AppState>({
  ready: false,
  agents: [],
  currentAgent: null,
  messages: [],
  histories: [],
  settings: loadSettings(),
  loading: false,
  error: '',
  historyOpen: false,
  sidebarCollapsed: false,
  view: 'chat',
});

let abortController: AbortController | null = null;
let activeStream = 0;
let presetHidden = false;
const systemTheme: MediaQueryList | undefined = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

function initialMessages(agent: Agent | null): ChatMessage[] {
  const messages = clonePlain(agent?.params?.messages || []);
  return messages[0]?.role === 'system' ? messages.slice(1) : messages;
}

function presetPrefix(): ChatMessage[] {
  const preset = clonePlain(state.currentAgent?.params?.messages || []);
  return presetHidden ? preset : preset[0]?.role === 'system' ? preset.slice(0, 1) : [];
}

// 「临时调参」弹窗标题承诺的是「发起新话题后失效」，但直接改好友文档做不到这件事：之后
// 任何一次 saveAgent（哪怕只是点个置顶）都会把这份临时值顺手写进磁盘，而且换话题也不会退
// 回去。所以覆盖值单独存一份，只在组请求时合并进去，换话题、换好友、打开旧话题都清空。
const paramOverrides = reactive<Record<string, any>>({});

function setParamOverrides(next: Record<string, unknown>): void {
  Object.assign(paramOverrides, next);
}

function clearParamOverrides(): void {
  for (const key of Object.keys(paramOverrides)) delete paramOverrides[key];
}

// contextLength 挂在好友文档上而不是 params 里，合并时要排除掉，否则会被当成模型参数发出去
function overriddenParams(agent: Agent): Agent {
  const keys = Object.keys(paramOverrides).filter((key) => key !== 'contextLength');
  if (!keys.length) return agent;
  const params: AgentParams = { ...agent.params };
  for (const key of keys) params[key] = paramOverrides[key];
  return { ...agent, params };
}

function requestMessages(): ChatMessage[] {
  const size = Math.max(Number(paramOverrides.contextLength ?? state.currentAgent?.contextLength) || 16, 1) * 2;
  const messages = clonePlain(state.messages.slice(-size)) as ChatMessage[];
  const prefix = String(state.currentAgent?.autoPrefix || '').trim();
  const lastUser = prefix ? messages.findLastIndex((message) => message.role === 'user') : -1;
  const target = lastUser >= 0 ? messages[lastUser] : undefined;
  if (target) target.content = withPrefix(target.content, prefix);
  return [...presetPrefix(), ...messages];
}

// 不在这里克隆：唯一的去向是 saveHistory，它内部的 stripImagesToFit 已经 clonePlain 过一遍。
// 带图会话每条消息都要多拷一份几百 KB 的 base64，白拷的代价不小。
function conversationMessages(): ChatMessage[] {
  return [...presetPrefix(), ...state.messages];
}

// loadHistories 会把所有会话文档（连同完整消息与 base64 图片）全部读出来再克隆一遍，
// 每发一条消息都跑一次的话，几十个带图会话就是每条消息读写好几 MB。改成原地增删。
function upsertHistory(history: History): void {
  const index = state.histories.findIndex((item) => item._id === history._id);
  if (index < 0) state.histories.push(history);
  else state.histories[index] = history;
  state.histories.sort((left, right) => right.sortKey - left.sortKey);
}

function dropHistories(match: (history: History) => boolean): void {
  state.histories = state.histories.filter((history) => !match(history));
}

function removeMessage(message: ChatMessage): void {
  const at = state.messages.indexOf(message);
  if (at >= 0) state.messages.splice(at, 1);
}

function applyTheme(): void {
  const dark = state.settings.theme === 'dark' || (state.settings.theme === 'system' && systemTheme?.matches);
  state.settings.dark = Boolean(dark);
  const body = globalThis.document?.body;
  if (!body) return;
  body.classList.toggle('dark', state.settings.dark);
}

// 插件在 uTools 主面板里的高度由宿主控制，对应设置里的「插件高度」。
// 分离成独立窗口后 uTools 会忽略它。
// 两个名字都试一次：8.0 的接口叫 setExpandHeight，更早的客户端上只有拼错的 setExpendHeight。
// 之前只调旧名字，在 8.0 上是可选调用静默失败——这项设置拖了没反应也不报错。
function applyPluginHeight(): void {
  const height = Number(state.settings.windowHeight) || 660;
  (host.setExpandHeight ?? host.setExpendHeight)?.(height);
}

// 进入插件时的输入意图。seq 每次进入都 +1，输入框靠它聚焦；text 是匹配命令带进来的
// 选中文字（plugin.json 里的 over 类型指令），没有就是空串。
// 预填而不直接发送：用户还得有机会挑好友、改措辞。
const enterIntent = ref({ seq: 0, text: '' });

// 只有 over（划词）带进来的 payload 才是用户想问的内容。敲关键字进来时 type 是 text、
// payload 是关键字本身（"funchat"），照着预填会往输入框里塞一句莫名的 "funchat"。
function intentTextOf(action: { type?: string; payload?: unknown } | undefined): string {
  if (action?.type !== 'over') return '';
  return typeof action.payload === 'string' ? action.payload : '';
}

// 同步拉到新文档后重读一遍。正在生成回复时直接跳过，否则会把流式写入的那条消息覆盖掉；
// 当前好友和正在看的话题要保住，不然用户会被莫名甩回第一个好友。
async function refreshFromSync(): Promise<void> {
  if (state.loading) return;
  const currentId = state.currentAgent?._id;
  const chatId = state.currentAgent?.chatId;
  state.agents = await loadAgents();
  state.histories = await loadHistories();
  sortAgents();
  const current = state.agents.find((agent) => agent._id === currentId);
  if (current && chatId) current.chatId = chatId;
  state.currentAgent = current || state.agents[0] || null;
}

function registerHostEvents(): void {
  // 以前一次都没注册过 onPluginEnter，于是「唤出 uTools → 敲 funchat → 回车 → 直接打字」
  // 中间凭空多了一次点击输入框；匹配命令（选中文字直接提问）更是无从实现。
  host.onPluginEnter?.((action) => {
    enterIntent.value = { seq: enterIntent.value.seq + 1, text: intentTextOf(action) };
  });
  // uTools 退出插件默认是「转后台」（isKill=false），不会触发 pagehide，
  // 流式回复途中退出整轮问答就丢了。和 App.vue 里的 pagehide 两头都挂上。
  host.onPluginOut?.(() => { persistCurrentConversation(); });
  // uTools 会在设备间同步插件文档。不监听的话，另一台机器上加的好友和话题在这里要重启插件
  // 才看得见，而且接着写同一份文档会直接撞 _rev 冲突。
  host.onDbPull?.(() => { void refreshFromSync(); });
}

function ownActivityAt(agent: Agent): number {
  return Number(agent.created_at) || Number(String(agent._id).slice(3)) || 0;
}

// 排序前把「好友 → 最近活跃时间」算成一张表。放在比较器里算的话，每次比较都要扫一遍
// 全部历史，整个排序就是 O(好友数 × log 好友数 × 历史数)；现在是各扫一遍。
function sortAgents(): void {
  const latest = new Map<string, number>();
  for (const history of state.histories) {
    const at = history.updatedAt || history.sortKey || 0;
    if (at > (latest.get(history.agentId) ?? 0)) latest.set(history.agentId, at);
  }
  const activity = new Map(state.agents.map((agent) => [
    agent._id,
    Math.max(ownActivityAt(agent), latest.get(agent._id) ?? 0),
  ]));
  state.agents.sort((left, right) => {
    if (Boolean(left.is_top) !== Boolean(right.is_top)) return left.is_top ? -1 : 1;
    return (activity.get(right._id) ?? 0) - (activity.get(left._id) ?? 0);
  });
}

async function init(): Promise<void> {
  // 必须串行：loadAgents 开头会做一次性的旧数据搬迁，chat@ 文档也在搬迁范围内，
  // 并发读会漏掉刚搬进来的会话
  state.agents = await loadAgents();
  state.histories = await loadHistories();
  sortAgents();
  state.currentAgent = state.agents[0] || null;
  state.messages = [];
  presetHidden = Boolean(state.currentAgent);
  applyTheme();
  applyPluginHeight();
  systemTheme?.addEventListener?.('change', applyTheme);
  // 不 await：模型元信息只用来把选择器里的裸 id 换成显示名、标出能量消耗、以及判断
  // 模型吃不吃图片。拉不到也不影响聊天，不该让它挡住首屏。
  void loadUtoolsModelInfo();
  // 官方文档：每个插件应用只需注册一次事件监听。init 只在 App 挂载时调用一次。
  registerHostEvents();
  state.ready = true;
}

function selectAgent(agent: Agent | null | undefined): void {
  if (!agent) return;
  stop();
  clearParamOverrides();
  delete agent.chatId;
  state.currentAgent = agent;
  state.messages = initialMessages(agent);
  presetHidden = false;
  state.error = '';
  state.historyOpen = false;
  state.view = 'chat';
}

function cycleAgent(step: number): void {
  if (state.agents.length < 2) return;
  const index = state.agents.findIndex((agent) => agent._id === state.currentAgent?._id);
  selectAgent(state.agents[(index + step + state.agents.length) % state.agents.length]);
}

function addAgent(values: AgentFormValues): void {
  const nickname = values.nickname.trim();
  const agent: Agent = {
    _id: `ai@${Date.now()}`,
    nickname,
    info: values.info.trim() || '自定义 AI 好友',
    content: values.content.trim() || `你好，我是${nickname}，需要帮助吗？`,
    avatar: clonePlain(values.avatar) || { type: 'icon', icon: 'icon-a1', color: '#0ca47f', text: nickname.slice(0, 1) },
    contextLength: Number(values.contextLength) || 16,
    autoPrefix: values.autoPrefix.trim(),
    isFly: Boolean(values.isFly),
    isOverall: Boolean(values.isOverall),
    isFlyNewChat: values.isFlyNewChat !== false,
    isFollowQuestion: Boolean(values.isFollowQuestion),
    isFunAi: values.type === 'function',
    api_id: values.api_id || '',
    un_stream: Boolean(values.un_stream),
    callback: values.callback || '',
    isAiSummary: Boolean(values.isAiSummary),
    quick_questions: clonePlain(values.quick_questions || []),
    is_author: true,
    params: {
      ...(values.model.trim() ? { model: values.model.trim() } : {}),
      messages: [{ role: 'system', content: values.prompt.trim() }],
      temperature: Number(values.temperature),
      top_p: Number(values.top_p),
      presence_penalty: Number(values.presence_penalty),
      frequency_penalty: Number(values.frequency_penalty),
      max_tokens: Number(values.max_tokens) || 0,
      ...(values.paramsFunctions ? { functions: values.paramsFunctions } : {}),
    },
    created_at: String(Date.now()),
  };
  saveAgent(agent);
  state.agents.push(agent);
  sortAgents();
  selectAgent(agent);
}

function updateAgent(agent: Agent, values: AgentFormValues): void {
  const prompt = values.prompt.trim();
  const messages = clonePlain(agent.params?.messages || []);
  if (messages[0]?.role === 'system') messages[0].content = prompt;
  else if (prompt) messages.unshift({ role: 'system', content: prompt });

  const params: AgentParams = { ...agent.params, messages };
  if (values.model.trim()) params.model = values.model.trim();
  else delete params.model;
  writeOptionalParams(params, agent.params, values);
  if (values.paramsFunctions) params.functions = values.paramsFunctions;
  else delete params.functions;

  Object.assign(agent, {
    nickname: values.nickname.trim(),
    info: values.info.trim(),
    content: values.content.trim(),
    contextLength: Number(values.contextLength) || 16,
    params,
  });

  const incoming: Record<string, string | boolean> = {
    autoPrefix: values.autoPrefix.trim(),
    status: values.status || '',
    callback: values.callback || '',
    api_id: values.api_id || '',
    isFly: Boolean(values.isFly),
    isOverall: Boolean(values.isOverall),
    isFlyNewChat: values.isFlyNewChat !== false,
    isFollowQuestion: Boolean(values.isFollowQuestion),
    isFunAi: values.type === 'function',
    un_stream: Boolean(values.un_stream),
    isAiSummary: Boolean(values.isAiSummary),
  };
  for (const [key, fallback] of Object.entries(OPTIONAL_AGENT_FIELDS)) {
    if (key in agent || incoming[key] !== fallback) agent[key] = incoming[key];
    else delete agent[key];
  }
  const questions = clonePlain(values.quick_questions || []);
  if ('quick_questions' in agent || questions.length) agent.quick_questions = questions;
  else delete agent.quick_questions;

  saveAgent(agent);
}

function deleteAgent(agent: Agent): void {
  const index = state.agents.indexOf(agent);
  if (index < 0) return;
  removeAgent(agent._id);
  state.agents.splice(index, 1);
  dropHistories((history) => history.agentId === agent._id);
  if (state.currentAgent?._id !== agent._id) return;
  const next = state.agents[Math.max(0, index - 1)];
  if (next) {
    selectAgent(next);
    return;
  }
  state.currentAgent = null;
  state.messages = [];
  presetHidden = false;
  state.error = '';
}

function togglePin(agent: Agent): void {
  agent.is_top = !agent.is_top;
  saveAgent(agent);
  sortAgents();
}

function newConversation(): void {
  stop();
  clearParamOverrides();
  state.messages = [];
  presetHidden = Boolean(state.currentAgent);
  if (state.currentAgent) state.currentAgent.chatId = `chat@${state.currentAgent._id}#${Date.now()}`;
}

/**
 * 发出一条用户消息。
 * @param text 输入框文字。
 * @param images 随消息一起发送的图片 data URL，可为空。
 * @returns 真的发出去了返回 `true`；内容为空或正在生成时返回 `false`。
 */
async function send(text: string, images: readonly string[] = []): Promise<boolean> {
  return sendContent(buildUserContent(text, images));
}

async function sendContent(content: ChatMessage['content']): Promise<boolean> {
  if (!hasContent(content) || state.loading || !state.currentAgent) return false;
  state.messages.push({ role: 'user', content }, { role: 'assistant', content: '' });
  const assistantMessage = state.messages.at(-1) as ChatMessage;
  const streamId = ++activeStream;
  state.loading = true;
  state.error = '';
  abortController = new AbortController();

  try {
    await streamChat({
      settings: state.settings,
      agent: overriddenParams(state.currentAgent),
      messages: requestMessages().slice(0, -1),
      signal: abortController.signal,
      onDelta: (chunk) => { if (streamId === activeStream) assistantMessage.content += chunk; },
    });
    if (streamId === activeStream && !assistantMessage.content) assistantMessage.content = '服务端没有返回内容。';
  } catch (error) {
    const failure = error as { name?: string; message?: string } | null;
    if (failure?.name === 'AbortError') {
      if (!assistantMessage.content) removeMessage(assistantMessage);
    } else if (streamId === activeStream) {
      state.error = failure?.message || String(error);
      assistantMessage.content = `请求失败：${state.error}`;
      assistantMessage.error = true;
    }
  } finally {
    if (streamId === activeStream) {
      state.loading = false;
      abortController = null;
      if (state.messages.includes(assistantMessage)) persistCurrentConversation();
    }
  }
  return true;
}

function stop(): void {
  if (!state.loading && !abortController) return;
  activeStream += 1;
  abortController?.abort();
  abortController = null;
  state.loading = false;
  const last = state.messages.at(-1);
  if (last?.role === 'assistant' && !messageText(last)) removeMessage(last);
  persistCurrentConversation();
}

function persistCurrentConversation(): void {
  if (!state.currentAgent || !state.messages.some((message) => message.role === 'user')) return;
  const id = state.currentAgent.chatId || `chat@${state.currentAgent._id}#${Date.now()}`;
  state.currentAgent.chatId = id;
  const firstUser = state.messages.find((message) => message.role === 'user');
  const existing = state.histories.find((history) => history._id === id);
  upsertHistory(saveHistory({
    id,
    title: Array.from(messageText(firstUser)).slice(0, 20).join('') || '新话题',
    messages: conversationMessages(),
    favorite: existing?.isFavorite,
  }));
  sortAgents();
}

function openHistory(history: History): void {
  const agent = state.agents.find((item) => item._id === history.agentId);
  if (!agent) return;
  stop();
  clearParamOverrides();
  state.currentAgent = agent;
  agent.chatId = history._id;
  state.messages = history.messages[0]?.role === 'system' ? clonePlain(history.messages.slice(1)) : clonePlain(history.messages);
  presetHidden = false;
  state.error = '';
  state.historyOpen = false;
  state.view = 'chat';
}

function deleteHistory(history: History): void {
  removeHistory(history._id);
  dropHistories((item) => item._id === history._id);
  sortAgents();
  if (state.currentAgent?.chatId === history._id) newConversation();
}

function toggleFavorite(history: History): void {
  upsertHistory(saveHistory({
    id: history._id,
    title: history.title || '',
    messages: history.messages,
    favorite: !history.isFavorite,
  }));
}

function deleteMessage(index: number): void {
  state.messages.splice(index, 1);
  persistCurrentConversation();
}

async function retryMessage(index: number): Promise<void> {
  if (state.loading || !state.currentAgent) return;
  const userIndex = state.messages.slice(0, index).findLastIndex((message) => message.role === 'user');
  if (userIndex < 0) return;
  // 原样重放：带图的问题要连图一起重发，不能只把文字取出来
  const original = clonePlain(state.messages[userIndex].content) as ChatMessage['content'];
  const content = typeof original === 'string' ? original.trim() : original;
  if (!hasContent(content)) return;
  state.messages.splice(userIndex);
  await sendContent(content);
}

function updateSettings(next: Partial<Settings>): void {
  Object.assign(state.settings, next);
  // 线路可能被切换或删除，镜像字段要跟着走，否则 streamChat 还在用旧地址
  syncActiveRoute(state.settings);
  applyTheme();
  applyPluginHeight();
  saveSettings(state.settings);
}

function saveApiRoute(route: ApiRoute): void {
  const routes = state.settings.apiRoutes || [];
  const index = routes.findIndex((item) => item.id === route.id);
  if (index < 0) routes.push({ ...route, id: route.id || createRouteId() });
  else routes[index] = { ...routes[index], ...route };
  updateSettings({ apiRoutes: routes, activeRouteId: route.id || routes.at(-1)?.id || '' });
}

function removeApiRoute(routeId: string): void {
  const routes = (state.settings.apiRoutes || []).filter((route) => route.id !== routeId);
  // 删掉的正好是当前线路时，把 activeRouteId 清空，让 syncActiveRoute 退回第一条
  const activeRouteId = state.settings.activeRouteId === routeId ? '' : state.settings.activeRouteId;
  Object.assign(state.settings, { apiRoutes: routes, activeRouteId });
  if (!routes.length) Object.assign(state.settings, { baseUrl: '', apiKey: '', provider: 'openai' });
  updateSettings({});
}

function selectApiRoute(routeId: string): void {
  updateSettings({ activeRouteId: routeId });
}

// 当前线路拉回来的模型清单。好友自身用过的模型也并进来，
// 这样手动填过、或清单里已经下架的模型不会从选择器里消失。
const routeModels = computed(() => {
  const fetched = activeRoute(state.settings)?.models || [];
  const used = state.agents.map((agent) => agent.params?.model).filter(Boolean) as string[];
  return [...new Set([...fetched, ...used])];
});

// Token 数在标题栏和输入区一直显示着，而流式回复每来一个 chunk 就要把正在生成的那条消息
// 整段重新扫一遍（折叠空白、数汉字、算 UTF-8 字节），于是总开销是回复长度的平方：实测 5400
// 字要 256 ms，21600 字要 4633 ms——长回复光更新这个数字就能吃掉几秒主线程。
// 这个数字只是给人看的，没有任何逻辑依赖它，所以改成节流显示：变化后先立即算一次，之后最多
// 每 160 ms 一次，并总是补一次尾随计算。每次显示的值都还是整段精算的结果，只是不再逐 chunk 算。
const TOKEN_INTERVAL = 160;
const tokenCount = ref(estimateConversationTokens(state.messages));
let tokenCountAt = 0;
let tokenCountTimer: ReturnType<typeof setTimeout> | null = null;

function refreshTokenCount(): void {
  tokenCountTimer = null;
  tokenCountAt = Date.now();
  tokenCount.value = estimateConversationTokens(state.messages);
}

// getter 只取 content 的引用来建立依赖，不在这里扫内容——扫描本身才是要省掉的开销。
// 每次都返回新数组，所以任何一条消息的内容变动都会触发回调。
watch(() => state.messages.map((message) => message?.content), () => {
  const wait = TOKEN_INTERVAL - (Date.now() - tokenCountAt);
  if (wait > 0) {
    // 已经排过一次就不必再排，回调读的是届时的最新内容
    tokenCountTimer ||= setTimeout(refreshTokenCount, wait);
    return;
  }
  if (tokenCountTimer) clearTimeout(tokenCountTimer);
  refreshTokenCount();
});

const agentHistories = computed(() => state.histories.filter((history) => history.agentId === state.currentAgent?._id));
// 本次话题实际会用的模型：临时调参改过就显示改后的，界面上不能还停在好友自己的设置
const activeModel = computed(() => paramOverrides.model || state.currentAgent?.params?.model || state.settings.model || '');

export function useChatStore() {
  return {
    state,
    tokenCount,
    agentHistories,
    routeModels,
    activeModel,
    enterIntent,
    paramOverrides,
    setParamOverrides,
    init,
    selectAgent,
    cycleAgent,
    addAgent,
    updateAgent,
    deleteAgent,
    togglePin,
    newConversation,
    send,
    stop,
    persistCurrentConversation,
    openHistory,
    deleteHistory,
    toggleFavorite,
    deleteMessage,
    retryMessage,
    updateSettings,
    saveApiRoute,
    removeApiRoute,
    selectApiRoute,
  };
}
