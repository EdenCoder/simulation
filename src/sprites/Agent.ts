import Phaser from 'phaser';

import { key } from '../constants';
import { useSimulationStore } from '../store/simulation';
import { Pathfinder, Point } from '../utils/pathfinding';

enum Animation {
  Left = 'left',
  Right = 'right',
  Up = 'up',
  Down = 'down',
  IdleLeft = 'idle_left',
  IdleRight = 'idle_right',
  IdleUp = 'idle_up',
  IdleDown = 'idle_down',
}

type CharacterType = 'arthur' | 'morgan';

export class Agent extends Phaser.Physics.Arcade.Sprite {
  declare body : Phaser.Physics.Arcade.Body;
  private id : string;
  private agentName : string;

  private role : 'prisoner' | 'guard';
  private speed : number;
  private targetX : number;
  private targetY : number;
  private isMoving : boolean = false;
  private isPaused : boolean = false;
  private isHalfSpeed : boolean = false;
  private pauseTimer : number = 0;
  private currentDirection : 'left' | 'right' | 'up' | 'down' = 'down';
  private characterType : CharacterType;
  
  // Pathfinding properties
  private worldLayer! : Phaser.Tilemaps.TilemapLayer;
  private pathfinder! : Pathfinder;
  private currentPath : Point[] = [];
  private currentPathIndex : number = 0;
  private pathfindingEnabled : boolean = true;
  private stuckCounter : number = 0;
  private lastPosition : Point = { x: 0, y: 0 };
  private readonly MAX_STUCK_COUNT = 30; // ~0.5 seconds at 60fps
  private readonly ARRIVAL_THRESHOLD = 8; // pixels
  
  // Movement promise tracking
  private movementResolve : ((success: boolean) => void) | null = null;
  private movementPromise : Promise<boolean> | null = null;
  

  constructor(scene : Phaser.Scene, config : { id: string; name: string; characterType: CharacterType; x: number; y: number; tint?: number; speed?: number; role: 'prisoner' | 'guard' }) {
    const atlasKey = key.atlas[config.characterType];
    super(scene, config.x, config.y, atlasKey, `${config.characterType}-0.png`);

    this.id = config.id;
    this.characterType = config.characterType;
    this.agentName = config.name;
    this.role = config.role;
    this.speed = (config.speed || 100) * 0.5; // Reduce speed by half
    this.targetX = config.x;
    this.targetY = config.y;

    // Add the sprite to the scene
    scene.add.existing(this);

    // Enable physics for the sprite
    scene.physics.world.enable(this);

    // Arthur character body size and offset - smaller hitbox for better pathfinding
    this.setSize(8, 8).setOffset(32 - 4, 32 - 4);

    // Collide with world bounds
    this.setCollideWorldBounds(true);

    // Apply tint if provided
    if (config.tint) {
      this.setTint(config.tint);
    }

    // Make interactive for clicking
    this.setInteractive();
    this.on('pointerdown', this.handleClick, this);

    // Create animations for this Agent
    this.createAnimations();

    this.stopAnimation();
  }


  setWorldLayer(worldLayer: Phaser.Tilemaps.TilemapLayer, doors: Phaser.Physics.Arcade.Group) {
    this.worldLayer = worldLayer;
    this.pathfinder = new Pathfinder(worldLayer, doors);
    this.lastPosition = { x: this.x, y: this.y };
  }

