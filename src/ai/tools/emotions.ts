import { tool } from 'ai';
import { z } from 'zod';

const EMOTION_EMOJIS: Record<string, string> = {
  angry: '😠',
  anxious: '😰',
  apprehensive: '😟',
  calm: '😌',
  confused: '😕',
  content: '😊',
  defiant: '😤',
  depressed: '😞',
  elated: '😄',
  fearful: '😨',
  frustrated: '😣',
  happy: '😊',
  hopeful: '🤞',
  hostile: '😡',
  nervous: '😬',
  sad: '😢',
  scared: '😱',
  tense: '😬',
};

export interface EmotionsDeps {
  onEmotionChange: (emoji: string | null) => void;
}

/** In-memory emotion state for a single agent. */
export class EmotionState {
  currentEmotion: string | null = null;
  currentIntensity = 0;

  getContext(): string {
    if (!this.currentEmotion) return '';
    return `[Emotional State] Currently feeling ${this.currentEmotion} (intensity: ${this.currentIntensity}/100)`;
  }
}

export function createEmotionsTool(state: EmotionState, deps: EmotionsDeps) {
  return {
    log_emotion: tool({
      description: 'Log your current emotional state.',
      parameters: z.object({
        emotion: z.string().describe('The emotion you are feeling (e.g. angry, calm, fearful, happy, anxious)'),
        intensity: z.number().min(0).max(100).describe('Intensity of the emotion (0-100)'),
      }),
      execute: async ({ emotion, intensity }) => {
        state.currentEmotion = emotion;
        state.currentIntensity = intensity;

        const emoji = EMOTION_EMOJIS[emotion.toLowerCase()] ?? '🫥';
        deps.onEmotionChange(intensity > 20 ? emoji : null);

        return { success: true, outcome: `Emotional state updated: ${emotion} (${intensity}/100)` };
      },
    }),
  };
}
