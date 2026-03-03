// imports
import Phaser from 'phaser';

// local imports
import { Depth } from '../constants';

/**
 * @class Region
 * @description A draggable, resizable, and color-coded region for the map.
 * @extends Phaser.GameObjects.Rectangle
 */
export class Region extends Phaser.GameObjects.Rectangle {
  private label: string;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    color: number,
  ) {
    super(scene, x, y, width, height, color, 0.3); // 0.3 alpha for transparency
    this.label = label;

    // Add to scene and set properties
    scene.add.existing(this);
    this.setOrigin(0, 0);
    this.setDepth(Depth.BelowPlayer);
    this.setInteractive();
    scene.input.setDraggable(this);

    // Drag events
    this.on(
      'drag',
      (
        pointer: Phaser.Input.Pointer,
        dragX: number,
        dragY: number,
      ) => {
        this.x = dragX;
        this.y = dragY;
      },
    );
  }

  /**
   * @method getLabel
   * @description Get the label of the region.
   */
  public getLabel(): string {
    return this.label;
  }

  /**
   * @method setLabel
   * @description Set the label of the region.
   * @param {string} label - The new label.
   */
  public setLabel(label: string): void {
    this.label = label;
  }

  /**
   * @method getProperties
   * @description Get the properties of the region for saving.
   */
  public getProperties() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      label: this.label,
      color: this.fillColor,
    };
  }
}