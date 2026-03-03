import { useChatsStore } from '@/store/chats';

/** Build a system prompt section listing nearby agents. */
export function getNearbyContext(agentId: string): string {
  const nearby = useChatsStore.getState().getNearbyAgents(agentId);
  if (nearby.length === 0) return '[Nearby] No one is nearby.';

  const lines = nearby.map((a) => {
    const chatNote = a.inChat ? ' (in conversation)' : '';
    return `- ${a.name} (${Math.round(a.distance)} units away)${chatNote}`;
  });

  return `[Nearby Agents]\n${lines.join('\n')}`;
}