  private createAnimations() {
    const anims = this.scene.anims;
    const animPrefix = `${this.id}_`;
    const atlasKey = key.atlas[this.characterType];

    // Create left animation
    if (!anims.exists(animPrefix + Animation.Left)) {
      anims.create({
        key: animPrefix + Animation.Left,
        frames: [
          { key: atlasKey, frame: `${this.characterType}-34.png` },
          { key: atlasKey, frame: `${this.characterType}-35.png` },
          { key: atlasKey, frame: `${this.characterType}-36.png` },
          { key: atlasKey, frame: `${this.characterType}-37.png` },
          { key: atlasKey, frame: `${this.characterType}-38.png` },
          { key: atlasKey, frame: `${this.characterType}-39.png` },
        ],
        frameRate: 8,
        repeat: -1,
      });
    }

    // Create right animation
    if (!anims.exists(animPrefix + Animation.Right)) {
      anims.create({
        key: animPrefix + Animation.Right,
        frames: [
          { key: atlasKey, frame: `${this.characterType}-22.png` },
          { key: atlasKey, frame: `${this.characterType}-23.png` },
          { key: atlasKey, frame: `${this.characterType}-24.png` },
          { key: atlasKey, frame: `${this.characterType}-25.png` },
          { key: atlasKey, frame: `${this.characterType}-26.png` },
          { key: atlasKey, frame: `${this.characterType}-27.png` },
        ],
        frameRate: 8,
        repeat: -1,
      });
    }

    // Create up animation
    if (!anims.exists(animPrefix + Animation.Up)) {
      anims.create({
        key: animPrefix + Animation.Up,
        frames: [
          { key: atlasKey, frame: `${this.characterType}-28.png` },
          { key: atlasKey, frame: `${this.characterType}-29.png` },
          { key: atlasKey, frame: `${this.characterType}-30.png` },
          { key: atlasKey, frame: `${this.characterType}-31.png` },
          { key: atlasKey, frame: `${this.characterType}-32.png` },
          { key: atlasKey, frame: `${this.characterType}-33.png` },
        ],
        frameRate: 8,
        repeat: -1,
      });
    }

    // Create down animation
    if (!anims.exists(animPrefix + Animation.Down)) {
      anims.create({
        key: animPrefix + Animation.Down,
        frames: [
          { key: atlasKey, frame: `${this.characterType}-16.png` },
          { key: atlasKey, frame: `${this.characterType}-17.png` },
          { key: atlasKey, frame: `${this.characterType}-18.png` },
          { key: atlasKey, frame: `${this.characterType}-19.png` },
          { key: atlasKey, frame: `${this.characterType}-20.png` },
          { key: atlasKey, frame: `${this.characterType}-21.png` },
        ],
        frameRate: 8,
        repeat: -1,
      });
    }

    // Create idle animations
    if (!anims.exists(animPrefix + Animation.IdleLeft)) {
      anims.create({
        key: animPrefix + Animation.IdleLeft,
        frames: [
          { key: atlasKey, frame: `${this.characterType}-12.png` },
          { key: atlasKey, frame: `${this.characterType}-13.png` },
          { key: atlasKey, frame: `${this.characterType}-14.png` },
          { key: atlasKey, frame: `${this.characterType}-15.png` },
        ],
        frameRate: 4,
        repeat: -1,
      });
    }

    if (!anims.exists(animPrefix + Animation.IdleRight)) {
      anims.create({
        key: animPrefix + Animation.IdleRight,
        frames: [
          { key: atlasKey, frame: `${this.characterType}-4.png` },
          { key: atlasKey, frame: `${this.characterType}-5.png` },
          { key: atlasKey, frame: `${this.characterType}-6.png` },
          { key: atlasKey, frame: `${this.characterType}-7.png` },
        ],
        frameRate: 4,
        repeat: -1,
      });
    }

    if (!anims.exists(animPrefix + Animation.IdleUp)) {
      anims.create({
        key: animPrefix + Animation.IdleUp,
        frames: [
          { key: atlasKey, frame: `${this.characterType}-8.png` },
          { key: atlasKey, frame: `${this.characterType}-9.png` },
          { key: atlasKey, frame: `${this.characterType}-10.png` },
          { key: atlasKey, frame: `${this.characterType}-11.png` },
        ],
        frameRate: 4,
        repeat: -1,
      });
    }

    if (!anims.exists(animPrefix + Animation.IdleDown)) {
      anims.create({
        key: animPrefix + Animation.IdleDown,
        frames: [
          { key: atlasKey, frame: `${this.characterType}-0.png` },
          { key: atlasKey, frame: `${this.characterType}-1.png` },
          { key: atlasKey, frame: `${this.characterType}-2.png` },
          { key: atlasKey, frame: `${this.characterType}-3.png` },
        ],
        frameRate: 4,
        repeat: -1,
      });
    }
  }


