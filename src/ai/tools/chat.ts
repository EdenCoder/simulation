import { tool } from "ai";
import { z } from "zod";

export interface ChatDeps {
  agentId: string;
  agentName: string;
  getCurrentChatId: () => string | null;
  getNearbyAgents: () => Array<{
    id: string;
    name: string;
    distance: number;
    inChat?: string;
  }>;
  createChat: (participantIds: string[]) => {
    success: boolean;
    chatId?: string;
    outcome: string;
  };
  joinChat: (chatId: string) => { success: boolean; outcome: string };
  leaveChat: (chatId: string) => { success: boolean; outcome: string };
  sendMessage: (
    chatId: string,
    message: { id: string; name: string; content: string; timestamp: number },
  ) => { success: boolean; outcome: string };
  getMessages: (
    chatId: string,
  ) => Array<{ id: string; name: string; content: string; timestamp: number }>;
  /** Called after a message is sent to notify partners to respond. */
  onMessageSent?: (chatId: string, speakerId: string) => void;
  /** Whether this agent may change C-Scores via `say` (guards only). */
  canAdjustCScore?: boolean;
  /** Participants of a chat with their roles, for resolving the cscore target. */
  getChatParticipants?: (
    chatId: string,
  ) => Array<{ id: string; name: string; role: string }>;
  /** Apply a C-Score delta (positive adds, negative subtracts); returns new total. */
  adjustCScore?: (prisonerId: string, delta: number) => number;
}

export function createChatTools(deps: ChatDeps) {
  return {
    start_chat: tool({
      description:
        'Start or join a conversation with a nearby agent. You MUST call this before using "say". If the target is already in a chat, you will join their chat.',
      parameters: z.object({
        target_name: z
          .string()
          .describe(
            'The exact name of the agent (e.g. "Prisoner #1" or "Guard #2")',
          ),
      }),
      execute: async ({ target_name }) => {
        // If already in a chat, that's OK — just inform the agent
        const existingChatId = deps.getCurrentChatId();
        if (existingChatId) {
          return {
            success: true,
            outcome: `You are already in a conversation. Use "say" to speak, or "leave_chat" first to start a new one.`,
          };
        }

        const nearby = deps.getNearbyAgents();
        const target = nearby.find(
          (a) => a.name.toLowerCase() === target_name.toLowerCase(),
        );
        if (!target) {
          const nearbyNames = nearby.map((a) => a.name).join(", ");
          return {
            success: false,
            outcome: `${target_name} is not nearby. Nearby agents: ${nearbyNames || "none"}`,
          };
        }

        // If target is already in a chat, join it
        if (target.inChat) {
          return deps.joinChat(target.inChat);
        }

        // Create a new chat session
        return deps.createChat([deps.agentId, target.id]);
      },
    }),

    say: tool({
      description:
        "Say something in your current conversation. You must have an active chat (use start_chat first). Guards: when your message rewards or punishes a prisoner, set `cscore` to change their C-Score in the same call (e.g. -1 to deduct a point, 2 to reward two).",
      parameters: z.object({
        message: z.string().describe("What you want to say aloud"),
        cscore: z
          .number()
          .int()
          .optional()
          .describe(
            "Guards only. C-Score change to apply to the prisoner you are addressing: negative to punish (e.g. -1), positive to reward (e.g. 2). Set this WHENEVER your message announces a reward or punishment — otherwise the score does not change.",
          ),
        cscore_target: z
          .string()
          .optional()
          .describe(
            "Exact name of the prisoner the cscore applies to. Only needed when more than one prisoner is in the conversation; otherwise it defaults to the prisoner you are talking to.",
          ),
      }),
      execute: async ({ message, cscore, cscore_target }) => {
        const chatId = deps.getCurrentChatId();
        if (!chatId) {
          return {
            success: false,
            outcome: "You are not in a conversation. Use start_chat first.",
          };
        }

        const result = deps.sendMessage(chatId, {
          id: deps.agentId,
          name: deps.agentName,
          content: message,
          timestamp: Date.now(),
        });

        if (!result.success) return result;

        // Notify chat partners to respond quickly
        deps.onMessageSent?.(chatId, deps.agentId);

        // Inline C-Score change. Folding this into `say` means the
        // announcement and the actual score change happen in one call — the
        // model can't narrate a punishment without applying it.
        if (
          cscore !== undefined &&
          cscore !== 0 &&
          deps.canAdjustCScore &&
          deps.adjustCScore &&
          deps.getChatParticipants
        ) {
          const prisoners = deps
            .getChatParticipants(chatId)
            .filter((p) => p.role === "prisoner" && p.id !== deps.agentId);

          let targets = prisoners;
          if (cscore_target) {
            const wanted = cscore_target.toLowerCase();
            const matched = prisoners.filter(
              (p) =>
                p.name.toLowerCase() === wanted ||
                p.name.toLowerCase().includes(wanted),
            );
            if (matched.length > 0) targets = matched;
          }

          if (targets.length === 0) {
            return {
              success: true,
              outcome: `${result.outcome} (Note: no prisoner in this conversation to apply a C-Score change to.)`,
            };
          }

          const verb = cscore < 0 ? "Deducted" : "Added";
          const mag = Math.abs(cscore);
          const applied = targets.map((p) => {
            const total = deps.adjustCScore!(p.id, cscore);
            return `${p.name} (new C-Score: ${total})`;
          });
          return {
            success: true,
            outcome: `${result.outcome} ${verb} ${mag} C-Score point${mag === 1 ? "" : "s"} ${cscore < 0 ? "from" : "to"} ${applied.join(", ")}.`,
          };
        }

        return result;
      },
    }),

    leave_chat: tool({
      description:
        "Leave your current conversation. Call this when you are done talking.",
      parameters: z.object({}),
      execute: async () => {
        const chatId = deps.getCurrentChatId();
        if (!chatId)
          return { success: false, outcome: "You are not in a conversation." };
        return deps.leaveChat(chatId);
      },
    }),
  };
}
