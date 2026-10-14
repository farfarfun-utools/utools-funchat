import type { AgentAvatar } from '../../types.ts';

export type MarketAgent = {
  id: string;
  category: string;
  nickname: string;
  info: string;
  content: string;
  prompt: string;
  avatar?: AgentAvatar;
  autoPrefix?: string;
  quick_questions?: string[];
  temperature?: number;
  contextLength?: number;
};

// 角色按分类拆在 ./market/ 下，这里用 glob 收集。
// 刻意不用 eager：300 条提示词有 260 KB 源码，而 AI 市场只是个次级 tab，
// 让它们单独成块、进市场时再下载，首屏不必为此付钱。
const loaders = import.meta.glob<{ default: MarketAgent[] }>('./market/*.ts');

export const ALL_CATEGORY = '全部';

// 分类 tab 的展示顺序，同时也是「这个分类的角色在哪个文件里」的索引。
// 没有这张表就只能把 15 个文件全下下来才知道有哪些分类，按分类加载也就无从谈起；
// 代价是新增分类文件要回来登记一笔，market-agents.test.ts 会盯着这件事，漏了就红。
const CATEGORY_FILES: Record<string, string> = {
  写作: './market/writing.ts',
  开发: './market/dev.ts',
  学习: './market/study.ts',
  效率: './market/efficiency.ts',
  职场: './market/work.ts',
  创意: './market/idea.ts',
  设计: './market/design.ts',
  商业: './market/biz.ts',
  营销: './market/marketing.ts',
  数据: './market/data.ts',
  语言: './market/language.ts',
  生活: './market/life.ts',
  健康: './market/health.ts',
  娱乐: './market/fun.ts',
  情感: './market/mind.ts',
};

export const MARKET_CATEGORIES = Object.keys(CATEGORY_FILES);

function categoryRank(category: string): number {
  const index = MARKET_CATEGORIES.indexOf(category);
  return index < 0 ? MARKET_CATEGORIES.length : index;
}

const cached = new Map<string, MarketAgent[]>();
const pending = new Map<string, Promise<MarketAgent[]>>();

function loadFile(path: string): Promise<MarketAgent[]> {
  const ready = cached.get(path);
  if (ready) return Promise.resolve(ready);
  // 同时落到同一个文件的多次调用共享一个下载
  let task = pending.get(path);
  if (!task) {
    task = (loaders[path]?.() || Promise.resolve({ default: [] as MarketAgent[] }))
      .then((module) => {
        const agents = module.default || [];
        cached.set(path, agents);
        return agents;
      })
      .finally(() => { pending.delete(path); });
    pending.set(path, task);
  }
  return task;
}

function inCategoryOrder(groups: MarketAgent[][]): MarketAgent[] {
  // flat 会跳过还没填上的空位，所以这里拿到的就是「目前已经到货的那些」
  return groups.flat().sort((left, right) => categoryRank(left.category) - categoryRank(right.category));
}

/**
 * 加载 AI 市场的角色，结果在本次运行内缓存。
 * @param category 分类名；传「全部」或未登记的分类时加载所有文件。
 * @param onPartial 全量加载时每到一个文件回调一次，用于边下边显示；单个分类不会触发。
 * @returns 该分类的角色；全量时按分类顺序排好。
 */
export function loadMarketAgents(
  category: string = ALL_CATEGORY,
  onPartial?: (agents: MarketAgent[]) => void,
): Promise<MarketAgent[]> {
  const path = CATEGORY_FILES[category];
  if (path) return loadFile(path);
  // 「全部」确实需要全量：这里按 glob 到的文件算，
  // 即便有分类漏登记在 CATEGORY_FILES 里，角色也不会从「全部」里凭空消失。
  const paths = Object.keys(loaders).sort();
  const groups: MarketAgent[][] = [];
  return Promise.all(paths.map((item, index) => loadFile(item).then((agents) => {
    groups[index] = agents;
    // 15 个文件一起下，谁先到谁先上屏——不然整页要等最慢的那个
    onPartial?.(inCategoryOrder(groups));
  }))).then(() => inCategoryOrder(groups));
}
