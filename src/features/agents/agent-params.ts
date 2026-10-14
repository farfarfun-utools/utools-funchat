export type ParamKey =
  | 'contextLength'
  | 'max_tokens'
  | 'temperature'
  | 'top_p'
  | 'frequency_penalty'
  | 'presence_penalty';

export type ParamRow = { key: ParamKey; label: string; min: number; max: number; step: number };

/** 滑块组读的值；调用方（好友表单 / 临时调参）各自持有，组件只读不写。 */
export type ParamValues = Partial<Record<ParamKey, number>>;

/** 「临时调参」能覆盖的东西：滑块那几项，外加一个模型名。 */
export type ParamOverrides = ParamValues & { model?: string };

// 好友弹窗的「参数调节」和输入框上的「临时调参」调的是同一组字段，以前各自维护一份清单，
// 于是同一个滑块在两处叫不同的名字（temperature 这边是「随机性」、那边是「随机属性」），
// 连 presence / frequency 的先后顺序都不一样。合成一份，名字取更贴近参数本义的那套。
export const PARAMETER_ROWS: readonly ParamRow[] = [
  { key: 'contextLength', label: '上下文数', min: 2, max: 36, step: 1 },
  { key: 'max_tokens', label: '最大回复', min: 0, max: 16384, step: 1 },
  { key: 'temperature', label: '随机性', min: 0, max: 2, step: 0.1 },
  { key: 'top_p', label: '核采样', min: 0, max: 1, step: 0.1 },
  { key: 'frequency_penalty', label: '频率惩罚', min: -2, max: 2, step: 0.1 },
  { key: 'presence_penalty', label: '存在惩罚', min: -2, max: 2, step: 0.1 },
];

// uTools AI 只接受 model / messages / tools，采样参数一概丢弃（见 services/chat.ts 的说明）。
// 「上下文数」是本地裁剪消息列表用的，两条线路都算数，所以不在这张名单里。
const INERT_ON_UTOOLS = new Set<ParamKey>(['max_tokens', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty']);

export const INERT_HINT = '这项发不到 uTools AI，换到私有API路线才生效';

/**
 * 判断某项参数在当前线路上是不是发不出去。
 * @param key 参数字段名。
 * @param viaUtools 当前走的是不是 uTools AI 线路。
 * @returns 发不出去返回 `true`，界面据此禁用控件而不是让用户空拖一遍滑块。
 */
export function isInert(key: string, viaUtools: boolean): boolean {
  return viaUtools && INERT_ON_UTOOLS.has(key as ParamKey);
}

/**
 * 算出滑块已填充部分的百分比，供 CSS 自定义属性 `--range-progress` 画轨道。
 * @param row 参数行定义。
 * @param value 当前值。
 * @returns 可直接绑到 `:style` 上的对象。
 */
export function rangeStyle(row: ParamRow, value: unknown): Record<string, string> {
  return { '--range-progress': `${((Number(value) - row.min) / (row.max - row.min)) * 100}%` };
}

/**
 * 读一个参数值，读不出有效数字时退回默认值。
 * @param value 原始值。
 * @param fallback 默认值。
 * @returns 有限数值。
 */
export function paramValue(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}
