import { describe, expect, it } from "vitest";

import { RelationshipState } from "@/ai/tools/relationship";

describe("RelationshipState — Eden's single-axis behaviour", () => {
  it("records one trust value per person when no type is given", () => {
    const s = new RelationshipState();
    s.set("Guard #1", 60, "He was fair");
    expect(s.get("Guard #1")).toBe(60);
    expect(s.getContext()).toContain("You deeply trust Guard #1 (60)");
  });

  it("keeps negative values on the trust axis as distrust", () => {
    const s = new RelationshipState();
    s.set("Guard #2", -70, "He punished me unfairly");
    expect(s.get("Guard #2")).toBe(-70);
    expect(s.getContext()).toContain("You deeply distrust Guard #2 (-70)");
  });

  it("clamps to Eden's -100..100 range", () => {
    const s = new RelationshipState();
    s.set("Guard #3", 500, "");
    expect(s.get("Guard #3")).toBe(100);
  });

  it("overwrites the trust value on repeat", () => {
    const s = new RelationshipState();
    s.set("Guard #1", 40, "first");
    s.set("Guard #1", -20, "second");
    expect(s.get("Guard #1")).toBe(-20);
  });
});

describe("RelationshipState — several feelings at once", () => {
  it("holds fear and respect toward the same guard", () => {
    const s = new RelationshipState();
    s.set("Guard #3", 80, "He threatened solitary", "fear");
    s.set("Guard #3", 40, "He is consistent", "respect");

    expect(s.get("Guard #3", "fear")).toBe(80);
    expect(s.get("Guard #3", "respect")).toBe(40);

    const ctx = s.getContext();
    expect(ctx).toContain("You feel fear toward Guard #3 (80)");
    expect(ctx).toContain("You feel respect toward Guard #3 (40)");
  });

  it("keeps a named feeling separate from overall trust", () => {
    const s = new RelationshipState();
    s.set("Guard #1", -50, "He is harsh");
    s.set("Guard #1", 70, "He is in charge", "respect");

    expect(s.get("Guard #1")).toBe(-50);
    expect(s.get("Guard #1", "respect")).toBe(70);
    const ctx = s.getContext();
    expect(ctx).toContain("You deeply distrust Guard #1 (-50)");
    expect(ctx).toContain("You feel respect toward Guard #1 (70)");
  });

  it("removes a named feeling set to zero or below", () => {
    const s = new RelationshipState();
    s.set("Prisoner #2", 60, "He helped me", "friendship");
    expect(s.get("Prisoner #2", "friendship")).toBe(60);

    s.set("Prisoner #2", 0, "He informed on me", "friendship");
    expect(s.get("Prisoner #2", "friendship")).toBe(0);
    expect(s.getContext()).not.toContain("friendship");
  });

  it("stores the reason, which the original discarded", () => {
    const s = new RelationshipState();
    s.set("Guard #2", 50, "He rewarded my work", "respect");
    expect(s.getContext()).toContain("He rewarded my work");
  });

  it("returns no context when nothing is recorded", () => {
    expect(new RelationshipState().getContext()).toBe("");
  });
});
