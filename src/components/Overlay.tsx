import React from "react";
import { Download } from "lucide-react";

import { Button } from "@/ui/shadcn/button";
import { Agents } from "./agents";
import { AgentDialog } from "./agent/dialog";
import { HUD } from "./hud";
import { BuildUI } from "./BuildUI";
import { DoorOverlay } from "./DoorOverlay";
import { RegionOverlay } from "./RegionOverlay";
import { exportMessagesAsJSONL } from "@/ai/agent";
import { useChatsStore } from "@/store/chats";
import { useAgentsStore } from "@/store/agents";

import "@/globals.css";

export const Overlay: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-[1000] font-mono text-xs">
      <Agents />
      <DoorOverlay />
      <RegionOverlay />
      <HUD />
      <BuildUI />
      <AgentDialog />

      {/* Download Buttons */}
      <div className="fixed bottom-2 right-2 pointer-events-auto z-[1001] flex gap-2">
        <Button
          onClick={() => {
            const agentsStore = useAgentsStore.getState();
            const sessions = useChatsStore.getState().getAllSessions();
            const lines: Array<{
              chatId: string;
              from: string;
              message: string;
              timestamp: number;
            }> = [];
            for (const session of sessions) {
              for (const msg of session.messages) {
                lines.push({
                  chatId: session.id,
                  from: agentsStore.getAgent(msg.id)?.name ?? msg.name,
                  message: msg.content,
                  timestamp: msg.timestamp,
                });
              }
            }
            const json = JSON.stringify(lines, null, 2);
            const blob = new Blob([json], {
              type: "application/json;charset=utf-8;",
            });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute(
              "download",
              `sim-chats-${new Date().toISOString().split("T")[0]}.json`,
            );
            link.style.visibility = "hidden";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          variant="outline"
        >
          <Download className="h-4 w-4 mr-2" />
          Download Chats
        </Button>
        <Button
          onClick={() => {
            const jsonl = exportMessagesAsJSONL();
            const blob = new Blob([jsonl], {
              type: "application/jsonl;charset=utf-8;",
            });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute(
              "download",
              `sim-messages-${new Date().toISOString().split("T")[0]}.jsonl`,
            );
            link.style.visibility = "hidden";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          variant="outline"
        >
          <Download className="h-4 w-4 mr-2" />
          Download Messages
        </Button>
      </div>
    </div>
  );
};
