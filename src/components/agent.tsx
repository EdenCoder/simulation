import React, { useEffect, useState } from 'react';
import clsx from 'clsx';

import { useAgentsStore, type AgentState } from '@/store/agents';
import { AgentThought } from './agent/thought';
import { AgentSpeech } from './agent/speech';

interface AgentProps {
  agentId: string;
}

export const Agent: React.FC<AgentProps> = ({ agentId }) => {
  const [agentData, setAgentData] = useState<AgentState | undefined>(() => useAgentsStore.getState().getAgent(agentId));

  useEffect(() => {
    const interval = setInterval(() => {
      const data = useAgentsStore.getState().getAgent(agentId);
      if (data) setAgentData({ ...data });
    }, 10);
    return () => clearInterval(interval);
  }, [agentId]);

  if (!agentData) return null;

  const isGuard = agentData.role === 'guard';
  const roleIcon = isGuard ? '🛡️' : '⛓️';

  const nameLabelClass = clsx(
    'text-white text-xs px-1 py-0.5 rounded-sm font-mono whitespace-nowrap',
    isGuard ? 'bg-blue-600/80 border border-blue-400' : 'bg-orange-600/80 border border-orange-400',
  );

  const hasSpeech = !!agentData.speechBubble;
  const hasThought = !!agentData.thoughtBubble;
  const hasMove = !!agentData.moveBubble;

  return (
    <div
      className="absolute pointer-events-none w-6 h-6 flex flex-col items-center"
      style={{ left: `${agentData.x}px`, top: `${agentData.y}px`, transform: 'translate(-50%, -50%)' }}
    >
      {hasSpeech && (
        <div className="absolute bottom-full mb-1 z-25">
          <AgentSpeech content={agentData.speechBubble!.content} timestamp={agentData.speechBubble!.timestamp} duration={agentData.speechBubble!.duration} />
        </div>
      )}

      {hasThought && !hasSpeech && (
        <div className="absolute bottom-full mb-1 z-15">
          <AgentThought content={agentData.thoughtBubble!.content} timestamp={agentData.thoughtBubble!.timestamp} duration={agentData.thoughtBubble!.duration} />
        </div>
      )}

      <div className="absolute top-full mt-1 z-10">
        <div className={nameLabelClass}>
          <span className="mr-1">{roleIcon}</span>
          {agentData.name}
          {agentData.currentEmoji && <span className="ml-1">{agentData.currentEmoji}</span>}
          {hasMove && <span className="ml-1 font-semibold">{agentData.moveBubble?.isForced ? '🔗' : '→'} {agentData.moveBubble?.content}</span>}
          {!isGuard && agentData.points > 0 && <b className="ml-2">{agentData.points}</b>}
        </div>
      </div>
    </div>
  );
};
