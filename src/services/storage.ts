import { clonePlain } from './plain-clone.ts';
import { host } from './utools.ts';
import type { DbResult, StorageDocument } from './utools.ts';
// 纯函数模块，不带 Vue / DOM 依赖，这里只是为了在落盘时顺手把索引字段算出来
import { estimateConversationTokens, messageText } from '../features/chat/token-count.ts';
import type { Agent, ApiRoute, ChatMessage, History, HistoryInput, Settings } from '../types.ts';

const SETTINGS_KEY = 'funchat.settings';
// 文档库对单个文档的体积有上限，而 put 失败是静默的——真超了整段聊天记录会凭空消失。
// 一张压缩后的图 base64 就有几十万字符，带图会话很容易撞线，所以留个保守预算。
const HISTORY_SIZE_BUDGET = 1024 * 1024;
// 0.1.x 把所有文档塞在 dbStorage 的一个 JSON 大对象里，每存一条消息都要整库重写一遍。
// 现在改用 uTools 自己的文档库，这两个键只用于一次性搬迁。
const LEGACY_DOCUMENTS_KEY = 'browser.db';
const MIGRATED_KEY = 'funchat.documents.migrated';
// 话题列表只要标题、时间和收藏状态，可一条带图会话的正文有几十万字符。两者同在一个文档里时，
// 开插件的第一件事就是把所有历史连同图片整个搬进内存，只为了画一列标题。
// 所以拆成两份：chat@ 存索引，chatbody@ 存正文，点开某条话题时才去读它那一份。
const HISTORY_PREFIX = 'chat@';
const HISTORY_BODY_PREFIX = 'chatbody@';

export type { StorageDocument } from './utools.ts';
export type { ApiRoute, Settings, HistoryInput } from '../types.ts';

// 调用方必须传已经脱过响应式的纯数据：Proxy 过不了 Electron 的结构化克隆，db.put 会失败。
// 这里不再兜一层 clonePlain——两个调用方本来就各自克隆过一遍，再克隆就是白拷一次带图会话。
function putDocument(document: StorageDocument): DbResult {
  const result = host.db.put(document);
  if (result?.ok) return result;
  // _rev 过期说明同一条文档在别处被写过（例如先 saveHistory 再 saveAgent 走了同一个对象）。
  // 取回当前 _rev 重试一次，让本次改动生效，而不是把失败咽下去。
  const current = host.db.get(document._id);
  const retried = current ? host.db.put({ ...document, _rev: current._rev }) : result;
  if (!retried?.ok) throw new Error(`保存失败：${retried?.message || retried?.name || '未知错误'}`);
  return retried;
}

function removeDocument(id: string): void {
  const document = host.db.get(id);
  if (document) host.db.remove(document);
}

function allDocuments(prefix = ''): StorageDocument[] {
  return host.db.allDocs(prefix);
}

/**
 * 把 0.1.x 存在 dbStorage 单键里的文档搬进 uTools 文档库。
 * 只搬一次，且不删除旧数据——万一搬迁出错，用户的会话还在原处。
 * @returns 无返回值。
 */
function migrateLegacyDocuments(): void {
  if (host.dbStorage.getItem(MIGRATED_KEY)) return;
  const legacy = host.dbStorage.getItem(LEGACY_DOCUMENTS_KEY);
  if (legacy && typeof legacy === 'object') {
    for (const source of Object.values(legacy as Record<string, StorageDocument>)) {
      if (!source?._id || host.db.get(source._id)) continue;
      const document = clonePlain(source);
      delete document._rev;
      putDocument(document);
    }
  }
  // 标记写在搬完之后。写在前面的话，中途抛异常或被用户关掉插件，剩下的会话就再也搬不过来了
  // ——旧数据还躺在 dbStorage 里，却永远不会再读。重跑是安全的：上面按 _id 跳过已有文档。
  host.dbStorage.setItem(MIGRATED_KEY, true);
}

