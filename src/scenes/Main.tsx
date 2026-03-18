import React from "react";
import Phaser from "phaser";
import { render } from "phaser-jsx";

import { TilemapDebug } from "../components";
import { Depth, key, TilemapLayer, TILESET_NAME } from "../constants";
import { useSimulationStore } from "../store/simulation";
import { loadBuildAsync, SavedDoor, SavedRegion } from "../store/build";
import { AgentManager } from "../managers";
import { Door, Region } from "../sprites";
import { initSimulationTime } from "../ai/context/time";

/**
 * Main game scene that displays a tilemap with Agents and camera controls
 *
 * Features:
 * - Tilemap with floor, decorative trees, and collision walls
 * - Free camera movement with WASD/arrow keys
 * - Agents that spawn randomly on the map
 * - Auto-scaling to fit screen with proper bounds
 */
export class Main extends Phaser.Scene {
  // Core game objects
  private map!: Phaser.Tilemaps.Tilemap;
  private wallLayer!: Phaser.Tilemaps.TilemapLayer;
  private npcs!: AgentManager;
  private doors!: Phaser.Physics.Arcade.Group;
  private regions!: Phaser.GameObjects.Group;
  private selectionRectangle!: Phaser.GameObjects.Rectangle;
  private selectedRegion: Region | null = null;

  // Input controls
  private keys!: Phaser.Types.Input.Keyboard.CursorKeys & {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
    b: Phaser.Input.Keyboard.Key;
  };

  // Camera settings
  private readonly CAMERA_SPEED = 300; // pixels per second
  private readonly MAP_VISIBILITY_BUFFER = 0.8; // Keep 80% of map visible when scrolling

  constructor() {
    super(key.scene.main);
  }

  /**
   * Initialize the scene - called automatically by Phaser
   */
  async create() {
    this.createMap();
    this.setupCamera();
    this.setupControls();
    await this.loadSavedBuild();
    this.spawnAgents();
    this.setupCollisions();
    this.addDebugOverlay();
    this.setupWindowResize();
    this.selectionRectangle = this.add
      .rectangle(0, 0, 0, 0, 0x1d4ed8, 0.5)
      .setOrigin(0, 0);
    this.selectionRectangle.setDepth(Depth.AbovePlayer);
    this.selectionRectangle.setVisible(false);

    // Initialize simulation time
    initSimulationTime();

    // No-op: React reads from Zustand store directly
  }

  /**
   * Update loop - called every frame by Phaser
   */
  update() {
    // Handle pause toggle
    if (Phaser.Input.Keyboard.JustDown(this.keys.space)) {
      useSimulationStore.getState().togglePause();
    }

    // Handle build mode toggle
    if (Phaser.Input.Keyboard.JustDown(this.keys.b)) {
      const store = useSimulationStore.getState();
      store.setBuildMode(store.buildMode ? null : "regions");
    }

    // Skip updates if paused
    if (useSimulationStore.getState().paused) {
      return;
    }

    this.updateCameraMovement();
    if (this.npcs) this.npcs.update(this.time.now, this.game.loop.delta);
  }

  /**
   * Create and configure the tilemap with all layers
   */
  private createMap() {
    // Load the tilemap data
    this.map = this.make.tilemap({ key: key.tilemap.stanfordPrison });

    // Connect tileset image to tilemap
    const tileset = this.map.addTilesetImage(TILESET_NAME, key.image.tileset)!;

    // Create layers in rendering order (bottom to top)
    this.map.createLayer(TilemapLayer.Floor, tileset, 0, 0); // Background

    const trees = this.map.createLayer(TilemapLayer.Trees, tileset, 0, 0);
    trees?.setDepth(Depth.AbovePlayer); // Render trees above everything else

    this.wallLayer = this.map.createLayer(TilemapLayer.Walls, tileset, 0, 0)!;

    // Setup collision detection for walls
    this.wallLayer.setCollisionBetween(1, 1000); // Any non-empty tile blocks movement

    // Set physics world bounds to match map size
    this.physics.world.bounds.setTo(
      0,
      0,
      this.wallLayer.width,
      this.wallLayer.height,
    );
  }

