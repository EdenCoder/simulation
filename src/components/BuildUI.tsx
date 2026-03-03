import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Button } from '@/ui/shadcn/button';
import { useSimulationStore } from '@/store/simulation';
import { saveBuild } from '@/store/build';

export const BuildUI: React.FC = () => {
  const buildMode = useSimulationStore((s) => s.buildMode);
  const setBuildMode = useSimulationStore((s) => s.setBuildMode);

  if (!buildMode) return null;

  const handleSaveBuild = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const game = (window as any).phaserGame;
    if (game?.scene?.scenes[1]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mainScene = game.scene.scenes[1] as any;
      if (mainScene.doors && mainScene.regions) {
        saveBuild(mainScene.doors.getChildren(), mainScene.regions.getChildren());
      }
    }
  };

  return (
    <div className="fixed top-12 left-2 pointer-events-auto z-[1000]">
      <Card className="w-64 border-2 border-blue-500 bg-blue-50">
        <CardHeader className="!p-3">
          <CardTitle className="text-sm">Build Mode</CardTitle>
        </CardHeader>
        <CardContent className="!p-3 space-y-2">
          <div className="text-xs text-gray-700">
            {buildMode === 'doors' ? 'Click to place doors. Left-click to cycle types, right-click to toggle lock.' : 'Click and drag to create regions.'}
          </div>
          <Button onClick={() => setBuildMode(buildMode === 'doors' ? 'regions' : 'doors')} variant="outline" size="sm" className="text-xs w-full">
            {buildMode === 'doors' ? 'Switch to Regions' : 'Switch to Doors'}
          </Button>
          <Button onClick={handleSaveBuild} variant="default" size="sm" className="text-xs w-full bg-green-600 hover:bg-green-700">
            Save Build
          </Button>
          <Button onClick={() => setBuildMode(null)} variant="outline" size="sm" className="text-xs w-full">
            Exit Build Mode
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
