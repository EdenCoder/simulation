import { beforeEach, describe, expect, it } from "vitest";

import {
  clearChatCooldowns,
  getChatCooldownRemaining,
  setChatCooldown,
} from "./chat-cooldown";

beforeEach(() => clearChatCooldowns());

describe("chat cooldown", () => {
  it("reports no cooldown by default", () => {
    expect(getChatCooldownRemaining("a1", 1000)).toBe(0);
  });

  it("counts down and expires", () => {
    setChatCooldown("a1", 45_000, 10_000);
    expect(getChatCooldownRemaining("a1", 10_000)).toBe(45_000);
    expect(getChatCooldownRemaining("a1", 40_000)).toBe(15_000);
    expect(getChatCooldownRemaining("a1", 55_000)).toBe(0);
  });

  it("is per-agent", () => {
    setChatCooldown("a1", 45_000, 0);
    expect(getChatCooldownRemaining("a2", 1000)).toBe(0);
  });
});
