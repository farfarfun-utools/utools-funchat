import { host } from './utools.ts';
import type { AiChunk, AiRequest, UtoolsHost } from './utools.ts';

type AiInvoker = NonNullable<UtoolsHost['ai']>;
type ChatMessage = { role?: string; content?: unknown };
type ChatParams = Record<string, unknown> & { model?: string; messages: ChatMessage[]; stream: boolean; max_tokens?: number };
type StreamChatOptions = {
  settings: { provider?: string; baseUrl?: string; apiKey?: string; model?: string };
  agent: { params?: Record<string, unknown> & { model?: string }; un_stream?: boolean };
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
};

/**
 * 将用户配置的服务地址规范化为 OpenAI 聊天补全端点。
 * @param value 用户填写的基础地址或完整端点；末尾 `#` 表示禁止自动补全路径。
 * @returns 可请求的端点地址；空输入返回空字符串。
 */
export function normalizeChatUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (raw.endsWith('#')) return raw.slice(0, -1);
  const base = raw.replace(/\/$/u, '');
  if (!base) return '';
  if (base.endsWith('/chat/completions')) return base;
  return `${base.endsWith('/v1') ? base : `${base}/v1`}/chat/completions`;
}

function readChoice(payload: any): string {
  return payload?.choices?.[0]?.delta?.content
    ?? payload?.choices?.[0]?.message?.content
    ?? payload?.content
    ?? '';
}

/**
 * 判断文本块是否符合 Server-Sent Events 字段格式。
 * @param text 待检查的响应文本。
 * @returns 包含 SSE 字段时返回 `true`。
 */
export function isEventStream(text: string): boolean {
  return /^(?::|data:|event:|id:|retry:)/mu.test(text);
}

/**
 * 从 SSE 文本中提取聊天增量内容，忽略空事件和 `[DONE]` 标记。
 * @param text 一个或多个 SSE 事件组成的文本。
 * @returns 按出现顺序拼接的内容；无法解析的 data 行保留原文。
 */
export function parseEventStream(text: string): string {
  return text.split(/\r?\n/u).flatMap((line) => {
    if (!line.startsWith('data:')) return [];
    const value = line.slice(5).trim();
    if (!value || value === '[DONE]') return [];
    try {
      return [readChoice(JSON.parse(value))];
    } catch {
      return [value];
    }
  }).join('');
}

function bindAbort(pending: AiRequest, signal?: AbortSignal): void {
  const abort = pending?.abort?.bind(pending);
  if (!signal || !abort) return;
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
}

/**
 * uTools AI 线路。
 *
 * `utools.ai()` 只认 `model` / `messages` / `tools` 三个字段（见 utools-api-types 的
 * `AiOptions`），其余一概丢弃。以前这里把 `agent.params` 整个展开进去，于是好友弹窗的
 * 「参数」分页、输入框上的「模型参数」弹窗，以及市场里 300 个角色各自调好的 temperature，
 * 在这条线路上全是空转——用户以为调了，其实一直按模型默认值在跑。现在只发它认的字段，
 * 这个限制改由界面按线路讲清楚（见 ChatPopover 的提示），而不是假装生效。
 *
 * `tools` 故意不发：函数调用要有 `utools.registerTool()` 的实现才算闭环，
 * 光声明只会让模型去调一个没人接的工具。
 */
async function useUtoolsAi(ai: AiInvoker, params: ChatParams, stream: boolean, onDelta: (chunk: string) => void, signal?: AbortSignal): Promise<void> {
  // 这里断言一次是必要的，不是偷懒：官方把 `Message.content` 声明成 `string`，而带图提问
  // 必须把 content 发成片段数组（text + image_url，见 message-content.ts），uTools 的视觉
  // 能力本身是支持的——声明比运行时窄。role 同理，本项目内部一路按可选的 string 传。
  const options = { messages: params.messages, ...(params.model ? { model: params.model } : {}) } as Parameters<AiInvoker>[0];

  if (!stream) {
    // 非流式走另一个重载：不传回调时 ai() 直接 resolve 出整条消息。
    // 「非流输出」开关以前在这条线路上同样是空转的——它发的是 OpenAI 的 `stream: false` 字段，
    // 而 uTools 判断流式与否只看有没有传回调，于是开关怎么拨都是流式。
    const pending = ai(options);
    bindAbort(pending, signal);
    const message = (await pending) as AiChunk | undefined;
    if (message?.reasoning_content) onDelta(`:::thinking\n${message.reasoning_content}\n:::\n`);
    if (message?.content) onDelta(message.content);
    return;
  }

  let thinking = false;
  const pending = ai(options, (chunk: AiChunk = {}) => {
    if (chunk.reasoning_content) {
      if (!thinking) onDelta(':::thinking\n');
      thinking = true;
      onDelta(chunk.reasoning_content);
    }
    if (chunk.content) {
      if (thinking) {
        onDelta('\n:::\n');
        thinking = false;
      }
      onDelta(chunk.content);
    }
  });
  bindAbort(pending, signal);
  await pending;
}

/**
 * 通过 uTools AI 或用户配置的 OpenAI 兼容接口流式发送一次对话。
 * @param options 请求设置、角色参数、消息、取消信号和增量回调。
 * @returns 响应流消费完成后结束；配置缺失或远端请求失败时抛出错误。
 */
export async function streamChat({ settings, agent, messages, signal, onDelta }: StreamChatOptions): Promise<void> {
  const ai = host.ai;
  const viaUtools = settings.provider === 'utools' && typeof ai === 'function';
  const stream = !agent.un_stream;
  const params: ChatParams = {
    ...agent.params,
    // uTools AI 线路上留空就是「用 uTools 的默认模型」，硬塞一个 gpt-4.1-mini 反而可能
    // 不在用户的可用清单里；私有 API 线路没有默认可言，仍然兜一个常见的小模型。
    model: agent.params?.model || settings.model || (viaUtools ? '' : 'gpt-4.1-mini'),
    messages,
    stream,
  };
  if (!params.max_tokens) delete params.max_tokens;
  if (!params.model) delete params.model;

  if (viaUtools) {
    await useUtoolsAi(ai as AiInvoker, params, stream, onDelta, signal);
    return;
  }

  const url = normalizeChatUrl(settings.baseUrl);
  if (!url) throw new Error('请先在设置中配置 OpenAI 兼容接口，或选择 uTools AI。');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify(params),
    signal,
  });
  if (!response.ok) {
    const body = await response.text();
    try {
      throw new Error(JSON.parse(body).error?.message || body || `HTTP ${response.status}`);
    } catch (error) {
      throw error instanceof SyntaxError ? new Error(body || `HTTP ${response.status}`) : error;
    }
  }

  if (response.headers.get('content-type')?.includes('application/json')) {
    onDelta(readChoice(await response.json()));
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('服务端没有返回可读取的响应');
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const parts = pending.split(/\r?\n\r?\n/u);
    pending = parts.pop() || '';
    for (const part of parts) onDelta(isEventStream(part) ? parseEventStream(part) : part);
    if (done) break;
  }
  if (pending) onDelta(isEventStream(pending) ? parseEventStream(pending) : pending);
}
