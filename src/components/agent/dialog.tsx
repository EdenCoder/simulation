import React from "react";

import { Badge } from "@/ui/shadcn/badge";
import { Dialog, DialogContent, DialogTitle } from "@/ui/shadcn/dialog";
import { useSimulationStore } from "@/store/simulation";

export const AgentDialog: React.FC = () => {
  const characterInfo = useSimulationStore((s) => s.selectedCharacter);
  const hideCharacterInfo = useSimulationStore((s) => s.hideCharacterInfo);

  if (!characterInfo) return null;

  const isGuard = characterInfo.role === "guard";

  return (
    <Dialog
      open={!!characterInfo}
      onOpenChange={(open) => {
        if (!open) hideCharacterInfo();
      }}
    >
      <DialogContent className="!max-w-4xl !z-1000 border-3 border-gray-800 !rounded">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="aspect-square bg-muted rounded-lg overflow-hidden flex items-center justify-center text-6xl">
              {isGuard ? "🛡️" : "⛓️"}
            </div>
            <div className="text-center space-y-2">
              <div className="font-mono text-sm text-muted-foreground">
                ID: #{characterInfo.id}
              </div>
            </div>
          </div>

          <div className="space-y-4 col-span-2">
            <DialogTitle className="flex items-center gap-2 text-2xl">
              {characterInfo.name}
              <Badge variant={isGuard ? "default" : "destructive"}>
                {isGuard ? "🛡️ Guard" : "⛓️ Prisoner"}
              </Badge>
            </DialogTitle>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
