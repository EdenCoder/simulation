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

/**
 * Match the first "Prisoner #N" mentioned in a message to a chat participant,
 * or undefined if none matches. Used to route a C-Score change to the prisoner
 * the guard named.
 */
function firstNamedPrisoner<T extends { name: string }>(
  message: string,
  prisoners: T[],
): T | undefined {
  const mention = message.match(/prisoner\s*#?\s*(\d+)/i);
  if (!mention) return undefined;
  const num = mention[1];
  return prisoners.find((p) => p.name.match(/\d+/)?.[0] === num);
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
    message: {
      id: string;
      name: string;
      content: string;
      timestamp: number;
      cScoreChange?: { target: string; delta: number };
    },
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

/** Grace a guard must give a prisoner to reply before a non-response deduction lands. */
const RESPONSE_GRACE_MS = 15_000;

export function createChatTools(deps: ChatDeps) {
  // True once this agent speaks this tick; used to block leaving in the same turn.
  let spokeThisTurn = false;
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
            'Exact name of the prisoner the cscore applies to (e.g. "Prisoner #5"). Always set this to the prisoner you name in your message. Required when more than one prisoner is present; if omitted there, the change is routed to the prisoner named in your message, or refused if that is unclear.',
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

        // Resolve and apply the C-Score change before sending, and record it on
        // the outgoing message. If the send fails, it is rolled back below so
        // speech and score never diverge.
        let targets: Array<{ id: string; name: string; role: string }> = [];
        let scoreOutcome = "";
        let cScoreChange: { target: string; delta: number } | undefined;
        let heldTarget: string | undefined;
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
            if (targets.length > 1) {
              // A vague partial target could match several prisoners; make the
              // guard name one exactly rather than scoring all of them.
              const names = targets.map((p) => p.name).join(", ");
              return {
                success: false,
                outcome: `"${cscore_target}" matches multiple prisoners here (${names}). Your message was NOT sent and no C-Score was changed. Say again with cscore_target set to one exact name.`,
              };
            }
          } else if (prisoners.length > 1) {
            // No explicit target: prefer the prisoner named in the message,
            // since the most-recent speaker is often a different prisoner.
            const named = firstNamedPrisoner(message, prisoners);
            if (named) {
              targets = [named];
            } else {
              // No one named: fall back to the prisoner who spoke most recently.
              let speaker: (typeof prisoners)[number] | undefined;
              const messages = deps.getMessages(chatId);
              for (let i = messages.length - 1; i >= 0; i--) {
                speaker = prisoners.find((p) => p.id === messages[i].id);
                if (speaker) break;
              }
              if (!speaker) {
                // No name and no prior speaker: too ambiguous to pick a target.
                const names = prisoners.map((p) => p.name).join(", ");
                return {
                  success: false,
                  outcome: `Multiple prisoners are here (${names}) and none is named in your message or has spoken yet, so it is ambiguous who the C-Score change applies to. Your message was NOT sent and no score changed. Say again with cscore_target set to the exact prisoner name.`,
                };
              }
              targets = [speaker];
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

          // Hold a deduction if the target has not replied since the guard's own
          // last message here and that was recent, so a pending turn is not
          // punished as silence.
          let holdForReply = false;
          if (cscore < 0) {
            const msgs = deps.getMessages(chatId);
            let guardPrevTs = 0;
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].id === deps.agentId) {
                guardPrevTs = msgs[i].timestamp;
                break;
              }
            }
            const repliedSince =
              guardPrevTs > 0 &&
              msgs.some(
                (m) => m.id === targets[0].id && m.timestamp > guardPrevTs,
              );
            holdForReply =
              guardPrevTs > 0 &&
              !repliedSince &&
              Date.now() - guardPrevTs < RESPONSE_GRACE_MS;
          }

          if (holdForReply) {
            heldTarget = targets[0].name;
          } else {
            const verb = cscore < 0 ? "Deducted" : "Added";
            const mag = Math.abs(cscore);
            const applied = targets.map((p) => {
              const total = deps.adjustCScore!(p.id, cscore);
              return `${p.name} (new C-Score: ${total})`;
            });
            scoreOutcome = ` ${verb} ${mag} C-Score point${mag === 1 ? "" : "s"} ${cscore < 0 ? "from" : "to"} ${applied.join(", ")}.`;
            cScoreChange = { target: targets[0].name, delta: cscore };
          }
        }

        const result = deps.sendMessage(chatId, {
          id: deps.agentId,
          name: deps.agentName,
          content: message,
          timestamp: Date.now(),
          ...(cScoreChange ? { cScoreChange } : {}),
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
        spokeThisTurn = true;

        if (heldTarget) {
          return {
            success: true,
            outcome: `${result.outcome} (C-Score change held: ${heldTarget} has not had a chance to reply yet, so penalising them for non-response would be premature. If they stay silent after this, deduct on a later turn.)`,
          };
        }

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
        "Leave your current conversation. Only call this once the other person has replied and you are done, not right after you speak.",
      parameters: z.object({}),
      execute: async () => {
        if (spokeThisTurn) {
          return {
            success: false,
            outcome:
              "You just spoke. Wait for a reply before leaving. Use leave_chat on a later turn once the conversation is finished.",
          };
        }
        const chatId = deps.getCurrentChatId();
        if (!chatId)
          return { success: false, outcome: "You are not in a conversation." };
        return deps.leaveChat(chatId);
      },
    }),
  };
}
