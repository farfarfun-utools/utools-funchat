import { clonePlain } from './plain-clone.ts';

// 浏览器调试用的文档库键名。注意不要和 dbStorage 的 `funchat.` 前缀拼出同一个键，
// 否则 db 与 dbStorage 会互相覆盖，测试就会在生产不存在的路径上通过。
const STORAGE_KEY = 'funchat.db.documents';

export type StorageDocument = Record<string, unknown> & { _id: string; _rev?: string };

// 字段与官方声明的 DbResult 对齐（ok / error 是 boolean 而不是字面量 true），
// 否则真机的 db 赋不进 UtoolsHost。
export type DbResult = {
  ok?: boolean;
  id?: string;
  rev?: string;
  error?: boolean;
  name?: string;
  message?: string;
};

export type UtoolsDb = {
  put(document: StorageDocument): DbResult;
  get(id: string): StorageDocument | null;
  remove(document: StorageDocument | string): DbResult;
  allDocs(prefix?: string): StorageDocument[];
  promises: {
    put(document: StorageDocument): Promise<DbResult>;
    get(id: string): Promise<StorageDocument | null>;
    remove(document: StorageDocument | string): Promise<DbResult>;
    allDocs(prefix?: string): Promise<StorageDocument[]>;
  };
};

export type AiChunk = { content?: string; reasoning_content?: string };
export type AiRequest = Promise<unknown> & { abort?: () => void };

/** uTools AI 的模型元信息，字段取自官方声明的 `AiModel`。 */
export type AiModelInfo = { id: string; label?: string; icon?: string; cost?: number; vision?: boolean };

/**
 * 从官方类型声明（utools-api-types）里取出我们用到的那部分接口。
 *
 * 这一行是个验收点，不是装饰：`Pick` 的键名必须真的存在于官方声明里，写错就是类型错误。
 * 之前这里是 `Record<string, any> & { ... }`，手写的名字没人校对，于是 `setExpendHeight`
 * 一直活着——8.0 的名字是 `setExpandHeight`，旧拼写在新客户端上压根不存在，而调用点写的是
 * `host.setExpendHeight?.()`，可选调用把「这个接口没了」咽了下去，设置里的「插件高度」
 * 就一直拖了没反应、也不报错。接口名字交给上游兜底之后，这类问题会在构建时就暴露。
 */
// 真机和浏览器垫片都一定有的接口，签名直接取官方声明。
type AlwaysApi = Pick<typeof utools,
  | 'copyText' | 'copyImage' | 'shellOpenExternal'
  | 'getUser' | 'getPath' | 'showSaveDialog' | 'outPlugin'
  | 'onPluginEnter' | 'onPluginOut' | 'onPluginDetach' | 'onDbPull'
>;

// 可能缺席的接口：AI 能力要看客户端版本和用户是否开通，setExpandHeight 是 8.0 才有的名字。
type OptionalApi = Pick<typeof utools, 'setExpandHeight'>;

// 刻意不写成 `Record<string, any> & ...`：索引签名不会动已声明字段的类型，但会让**没声明**
// 的名字也通过检查并退化成 any——上面那段注释里的 setExpendHeight 就是这么活下来的。
// 用到新接口时在这里补一个键名，让它过一遍官方声明的校对。
export type UtoolsHost = {
  db: UtoolsDb;
  dbStorage: {
    /** 返回的是上次写进去的任意 JSON，键不存在时为 null；调用方自己判形状。 */
    getItem(key: string): unknown;
    setItem(key: string, value: unknown): void;
    removeItem(key: string): void;
  };
  /** 8.0 之前的拼写（官方拼错了）。新客户端上没有这个名字，留着只为兼容老客户端。 */
  setExpendHeight?: (height: number) => boolean;
  // 直接用官方签名（两个重载：传回调是流式，不传则一次性 resolve 出整条消息）。
  // 可空是因为老客户端没有这个接口、用户也可能没开通 AI 能力。
  ai?: typeof utools.ai | null;
  allAiModels?: () => Promise<AiModelInfo[]>;
} & AlwaysApi & Partial<OptionalApi>;

type WebStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function createWebStorage(): WebStorage {
  if (globalThis.localStorage) return globalThis.localStorage;
  const memory = new Map<string, string>();
  return {
    getItem: (key) => (memory.has(key) ? (memory.get(key) as string) : null),
    setItem: (key, value) => { memory.set(key, String(value)); },
    removeItem: (key) => { memory.delete(key); },
  };
}