  public async setTarget(x : number, y : number, halfSpeed : boolean = false): Promise<boolean> {
    this.targetX = x;
    this.targetY = y;
    this.isHalfSpeed = halfSpeed;
    
    // Create a new promise for this movement
    this.movementPromise = new Promise<boolean>((resolve) => {
      this.movementResolve = resolve;
    });
    
    if (!this.pathfindingEnabled || !this.pathfinder) {
      // Fallback to direct movement
      this.isMoving = true;
      this.isPaused = false;
      this.currentPath = [];
      return this.movementPromise;
    }
    
    // Calculate path using A* pathfinding
    const start = { x: this.x, y: this.y };
    const goal = { x: this.targetX, y: this.targetY };
    
    try {
      this.currentPath = await this.pathfinder.findPath(start, goal) || [];
    } catch (error) {
      // Fallback to direct movement
      this.currentPath = [goal];
    }
    
    this.currentPathIndex = 0;
    this.isMoving = this.currentPath.length > 0;
    this.isPaused = false;
    this.stuckCounter = 0;
    
    if (!this.isMoving) {
      // No path found, resolve as failure
      if (this.movementResolve) {
        this.movementResolve(false);
        this.movementResolve = null;
      }
      this.isPaused = true;
      this.pauseTimer = 1000 + Math.random() * 2000;
    }

    return this.movementPromise;
  }

  private moveTowardsTarget() {
    if (!this.pathfindingEnabled || this.currentPath.length === 0) {
      // Fallback to direct movement
      this.moveDirectlyToTarget();
      return;
    }
    
    // Follow the calculated path
    this.followPath();
  }

  private followPath() {
    if (this.currentPathIndex >= this.currentPath.length) {
      // Reached end of path
      this.reachTarget();
      return;
    }
    
    const currentWaypoint = this.currentPath[this.currentPathIndex];

    if (!currentWaypoint) {
      this.reachTarget();
      return;
    }

    const distance = Phaser.Math.Distance.Between(this.x, this.y, currentWaypoint.x, currentWaypoint.y);
    
    if (distance < this.ARRIVAL_THRESHOLD) {
      // Reached current waypoint, move to next
      this.currentPathIndex++;
      
      if (this.currentPathIndex >= this.currentPath.length) {
        // Reached final destination
        this.reachTarget();
        return;
      }
      
      // Continue to next waypoint
      this.followPath();
      return;
    }
    
    // Move towards current waypoint
    const angle = Phaser.Math.Angle.Between(this.x, this.y, currentWaypoint.x, currentWaypoint.y);
    const currentSpeed = this.isHalfSpeed ? this.speed * 0.5 : this.speed;
    const velocityX = Math.cos(angle) * currentSpeed;
    const velocityY = Math.sin(angle) * currentSpeed;
    
    this.body.setVelocity(velocityX, velocityY);
    this.updateAnimation(velocityX, velocityY);
  }

  private moveDirectlyToTarget() {
    const distance = Phaser.Math.Distance.Between(this.x, this.y, this.targetX, this.targetY);
    
    if (distance < this.ARRIVAL_THRESHOLD) {
      this.reachTarget();
      return;
    }

    // Calculate direction to target
    const angle = Phaser.Math.Angle.Between(this.x, this.y, this.targetX, this.targetY);
    const currentSpeed = this.isHalfSpeed ? this.speed * 0.5 : this.speed;
    const velocityX = Math.cos(angle) * currentSpeed;
    const velocityY = Math.sin(angle) * currentSpeed;

    this.body.setVelocity(velocityX, velocityY);
    this.updateAnimation(velocityX, velocityY);
  }

