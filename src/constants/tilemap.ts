export const TILESET_NAME = 'tileset';

export enum TilemapLayer {
  BelowPlayer = 'Below Player',
  World = 'World',
  AbovePlayer = 'Above Player',
  Objects = 'Objects',
  // Stanford Prison layers
  Floor = 'floor',
  Trees = 'trees',
  Walls = 'walls',
}

export enum TilemapObject {
  SpawnPoint = 'Spawn Point',
  Sign = 'Sign',
}
