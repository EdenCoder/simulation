import React from 'react';

import type { ChatMessage } from '@/store/agents';

interface AgentChatProps {
  messages: ChatMessage[];
  currentAgentId: string;
}

export const AgentChat: React.FC<AgentChatProps> = ({ messages, currentAgentId }) => {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.id !== currentAgentId) return null;

  return (
    <div className="bg-gray-500 text-white p-2 text-sm rounded-lg max-w-xs">
      <div className="flex items-center gap-1 mb-1">
        <span>💬</span>
        <span className="font-semibold text-xs">You</span>
      </div>
      <div className="truncate">{latestMessage.content}</div>
    </div>
  );
};
