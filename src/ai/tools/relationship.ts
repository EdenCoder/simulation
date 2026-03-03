import { tool } from 'ai';
import { z } from 'zod';

/** In-memory relationship tracker for a single agent. */
export class RelationshipState {
  private relationships = new Map<string, number>();

  set(targetName: string, value: number): void {
    this.relationships.set(targetName, Math.max(-100, Math.min(100, value)));
  }

  get(targetName: string): number {
    return this.relationships.get(targetName) ?? 0;
  }

  getContext(): string {
    if (this.relationships.size === 0) return '';
    const lines: string[] = [];
    for (const [name, value] of this.relationships) {
      let label = 'neutral towards';
      if (value >= 50) label = 'deeply trust';
      else if (value >= 20) label = 'somewhat trust';
      else if (value <= -50) label = 'deeply distrust';
      else if (value <= -20) label = 'somewhat distrust';
      lines.push(`- You ${label} ${name} (${value})`);
    }
    return `[Relationships]\n${lines.join('\n')}`;
  }
}

export function createRelationshipTools(state: RelationshipState) {
  return {
    set_relationship: tool({
      description: 'Update how you feel about another person. Value from -100 (hate) to +100 (deep trust).',
      parameters: z.object({
        target_name: z.string().describe('Name of the person'),
        value: z.number().min(-100).max(100).describe('Relationship value'),
        reason: z.string().describe('Why you feel this way'),
      }),
      execute: async ({ target_name, value, reason }) => {
        state.set(target_name, value);
        return { success: true, outcome: `Relationship with ${target_name} set to ${value}. Reason: ${reason}` };
      },
    }),
  };
}
