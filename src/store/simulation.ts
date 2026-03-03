import { create } from 'zustand';

/** Character info shown in the detail dialog. */
export interface CharacterInfo {
  id: string;
  name: string;
  characterType: 'arthur' | 'morgan';
  x: number;
  y: number;
  speed: number;
  role: string;
}

interface SimulationStore {
  /** Whether the simulation is paused. */
  paused: boolean;

  /** Current build mode, or null if not building. */
  buildMode: 'doors' | 'regions' | null;

  /** Currently selected character info for the dialog. */
  selectedCharacter: CharacterInfo | null;

  /** Reference to the Phaser game instance. */
  game: Phaser.Game | null;

  togglePause: () => void;
  setBuildMode: (mode: 'doors' | 'regions' | null) => void;
  showCharacterInfo: (info: CharacterInfo) => void;
  hideCharacterInfo: () => void;
  setGame: (game: Phaser.Game) => void;

  /** Convert world coordinates to screen coordinates using the main camera. */
  worldToScreen: (worldX: number, worldY: number) => { x: number; y: number };
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  paused: false,
  buildMode: null,
  selectedCharacter: null,
  game: null,

  togglePause: () => set((s) => ({ paused: !s.paused })),

  setBuildMode: (mode) => set({ buildMode: mode }),

  showCharacterInfo: (info) => {
    if (get().buildMode) return;
    set({ selectedCharacter: info });
  },

  hideCharacterInfo: () => set({ selectedCharacter: null }),

  setGame: (game) => set({ game }),

  worldToScreen: (worldX, worldY) => {
    const game = get().game;
    if (!game?.scene?.scenes[1]) return { x: worldX, y: worldY };

    const scene = game.scene.scenes[1] as Phaser.Scene;
    const camera = scene.cameras?.main;
    if (!camera) return { x: worldX, y: worldY };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cam = camera as any;
    const scrollX: number = cam.scrollX;
    const scrollY: number = cam.scrollY;
    const zoom: number = cam.zoom;
    const rotation: number = cam.rotation ?? 0;
    const ox: number = cam.originX * cam.width;
    const oy: number = cam.originY * cam.height;

    const result = Phaser.Math.TransformXY(worldX, worldY, ox + scrollX, oy + scrollY, -rotation, 1 / zoom, 1 / zoom) as { x: number; y: number };

    return {
      x: Math.round(result.x + ox),
      y: Math.round(result.y + oy),
    };
  },
}));
