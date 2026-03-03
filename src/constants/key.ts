const atlas = {
  arthur: 'arthur',
  morgan: 'morgan',
} as const;

const emote = {
  angry: 'angry',
  mail: 'mail',
  thinking: 'thinking',
  timerGreenToGreen: 'timerGreenToGreen',
  timerGreenToRed: 'timerGreenToRed',
} as const;

const image = {
  spaceman: 'spaceman',
  tuxemon: 'tuxemon',
  tileset: 'tileset',
  door: 'door',
  doorVertical: 'doorVertical',
} as const;

const scene = {
  boot: 'boot',
  main: 'main',
  menu: 'menu',
} as const;

const tilemap = {
  tuxemon: 'tuxemon',
  stanfordPrison: 'stanfordPrison',
} as const;

export const key = {
  atlas,
  emote,
  image,
  scene,
  tilemap,
} as const;
