import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Button } from '@/ui/shadcn/button';
import { useAgentsStore } from '@/store/agents';
import { useSimulationStore } from '@/store/simulation';
import { getCurrentGameTime } from '@/ai/context/time';

export const HUD: React.FC = () => {
  const [, forceUpdate] = React.useState({});
  React.useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 50);
    return () => clearInterval(interval);
  }, []);

  const agents = useAgentsStore.getState().getAllAgents();
  const currentSimTime = getCurrentGameTime();

  const activeConversations = agents
    .filter((a) => a.speechBubble)
    .map((a) => ({ participants: [a.name], messages: [a.speechBubble!.content] }));

  const agentAvatars = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    statusIcon: agent.speechBubble ? '🗣️' : agent.currentEmoji || '',
  }));

  const handleAgentClick = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) {
      useSimulationStore.getState().showCharacterInfo({
        id: agent.id,
        name: agent.name,
        characterType: agent.characterType,
        x: agent.x,
        y: agent.y,
        speed: agent.speed,
        role: agent.role,
      });
    }
  };

  return (
    <>
      {currentSimTime && (
        <div className="fixed top-2 right-2 pointer-events-auto z-[1001]">
          <Card className="border-2 border-gray-800 !rounded !p-2 bg-background/90 backdrop-blur-sm">
            <div className="text-sm font-mono font-semibold space-y-1">
              <div>{currentSimTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div>{currentSimTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</div>
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-2 fixed bottom-6 left-6">
        {agentAvatars.map((agent) => (
          <Button key={agent.id} variant="ghost" size="sm" className="relative w-12 h-12 p-0 rounded-lg hover:scale-105 transition-transform" onClick={() => handleAgentClick(agent.id)} title={agent.name}>
            <div className={`w-full h-full rounded-lg flex items-center justify-center text-lg font-bold ${agent.role === 'guard' ? 'bg-blue-100 text-blue-800 border-2 border-blue-300' : 'bg-orange-100 text-orange-800 border-2 border-orange-300'}`}>
              {agent.name.charAt(0)}
            </div>
            {agent.statusIcon && (
              <div className="absolute -top-1 -right-1 text-xs bg-background border rounded-full w-5 h-5 flex items-center justify-center">{agent.statusIcon}</div>
            )}
          </Button>
        ))}
      </div>

      <div className="fixed bottom-6 right-6 max-w-sm w-full pointer-events-auto z-[1000] space-y-3">
        {activeConversations.length > 0 && (
          <Card className="border-2 border-gray-800 !rounded !p-3 !gap-y-3 opacity-40 hover:opacity-100 transition-all duration-300">
            <CardHeader className="!p-0"><CardTitle className="text-sm">Active Conversations</CardTitle></CardHeader>
            <CardContent className="!p-0 space-y-2">
              {activeConversations.map((conv, i) => (
                <div key={i} className="rounded p-2 border-1 border-gray-800">
                  <div className="text-sm font-semibold mb-1">{conv.participants.join(' <> ')}</div>
                  <div className="text-sm">"{conv.messages[conv.messages.length - 1]}"</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
};