function revisionOf(document: StorageDocument | undefined): string | undefined {
  return document?._rev || undefined;
}

function createBrowserDb(storage: WebStorage): UtoolsDb {
  const readDocs = (): Map<string, StorageDocument> => new Map(Object.entries(JSON.parse(storage.getItem(STORAGE_KEY) || '{}')));
  const writeDocs = (docs: Map<string, StorageDocument>) => storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(docs)));

  const db = {
    put(document: StorageDocument): DbResult {
      const docs = readDocs();
      const previous = docs.get(document._id);
      // 和真机 db 一样校验 _rev：过期的写入必须报冲突，不能静默覆盖别处的改动
      if (revisionOf(previous) !== revisionOf(document)) {
        return { id: document._id, error: true, name: 'conflict', message: 'Document update conflict' };
      }
      const next = clonePlain(document);
      next._rev = `${Number.parseInt(String(previous?._rev), 10) + 1 || 1}-browser`;
      docs.set(next._id, next);
      writeDocs(docs);
      return { ok: true, id: next._id, rev: next._rev };
    },
    get(id: string): StorageDocument | null {
      return clonePlain(readDocs().get(id) || null);
    },
    remove(document: StorageDocument | string): DbResult {
      const id = typeof document === 'string' ? document : document?._id;
      const docs = readDocs();
      docs.delete(id);
      writeDocs(docs);
      return { ok: true, id };
    },
    allDocs(prefix = ''): StorageDocument[] {
      return [...readDocs().values()].filter((item) => item._id.startsWith(prefix)).map(clonePlain);
    },
  };

  return {
    ...db,
    promises: {
      put: async (document) => db.put(document),
      get: async (id) => db.get(id),
      remove: async (document) => db.remove(document),
      allDocs: async (prefix) => db.allDocs(prefix),
    },
  };
}

function createBrowserUtools(): UtoolsHost {
  const storage = createWebStorage();

  return {
    db: createBrowserDb(storage),
    dbStorage: {
      getItem: (key) => JSON.parse(storage.getItem(`funchat.${key}`) || 'null'),
      setItem: (key, value) => storage.setItem(`funchat.${key}`, JSON.stringify(value)),
      removeItem: (key) => storage.removeItem(`funchat.${key}`),
    },
    getUser: () => ({ nickname: '本地用户', avatar: '', type: 'user' }),
    // 进入插件：真机由 uTools 触发，浏览器里立刻回调一次，模拟「刚打开」
    onPluginEnter: (callback) => callback({ code: 'funchat', type: 'text', payload: '', from: 'main' }),
    onPluginOut: () => {},
    onPluginDetach: () => {},
    // 浏览器里没有同步机制，注册了也永远不会回调；留着只为让调用点不必判空
    onDbPull: () => {},
    // 浏览器预览里「退出插件」无处可退，什么都不做比关掉标签页更不碍事
    outPlugin: () => {},
    setExpandHeight: () => true,
    // 官方签名是同步返回 boolean，而浏览器的剪贴板接口是异步的：发出去就算成功，
    // 不把 Promise 泄漏到调用方（真机那边拿到的也只是一个 boolean）
    copyText: (text) => {
      void navigator.clipboard?.writeText(text);
      return true;
    },
    // 浏览器调试时也让「复制为图片」真的能用，而不是静默失败。
    // 官方还接受 Uint8Array，但本项目只传 data URL，二进制那条分支直接报不支持。
    copyImage: (image) => {
      if (typeof image !== 'string') return false;
      if (typeof ClipboardItem !== 'function' || !navigator.clipboard?.write) return false;
      void (async () => {
        const blob = await (await fetch(image)).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      })();
      return true;
    },
    getPath: () => '',
    // 浏览器里没有保存对话框，返回 undefined 表示「用户取消了」
    showSaveDialog: () => undefined,
    shellOpenExternal: async (url) => { window.open(url, '_blank', 'noopener'); },
    ai: null,
  };
}

export const host: UtoolsHost = globalThis.utools || createBrowserUtools();
// 垫片只实现了本应用用到的那一小部分接口，当然凑不出完整的官方类型。
// 这里把它挂回全局，是为了让直接读 window.utools 的第三方代码（html2canvas 之类）不炸。
globalThis.utools ||= host as unknown as typeof utools;
