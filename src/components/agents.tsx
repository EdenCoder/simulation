import React from 'react';

import { useAgentsStore } from '@/store/agents';
import { Agent } from './agent';

export const Agents: React.FC = () => {
  const [, forceUpdate] = React.useState({});
  React.useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 10);
    return () => clearInterval(interval);
  }, []);

  const agents = useAgentsStore.getState().getAllAgents();

  return (
    <div className="fixed inset-0 pointer-events-none">
      {agents.map((agent) => (
        <Agent key={agent.id} agentId={agent.id} />
      ))}
    </div>
  );
};
