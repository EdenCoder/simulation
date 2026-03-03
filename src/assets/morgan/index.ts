// Morgan character sprite animations
// Based on frame mappings: morgan-[0-39] with specific animation states

export const MorganAnimations = {
  // Idle animations (4 frames each)
  idle: {
    down: ['morgan-0.png', 'morgan-1.png', 'morgan-2.png', 'morgan-3.png'],
    right: ['morgan-4.png', 'morgan-5.png', 'morgan-6.png', 'morgan-7.png'],
    up: ['morgan-8.png', 'morgan-9.png', 'morgan-10.png', 'morgan-11.png'],
    left: ['morgan-12.png', 'morgan-13.png', 'morgan-14.png', 'morgan-15.png']
  },
  
  // Moving animations (6 frames each)
  moving: {
    down: ['morgan-16.png', 'morgan-17.png', 'morgan-18.png', 'morgan-19.png', 'morgan-20.png', 'morgan-21.png'],
    right: ['morgan-22.png', 'morgan-23.png', 'morgan-24.png', 'morgan-25.png', 'morgan-26.png', 'morgan-27.png'],
    up: ['morgan-28.png', 'morgan-29.png', 'morgan-30.png', 'morgan-31.png', 'morgan-32.png', 'morgan-33.png'],
    left: ['morgan-34.png', 'morgan-35.png', 'morgan-36.png', 'morgan-37.png', 'morgan-38.png', 'morgan-39.png']
  }
};

// Animation configuration for easy use in game engines
export const MorganConfig = {
  spritesheet: 'morgan.png',
  atlas: 'morgan.json',
  animations: {
    // Idle animations
    'idle-down': {
      frames: MorganAnimations.idle.down,
      frameRate: 4,
      repeat: -1
    },
    'idle-right': {
      frames: MorganAnimations.idle.right,
      frameRate: 4,
      repeat: -1
    },
    'idle-up': {
      frames: MorganAnimations.idle.up,
      frameRate: 4,
      repeat: -1
    },
    'idle-left': {
      frames: MorganAnimations.idle.left,
      frameRate: 4,
      repeat: -1
    },
    
    // Moving animations
    'move-down': {
      frames: MorganAnimations.moving.down,
      frameRate: 8,
      repeat: -1
    },
    'move-right': {
      frames: MorganAnimations.moving.right,
      frameRate: 8,
      repeat: -1
    },
    'move-up': {
      frames: MorganAnimations.moving.up,
      frameRate: 8,
      repeat: -1
    },
    'move-left': {
      frames: MorganAnimations.moving.left,
      frameRate: 8,
      repeat: -1
    }
  }
};

// Helper function to get animation by direction and state
export const getMorganAnimation = (direction: 'up' | 'down' | 'left' | 'right', state: 'idle' | 'moving') => {
  return MorganAnimations[state][direction];
};

// Helper function to get animation key for game engines
export const getMorganAnimationKey = (direction: 'up' | 'down' | 'left' | 'right', state: 'idle' | 'moving') => {
  return state === 'idle' ? `idle-${direction}` : `move-${direction}`;
};

// Export all frames in order for reference
export const MorganFrames = [
  // Idle facing down (0-3)
  'morgan-0.png', 'morgan-1.png', 'morgan-2.png', 'morgan-3.png',
  // Idle facing right (4-7)
  'morgan-4.png', 'morgan-5.png', 'morgan-6.png', 'morgan-7.png',
  // Idle facing up (8-11)
  'morgan-8.png', 'morgan-9.png', 'morgan-10.png', 'morgan-11.png',
  // Idle facing left (12-15)
  'morgan-12.png', 'morgan-13.png', 'morgan-14.png', 'morgan-15.png',
  // Moving facing down (16-21)
  'morgan-16.png', 'morgan-17.png', 'morgan-18.png', 'morgan-19.png', 'morgan-20.png', 'morgan-21.png',
  // Moving facing right (22-27)
  'morgan-22.png', 'morgan-23.png', 'morgan-24.png', 'morgan-25.png', 'morgan-26.png', 'morgan-27.png',
  // Moving facing up (28-33)
  'morgan-28.png', 'morgan-29.png', 'morgan-30.png', 'morgan-31.png', 'morgan-32.png', 'morgan-33.png',
  // Moving facing left (34-39)
  'morgan-34.png', 'morgan-35.png', 'morgan-36.png', 'morgan-37.png', 'morgan-38.png', 'morgan-39.png'
];

export default MorganConfig;