/**
 * 读取已保存的好友；首次运行时导入内置好友数据。
 * @returns 所有好友存储文档的副本。
 */
export async function loadAgents(): Promise<Agent[]> {
  migrateLegacyDocuments();
  // 和 loadHistories 一样走异步接口：同步 allDocs 是阻塞式 IPC，好友文档里带着整段开场白
  // 和参数，几十个好友就是在首屏把界面钉住一下。
  let documents = await host.db.promises.allDocs('ai@');
  if (!documents.length) {
    const response = await fetch('./data/agents.json');
    if (!response.ok) throw new Error('无法加载初始好友数据');
    const seed: StorageDocument[] = await response.json();
    await Promise.all(seed.map(async (source) => {
      const document = clonePlain(source);
      delete document._rev;
      const result = await host.db.promises.put(document);
      if (!result?.ok) throw new Error(`初始化好友失败：${result?.message || result?.name || '未知错误'}`);
    }));
    documents = await host.db.promises.allDocs('ai@');
  }

  return documents as Agent[];
}

/**
 * 保存好友并将最新修订号写回传入对象。
 * @param agent 要保存的好友存储文档。
 * @returns 无返回值。
 */
export function saveAgent(agent: Agent): void {
  const document = clonePlain(agent) as StorageDocument;
  delete document.chatId;
  const result = putDocument(document);
  if (result?.rev) agent._rev = result.rev;
}

/**
 * 删除好友及其全部历史会话。
 * @param agentId 要删除的好友标识。
 * @returns 无返回值。
 */
export function removeAgent(agentId: string): void {
  removeDocument(agentId);
  for (const history of allDocuments(`${HISTORY_PREFIX}${agentId}#`)) host.db.remove(history);
  for (const body of allDocuments(`${HISTORY_BODY_PREFIX}${agentId}#`)) host.db.remove(body);
}

function bodyIdOf(id: string): string {
  return `${HISTORY_BODY_PREFIX}${id.slice(HISTORY_PREFIX.length)}`;
}

// 正文搬走之后，列表上还要显示的 Token 数、以及搜索要用的正文文本，都得在落盘时先算好。
// searchText 是另存了一份纯文本，图片不计入，所以它比正文小一两个数量级——
// 代价是文字部分在库里存了两遍，换来的是搜索不必为了找一个词把所有会话的图片读回来。
function summarize(messages: ChatMessage[]): { tokens: number; searchText: string } {
  return {
    tokens: estimateConversationTokens(messages),
    searchText: messages.map((message) => messageText(message)).join(' '),
  };
}

// 0.2.x 之前正文和索引同在一个文档里。读到这样的老文档就地拆开：正文写进 chatbody@，
// 索引原地写回。只在真读到时拆，不做全库扫描。
function splitLegacyBody(document: StorageDocument): StorageDocument {
  if (!Array.isArray(document.messages)) return document;
  const { messages, ...meta } = document;
  putDocument({ _id: bodyIdOf(document._id), messages });
  const next = { ...meta, ...summarize(messages) } as StorageDocument;
  const result = putDocument(next);
  if (result?.rev) next._rev = result.rev;
  return next;
}

// agentId 与 sortKey 都是从 _id 里解析出来的，不落盘
function toHistory(document: StorageDocument): History {
  const separator = document._id.lastIndexOf('#');
  return {
    ...document,
    agentId: separator < 0 ? document._id.slice(5) : document._id.slice(5, separator),
    sortKey: separator < 0 ? 0 : Number(document._id.slice(separator + 1)) || 0,
  } as History;
}

/**
 * 按最近会话优先的顺序读取全部历史记录的索引，不含消息正文。
 * 走异步接口：同步版 allDocs 是阻塞式 IPC，一次性搬进渲染进程的数据越少越好。
 * @returns 带好友标识和排序键的历史索引副本。
 */
