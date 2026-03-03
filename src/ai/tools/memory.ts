import { tool } from 'ai';
import { z } from 'zod';

interface Memory {
  summary: string;
  importance: number;
  timestamp: number;
}

/** In-memory store for a single agent's memories. */
export class MemoryStore {
  private memories: Memory[] = [];
  private readonly maxMemories = 20;

  add(summary: string, importance: number): void {
    this.memories.push({ summary, importance, timestamp: Date.now() });
    // Keep only the most important/recent
    this.memories.sort((a, b) => b.importance - a.importance || b.timestamp - a.timestamp);
    if (this.memories.length > this.maxMemories) {
      this.memories = this.memories.slice(0, this.maxMemories);
    }
  }

  getContext(): string {
    if (this.memories.length === 0) return '';
    const lines = this.memories.slice(0, 10).map((m) => `- [${m.importance}/10] ${m.summary}`);
    return `[Memories]\n${lines.join('\n')}`;
  }
}

export function createMemoryTool(store: MemoryStore) {
  return {
    create_memory: tool({
      description: 'Store an important memory or observation for future reference.',
      parameters: z.object({
        summary: z.string().describe('Brief description of what happened'),
        importance: z.number().min(1).max(10).describe('How important is this memory (1-10)'),
      }),
      execute: async ({ summary, importance }) => {
        store.add(summary, importance);
        return { success: true, outcome: `Memory stored: "${summary}" (importance: ${importance})` };
      },
    }),
  };
}
