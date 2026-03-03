import React from 'react';

import { useSimulationStore } from '@/store/simulation';

export const RegionOverlay: React.FC = () => {
  const [, forceUpdate] = React.useState({});
  React.useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 100);
    return () => clearInterval(interval);
  }, []);

  const worldToScreen = useSimulationStore.getState().worldToScreen;

  const getRegionData = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const game = (window as any).phaserGame;
      if (!game?.scene?.scenes[1]) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mainScene = game.scene.scenes[1] as any;
      if (!mainScene.regions) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return mainScene.regions.getChildren().map((region: any) => {
        const props = region.getProperties();
        return { id: `${props.x}-${props.y}`, ...props };
      });
    } catch {
      return [];
    }
  };

  const regions = getRegionData();
  if (regions.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[900]">
      {regions.map((region: { id: string; x: number; y: number; width: number; height: number; label: string }) => {
        const screenPos = worldToScreen(region.x, region.y);
        const screenEnd = worldToScreen(region.x + region.width, region.y + region.height);
        return (
          <div key={region.id} className="absolute" style={{ left: screenPos.x, top: screenPos.y, width: screenEnd.x - screenPos.x, height: screenEnd.y - screenPos.y }}>
            <div className="flex items-center justify-center w-full h-full">
              <div className="text-white text-lg font-bold px-2 py-1 rounded">{region.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
