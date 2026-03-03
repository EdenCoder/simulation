// Arthur character sprite animations
// Based on frame mappings: arthur-[0-39] with specific animation states

export const ArthurAnimations = {
  // Idle animations (4 frames each)
  idle: {
    down: ['arthur-0.png', 'arthur-1.png', 'arthur-2.png', 'arthur-3.png'],
    right: ['arthur-4.png', 'arthur-5.png', 'arthur-6.png', 'arthur-7.png'],
    up: ['arthur-8.png', 'arthur-9.png', 'arthur-10.png', 'arthur-11.png'],
    left: ['arthur-12.png', 'arthur-13.png', 'arthur-14.png', 'arthur-15.png']
  },
  
  // Moving animations (6 frames each)
  moving: {
    down: ['arthur-16.png', 'arthur-17.png', 'arthur-18.png', 'arthur-19.png', 'arthur-20.png', 'arthur-21.png'],
    right: ['arthur-22.png', 'arthur-23.png', 'arthur-24.png', 'arthur-25.png', 'arthur-26.png', 'arthur-27.png'],
    up: ['arthur-28.png', 'arthur-29.png', 'arthur-30.png', 'arthur-31.png', 'arthur-32.png', 'arthur-33.png'],
    left: ['arthur-34.png', 'arthur-35.png', 'arthur-36.png', 'arthur-37.png', 'arthur-38.png', 'arthur-39.png']
  }
};

// Animation configuration for easy use in game engines
export const ArthurConfig = {
  spritesheet: 'arthur.png',
  atlas: 'arthur.json',
  animations: {
    // Idle animations
    'idle-down': {
      frames: ArthurAnimations.idle.down,
      frameRate: 4,
      repeat: -1
    },
    'idle-right': {
      frames: ArthurAnimations.idle.right,
      frameRate: 4,
      repeat: -1
    },
    'idle-up': {
      frames: ArthurAnimations.idle.up,
      frameRate: 4,
      repeat: -1
    },
    'idle-left': {
      frames: ArthurAnimations.idle.left,
      frameRate: 4,
      repeat: -1
    },
    
    // Moving animations
    'move-down': {
      frames: ArthurAnimations.moving.down,
      frameRate: 8,
      repeat: -1
    },
    'move-right': {
      frames: ArthurAnimations.moving.right,
      frameRate: 8,
      repeat: -1
    },
    'move-up': {
      frames: ArthurAnimations.moving.up,
      frameRate: 8,
      repeat: -1
    },
    'move-left': {
      frames: ArthurAnimations.moving.left,
      frameRate: 8,
      repeat: -1
    }
  }
};

// Helper function to get animation by direction and state
export const getArthurAnimation = (direction: 'up' | 'down' | 'left' | 'right', state: 'idle' | 'moving') => {
  return ArthurAnimations[state][direction];
};

// Helper function to get animation key for game engines
export const getArthurAnimationKey = (direction: 'up' | 'down' | 'left' | 'right', state: 'idle' | 'moving') => {
  return state === 'idle' ? `idle-${direction}` : `move-${direction}`;
};

// Export all frames in order for reference
export const ArthurFrames = [
  // Idle facing down (0-3)
  'arthur-0.png', 'arthur-1.png', 'arthur-2.png', 'arthur-3.png',
  // Idle facing right (4-7)
  'arthur-4.png', 'arthur-5.png', 'arthur-6.png', 'arthur-7.png',
  // Idle facing up (8-11)
  'arthur-8.png', 'arthur-9.png', 'arthur-10.png', 'arthur-11.png',
  // Idle facing left (12-15)
  'arthur-12.png', 'arthur-13.png', 'arthur-14.png', 'arthur-15.png',
  // Moving facing down (16-21)
  'arthur-16.png', 'arthur-17.png', 'arthur-18.png', 'arthur-19.png', 'arthur-20.png', 'arthur-21.png',
  // Moving facing right (22-27)
  'arthur-22.png', 'arthur-23.png', 'arthur-24.png', 'arthur-25.png', 'arthur-26.png', 'arthur-27.png',
  // Moving facing up (28-33)
  'arthur-28.png', 'arthur-29.png', 'arthur-30.png', 'arthur-31.png', 'arthur-32.png', 'arthur-33.png',
  // Moving facing left (34-39)
  'arthur-34.png', 'arthur-35.png', 'arthur-36.png', 'arthur-37.png', 'arthur-38.png', 'arthur-39.png'
];

export default ArthurConfig;