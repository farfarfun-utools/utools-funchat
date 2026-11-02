import { expect, test } from 'vitest';
import { publicAgents } from '../src/services/agent-tools.ts';
import type { Agent } from '../src/types.ts';

test('AI 角色目录不包含提示词、模型配置和密钥', () => {
  const agents = [{ _id: 'agent-1', nickname: '写作', content: '私有提示词', params: { model: 'private' }, apiKey: 'secret' }] as Agent[];
  expect(publicAgents(agents)).toEqual({ agents: [{ id: 'agent-1', name: '写作' }] });
});