  /**
   * Configure camera zoom and initial position
   */
  private setupCamera() {
    const camera = this.cameras.main;

    // Always zoom to fill the screen (like fitting an image)
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;
    const mapWidth = this.map.widthInPixels;
    const mapHeight = this.map.heightInPixels;

    // Calculate zoom to fill screen completely, but never smaller than 1:1 pixels
    const zoomX = screenWidth / mapWidth;
    const zoomY = screenHeight / mapHeight;
    const zoom = Math.max(2, Math.max(zoomX, zoomY)); // Fill screen but max 1x zoom

    camera.setZoom(zoom);
    camera.removeBounds();

    // Point the camera at the center of the map (in map coordinates)
    // Phaser will handle the rest with zoom
    const mapCenterX = mapWidth / 2;
    const mapCenterY = mapHeight / 2;

    camera.centerOn(mapCenterX, mapCenterY);
  }

  /**
   * Setup keyboard controls for camera movement
   */
  private setupControls() {
    const keyboard = this.input.keyboard!;

    // Get standard cursor keys
    this.keys = keyboard.createCursorKeys() as any;

    // Add WASD keys
    this.keys.w = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keys.a = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keys.s = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keys.d = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // Add pause key
    this.keys.space = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Add build mode toggle key
    this.keys.b = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);