export async function loadHistories(): Promise<History[]> {
  // chatbody@ 不以 chat@ 开头（'chatb' ≠ 'chat@'），正文文档不会被这个前缀捎带出来
  const documents = await host.db.promises.allDocs(HISTORY_PREFIX);
  return documents
    .map((document) => toHistory(splitLegacyBody(document)))
    .sort((left, right) => right.sortKey - left.sortKey);
}

/**
 * 读取一条话题的消息正文。
 * @param id 话题标识（chat@ 开头的索引文档 id）。
 * @returns 消息列表；话题不存在或正文为空时返回空数组。
 */
export async function loadHistoryMessages(id: string): Promise<ChatMessage[]> {
  const body = await host.db.promises.get(bodyIdOf(id));
  return Array.isArray(body?.messages) ? body.messages : [];
}

/**
 * 丢掉最老的图片数据，把会话压到可以写进文档库的体积。
 * 宁可丢图也要保住文字记录——图片片段会留下空占位，界面据此提示图片已清理。
 * @param messages 要保存的消息列表，不会被修改。
 * @param budget 序列化后的字符预算。
 * @returns 可以安全写入的消息副本。
 */
export function stripImagesToFit(messages: ChatMessage[], budget = HISTORY_SIZE_BUDGET): ChatMessage[] {
  // clonePlain 本身就是一次 stringify + parse，顺手把长度量出来：原先是克隆一遍、再
  // stringify 一遍量体积，带图会话每发一条消息就要把几 MB base64 重复铺平两次。
  const serialized = JSON.stringify(messages);
  const next = JSON.parse(serialized) as ChatMessage[];
  let size = serialized.length;
  if (size <= budget) return next;
  for (const message of next) {
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part?.type !== 'image_url' || !part.image_url?.url) continue;
      // 抹掉一个 url 省下的字符数就是它 JSON 编码后的长度减去剩下的那对引号，可以精确算出来。
      // 每抹一张就把整段重新序列化一遍是平方级的，带十几张图的会话会明显卡一下。
      size -= JSON.stringify(part.image_url.url).length - 2;
      part.image_url.url = '';
      if (size <= budget) return next;
    }
  }
  return next;
}

/**
 * 新建或更新一条聊天历史记录。
 * @param history 会话标识、标题、消息及收藏状态；不传 messages 时只改索引，正文原样保留。
 * @returns 写入后的索引记录，供调用方原地更新列表而不必整库重读。
 */
export function saveHistory({ id, title, messages, favorite = false }: HistoryInput): History {
  const document: StorageDocument = splitLegacyBody(host.db.get(id) || { _id: id });
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  document.title = title;
  if (messages) {
    const body = stripImagesToFit(messages);
    const stored = host.db.get(bodyIdOf(id)) || { _id: bodyIdOf(id) };
    stored.messages = body;
    putDocument(stored);
    Object.assign(document, summarize(body));
  }
  document.createdDate ||= now;
  document.updatedDate = now;
  document.updatedAt = Date.now();
  document.isFavorite = favorite;
  const result = putDocument(document);
  if (result?.rev) document._rev = result.rev;
  return toHistory(document);
}

/**
 * 删除指定聊天历史记录，索引和正文一起删。
 * @param id 要删除的会话标识。
 * @returns 无返回值。
 */
export function removeHistory(id: string): void {
  removeDocument(id);
  removeDocument(bodyIdOf(id));
}

let routeSeed = 0;
/**
 * 生成当前运行期内唯一的 API 路线标识。
 * @returns 新生成的路线标识。
 */
export function createRouteId(): string {
  routeSeed += 1;
  return `route-${Date.now().toString(36)}-${routeSeed}`;
}

// 把旧版 apiProxy 数组整个搬过来。老实现只挑 isOpen 那一条、其余直接丢弃，
// 用户配过的多条线路就是这样丢的——这里全部保留。
/**
 * 将旧版单线路或线路数组迁移为当前路线结构。
 * @param legacy 旧版 `apiProxy` 存储值。
 * @returns 可用的 API 路线列表。
 */
