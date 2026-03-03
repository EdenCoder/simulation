import Phaser from 'phaser';
import EasyStar from 'easystarjs';

import { Door } from '../sprites';

export interface Point {
  x: number;
  y: number;
}

/** A* pathfinder backed by EasyStar.js, built from a Phaser tilemap layer. */
export class Pathfinder {
  private easystar: EasyStar.js;
  private gridWidth: number;
  private gridHeight: number;
  private readonly WALKABLE = 0;
  private readonly UNWALKABLE = 1;

  constructor(
    private worldLayer: Phaser.Tilemaps.TilemapLayer,
    private doors: Phaser.Physics.Arcade.Group,
  ) {
    this.gridWidth = worldLayer.width;
    this.gridHeight = worldLayer.height;
    this.easystar = new EasyStar.js();
    this.easystar.setAcceptableTiles([this.WALKABLE]);
    this.easystar.enableDiagonals();
    this.easystar.disableCornerCutting();
    this.updateGrid();
  }

  /** Rebuild the walkability grid from tilemap + door states. */
  private updateGrid(): number[][] {
    const grid: number[][] = [];

    for (let y = 0; y < this.gridHeight; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.gridWidth; x++) {
        const tile = this.worldLayer.getTileAt(x, y);
        row.push(!tile || !tile.collides ? this.WALKABLE : this.UNWALKABLE);
      }
      grid.push(row);
    }

    // Adjust grid for door states
    this.doors.getChildren().forEach((door) => {
      const doorSprite = door as Door;
      const tile = this.worldLayer.getTileAtWorldXY(doorSprite.x, doorSprite.y);
      if (tile && tile.y >= 0 && tile.y < grid.length) {
        const row = grid[tile.y];
        if (row && tile.x >= 0 && tile.x < row.length) {
          const isOpen = doorSprite.isDoorOpen();
          const isLocked = doorSprite.isDoorLocked();
          if (isOpen && !isLocked) {
            row[tile.x] = this.WALKABLE;
          } else if (isLocked) {
            row[tile.x] = this.UNWALKABLE;
          }
        }
      }
    });

    this.easystar.setGrid(grid);
    return grid;
  }

  /** Find a path between two world-space points. Returns null if no path exists. */
  findPath(start: Point, goal: Point): Promise<Point[] | null> {
    const grid = this.updateGrid();

    const startX = Phaser.Math.Clamp(Math.floor(start.x / 16), 0, this.gridWidth - 1);
    const startY = Phaser.Math.Clamp(Math.floor(start.y / 16), 0, this.gridHeight - 1);
    const goalX = Phaser.Math.Clamp(Math.floor(goal.x / 16), 0, this.gridWidth - 1);
    const goalY = Phaser.Math.Clamp(Math.floor(goal.y / 16), 0, this.gridHeight - 1);

    // Bail early if goal is unwalkable
    if (grid[goalY] && grid[goalY][goalX] === this.UNWALKABLE) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      this.easystar.findPath(startX, startY, goalX, goalY, (path) => {
        if (path) {
          resolve(path.map((node) => ({ x: node.x * 16 + 8, y: node.y * 16 + 8 })));
        } else {
          resolve(null);
        }
      });
      this.easystar.calculate();
    });
  }
}
