import Phaser from 'phaser';

import { key } from '../constants';

enum Animation {
  Open = 'open',
  Close = 'close',
}

type DoorType = 'horizontal' | 'vertical';
type DoorPosition = 'left' | 'right'; // Only for vertical doors

export class Door extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  private doorType: DoorType;
  private doorPosition: DoorPosition;
  private isOpen: boolean = false;
  private isLocked: boolean = false; // All doors unlocked by default
  private closeTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, doorType: DoorType = 'horizontal', doorPosition: DoorPosition = 'left', isLocked: boolean = false) {
    const textureKey = doorType === 'horizontal' ? key.image.door : key.image.doorVertical;

    super(scene, x, y, textureKey);

    this.doorType = doorType;
    this.doorPosition = doorPosition;
    this.isLocked = isLocked;

    // Add the sprite to the scene
    // Add the sprite to the scene and enable physics
    scene.add.existing(this);
    scene.physics.world.enable(this);

    // Set the origin to center
    this.setOrigin(0.5, 0.5);

    // Set immovable so agents can't push it
    this.body.setImmovable(true);
    this.body.pushable = false;

    // Create animations for this door
    this.createAnimations();

    // Start with closed animation
    this.close();
  }

  private createAnimations() {
    const anims = this.scene.anims;
    const textureKey = this.texture.key;
    const animPrefix = `${textureKey}_`;

    // Create open animation (frames 0 to 3)
    if (!anims.exists(animPrefix + Animation.Open)) {
      anims.create({
        key: animPrefix + Animation.Open,
        frames: this.scene.anims.generateFrameNumbers(textureKey, {
          start: 0,
          end: 3,
        }),
        frameRate: 8,
        repeat: 0, // Play once
      });
    }

    // Create close animation (frames 3 to 0)
    if (!anims.exists(animPrefix + Animation.Close)) {
      anims.create({
        key: animPrefix + Animation.Close,
        frames: this.scene.anims.generateFrameNumbers(textureKey, {
          start: 3,
          end: 0,
        }),
        frameRate: 8,
        repeat: 0, // Play once
      });
    }
  }

  open() {
    if (this.isOpen || this.isLocked) return;

    this.isOpen = true;
    const animPrefix = `${this.texture.key}_`;
    this.anims.play(animPrefix + Animation.Open);

    // Disable collision while open
    this.body.checkCollision.none = true;

    // Automatically close after a delay
    this.closeTimer = this.scene.time.delayedCall(2000, this.close, [], this);
  }

  close() {
    if (!this.isOpen) return;

    // Cancel any pending auto-close timer
    if (this.closeTimer) {
      this.closeTimer.remove(false);
      this.closeTimer = null;
    }

    this.isOpen = false;
    const animPrefix = `${this.texture.key}_`;
    this.anims.play(animPrefix + Animation.Close);

    // Re-enable collision when closed
    this.body.checkCollision.none = false;
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  isDoorOpen(): boolean {
    return this.isOpen;
  }

  getDoorType(): DoorType {
    return this.doorType;
  }

  getDoorPosition(): DoorPosition {
    return this.doorPosition;
  }

  isDoorLocked(): boolean {
    return this.isLocked;
  }

  setDoorLocked(locked: boolean) {
    this.isLocked = locked;
  }

  toggleDoorLock() {
    this.setDoorLocked(!this.isLocked);
  }

  /**
   * Change the door type and update its texture
   */
  setDoorType(newType: DoorType) {
    if (this.doorType === newType) {
      return;
    }

    this.doorType = newType;

    // Update the texture key based on the new type
    const textureKey = newType === 'horizontal' ? key.image.door : key.image.doorVertical;

    // Change the texture
    this.setTexture(textureKey);

    // Re-create animations for the new texture
    this.createAnimations();

    // Start with closed animation
    this.close();
  }

  /**
   * Set the door position (for vertical doors only)
   */
  setDoorPosition(newPosition: DoorPosition) {
    if (this.doorPosition === newPosition) {
      return;
    }

    this.doorPosition = newPosition;
  }
}