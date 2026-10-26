import type { Agent, AgentFormValues, AgentParams } from '../../types.ts';

// 内置的「使用帮助」好友：data/agents.json 里写死的这个 _id 就是它的身份证，
// 删掉它用户就再也看不到使用说明了，所以右键菜单里的删除是禁用的。
// 以前这串数字直接埋在 AgentList 的模板里，换成常量后至少能搜得到、改得动。
const BUILTIN_HELP_AGENT_ID = 'ai@0000000000001';

/**
 * 判断是否为随插件分发、不允许删除的内置好友。
 * @param agent 待判断的好友；传空视为否。
 * @returns 是内置好友则为 `true`。
 */
export function isBuiltinAgent(agent: Agent | null | undefined): boolean {
  return agent?._id === BUILTIN_HELP_AGENT_ID;
}

export const OPTIONAL_PARAM_DEFAULTS = {
  max_tokens: 0,
  temperature: 0.6,
  top_p: 1,
  presence_penalty: 0,
  frequency_penalty: 0,
};

/** 可选模型参数的字段名。`Object.keys` 只给 `string[]`，拿它当索引会退回 any。 */
export type OptionalParamKey = keyof typeof OPTIONAL_PARAM_DEFAULTS;

const OPTIONAL_PARAM_KEYS = Object.keys(OPTIONAL_PARAM_DEFAULTS) as OptionalParamKey[];

const FORM_DEFAULTS: AgentFormValues = {
  model: '',
  type: 'prompt',
  nickname: '',
  info: '',
  content: '',
  prompt: '',
  functions: '',
  callback: '',
  isAiSummary: false,
  autoPrefix: '',
  superPanel: false,
  isFly: false,
  isOverall: false,
  isFlyNewChat: true,
  status: '',
  contextLength: 16,
  ...OPTIONAL_PARAM_DEFAULTS,
  quick_questions: [],
  isFollowQuestion: false,
  api_id: '',
  un_stream: false,
};

/**
 * 把好友文档摊平成编辑表单的初始值。
 * @param agent 要编辑的好友；传空则返回新建用的默认值。
 * @returns 表单各字段的初始值。
 */
export function agentFormValues(agent: Agent | null | undefined): AgentFormValues {
  const values: AgentFormValues = { ...FORM_DEFAULTS, quick_questions: [] };
  if (!agent) return values;
  for (const key of OPTIONAL_PARAM_KEYS) {
    values[key] = Number(agent.params?.[key] ?? OPTIONAL_PARAM_DEFAULTS[key]);
  }
  return Object.assign(values, {
    model: agent.params?.model || '',
    type: agent.isFunAi || agent.params?.functions ? 'function' : 'prompt',
    nickname: agent.nickname || '',
    info: agent.info || '',
    content: agent.content || '',
    prompt: agent.params?.messages?.[0]?.role === 'system' ? agent.params.messages[0].content || '' : '',
    functions: agent.params?.functions ? JSON.stringify(agent.params.functions, null, 2) : '',
    callback: agent.callback || '',
    isAiSummary: Boolean(agent.isAiSummary),
    autoPrefix: agent.autoPrefix || '',
    superPanel: agent.superPanel === true,
    isFly: Boolean(agent.isFly),
    isOverall: Boolean(agent.isOverall),
    isFlyNewChat: agent.isFlyNewChat !== false,
    status: agent.status ?? '',
    contextLength: Number(agent.contextLength) || 16,
    quick_questions: [...(agent.quick_questions || [])],
    isFollowQuestion: Boolean(agent.isFollowQuestion),
    api_id: agent.api_id || '',
    un_stream: Boolean(agent.un_stream),
  });
}

/**
 * 把表单里的可选模型参数写回 params，默认值且原本没有的字段不写入。
 * @param target 要写入的 params 对象。
 * @param original 编辑前的 params，用于判断字段原本是否存在。
 * @param values 表单当前值。
 * @returns 无返回值。
 */
export function writeOptionalParams(target: AgentParams, original: AgentParams | undefined, values: AgentFormValues): void {
  for (const key of OPTIONAL_PARAM_KEYS) {
    const next = Number(values[key]);
    if (!Number.isFinite(next)) continue;
    if (key in (original || {}) || next !== OPTIONAL_PARAM_DEFAULTS[key]) target[key] = next;
    else delete target[key];
  }
}
