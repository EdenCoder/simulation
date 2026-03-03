// imports
import { Graphics, useScene } from 'phaser-jsx';
import { Depth } from '../constants';
const isProduction = import.meta.env.PROD;

interface Props {
  tilemapLayer: Phaser.Tilemaps.TilemapLayer;
}

/**
 * Debug overlay component for visualizing tilemap collision areas
 * 
 * Features:
 * - Only appears in development builds
 * - Press SHIFT to toggle collision visualization on/off
 * - Shows colliding tiles in orange, collision edges in dark gray
 * - Renders above world but below UI elements
 */
export function TilemapDebug(props: Props) {
  const scene = useScene();
  
  // Debug colors for collision visualization
  const DEBUG_COLORS = {
    COLLIDING_TILE: new Phaser.Display.Color(243, 134, 48, 255), // Orange
    COLLISION_EDGE: new Phaser.Display.Color(40, 39, 37, 255),   // Dark gray
    NON_COLLIDING: null // Transparent
  };
  
  // Don't render anything in production builds
  if (isProduction) {
    return null;
  }

  // Toggle debug visibility state
  let debugVisible = false;
  let debugGraphics: Phaser.GameObjects.Graphics;

  /**
   * Setup keyboard toggle for debug overlay
   */
  function setupDebugToggle() {
    scene.input.keyboard!.on('keydown-SHIFT', () => {
      debugVisible = !debugVisible;
      debugGraphics.setAlpha(debugVisible ? 0.75 : 0);
    });
  }

  /**
   * Render collision debug visualization on the graphics object
   */
  function renderCollisionDebug() {
    props.tilemapLayer.renderDebug(debugGraphics, {
      tileColor: DEBUG_COLORS.NON_COLLIDING,
      collidingTileColor: DEBUG_COLORS.COLLIDING_TILE,
      faceColor: DEBUG_COLORS.COLLISION_EDGE,
    });
  }

  /**
   * Initialize the debug graphics when component mounts
   */
  function initializeDebugGraphics(graphics: Phaser.GameObjects.Graphics) {
    debugGraphics = graphics;
    setupDebugToggle();
    renderCollisionDebug();
  }

  return (
    <Graphics
      alpha={0} // Start hidden
      depth={Depth.AboveWorld} // Render above world tiles
      ref={initializeDebugGraphics}
    />
  );
}