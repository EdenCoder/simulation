import { Scene } from 'phaser';

import * as assets from '../assets';
import { key } from '../constants';

export class Boot extends Scene {
  constructor() {
    super(key.scene.boot);
  }

  preload() {
    this.load.image(key.image.tileset, assets.tilesets.tileset);
    this.load.tilemapTiledJSON(key.tilemap.stanfordPrison, assets.tilemaps.stanfordPrison);
    this.load.atlas(key.atlas.arthur, assets.arthur.image, assets.arthur.data);
    this.load.atlas(key.atlas.morgan, assets.morgan.image, assets.morgan.data);

    // Load all emote assets as spritesheets (PNG sprite maps with 2 vertical 48px tiles, 96px total height)
    this.load.spritesheet(key.emote.angry, assets.emotes.emotes.angry.asset, {
      frameWidth: 48,
      frameHeight: 96,
    });
    this.load.spritesheet(key.emote.mail, assets.emotes.emotes.mail.asset, {
      frameWidth: 48,
      frameHeight: 96,
    });
    this.load.spritesheet(key.emote.thinking, assets.emotes.emotes.thinking.asset, {
      frameWidth: 48,
      frameHeight: 96,
    });
    this.load.spritesheet(key.emote.timerGreenToGreen, assets.emotes.emotes.timerGreenToGreen.asset, {
      frameWidth: 48,
      frameHeight: 96,
    });
    this.load.spritesheet(key.emote.timerGreenToRed, assets.emotes.emotes.timerGreenToRed.asset, {
      frameWidth: 48,
      frameHeight: 96,
    });

    // Load door spritesheets (16x16 with 4 horizontal frames)
    this.load.spritesheet(key.image.door, assets.door.door, {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet(key.image.doorVertical, assets.door.doorVertical, {
      frameWidth: 16,
      frameHeight: 16,
    });

  }

  create() {
    this.scene.start(key.scene.main);
  }
}
