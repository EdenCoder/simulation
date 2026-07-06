import { tool } from "ai";
import { z } from "zod";

/**
 * Heuristic: does this message announce a C-Score reward/punishment?
 * Used to nudge guards who narrate a score change but forget to set `cscore`.
 */
function mentionsCScoreChange(message: string): boolean {
  return /c-?\s?score|compliance score|\bpoints?\b|deduct|reward|punish|solitary/i.test(
    message,
  );
}

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
         // If already in a chat, that's OK — just inform the agent, and name
        // who is in it so they notice when it's not who they meant to address.
        const existingChatId = deps.getCurrentChatId();
        if (existingChatId) {
          const others = deps
            .getChatParticipants?.(existingChatId)
            ?.filter((p) => p.id !== deps.agentId)
            .map((p) => p.name)
            .join(", ");
          return {
            success: true,
            outcome: `You are already in a conversation${others ? ` with ${others}` : ""}. Use "say" to speak to them, or "leave_chat" first to start a new one with ${target_name}.`,
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
            outcome: cscore
              ? `You are not in a conversation, so your message was not sent and the C-Score change (${cscore}) was NOT applied. Use start_chat first, then say again with cscore set.`
              : "You are not in a conversation. Use start_chat first.",
          };
        }

        // Resolve and apply the C-Score change BEFORE sending the message, so
        // the score snapshot stamped onto the message already reflects it. If
        // the send fails afterwards, the change is rolled back below.
        let targets: Array<{ id: string; name: string; role: string }> = [];
        let scoreOutcome = "";
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

          if (cscore_target) {
            // Prefer an exact name match; only fall back to a substring match
            // when there is no exact one (so "Prisoner #1" doesn't also hit
            // "Prisoner #11").
            const wanted = cscore_target.toLowerCase().trim();
            const exact = prisoners.filter(
              (p) => p.name.toLowerCase() === wanted,
            );
            const partial = prisoners.filter((p) =>
              p.name.toLowerCase().includes(wanted),
            );
            targets = exact.length > 0 ? exact : partial;
            if (targets.length === 0) {
              const names = prisoners.map((p) => p.name).join(", ");
              return {
                success: false,
                outcome: `${cscore_target} is not in this conversation (prisoners here: ${names || "none"}). Your message was NOT sent and no C-Score was changed. Use start_chat with ${cscore_target} first, then say again with cscore set.`,
              };
            }
          } else if (prisoners.length > 1) {
            // No explicit target and multiple prisoners present: default to the
            // prisoner being addressed — the one who most recently spoke —
            // rather than applying the change to every prisoner in the room.
            targets = prisoners;
            const messages = deps.getMessages(chatId);
            for (let i = messages.length - 1; i >= 0; i--) {
              const speaker = prisoners.find((p) => p.id === messages[i].id);
              if (speaker) {
                targets = [speaker];
                break;
              }
            }
          } else {
            targets = prisoners;
          }

          if (targets.length === 0) {
            return {
              success: false,
              outcome:
                "There is no prisoner in this conversation to apply a C-Score change to. Your message was NOT sent and no score was changed.",
            };
          }

          const verb = cscore < 0 ? "Deducted" : "Added";
          const mag = Math.abs(cscore);
          const applied = targets.map((p) => {
            const total = deps.adjustCScore!(p.id, cscore);
            return `${p.name} (new C-Score: ${total})`;
          });
          scoreOutcome = ` ${verb} ${mag} C-Score point${mag === 1 ? "" : "s"} ${cscore < 0 ? "from" : "to"} ${applied.join(", ")}.`;
        }

        const result = deps.sendMessage(chatId, {
          id: deps.agentId,
          name: deps.agentName,
          content: message,
          timestamp: Date.now(),
        });

        if (!result.success) {
          // The message did not go out; undo the score change so speech and
          // score never diverge.
          if (scoreOutcome && cscore) {
            for (const p of targets) deps.adjustCScore!(p.id, -cscore);
          }
          return scoreOutcome
            ? {
                success: false,
                outcome: `${result.outcome} No C-Score was changed.`,
              }
            : result;
        }

        // Notify chat partners to respond quickly
        deps.onMessageSent?.(chatId, deps.agentId);

        if (scoreOutcome) {
          return { success: true, outcome: `${result.outcome}${scoreOutcome}` };
        }

        // The guard narrated a reward/punishment but didn't actually set
        // `cscore` (or set it to 0), so no score changed. Nudge them to
        // confirm - announcing a change without applying it is a no-op.
        if (
          deps.canAdjustCScore &&
          (cscore === undefined || cscore === 0) &&
          mentionsCScoreChange(message)
        ) {
          return {
            success: true,
            outcome: `${result.outcome} (Your message mentions a C-Score reward or punishment, but you did not set the \`cscore\` parameter, so no score changed. Are you sure you meant to add or subtract C-Score? If so, say again with cscore set, e.g. cscore: -1 or cscore: 1.)`,
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
