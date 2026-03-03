import React from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import { Agents } from './agents';
import { AgentDialog } from './agent/dialog';
import { HUD } from './hud';
import { BuildUI } from './BuildUI';
import { DoorOverlay } from './DoorOverlay';
import { RegionOverlay } from './RegionOverlay';
import { exportMessagesAsJSONL } from '@/ai/agent';

import '@/globals.css';

export const Overlay: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-[1000] font-mono text-xs">
      <Agents />
      <DoorOverlay />
      <RegionOverlay />
      <HUD />
      <BuildUI />
      <AgentDialog />

      {/* Download Messages */}
      <div className="fixed bottom-2 right-2 pointer-events-auto z-[1001]">
        <Button
          onClick={() => {
            const jsonl = exportMessagesAsJSONL();
            const blob = new Blob([jsonl], { type: 'application/jsonl;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `sim-messages-${new Date().toISOString().split('T')[0]}.jsonl`);
            link.style.visibility = 'hidden';
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