    // Add mouse click handler for build mode
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerup", this.handlePointerUp, this);
  }

  /**
   * Create and configure Agents
   */
  private spawnAgents() {
    this.npcs = new AgentManager(this, this.wallLayer, this.doors);
    this.npcs.spawnAgents();
  }

  /**
   * Setup collision handlers for agents and doors
   */
  private setupCollisions() {
    this.physics.add.collider(
      this.npcs.getAgents(),
      this.doors,
      (agent, door) => {
        const doorSprite = door as Door;
        if (!doorSprite.isDoorLocked()) {
          doorSprite.open();
        }
      },
    );
  }

  /**
   * Add debug overlay for development
   */
  private addDebugOverlay() {
    render(<TilemapDebug tilemapLayer={this.wallLayer} />, this);
  }

  /**
   * Handle window resize events
   */
  private setupWindowResize() {
    this.scale.on("resize", () => {
      this.setupCamera(); // Recalculate position for new screen size
    });
  }

  /**
   * Handle camera movement based on keyboard input
   */
  private updateCameraMovement() {
    const camera = this.cameras.main;
    const deltaTime = this.game.loop.delta / 1000; // Convert to seconds
    const moveSpeed = this.CAMERA_SPEED * deltaTime;

    // Calculate movement based on pressed keys
    let deltaX = 0;
    let deltaY = 0;

    // Horizontal movement
    if (this.keys.left.isDown || this.keys.a.isDown) {
      deltaX = -moveSpeed;
    }
    if (this.keys.right.isDown || this.keys.d.isDown) {
      deltaX = moveSpeed;
    }

    // Vertical movement
    if (this.keys.up.isDown || this.keys.w.isDown) {
      deltaY = -moveSpeed;
    }
    if (this.keys.down.isDown || this.keys.s.isDown) {
      deltaY = moveSpeed;
    }

    // Apply movement if any keys are pressed
    if (deltaX !== 0 || deltaY !== 0) {
      // Get current center position using Phaser's built-in properties
      const currentCenterX = camera.midPoint.x;
      const currentCenterY = camera.midPoint.y;

      // Calculate new center position
      const newCenterX = currentCenterX + deltaX;
      const newCenterY = currentCenterY + deltaY;

      // Apply bounds to the center position
      const bounds = this.getCenterBounds();
      const clampedCenterX = Phaser.Math.Clamp(
        newCenterX,
        bounds.minCenterX,
        bounds.maxCenterX,
      );
      const clampedCenterY = Phaser.Math.Clamp(
        newCenterY,
        bounds.minCenterY,
        bounds.maxCenterY,
      );

      // Use centerOn to maintain consistency
      camera.centerOn(clampedCenterX, clampedCenterY);
    }
  }

  /**
   * Calculate valid camera center bounds for movement
   *
   * @returns Object with min/max center X/Y positions
   */
  private getCenterBounds() {
    const camera = this.cameras.main;
    const mapWidth = this.map.widthInPixels;
    const mapHeight = this.map.heightInPixels;

    // How much of the map is visible at current zoom
    const visibleMapWidth = this.scale.width / camera.zoom;
    const visibleMapHeight = this.scale.height / camera.zoom;

    // Simple bounds: center can move within the map boundaries
    // If map is smaller than view, center stays at map center
    const halfViewWidth = visibleMapWidth / 2;
    const halfViewHeight = visibleMapHeight / 2;

    let minCenterX, maxCenterX, minCenterY, maxCenterY;

    // X bounds
    if (mapWidth <= visibleMapWidth) {
      // Map fits within view - lock to center
      minCenterX = maxCenterX = mapWidth / 2;
    } else {
      // Map is bigger than view - allow scrolling
      minCenterX = halfViewWidth;
      maxCenterX = mapWidth - halfViewWidth;
    }

    // Y bounds
    if (mapHeight <= visibleMapHeight) {
      // Map fits within view - lock to center
      minCenterY = maxCenterY = mapHeight / 2;
    } else {
      // Map is bigger than view - allow scrolling
      minCenterY = halfViewHeight;
      maxCenterY = mapHeight - halfViewHeight;
    }

    return {
      minCenterX,
      maxCenterX,
      minCenterY,
      maxCenterY,
    };
  }

  /**
   * Handle mouse clicks for build mode
   */
  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    const currentBuildMode = useSimulationStore.getState().buildMode;

    if (currentBuildMode) {
      // Convert screen coordinates to world coordinates
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

      if (currentBuildMode === "doors") {
        // Check if there's already a door at this location
        const existingDoor = this.findDoorAt(
          worldPoint.x,
          worldPoint.y,
        ) as Door | null;

        if (existingDoor) {
          // Right-click toggles lock state, left-click toggles door type
          if (pointer.button === 2) {
            // Right mouse button
            this.toggleDoorLock(existingDoor);
          } else {
            // Left mouse button or touch
            this.toggleDoorType(existingDoor);
          }
        } else {
          // Only place new doors on left-click (not right-click)
          if (pointer.button !== 2) {
            this.placeDoor(worldPoint.x, worldPoint.y);
          }
        }
      } else if (currentBuildMode === "regions") {
        // Handle region placement
        if (pointer.button === 2) {
          const region = this.findRegionAt(worldPoint.x, worldPoint.y);
          if (region) {
            this.removeRegion(region);
          }
        } else {
          const snappedX = Math.floor(worldPoint.x / 16) * 16;
          const snappedY = Math.floor(worldPoint.y / 16) * 16;
          this.selectionRectangle.x = snappedX;
          this.selectionRectangle.y = snappedY;
          this.selectionRectangle.width = 0;
          this.selectionRectangle.height = 0;
          this.selectionRectangle.setVisible(true);
        }
      }
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.selectionRectangle.visible) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.selectionRectangle.width = worldPoint.x - this.selectionRectangle.x;
      this.selectionRectangle.height = worldPoint.y - this.selectionRectangle.y;
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (this.selectionRectangle.visible) {
      this.selectionRectangle.setVisible(false);
      const snappedX = Math.floor(this.selectionRectangle.x / 16) * 16;
      const snappedY = Math.floor(this.selectionRectangle.y / 16) * 16;
      const snappedWidth = Math.ceil(this.selectionRectangle.width / 16) * 16;
      const snappedHeight = Math.ceil(this.selectionRectangle.height / 16) * 16;

      if (snappedWidth > 0 && snappedHeight > 0) {
        this.placeRegion(snappedX, snappedY, snappedWidth, snappedHeight);
      }
    }
  }

  /**
   * Place a door at the specified world coordinates
   */
  private placeDoor(worldX: number, worldY: number) {
    // Snap to 16x16 grid (door size)
    const snappedX = Math.floor(worldX / 16) * 16 + 8; // Center on tile
    const snappedY = Math.floor(worldY / 16) * 16 + 8; // Center on tile

    try {
      // Create a new door
      const door = new Door(this, snappedX, snappedY, "horizontal", "left");

      this.doors.add(door);
    } catch (error) {
      console.error("Error creating door:", error);
    }
  }

  /**
   * Place a region at the specified world coordinates
   */
  private placeRegion(x: number, y: number, width: number, height: number) {
    const label = prompt("Enter region label:");
    if (label) {
      const region = new Region(
        this,
        x,
        y,
        width,
        height,
        label,
        Phaser.Display.Color.GetColor(
          Phaser.Math.Between(0, 255),
          Phaser.Math.Between(0, 255),
          Phaser.Math.Between(0, 255),
        ),
      );
      this.regions.add(region);
    }
  }

  private findRegionAt(worldX: number, worldY: number): Region | null {
    for (const region of this.regions.getChildren()) {
      const regionSprite = region as Region;
      if (regionSprite.getBounds().contains(worldX, worldY)) {
        return regionSprite;
      }
    }
    return null;
  }

  private removeRegion(region: Region) {
    this.regions.remove(region, true);
  }

  /**
   * Find a door at the specified world coordinates
   */
  private findDoorAt(
    worldX: number,
    worldY: number,
  ): Phaser.GameObjects.GameObject | null {
    // Snap the coordinates to the same grid as door placement
    const snappedX = Math.floor(worldX / 16) * 16 + 8;
    const snappedY = Math.floor(worldY / 16) * 16 + 8;

    // Check all doors to see if any are at this location
    for (const door of this.doors.getChildren()) {
      const doorSprite = door as Door;
      const doorX = Math.floor(doorSprite.x / 16) * 16 + 8;
      const doorY = Math.floor(doorSprite.y / 16) * 16 + 8;

      if (doorX === snappedX && doorY === snappedY) {
        return door;
      }
    }

    return null;
  }

  /**
   * Toggle a door through the cycle: horizontal → vertical-left → vertical-right → remove
   */
  private toggleDoorType(door: Door) {
    const currentType = door.getDoorType();

    if (currentType === "horizontal") {
      // horizontal → vertical-left
      door.setDoorType("vertical");
      door.setDoorPosition("left");
    } else {
      // vertical door - check position
      const currentPosition = door.getDoorPosition();

      if (currentPosition === "left") {
        // vertical-left → vertical-right
        door.setDoorPosition("right");
      } else {
        // vertical-right → remove door
        this.removeDoor(door);
        return;
      }
    }
  }

  /**
   * Toggle the lock state of a door
   */
  private toggleDoorLock(door: Door) {
    door.toggleDoorLock();
  }

  /**
   * Remove a door from the scene
   */
  private removeDoor(door: Door) {
    // Remove from doors group
    this.doors.remove(door, true);

    // Remove from scene
    door.destroy();
  }

  /**
   * Load saved build from data.json
   */
  private async loadSavedBuild() {
    // Create a physics group for doors
    this.doors = this.physics.add.group({
      classType: Door,
      runChildUpdate: true,
    });
    this.regions = this.add.group({
      classType: Region,
    });

    try {
      const buildData = await loadBuildAsync();
      for (const savedDoor of buildData.doors) {
        const door = new Door(
          this,
          savedDoor.x,
          savedDoor.y,
          savedDoor.type,
          savedDoor.position,
          savedDoor.isLocked,
        );

        // Set the door state (open/closed)
        if (savedDoor.isOpen) {
          door.open();
        } else {
          door.close();
        }

        this.doors.add(door);
      }

      for (const savedRegion of buildData.regions) {
        const region = new Region(
          this,
          savedRegion.x,
          savedRegion.y,
          savedRegion.width,
          savedRegion.height,
          savedRegion.label,
          savedRegion.color,
        );

        this.regions.add(region);
      }
    } catch (error) {
      console.error("Error loading saved build:", error);
    }
  }
}