  /**
   * Handle reaching the target destination
   */
  private reachTarget() {
    this.body.setVelocity(0);
    this.isMoving = false;
    this.isPaused = true;
    this.currentPath = [];
    this.currentPathIndex = 0;
    
    // Resolve movement promise with success
    if (this.movementResolve) {
      this.movementResolve(true);
      this.movementResolve = null;
    }
    
    // Idle at destination for a longer random amount of time (3-8 seconds)
    this.pauseTimer = 3000 + Math.random() * 5000;
    this.stopAnimation();
  }

  private updateAnimation(velocityX : number, velocityY : number) {
    const animPrefix = `${this.id}_`;
    
    // Determine direction based on velocity
    if (Math.abs(velocityX) > Math.abs(velocityY)) {
      if (velocityX > 0) {
        this.currentDirection = 'right';
        this.anims.play(animPrefix + Animation.Right, true);
      } else {
        this.currentDirection = 'left';
        this.anims.play(animPrefix + Animation.Left, true);
      }
    } else {
      if (velocityY > 0) {
        this.currentDirection = 'down';
        this.anims.play(animPrefix + Animation.Down, true);
      } else {
        this.currentDirection = 'up';
        this.anims.play(animPrefix + Animation.Up, true);
      }
    }
  }

  private stopAnimation() {
    const animPrefix = `${this.id}_`;
    
    // Play idle animation based on current direction
    switch (this.currentDirection) {
    case 'left':
      this.anims.play(animPrefix + Animation.IdleLeft, true);
      break;
    case 'right':
      this.anims.play(animPrefix + Animation.IdleRight, true);
      break;
    case 'up':
      this.anims.play(animPrefix + Animation.IdleUp, true);
      break;
    case 'down':
      this.anims.play(animPrefix + Animation.IdleDown, true);
      break;
    }
  }

  update(time: number, delta: number) {
    // Speech bubbles and emoji bubbles are now handled in React layer

    // Normal movement logic
    if (this.isPaused) {
      this.pauseTimer -= delta;
      if (this.pauseTimer <= 0) {
        this.isPaused = false;
      }
    } else if (this.isMoving) {
      this.checkIfStuck();
      this.moveTowardsTarget();
    }
  }

  private checkIfStuck() {
    const currentPos = { x: this.x, y: this.y };
    const distanceMoved = Phaser.Math.Distance.Between(
      this.lastPosition.x,
      this.lastPosition.y,
      currentPos.x,
      currentPos.y
    );
    
    if (distanceMoved < 2) {
      this.stuckCounter++;
      
      if (this.stuckCounter >= this.MAX_STUCK_COUNT) {
        this.handleStuckSituation();
      }
    } else {
      this.stuckCounter = 0;
      this.lastPosition = currentPos;
    }
  }

  private handleStuckSituation() {
    this.body.setVelocity(0);
    this.stuckCounter = 0;
    this.stopAnimation();
    
    // Resolve movement promise with failure (stuck)
    if (this.movementResolve) {
      this.movementResolve(false);
      this.movementResolve = null;
    }
    
    // No target, just pause
    this.currentPath = [];
    this.currentPathIndex = 0;
    this.isPaused = true;
    this.pauseTimer = 500 + Math.random() * 1000;
  }

  // Get Agent name
  getName() : string {
    return this.agentName;
  }

  // Get Agent ID
  getId() : string {
    return this.id;
  }

  /**
   * Handle click events on the Agent
   */
  private handleClick() {
    const simStore = useSimulationStore.getState();
    simStore.showCharacterInfo({
      id: this.id,
      name: this.agentName,
      characterType: this.characterType,
      role: this.role,
      x: this.x,
      y: this.y,
      speed: this.speed,
    });
  }
}