export function routesFromLegacy(legacy: unknown): ApiRoute[] {
  // 旧版 apiProxy 的形状，字段全可选：下面读到的每一项都是从磁盘来的，不保证齐整，
  // 连「是不是对象」都由 filter 里那句 item && ... 在运行时兜着。
  type LegacyProxy = { name?: string; url?: string; apiKey?: string; value?: number; isOpen?: boolean };
  const entries = (Array.isArray(legacy) ? legacy : [legacy]) as LegacyProxy[];
  return entries
    .filter((item) => item && (item.url || item.apiKey || item.value === 200))
    .map((item, index) => ({
      id: createRouteId(),
      name: item.name || (item.value === 200 ? 'uTools AI' : `线路 ${index + 1}`),
      provider: item.value === 200 ? 'utools' : 'openai',
      baseUrl: item.url || '',
      apiKey: item.apiKey || '',
      wasActive: Boolean(item.isOpen),
    }));
}

/**
 * 获取设置中当前选中的路线，缺失时回退到第一条。
 * @param settings 含 API 路线的设置对象。
 * @returns 当前路线；没有路线时返回 `null`。
 */
export function activeRoute(settings: Settings): ApiRoute | null {
  const routes = settings?.apiRoutes || [];
  return routes.find((route) => route.id === settings.activeRouteId) || routes[0] || null;
}

// provider/baseUrl/apiKey 作为当前线路的镜像字段保留，
// 这样 streamChat 和各处的「是否已配置」判断都不用改。
/**
 * 将当前路线字段同步到兼容旧调用方的设置镜像字段。
 * @param settings 要同步的设置对象。
 * @returns 同一个已同步的设置对象。
 */
export function syncActiveRoute(settings: Settings): Settings {
  const route = activeRoute(settings);
  if (!route) return settings;
  settings.activeRouteId = route.id;
  settings.provider = route.provider || 'openai';
  settings.baseUrl = route.baseUrl || '';
  settings.apiKey = route.apiKey || '';
  return settings;
}

function ensureRoutes(settings: Settings): Settings {
  if (Array.isArray(settings.apiRoutes) && settings.apiRoutes.length) return syncActiveRoute(settings);
  // 老版本只存了单条，包装成第一条线路
  if (settings.baseUrl || settings.apiKey || settings.provider === 'utools') {
    settings.apiRoutes = [{
      id: createRouteId(),
      name: settings.provider === 'utools' ? 'uTools AI' : '默认线路',
      provider: settings.provider || 'openai',
      baseUrl: settings.baseUrl || '',
      apiKey: settings.apiKey || '',
    }];
  } else {
    settings.apiRoutes = [];
  }
  return syncActiveRoute(settings);
}

/**
 * 读取设置，并在需要时从旧版存储格式迁移路线数据。
 * @returns 当前应用设置。
 */
export function loadSettings(): Settings {
  // 读回来的就是上次 saveSettings 写下去的那份，只是中间过了一趟磁盘，类型得自己认回来
  const stored = host.dbStorage.getItem(SETTINGS_KEY) as Settings | null;
  if (stored) return ensureRoutes({ ...stored, theme: stored.theme || (stored.dark ? 'dark' : 'system') });

  const routes = routesFromLegacy(host.dbStorage.getItem('apiProxy'));
  const preferred = routes.find((route) => route.wasActive) || routes[0];
  for (const route of routes) delete route.wasActive;

  return syncActiveRoute({
    apiRoutes: routes,
    activeRouteId: preferred?.id || '',
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    model: 'gpt-4.1-mini',
    theme: host.dbStorage.getItem('isDark') ? 'dark' : 'system',
    dark: Boolean(host.dbStorage.getItem('isDark')),
  });
}

/**
 * 将设置的纯数据副本写入本地存储。
 * @param settings 要保存的应用设置。
 * @returns 无返回值。
 */
export function saveSettings(settings: Settings): void {
  host.dbStorage.setItem(SETTINGS_KEY, clonePlain(settings));
}
