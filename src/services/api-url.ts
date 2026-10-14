// 聊天端点和模型列表端点归一化的是同一份用户输入，/v1 要不要补、末尾的 # 和斜杠怎么处理
// 这些约定以前在 chat.ts 和 models.ts 里各写了一份，改一处很容易漏掉另一处。

/**
 * 去掉用户地址末尾的 `#` 和多余斜杠，得到可以继续拼路径的基础地址。
 * @param value 用户填写的地址。
 * @returns 规整后的地址；空输入返回空字符串。
 */
export function trimEndpoint(value: unknown): string {
  return String(value || '').trim().replace(/#$/u, '').replace(/\/+$/u, '');
}

/**
 * 在基础地址后补上 `/v1/<path>`；地址本身已经以 `/v1` 结尾时不重复拼。
 * @param base 已经 `trimEndpoint` 过的基础地址。
 * @param path `/v1` 之后的路径，不带前导斜杠。
 * @returns 完整端点地址。
 */
export function withApiVersion(base: string, path: string): string {
  return `${base.endsWith('/v1') ? base : `${base}/v1`}/${path}`;
}
