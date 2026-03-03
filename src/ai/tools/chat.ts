import { tool } from 'ai';
import { z } from 'zod';

export interface ChatDeps {
  agentId: string;
  agentName: string;
  getCurrentChatId: () => string | null;
  getNearbyAgents: () => Array<{ id: string; name: string; distance: number; inChat?: string }>;
  createChat: (participantIds: string[]) => { success: boolean; chatId?: string; outcome: string };
  joinChat: (chatId: string) => { success: boolean; outcome: string };
  leaveChat: (chatId: string) => { success: boolean; outcome: string };
  sendMessage: (chatId: string, message: { id: string; name: string; content: string; timestamp: number }) => { success: boolean; outcome: string };
  getMessages: (chatId: string) => Array<{ id: string; name: string; content: string; timestamp: number }>;
  /** Called after a message is sent to notify partners to respond. */
  onMessageSent?: (chatId: string, speakerId: string) => void;
}

export function createChatTools(deps: ChatDeps) {
  return {
    start_chat: tool({
      description: 'Start or join a conversation with a nearby agent. You MUST call this before using "say". If the target is already in a chat, you will join their chat.',
      parameters: z.object({
        target_name: z.string().describe('The exact name of the agent (e.g. "Prisoner #1" or "Guard #2")'),
      }),
      execute: async ({ target_name }) => {
        // If already in a chat, that's OK — just inform the agent
        const existingChatId = deps.getCurrentChatId();
        if (existingChatId) {
          return { success: true, outcome: `You are already in a conversation. Use "say" to speak, or "leave_chat" first to start a new one.` };
        }

        const nearby = deps.getNearbyAgents();
        const target = nearby.find((a) => a.name.toLowerCase() === target_name.toLowerCase());
        if (!target) {
          const nearbyNames = nearby.map((a) => a.name).join(', ');
          return { success: false, outcome: `${target_name} is not nearby. Nearby agents: ${nearbyNames || 'none'}` };
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
      description: 'Say something in your current conversation. You must have an active chat (use start_chat first).',
      parameters: z.object({
        message: z.string().describe('What you want to say aloud'),
      }),
      execute: async ({ message }) => {
        const chatId = deps.getCurrentChatId();
        if (!chatId) return { success: false, outcome: 'You are not in a conversation. Use start_chat first.' };

        const result = deps.sendMessage(chatId, {
          id: deps.agentId,
          name: deps.agentName,
          content: message,
          timestamp: Date.now(),
        });

        // Notify chat partners to respond quickly
        if (result.success) {
          deps.onMessageSent?.(chatId, deps.agentId);
        }

        return result;
      },
    }),

    leave_chat: tool({
      description: 'Leave your current conversation. Call this when you are done talking.',
      parameters: z.object({}),
      execute: async () => {
        const chatId = deps.getCurrentChatId();
        if (!chatId) return { success: false, outcome: 'You are not in a conversation.' };
        return deps.leaveChat(chatId);
      },
    }),
  };
}
