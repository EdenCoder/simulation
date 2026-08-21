import { ChevronDown, ChevronUp, MessagesSquare } from "lucide-react";
import React from "react";

import { realToSimTime } from "@/ai/context/time";
import { useAgentsStore } from "@/store/agents";
import { useChatsStore } from "@/store/chats";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";

import {
  formatCScoreDelta,
  formatSimClock,
  messageRecipientIds,
  selectLogSessions,
} from "./chat-log/utils";

/** Most recent messages shown per conversation. */
const MESSAGES_PER_SESSION = 8;

/** Conversations shown at once (all active ones always show). */
const SESSION_LIMIT = 4;

function agentInfo(id: string): { name: string; isGuard: boolean } {
  const agent = useAgentsStore.getState().getAgent(id);
  return {
    name: agent?.name ?? id,
    isGuard: agent?.role === "guard",
  };
}

const roleText = (isGuard: boolean) =>
  isGuard ? "text-blue-300" : "text-orange-300";

const NameChip: React.FC<{ id: string }> = ({ id }) => {
  const { name, isGuard } = agentInfo(id);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 border text-[11px] font-semibold ${
        isGuard
          ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
          : "bg-orange-500/15 border-orange-500/40 text-orange-300"
      }`}
    >
      {isGuard ? "🛡️" : "⛓️"} {name}
    </span>
  );
};

/**
 * The conversation log panel: one card per chat session, with the full
 * participant roster, and every message labeled speaker → addressee(s)
 * so it is always clear who is talking to whom.
 */
export const ChatLog: React.FC = () => {
  const sessions = useChatsStore((s) => s.sessions);
  const endedSessions = useChatsStore((s) => s.endedSessions);
  const [collapsed, setCollapsed] = React.useState(false);

  const shown = selectLogSessions(
    Object.values(sessions),
    Object.values(endedSessions),
    SESSION_LIMIT,
  );

  if (shown.length === 0) return null;

  const activeCount = Object.keys(sessions).length;

  return (
    <div className="fixed bottom-14 right-2 w-[26rem] max-w-[90vw] pointer-events-auto z-[1000]">
      <Card className="border-2 border-gray-800 !rounded !p-0 !gap-0 bg-background/95 backdrop-blur-sm">
        <CardHeader className="!p-2 border-b border-border flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessagesSquare className="h-4 w-4" />
            Conversations
            {activeCount > 0 && (
              <span className="rounded-full bg-green-500/20 border border-green-500/40 text-green-300 px-1.5 text-[11px]">
                {activeCount} live
              </span>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CardHeader>

        {!collapsed && (
          <CardContent className="!p-2 space-y-2 max-h-[55vh] overflow-y-auto">
            {shown.map(({ session, ended }) => {
              const startedAt = realToSimTime(session.createdAt);
              const hidden = Math.max(
                0,
                session.messages.length - MESSAGES_PER_SESSION,
              );
              const messages = session.messages.slice(-MESSAGES_PER_SESSION);

              return (
                <div
                  key={session.id}
                  className={`rounded border p-2 space-y-1.5 ${
                    ended ? "border-border opacity-60" : "border-gray-600"
                  }`}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {session.participants.map((pid) => (
                      <NameChip key={pid} id={pid} />
                    ))}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {ended ? "ended" : "live"}
                      {startedAt
                        ? ` · started ${formatSimClock(startedAt)}`
                        : ""}
                    </span>
                  </div>

                  {hidden > 0 && (
                    <div className="text-[10px] text-muted-foreground italic">
                      … {hidden} earlier message{hidden === 1 ? "" : "s"}
                    </div>
                  )}

                  {messages.length === 0 && (
                    <div className="text-[11px] text-muted-foreground italic">
                      No messages yet.
                    </div>
                  )}

                  {messages.map((msg, i) => {
                    const speaker = agentInfo(msg.id);
                    const recipients = messageRecipientIds(msg, session).map(
                      (rid) => agentInfo(rid),
                    );
                    const simTime = realToSimTime(msg.timestamp);
                    return (
                      <div
                        key={`${msg.timestamp}-${i}`}
                        className={`border-l-2 pl-2 ${
                          speaker.isGuard
                            ? "border-blue-500/60"
                            : "border-orange-500/60"
                        }`}
                      >
                        <div className="text-[10px] text-muted-foreground leading-tight">
                          {simTime ? `${formatSimClock(simTime)} · ` : ""}
                          <span
                            className={`font-semibold ${roleText(speaker.isGuard)}`}
                          >
                            {speaker.name}
                          </span>
                          {" → "}
                          {recipients.map((r, j) => (
                            <span
                              key={j}
                              className={`font-semibold ${roleText(r.isGuard)}`}
                            >
                              {j > 0 ? ", " : ""}
                              {r.name}
                            </span>
                          ))}
                        </div>
                        <div className="text-xs leading-snug">
                          {msg.content}
                        </div>
                        {msg.cScoreChange && (
                          <span
                            className={`inline-block mt-0.5 rounded px-1 border text-[10px] font-semibold ${
                              msg.cScoreChange.delta >= 0
                                ? "bg-green-500/15 border-green-500/40 text-green-300"
                                : "bg-red-500/15 border-red-500/40 text-red-300"
                            }`}
                          >
                            C-Score {msg.cScoreChange.target}{" "}
                            {formatCScoreDelta(msg.cScoreChange.delta)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </CardContent>
        )}
      </Card>
    </div>
  );
};
