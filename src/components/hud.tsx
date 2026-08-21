import React from "react";

import { getCurrentGameTime } from "@/ai/context/time";
import { getAssignedCell } from "@/scenarios/prison/schedule";
import { useAgentsStore } from "@/store/agents";
import { useChatsStore } from "@/store/chats";
import { useSimulationStore } from "@/store/simulation";
import { Button } from "@/ui/shadcn/button";
import { Card } from "@/ui/shadcn/card";

import { latestDeduction, shortAgentLabel } from "./hud-info";

export const HUD: React.FC = () => {
  const [, forceUpdate] = React.useState({});
  React.useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 50);
    return () => clearInterval(interval);
  }, []);

  const agents = useAgentsStore.getState().getAllAgents();
  const currentSimTime = getCurrentGameTime();

  const sessions = useChatsStore.getState().getAllSessions();

  const agentAvatars = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    statusIcon: agent.speechBubble ? "🗣️" : agent.currentEmoji || "",
    points: agent.points,
    emoji: agent.currentEmoji || "",
    deduction:
      agent.role === "guard" ? latestDeduction(sessions, agent.id) : null,
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
              <div>
                {currentSimTime.toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
              <div>
                {currentSimTime.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: true,
                })}
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-2 fixed bottom-6 left-6">
        {agentAvatars.map((agent) => (
          <Button
            key={agent.id}
            variant="ghost"
            size="sm"
            className="relative w-12 h-12 p-0 rounded-lg hover:scale-105 transition-transform"
            onClick={() => handleAgentClick(agent.id)}
            title={
              agent.role === "prisoner"
                ? `${agent.name} — ${getAssignedCell(agent.name) ?? "no cell"} — C-Score: ${agent.points}`
                : `${agent.name}${agent.emoji ? ` — feeling ${agent.emoji}` : ""}${agent.deduction ? ` — last deduction: ${agent.deduction.delta} ${agent.deduction.target}` : ""}`
            }
          >
            <div
              className={`w-full h-full rounded-lg flex flex-col items-center justify-center font-bold ${agent.role === "guard" ? "bg-blue-100 text-blue-800 border-2 border-blue-300" : "bg-orange-100 text-orange-800 border-2 border-orange-300"}`}
            >
              <span className="text-base leading-none">
                {shortAgentLabel(agent.name)}
              </span>
              {agent.role === "prisoner" && (
                <span
                  className={`text-[10px] leading-none mt-0.5 ${agent.points > 0 ? "text-green-700" : agent.points < 0 ? "text-red-700" : ""}`}
                >
                  C:{agent.points}
                </span>
              )}
              {agent.role === "guard" && (agent.emoji || agent.deduction) && (
                <span className="text-[9px] leading-none mt-0.5">
                  {agent.emoji}
                  {agent.deduction &&
                    ` ${agent.deduction.delta} ${shortAgentLabel(agent.deduction.target)}`}
                </span>
              )}
            </div>
            {agent.statusIcon && (
              <div className="absolute -top-1 -right-1 text-xs bg-background border rounded-full w-5 h-5 flex items-center justify-center">
                {agent.statusIcon}
              </div>
            )}
          </Button>
        ))}
      </div>
    </>
  );
};
