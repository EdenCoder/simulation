export interface SpatialAgent {
  id: string;
  name: string;
}

export interface LocationSeekOpts {
  message: string;
  speakerId: string;
  nearby: SpatialAgent[];
  chatParticipants?: SpatialAgent[];
  knownAgents?: SpatialAgent[];
  getRegionOf?: (agentId: string) => string;
}

function canonicalize(role: string, num: string): string {
  const kind = role[0].toUpperCase() + role.slice(1).toLowerCase();
  return `${kind} #${num}`;
}

function findAgent(
  raw: string,
  agents: SpatialAgent[],
): SpatialAgent | undefined {
  const wanted = raw.toLowerCase().trim();
  const exact = agents.find((a) => a.name.toLowerCase() === wanted);
  if (exact) return exact;
  const role = raw.match(/(prisoner|guard)/i)?.[1]?.toLowerCase();
  const num = raw.match(/\d+/)?.[0];
  if (!role || !num) return undefined;
  return agents.find((a) => {
    const aRole = a.name.match(/(prisoner|guard)/i)?.[1]?.toLowerCase();
    const aNum = a.name.match(/\d+/)?.[0];
    return aRole === role && aNum === num;
  });
}

function firstNamedInMessage(
  message: string,
  agents: SpatialAgent[],
  speakerId: string,
): SpatialAgent | undefined {
  for (const m of message.matchAll(/(prisoner|guard)\s*#?\s*(\d+)/gi)) {
    const name = canonicalize(m[1], m[2]);
    const found = findAgent(name, agents);
    if (found && found.id !== speakerId) return found;
    if (!found) return { id: "", name };
  }
  return undefined;
}

function seenPhrase(id: string, getRegionOf?: (id: string) => string): string {
  if (!id) return "right in front of you";
  const region = getRegionOf?.(id);
  if (!region || region === "unknown") return "right in front of you";
  return `in ${region}`;
}

function isLocationAnswer(message: string): boolean {
  return /\b(i don't know|i do not know|i haven't seen|i have not seen|i have no (idea|information)|i really don't know|i really haven't|i have no idea where|i'm not sure where|i am not sure where)\b/i.test(
    message,
  );
}

function asksOwnLocation(message: string): boolean {
  return (
    /\bwhere are you\b/i.test(message) ||
    /\bare you (?:in|at|still (?:in|at))\b/i.test(message) ||
    /\bare you (?:here|nearby|around)\b/i.test(message)
  );
}

function thirdPartyLocationMatch(message: string): RegExpMatchArray | null {
  return (
    message.match(
      /\b(?:where(?:'s| is)|where are)\s+((?:prisoner|guard)\s*#?\s*\d+)/i,
    ) ||
    message.match(
      /\b(?:do you know|tell me|i asked you)\s+where\s+((?:prisoner|guard)\s*#?\s*\d+)/i,
    ) ||
    message.match(/\bwhere\s+((?:prisoner|guard)\s*#?\s*\d+)\s+is\b/i)
  );
}

function visibleMap(
  nearby: SpatialAgent[],
  chatParticipants: SpatialAgent[] | undefined,
): Map<string, SpatialAgent> {
  const visible = new Map<string, SpatialAgent>();
  for (const a of [...nearby, ...(chatParticipants ?? [])]) {
    visible.set(a.name.toLowerCase(), a);
  }
  return visible;
}

function isVisible(
  target: SpatialAgent,
  visible: Map<string, SpatialAgent>,
): SpatialAgent | undefined {
  const byName = visible.get(target.name.toLowerCase());
  if (byName) return byName;
  const role = target.name.match(/(prisoner|guard)/i)?.[1]?.toLowerCase();
  const num = target.name.match(/\d+/)?.[0];
  if (!role || !num) return undefined;
  for (const a of visible.values()) {
    const aRole = a.name.match(/(prisoner|guard)/i)?.[1]?.toLowerCase();
    const aNum = a.name.match(/\d+/)?.[0];
    if (aRole === role && aNum === num) return a;
  }
  return undefined;
}

export function locationSeekRefusal(opts: LocationSeekOpts): string | null {
  const {
    message,
    speakerId,
    nearby,
    chatParticipants,
    knownAgents,
    getRegionOf,
  } = opts;

  if (isLocationAnswer(message)) return null;

  const selfAsk = asksOwnLocation(message);
  const otherMatch = thirdPartyLocationMatch(message);
  if (!selfAsk && !otherMatch) return null;

  const visible = visibleMap(nearby, chatParticipants);
  const roster = [
    ...(knownAgents ?? []),
    ...nearby,
    ...(chatParticipants ?? []),
  ];
  const othersInChat = (chatParticipants ?? []).filter(
    (p) => p.id !== speakerId,
  );

  if (selfAsk) {
    const named = firstNamedInMessage(message, roster, speakerId);
    if (named) {
      const seen = isVisible(named, visible);
      if (seen) {
        return `You can already see ${seen.name} ${seenPhrase(seen.id, getRegionOf)}. Do not ask them where they are — look at [Nearby Agents] / [Prisoners In Sight].`;
      }
      // Not visible: asking after them is legitimate. Finding someone you
      // cannot see is part of the job, whether by questioning others or
      // by patrolling.
      return null;
    }
    if (othersInChat.length > 1) {
      return "Everyone in this conversation is with you — you can see them. Do not ask where they are.";
    }
    const target = othersInChat[0] ?? nearby[0];
    if (target) {
      return `You can already see ${target.name} ${seenPhrase(target.id, getRegionOf)}. Do not ask them where they are — look at [Nearby Agents] / [Prisoners In Sight].`;
    }
    return "You can see who is near you under [Nearby Agents]. Do not ask them where they are.";
  }

  const rawName = otherMatch![1];
  const resolved =
    findAgent(rawName, roster) ??
    (() => {
      const m = rawName.match(/(prisoner|guard)\s*#?\s*(\d+)/i);
      return m ? { id: "", name: canonicalize(m[1], m[2]) } : undefined;
    })();
  if (!resolved) return null;

  const seen = isVisible(resolved, visible);
  if (seen) {
    return `You can already see ${seen.name} ${seenPhrase(seen.id, getRegionOf)}. Do not ask anyone where they are.`;
  }

  // The subject is not visible to the speaker. Asking where they are is a
  // reasonable thing to do, so let it through.
  return null;
}
