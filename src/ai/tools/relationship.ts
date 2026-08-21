import { tool } from "ai";
import { z } from "zod";

/**
 * Optional named feeling. Omitting the type keeps the original single-axis
 * behaviour: one trust/distrust value per person. Naming a type records
 * that feeling alongside any others held toward the same person, so an
 * agent can fear and respect the same guard at once.
 */
const DEFAULT_TYPE = "trust";

interface RelationshipRecord {
  value: number;
  reason: string;
}

/** In-memory relationship tracker for a single agent. */
export class RelationshipState {
  private relationships = new Map<string, Map<string, RelationshipRecord>>();

  set(
    targetName: string,
    value: number,
    reason = "",
    type: string = DEFAULT_TYPE,
  ): void {
    const clamped = Math.max(-100, Math.min(100, value));
    let byType = this.relationships.get(targetName);
    if (!byType) {
      byType = new Map();
      this.relationships.set(targetName, byType);
    }

    // A named feeling at zero or below is no longer felt; the trust axis
    // keeps negative values because they mean distrust.
    if (type !== DEFAULT_TYPE && clamped <= 0) {
      byType.delete(type);
      if (byType.size === 0) this.relationships.delete(targetName);
      return;
    }

    byType.set(type, { value: clamped, reason });
  }

  get(targetName: string, type: string = DEFAULT_TYPE): number {
    return this.relationships.get(targetName)?.get(type)?.value ?? 0;
  }

  getContext(): string {
    if (this.relationships.size === 0) return "";
    const lines: string[] = [];
    for (const [name, byType] of this.relationships) {
      for (const [type, { value, reason }] of byType) {
        const because = reason ? ` — ${reason}` : "";
        if (type === DEFAULT_TYPE) {
          let label = "neutral towards";
          if (value >= 50) label = "deeply trust";
          else if (value >= 20) label = "somewhat trust";
          else if (value <= -50) label = "deeply distrust";
          else if (value <= -20) label = "somewhat distrust";
          lines.push(`- You ${label} ${name} (${value})${because}`);
        } else {
          lines.push(`- You feel ${type} toward ${name} (${value})${because}`);
        }
      }
    }
    return `[Relationships]\n${lines.join("\n")}`;
  }
}

export function createRelationshipTools(state: RelationshipState) {
  return {
    set_relationship: tool({
      description:
        "Update how you feel about another person. Value from -100 (hate) to +100 (deep trust). Optionally name a specific feeling (fear, respect, loyalty, contempt, friendship, rivalry, hostility, sympathy) to record it alongside how much you trust them — you can hold several feelings about the same person at once.",
      parameters: z.object({
        target_name: z.string().describe("Name of the person"),
        value: z.number().min(-100).max(100).describe("Relationship value"),
        reason: z.string().describe("Why you feel this way"),
        type: z
          .string()
          .optional()
          .describe(
            'Optional named feeling (e.g. "fear", "respect"). Leave it out to set overall trust. A named feeling set to 0 or below is removed.',
          ),
      }),
      execute: async ({ target_name, value, reason, type }) => {
        state.set(target_name, value, reason, type ?? DEFAULT_TYPE);
        const what =
          type && type !== DEFAULT_TYPE
            ? `${type} toward ${target_name}`
            : `Relationship with ${target_name}`;
        return {
          success: true,
          outcome: `${what} set to ${value}. Reason: ${reason}`,
        };
      },
    }),
  };
}
