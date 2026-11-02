import type { Agent } from '../types.ts';

export function publicAgents(agents: Agent[]) {
  return { agents: agents.map(({ _id, nickname }) => ({ id: _id, name: nickname })) };
}
