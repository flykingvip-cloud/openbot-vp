import { describe, expect, it } from "vitest";
import {
  areChatSessionKeysEquivalent,
  isForeignEmployeeStewardSessionKey,
  normalizeChatSessionKeyForMatch,
} from "./chat-session-key-match.ts";

describe("areChatSessionKeysEquivalent", () => {
  it("matches exact keys", () => {
    expect(areChatSessionKeysEquivalent("agent:panda:main", "agent:panda:main")).toBe(true);
  });

  it("matches main aliases with the caller's own employee steward remap", () => {
    const own = "agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    expect(areChatSessionKeysEquivalent("main", "agent:main:main")).toBe(true);
    expect(
      areChatSessionKeysEquivalent("agent:main:main", own, { ownStewardSessionKey: own }),
    ).toBe(true);
    expect(areChatSessionKeysEquivalent("main", own, { ownStewardSessionKey: own })).toBe(true);
  });

  it("does not match another employee's steward key via main", () => {
    const own = "agent:main:employee:alice";
    expect(
      areChatSessionKeysEquivalent("main", "agent:main:employee:bob", {
        ownStewardSessionKey: own,
      }),
    ).toBe(false);
    expect(
      areChatSessionKeysEquivalent("agent:main:employee:alice", "agent:main:employee:bob"),
    ).toBe(false);
  });

  it("does not match group/space sessions to employee steward", () => {
    expect(
      areChatSessionKeysEquivalent("agent:main:main:space:grp-demo", "agent:main:employee:alice"),
    ).toBe(false);
    expect(areChatSessionKeysEquivalent("space:grp-demo", "agent:main:main")).toBe(false);
  });

  it("does not match other agents to main", () => {
    expect(areChatSessionKeysEquivalent("agent:panda:main", "agent:main:main")).toBe(false);
  });
});

describe("normalizeChatSessionKeyForMatch", () => {
  it("does not collapse distinct employee steward keys", () => {
    expect(normalizeChatSessionKeyForMatch("main")).toBe("agent:main:main");
    expect(normalizeChatSessionKeyForMatch("agent:main:employee:u1")).toBe(
      "agent:main:employee:u1",
    );
    expect(normalizeChatSessionKeyForMatch("agent:main:employee:u2")).toBe(
      "agent:main:employee:u2",
    );
  });
});

describe("isForeignEmployeeStewardSessionKey", () => {
  it("detects sticky foreign employee steward keys against hello mainSessionKey", () => {
    const elle = "agent:main:employee:475156c1-03e7-44ad-9fb2-fcc880374b82";
    const daniel = "agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    expect(isForeignEmployeeStewardSessionKey(daniel, elle)).toBe(true);
    expect(isForeignEmployeeStewardSessionKey(elle, elle)).toBe(false);
    expect(isForeignEmployeeStewardSessionKey("main", elle)).toBe(false);
    expect(isForeignEmployeeStewardSessionKey("space:grp-demo", elle)).toBe(false);
    expect(isForeignEmployeeStewardSessionKey("agent:bot-skill:main", elle)).toBe(false);
    expect(isForeignEmployeeStewardSessionKey(daniel, "agent:main:main")).toBe(false);
  });
});
