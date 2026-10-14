import { messageText } from '../chat/token-count.ts';
import type { ChatMessage } from '../../types.ts';

// 只要求排序键，正文从 searchText（落盘时抽好的纯文本）或 messages 里取，
// 这样搜索既能用在历史索引上，也能用在测试里的简化记录上。
type HistoryRecord = Record<string, unknown> & {
  title?: string;
  searchText?: string;
  messages?: ChatMessage[];
  sortKey: number;
};

function normalize(value: unknown): string {
  return String(value || '').toLocaleLowerCase('zh-CN');
}

// 侧边栏的全局搜索每敲一个键都要重新过一遍全部历史，而拼小写长串的代价和消息总字数成正比：
// 300 条会话就是每次按键几 MB 的字符串操作。按记录对象缓存，落盘时 upsertHistory 会换上新的
// 记录对象，WeakMap 条目自然失效；title / messages 的恒等比较再兜住原地改写的情况。
const haystackCache = new WeakMap<object, { title: unknown; source: unknown; text: string }>();

function haystackOf(record: HistoryRecord): string {
  const source = record.searchText ?? record.messages;
  const cached = haystackCache.get(record);
  if (cached && cached.title === record.title && cached.source === source) return cached.text;
  const body = typeof source === 'string' ? source : (source || []).map(messageText).join(' ');
  const text = normalize(`${record.title || ''} ${body}`);
  haystackCache.set(record, { title: record.title, source, text });
  return text;
}

function parseTerms(query: unknown): string[] {
  return normalize(query).trim().split(/\s+/u).filter(Boolean);
}

function matchesTerms(record: HistoryRecord, terms: readonly string[]): boolean {
  if (!terms.length) return true;
  const haystack = haystackOf(record);
  return terms.every((term) => haystack.includes(term));
}

/**
 * 判断一条历史记录的标题或消息正文是否包含全部搜索词。
 * @param record 待匹配的历史记录。
 * @param query 以空白分隔的搜索词；空查询匹配所有记录。
 * @returns 全部搜索词均命中时返回 `true`。
 */
export function matchesHistoryQuery(record: HistoryRecord, query: unknown): boolean {
  return matchesTerms(record, parseTerms(query));
}

/**
 * 预解析搜索词，返回可重复套用的匹配函数。
 * 调用方自己做筛选（例如还要按收藏分页）时用它，避免每条记录都重新解析一遍搜索词。
 * @param query 以空白分隔的搜索词；空查询得到的函数匹配所有记录。
 * @returns 判定单条记录是否命中的函数。
 */
export function historyMatcher(query: unknown): (record: HistoryRecord) => boolean {
  const terms = parseTerms(query);
  return (record) => matchesTerms(record, terms);
}

/**
 * 筛选历史记录，并按最新顺序限制返回数量。
 * @param records 候选历史记录。
 * @param query 搜索文本；空查询返回空数组。
 * @param limit 最大返回数量，默认为 30。
 * @returns 匹配且按 `sortKey` 降序排列的记录。
 */
export function filterHistoryRecords<T extends HistoryRecord>(records: readonly T[], query: unknown, limit = 30): T[] {
  // 搜索词只解析一次，而不是每条记录都重新归一化、切分一遍
  const terms = parseTerms(query);
  if (!terms.length) return [];
  return records
    .filter((record) => matchesTerms(record, terms))
    .sort((left, right) => right.sortKey - left.sortKey)
    .slice(0, limit);
}
