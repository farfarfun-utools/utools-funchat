export type { StorageDocument } from './services/utools.ts';

// 文档类型统一写成 `Record<string, unknown> & { 已知字段 }`：
// 好友文档要和原插件导出的数据保持字段级兼容（见 tests/agent-compat.test.ts），
// 不能用封闭类型把未知的历史字段挡在外面，但已知字段仍然要有提示和检查。
//
// 索引签名写 unknown 而不是 any：两者对已知字段的检查是一样的，区别在于没声明的字段——
// any 会让 `agent.typo.whatever` 一路畅通无阻，unknown 则逼着调用处先判一下再用。
// 当初正是 any 放过了 `host.setExpendHeight`（见 services/utools.ts 里的那段）。
// 真正会用到的字段一律在下面声明出来，索引签名只负责「让老文档的陌生字段能原样存回去」。

// 多模态消息片段，字段名沿用 OpenAI 的 chat completions 结构，
// 这样带图的消息可以直接塞进请求体，不需要再转一层。
export type MessagePart = {
  type?: string;
  text?: string;
  image_url?: { url?: string };
  file?: { filename?: string };
};

export type ChatMessage = Record<string, unknown> & {
  role?: string;
  content?: string | MessagePart[] | null;
  error?: boolean;
};

export type AgentAvatar = Record<string, unknown> & {
  type?: 'icon' | 'emoji' | 'image' | 'text' | string;
  icon?: string;
  emoji?: string;
  image?: string;
  text?: string;
  color?: string;
  gradient?: string[];
};

export type AgentParams = Record<string, unknown> & {
  model?: string;
  messages?: ChatMessage[];
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  max_tokens?: number;
  functions?: unknown;
};

export type Agent = Record<string, unknown> & {
  _id: string;
  _rev?: string;
  nickname: string;
  info?: string;
  content?: string;
  avatar?: AgentAvatar;
  contextLength?: number;
  params?: AgentParams;
  autoPrefix?: string;
  superPanel?: boolean;
  quick_questions?: string[];
  is_top?: boolean;
  created_at?: string;
  un_stream?: boolean;
  /** 函数调用型好友；编辑器据此决定填提示词还是填 functions 定义。 */
  isFunAi?: boolean;
  /**
   * 以下字段全部继承自原插件。funchat 里只有编辑好友时把它们读进表单、再原样写回，
   * 没有任何功能读取它们——声明在这里是为了「打开好友、直接保存，文档逐字节不变」
   * （tests/agent-compat.test.ts 守着这条）。哪天真要实现其中一项，把它从这段注释里挪出去。
   */
  isFly?: boolean;
  isOverall?: boolean;
  isFlyNewChat?: boolean;
  isFollowQuestion?: boolean;
  isAiSummary?: boolean;
  callback?: string;
  api_id?: string;
  status?: string;
  /** 当前打开的话题 id，只存在于内存，保存时会被剥掉。 */
  chatId?: string;
};

export type History = Record<string, unknown> & {
  _id: string;
  _rev?: string;
  title?: string;
  /** 正文存在 `chatbody@` 文档里，列表上的记录不带它；用 `loadHistoryMessages` 按需读。 */
  messages?: ChatMessage[];
  /** 落盘时算好的 Token 数，列表直接显示，不必为此把正文读回来。 */
  tokens?: number;
  /** 落盘时抽出的正文纯文本，供搜索使用，不含图片。 */
  searchText?: string;
  isFavorite?: boolean;
  createdDate?: string;
  updatedDate?: string;
  updatedAt?: number;
  /** 由 `_id` 解析出来，不落盘。 */
  agentId: string;
  /** 由 `_id` 里的时间戳解析出来，用于排序，不落盘。 */
  sortKey: number;
};

export type ApiRoute = Record<string, unknown> & {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  /** 从 /v1/models 拉回来的可用模型清单，随线路一起保存。 */
  models?: string[];
  /** 上次拉取模型的时间戳，用于在界面上提示清单的新鲜度。 */
  modelsFetchedAt?: number;
  /** 仅迁移期间使用：标记旧数据里处于启用状态的那条线路。 */
  wasActive?: boolean;
};

export type ThemePreference = 'light' | 'dark' | 'system';

/** 设置里由本插件写入、有明确含义的字段。`updateSetting` 按键名查类型就靠它。 */
export type KnownSettings = {
  apiRoutes?: ApiRoute[];
  activeRouteId?: string;
  /** 以下三项是当前线路的镜像字段，由 `syncActiveRoute` 维护。 */
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  theme?: ThemePreference;
  dark?: boolean;
  /** 输入框的发送键，默认 `ctrl-enter`。 */
  sendMode?: 'enter' | 'ctrl-enter';
  /** 插件在 uTools 主面板里的高度（像素）；分离成独立窗口后宿主会忽略它。 */
  windowHeight?: number;
};

export type Settings = Record<string, unknown> & KnownSettings;

export type HistoryInput = {
  id: string;
  title: string;
  /** 不传表示只改索引（标题、收藏），正文保持原样。 */
  messages?: ChatMessage[];
  favorite?: boolean;
};

export type AgentFormValues = Record<string, unknown> & {
  model: string;
  type: string;
  /** 编辑中的头像；新建好友时为空，由 `addAgent` 兜一个默认图标。 */
  avatar?: AgentAvatar;
  nickname: string;
  info: string;
  content: string;
  prompt: string;
  functions: string;
  callback: string;
  isAiSummary: boolean;
  autoPrefix: string;
  superPanel: boolean;
  isFly: boolean;
  isOverall: boolean;
  isFlyNewChat: boolean;
  status: string;
  contextLength: number;
  max_tokens: number;
  temperature: number;
  top_p: number;
  presence_penalty: number;
  frequency_penalty: number;
  quick_questions: string[];
  isFollowQuestion: boolean;
  api_id: string;
  un_stream: boolean;
  paramsFunctions?: unknown;
};

export type AppView = 'chat' | 'prompts' | 'settings' | string;

export type AppState = {
  ready: boolean;
  agents: Agent[];
  currentAgent: Agent | null;
  messages: ChatMessage[];
  histories: History[];
  settings: Settings;
  loading: boolean;
  error: string;
  saveError: string;
  historyOpen: boolean;
  sidebarCollapsed: boolean;
  view: AppView;
};
