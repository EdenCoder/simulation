// Import all emote assets (PNG sprite maps with 2 vertical 48px tiles)
import angryEmote from './angry-emote.png';
import mail from './mail.png';
import thinking from './thinking-emote-dots.png';
import timerGreenToGreen from './timer-green-to-green.png';
import timerGreenToRed from './timer-green-to-red.png';

// Export all emotes with frame count information
export const emotes = {
  angry: { asset: angryEmote, frames: 4 },
  mail: { asset: mail, frames: 6 },
  thinking: { asset: thinking, frames: 8 },
  timerGreenToGreen: { asset: timerGreenToGreen, frames: 8 },
  timerGreenToRed: { asset: timerGreenToRed, frames: 8 },
} as const;

// Export emote keys for easy access
export const emoteKeys = Object.keys(emotes) as Array<keyof typeof emotes>;

// Export default export for convenience
export default emotes;