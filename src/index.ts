import Phaser from 'phaser';
import React from 'react';
import { createRoot } from 'react-dom/client';

import * as scenes from './scenes';
import { Overlay } from './components/Overlay';
import { useAgentsStore, type AgentState } from './store/agents';
import { useSimulationStore } from './store/simulation';
import { prisonScenario } from './scenarios/prison';
import { initAgents, setBridgeFunctions } from './ai/agent';
import { getBridgeFunctions } from './bridge';

// --- 1. Initialize the Zustand agent store from scenario config ---

const initialAgents: AgentState[] = prisonScenario.agents.map((config) => ({
  id: config.id,
  name: config.name,
  role: config.role,
  characterType: config.characterType,
  x: config.startX,
  y: config.startY,
  tint: config.tint,
  speed: config.speed,
  currentEmoji: null,
  speechBubble: null,
  thoughtBubble: null,
  moveBubble: null,
  currentChatId: null,
  chatMessages: [],
  points: 0,
}));

useAgentsStore.getState().initAgents(initialAgents);

// --- 2. Create React overlay ---

const reactContainer = document.createElement('div');
reactContainer.id = 'react-overlay-root';
document.body.appendChild(reactContainer);

const root = createRoot(reactContainer);
root.render(React.createElement(Overlay));

// --- 3. Create Phaser game ---

const game = new Phaser.Game({
  width: window.innerWidth,
  height: window.innerHeight,
  title: 'Eden Simulation',
  scene: [scenes.Boot, ...Object.values(scenes).filter((s) => s !== scenes.Boot)],
  physics: {
    default: 'arcade',
    arcade: {
      debug: import.meta.env.DEV,
    },
  },
  disableContextMenu: import.meta.env.PROD,
  backgroundColor: '#000',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  pixelArt: true,
  parent: document.body,
});

// Store game reference
useSimulationStore.getState().setGame(game);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).phaserGame = game;

// --- 4. Wire up bridge + start AI agents ---
// Wait until the Main scene is actually running (not just Boot), and
// the build data (regions/doors from data.json) has been loaded.

function waitForSceneReady(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mainScene = game.scene.scenes[1] as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasBuildData = !!(window as any).__buildDataCache;
      const hasNpcs = !!mainScene?.npcs;

      if (hasBuildData && hasNpcs) {
        console.log('[Boot] Main scene ready, build data loaded, agents spawned.');
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

waitForSceneReady().then(() => {
  const bridge = getBridgeFunctions();
  setBridgeFunctions(bridge);
  initAgents(prisonScenario.agents);
});
