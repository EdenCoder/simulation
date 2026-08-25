import { describe, expect, it } from "vitest";

import { locationSeekRefusal } from "@/ai/tools/spatial-speech";

const G1 = { id: "g1", name: "Guard #1" };
const P1 = { id: "p1", name: "Prisoner #1" };
const P2 = { id: "p2", name: "Prisoner #2" };
const P3 = { id: "p3", name: "Prisoner #3" };

const regions: Record<string, string> = {
  g1: "Common Area",
  p1: "Rec Room",
  p2: "Common Area",
  p3: "Shower",
};

function refuse(
  message: string,
  opts: {
    speakerId?: string;
    nearby?: (typeof P1)[];
    chatParticipants?: (typeof P1)[];
    knownAgents?: (typeof P1)[];
  } = {},
) {
  return locationSeekRefusal({
    message,
    speakerId: opts.speakerId ?? "g1",
    nearby: opts.nearby ?? [P2],
    chatParticipants: opts.chatParticipants ?? [G1, P2],
    knownAgents: opts.knownAgents ?? [G1, P1, P2, P3],
    getRegionOf: (id) => regions[id] ?? "unknown",
  });
}

describe("locationSeekRefusal", () => {
  it("lets ordinary speech through", () => {
    expect(refuse("Prisoner #2, keep your voice down.")).toBeNull();
  });

  it("lets a prisoner answer that they do not know where someone is", () => {
    expect(
      refuse(
        "Officer, I don't know where Prisoner #1 is. I haven't seen him.",
        {
          speakerId: "p2",
        },
      ),
    ).toBeNull();
  });

  it("lets a guard ask others where an unseen prisoner is", () => {
    // Questioning people about someone you cannot see is legitimate;
    // only asking about someone standing in front of you is refused.
    expect(refuse("Prisoner #2, where is Prisoner #1?")).toBeNull();
  });

  it("stops a guard asking about someone they can already see", () => {
    const outcome = refuse("Where is Prisoner #2?");
    expect(outcome).toContain("already see Prisoner #2");
    expect(outcome).toContain("in Common Area");
  });

  it("stops asking someone in front of you whether they are in a region", () => {
    const outcome = refuse("Prisoner #2, are you in the Common Area?");
    expect(outcome).toContain("already see Prisoner #2");
    expect(outcome).toContain("in Common Area");
  });

  it("stops a nameless 'where are you' in a 1:1 chat", () => {
    const outcome = refuse("Where are you?");
    expect(outcome).toContain("already see Prisoner #2");
  });

  it("lets a prisoner ask a cellmate about someone they cannot see", () => {
    expect(
      refuse("Prisoner #2, where is Prisoner #3?", {
        speakerId: "p1",
        nearby: [P2],
        chatParticipants: [P1, P2],
      }),
    ).toBeNull();
  });

  it("still stops a prisoner asking a person in front of them where they are", () => {
    const outcome = refuse("Prisoner #2, are you in the Common Area?", {
      speakerId: "p1",
      nearby: [P2],
      chatParticipants: [P1, P2],
    });
    expect(outcome).toContain("already see Prisoner #2");
  });

  it("allows every phrasing of asking after an unseen prisoner", () => {
    expect(refuse("Tell me where Prisoner #1 is.")).toBeNull();
    expect(refuse("Prisoner #2, do you know where Prisoner #1 is?")).toBeNull();
    expect(refuse("Prisoner #2, where's Prisoner #1?")).toBeNull();
  });

  it("does not treat Guard #1 as Prisoner #1 when only the guard is in sight", () => {
    // Prisoner #1 is not visible, so the question is allowed...
    expect(
      refuse("Where is Prisoner #1?", {
        nearby: [G1],
        chatParticipants: [G1, P2],
      }),
    ).toBeNull();
    // ...but asking after the guard who IS in sight is still refused,
    // which is what proves the two are not being conflated.
    const seen = refuse("Where is Guard #1?", {
      speakerId: "p2",
      nearby: [G1],
      chatParticipants: [G1, P2],
    });
    expect(seen).toContain("already see Guard #1");
  });
});
