import React from 'react';

import { Badge } from '@/ui/shadcn/badge';
import { Progress } from '@/ui/shadcn/progress';
import { Dialog, DialogContent, DialogTitle } from '@/ui/shadcn/dialog';
import { useSimulationStore } from '@/store/simulation';

export const AgentDialog: React.FC = () => {
  const characterInfo = useSimulationStore((s) => s.selectedCharacter);
  const hideCharacterInfo = useSimulationStore((s) => s.hideCharacterInfo);

  if (!characterInfo) return null;

  const isGuard = characterInfo.role === 'guard';
  const stats = {
    health: Math.round(85 + Math.random() * 15),
    mood: Math.round(60 + Math.random() * 40),
    energy: Math.round(40 + Math.random() * 60),
  };

  return (
    <Dialog open={!!characterInfo} onOpenChange={(open) => { if (!open) hideCharacterInfo(); }}>
      <DialogContent className="!max-w-4xl !z-1000 border-3 border-gray-800 !rounded">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="aspect-square bg-muted rounded-lg overflow-hidden flex items-center justify-center text-6xl">
              {isGuard ? '🛡️' : '⛓️'}
            </div>
            <div className="text-center space-y-2">
              <div className="font-mono text-sm text-muted-foreground">ID: #{characterInfo.id}</div>
              <div className="text-sm">
                <span className="font-medium">Location:</span> ({Math.round(characterInfo.x)}, {Math.round(characterInfo.y)})
              </div>
            </div>
          </div>

          <div className="space-y-4 col-span-2">
            <DialogTitle className="flex items-center gap-2 text-2xl">
              {characterInfo.name}
              <Badge variant={isGuard ? 'default' : 'destructive'}>
                {isGuard ? '🛡️ Guard' : '⛓️ Prisoner'}
              </Badge>
            </DialogTitle>

            <div className="flex flex-row gap-6">
              <div className="flex-1 space-y-2">
                <div>
                  <div className="flex justify-between text-sm mb-1"><span>❤️ Health</span><span>{stats.health}%</span></div>
                  <Progress value={stats.health} />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1"><span>😊 Mood</span><span>{stats.mood}%</span></div>
                  <Progress value={stats.mood} />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1"><span>⚡ Energy</span><span>{stats.energy}%</span></div>
                  <Progress value={stats.energy} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
