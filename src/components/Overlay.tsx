import "@/globals.css";

import { Download } from "lucide-react";
import React from "react";

import { exportMessagesAsJSONL } from "@/ai/agent";
import { useAgentsStore } from "@/store/agents";
import { useChatsStore } from "@/store/chats";
import { Button } from "@/ui/shadcn/button";

import { AgentDialog } from "./agent/dialog";
import { Agents } from "./agents";
import { BuildUI } from "./BuildUI";
import { ChatLog } from "./ChatLog";
import { DoorOverlay } from "./DoorOverlay";
import { HUD } from "./hud";
import { RegionOverlay } from "./RegionOverlay";

export const Overlay: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-[1000] font-mono text-xs">
      <Agents />
      <DoorOverlay />
      <RegionOverlay />
      <HUD />
      <ChatLog />
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
              to: string[];
              message: string;
              timestamp: number;
              c_score: Record<string, number>;
              c_score_change?: { target: string; delta: number };
            }> = [];
            for (const session of sessions) {
              for (const msg of session.messages) {
                const senderName =
                  agentsStore.getAgent(msg.id)?.name ?? msg.name;
                // Prefer the send-time snapshot; the session's final
                // participant list misrepresents who actually heard it.
                const recipients = (
                  msg.recipients ??
                  session.participants.filter((pid) => pid !== msg.id)
                ).map((pid) => agentsStore.getAgent(pid)?.name ?? pid);
                lines.push({
                  chatId: session.id,
                  from: senderName,
                  to: recipients,
                  message: msg.content,
                  timestamp: msg.timestamp,
                  c_score: {},
                  ...(msg.cScoreChange
                    ? { c_score_change: msg.cScoreChange }
                    : {}),
                });
              }
            }
            // Sessions aren't in global time order, so sort by timestamp and
            // accumulate the per-message deltas into each line's running total.
            lines.sort((a, b) => a.timestamp - b.timestamp);
            const running: Record<string, number> = {};
            for (const p of agentsStore.getAllPrisonerPoints())
              running[p.name] = 0;
            for (const line of lines) {
              if (line.c_score_change) {
                const { target, delta } = line.c_score_change;
                running[target] = (running[target] ?? 0) + delta;
              }
              line.c_score = { ...running };
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
