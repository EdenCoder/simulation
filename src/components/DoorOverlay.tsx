import React from 'react';
import { Lock, Unlock } from 'lucide-react';

import { useSimulationStore } from '@/store/simulation';

export const DoorOverlay: React.FC = () => {
  const [, forceUpdate] = React.useState({});
  React.useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 100);
    return () => clearInterval(interval);
  }, []);

  const worldToScreen = useSimulationStore.getState().worldToScreen;

  const getDoorData = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const game = (window as any).phaserGame;
      if (!game?.scene?.scenes[1]) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mainScene = game.scene.scenes[1] as any;
      if (!mainScene.doors) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return mainScene.doors.getChildren().map((door: any) => ({
        id: `${door.x}-${door.y}`,
        x: door.x,
        y: door.y,
        isLocked: door.isDoorLocked(),
      }));
    } catch {
      return [];
    }
  };

  const doors = getDoorData();
  if (doors.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[900]">
      {doors.map((door: { id: string; x: number; y: number; isLocked: boolean }) => {
        const screenPos = worldToScreen(door.x, door.y);
        return (
          <div key={door.id} className="absolute transform -translate-x-1/2 -translate-y-full" style={{ left: screenPos.x, top: screenPos.y - 8 }}>
            <div className="flex items-center justify-center w-6 h-6 bg-background border-2 border-gray-800 rounded-full shadow-lg">
              {door.isLocked ? <Lock className="w-3 h-3 text-red-500" /> : <Unlock className="w-3 h-3 text-green-500" />}
            </div>
          </div>
        );
      })}
    </div>
  );
};
