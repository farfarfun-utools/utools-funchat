// 全量备份：把插件的全部数据导成一份 JSON，以及从这份 JSON 整库恢复回来。
//
// 为什么需要它：数据全在 uTools 自己的数据库里，卸载插件会一并删除，而原来插件只有
// 「导出 Markdown / HTML / PDF」—— 那是给人看的，丢掉了角色、模型参数和话题结构，导不
// 回来，当不了备份。换设备除了开 uTools 会员的数据同步之外没有别的手段。
//
// 备份里**含明文 API 密钥**。这是有意的：恢复完还要手动把几个服务的密钥重新填一遍，
// 那这份备份就只恢复了一半，而「少了什么」恰恰是最不容易当场发现的（funotp 也是这么
// 做的）。代价是这个文件等同于凭据，所以界面上的确认框、README 都必须把这件事说在明
// 面上 —— 见 docs/roadmap.md 里记的那三件配套事项。
//
// 这一层只碰数据库和 dbStorage，不碰 Vue：恢复之后界面怎么跟上由 store 的 reload 负责。
import { clonePlain } from './plain-clone.ts';
import { host } from './utools.ts';
import { loadSettings, saveSettings } from './storage.ts';
import type { StorageDocument } from './utools.ts';
import type { Settings } from '../types.ts';

/**
 * 备份格式版本。读到更大的版本号就整份拒绝，免得按旧字段猜新结构 —— 猜错的表现是
 * 「恢复成功了但东西不对」，比直接报错难查得多。
 */
export const BACKUP_VERSION = 1;

/**
 * 要备份的文档前缀。
 *
 * 用白名单而不是 allDocs('') 整库捞：将来多出别的文档（草稿、缓存之类），默认不该进备份，
 * 而不是被悄悄带上。注意 'chatbody@' 必须单独列 —— 它不以 'chat@' 开头（'chatb' ≠ 'chat@'），
 * 漏了它备份里就只有话题标题，正文一条都没有。
 */
const BACKUP_PREFIXES = ['ai@', 'chat@', 'chatbody@'];

export type Backup = {
  /** 格式版本，见 BACKUP_VERSION。 */
  funchat: number;
  exportedAt: number;
  /** 全部设置，含 API 路线与明文密钥。 */
  settings: Settings;
  /** 好友（ai@）、话题索引（chat@）、话题正文（chatbody@）。消息里的图片是内联的，跟着正文一起走。 */
  documents: StorageDocument[];
};

/** 解析结果。dropped 是被丢掉的脏条目数，界面要如实报给用户。 */
export type ParsedBackup = { backup: Backup; dropped: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBackupDocument(value: unknown): value is StorageDocument {
  if (!isPlainObject(value) || typeof value._id !== 'string') return false;
  return BACKUP_PREFIXES.some((prefix) => (value._id as string).startsWith(prefix));
}

/**
 * 读出当前全部数据。
 *
 * 用同步的 allDocs：这是用户点了「导出」之后的一次性操作，卡一下无所谓，而异步版要把三类
 * 文档串起来读，反而更啰嗦。设置走 loadSettings 而不是直接读 dbStorage —— 键名和旧格式
 * 迁移都在 storage.ts 里，这里不该再有第二份。
 *
 * @param now 导出时间，便于测试固定输出。
 * @returns 可直接序列化的备份对象。
 */
export function buildBackup(now = Date.now()): Backup {
  const documents: StorageDocument[] = [];
  for (const prefix of BACKUP_PREFIXES) documents.push(...host.db.allDocs(prefix));
  return {
    funchat: BACKUP_VERSION,
    exportedAt: now,
    settings: clonePlain(loadSettings()),
    // _rev 是本机数据库的修订号，换台机器没有任何意义，留着只会在恢复时撞冲突。
    documents: documents.map((document) => {
      const copy = clonePlain(document);
      delete copy._rev;
      return copy;
    }),
  };
}

/**
 * 序列化备份。
 * @param backup 备份对象。
 * @returns JSON 文本。缩进 2 空格、末尾带换行：这份文件会落在用户自己的目录里，
 *   有人会拿 git 管它，压成一行的 diff 没法看。
 */
export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

/**
 * 解析并校验一份备份。
 *
 * 整份拒绝（返回 null）只有三种情况：不是 JSON、不是本插件的备份、版本比我们认识的新。
 * 其余一律「能认多少认多少」：单条文档坏了就跳过并计入 dropped，由界面如实报出来 ——
 * 一个字段不对就把整份备份判死，用户手上那份可能是唯一的一份。
 *
 * @param text 备份文件内容。
 * @returns 解析结果；不是可用的备份时返回 null。
 */
export function parseBackup(text: string): ParsedBackup | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(raw)) return null;
  // funchat 这个键同时起到「是不是本插件的备份」的作用：别的 JSON 不会有它。
  if (typeof raw.funchat !== 'number' || raw.funchat > BACKUP_VERSION) return null;
  if (!isPlainObject(raw.settings)) return null;
  if (!Array.isArray(raw.documents)) return null;

  const documents = raw.documents.filter(isBackupDocument).map((document) => {
    const copy = clonePlain(document);
    delete copy._rev;
    return copy;
  });

  return {
    backup: {
      funchat: raw.funchat,
      exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
      settings: raw.settings as Settings,
      documents,
    },
    dropped: raw.documents.length - documents.length,
  };
}

/**
 * 用备份整库替换当前数据。
 *
 * 是替换而不是合并：合并要面对「同一条话题两边都改过」这种没有正确答案的情况，而备份的
 * 语义本来就是「回到那一刻」。所以先把三类文档清掉再写入 —— 界面上必须先问过用户。
 *
 * @param backup 已经过 parseBackup 校验的备份。
 * @returns 写入成功的文档数，以及写失败的条数（失败不该静默，界面要报出来）。
 */
export function applyBackup(backup: Backup): { documents: number; failed: number } {
  for (const prefix of BACKUP_PREFIXES) {
    for (const document of host.db.allDocs(prefix)) host.db.remove(document);
  }

  let documents = 0;
  let failed = 0;
  for (const source of backup.documents) {
    const document = clonePlain(source);
    delete document._rev;
    let result = host.db.put(document);
    // 上面刚清过库，正常不会撞 _rev 冲突；但备份里可能有重复 _id（手工拼过的文件），
    // 第二条就会撞上。取当前修订号重试一次，而不是把这条数据悄悄丢掉。
    if (result?.error) {
      const current = host.db.get(document._id);
      result = current ? host.db.put({ ...document, _rev: current._rev }) : result;
    }
    if (result?.error) failed += 1;
    else documents += 1;
  }

  // 设置放最后写：万一上面中途抛了，至少不会出现「密钥已经换成备份里的、而会话还是旧的」
  // 这种半截状态 —— 那种状态下用户下一句话就会发到另一个服务商那里去。
  saveSettings(backup.settings);
  return { documents, failed };
}

/**
 * 备份文件名。
 * @param date 日期，默认当天。
 * @returns 形如 `funchat-2026-10-18.json`。
 */
export function backupFilename(date = new Date()): string {
  // toISOString 是 UTC，东八区的深夜会写成前一天。按本地日期拼。
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `funchat-${date.getFullYear()}-${month}-${day}.json`;
}
