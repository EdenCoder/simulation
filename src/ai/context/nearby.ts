import { useChatsStore } from "@/store/chats";

/**
 * Build a system prompt section listing nearby agents, including which
 * region each of them is in when a region resolver is provided.
 */
export function getNearbyContext(
  agentId: string,
  getRegion?: (agentId: string) => string,
): string {
  const nearby = useChatsStore.getState().getNearbyAgents(agentId);
  if (nearby.length === 0) return "[Nearby Agents] No one is nearby.";

  const lines = nearby.map((a) => {
    const chatNote = a.inChat ? " (in conversation)" : "";
    const region = getRegion?.(a.id);
    const regionNote = region && region !== "unknown" ? `, in ${region}` : "";
    return `- ${a.name} (${Math.round(a.distance)} units away${regionNote})${chatNote}`;
  });

  return `[Nearby Agents] You can see these people and already know their location — do not ask them where they are.\n${lines.join("\n")}`;
}
