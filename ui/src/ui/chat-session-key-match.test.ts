import { describe, expect, it } from "vitest";
import {
  areChatSessionKeysEquivalent,
  canonicalizeWorkbenchChatSessionKey,
  chatEventMatchesOpenSession,
  isForeignEmployeeStewardSessionKey,
  normalizeChatSessionKeyForMatch,
  resolveChatSurfaceId,
  resolveWorkbenchSessionKeyFromUrlSearch,
  sessionKeysShareChatSurface,
} from "./chat-session-key-match.ts";

describe("chat-session-key-match", () => {
  it("equates main aliases with the caller's own steward key only", () => {
    const own = "agent:main:employee:alice";
    expect(areChatSessionKeysEquivalent("main", own, { ownStewardSessionKey: own })).toBe(true);
    expect(areChatSessionKeysEquivalent("agent:main", own, { ownStewardSessionKey: own })).toBe(
      true,
    );
    expect(
      areChatSessionKeysEquivalent("agent:main:main", own, { ownStewardSessionKey: own }),
    ).toBe(true);
    expect(
      areChatSessionKeysEquivalent("main", "agent:main:employee:bob", {
        ownStewardSessionKey: own,
      }),
    ).toBe(false);
    expect(areChatSessionKeysEquivalent("main", "agent:bot-skill:main")).toBe(false);
    expect(areChatSessionKeysEquivalent("agent:bot-skill:main", "agent:secretary:main")).toBe(
      false,
    );
  });

  it("detects foreign sticky employee steward keys against hello mainSessionKey", () => {
    const elle = "agent:main:employee:475156c1-03e7-44ad-9fb2-fcc880374b82";
    const daniel = "agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    expect(isForeignEmployeeStewardSessionKey(daniel, elle)).toBe(true);
    expect(isForeignEmployeeStewardSessionKey(elle, elle)).toBe(false);
    expect(isForeignEmployeeStewardSessionKey("main", elle)).toBe(false);
    expect(isForeignEmployeeStewardSessionKey("space:grp-demo", elle)).toBe(false);
    expect(isForeignEmployeeStewardSessionKey("agent:bot-skill:main", elle)).toBe(false);
    expect(isForeignEmployeeStewardSessionKey(daniel, "agent:main:main")).toBe(false);
  });

  it("never equates different employee steward owners", () => {
    expect(
      areChatSessionKeysEquivalent("agent:main:employee:alice", "agent:main:employee:bob"),
    ).toBe(false);
    expect(
      areChatSessionKeysEquivalent("agent:main:employee:alice", "agent:main:employee:bob", {
        ownStewardSessionKey: "agent:main:employee:alice",
      }),
    ).toBe(false);
    expect(
      areChatSessionKeysEquivalent("main", "agent:main:employee:bob", {
        ownStewardSessionKey: "agent:main:employee:alice",
      }),
    ).toBe(false);
  });

  it("without ownStewardSessionKey, main does not match an arbitrary employee key", () => {
    expect(areChatSessionKeysEquivalent("main", "agent:main:employee:alice")).toBe(false);
    expect(areChatSessionKeysEquivalent("main", "agent:main:main")).toBe(true);
  });

  it("collapses conversation children onto the parent agent surface", () => {
    expect(resolveChatSurfaceId("agent:bot-skill:main")).toBe("agent:bot-skill");
    expect(resolveChatSurfaceId("agent:bot-skill:main:conversation:abc")).toBe("agent:bot-skill");
    expect(resolveChatSurfaceId("main")).toBe("agent:main");
    expect(resolveChatSurfaceId("agent:main:employee:alice")).toBe("agent:main");
  });

  it("keeps collaboration nav aliases on the same space surface", () => {
    expect(sessionKeysShareChatSurface("space:alpha", "agent:main:space:alpha")).toBe(true);
    expect(sessionKeysShareChatSurface("space:alpha", "space:beta")).toBe(false);
    expect(sessionKeysShareChatSurface("agent:bot-skill:main", "main")).toBe(false);
    expect(
      sessionKeysShareChatSurface("agent:bot-skill:main", "agent:bot-skill:main:conversation:t1"),
    ).toBe(true);
    expect(sessionKeysShareChatSurface("agent:bot-2:org:upbeyond", "agent:bot-2:main")).toBe(false);
    expect(sessionKeysShareChatSurface("agent:bot-2:org:upbeyond", "space:upbeyond")).toBe(false);
  });

  it("matches live group events from per-bot child keys onto the space thread", () => {
    expect(
      chatEventMatchesOpenSession("agent:bot--agent:main:space:grp-demo", "space:grp-demo"),
    ).toBe(true);
    expect(chatEventMatchesOpenSession("space:grp-demo", "space:grp-other")).toBe(false);
    expect(chatEventMatchesOpenSession("agent:bot-skill:main", "agent:main:main")).toBe(false);
  });

  it("canonicalizes workbench destinations to one key per robot or group", () => {
    expect(canonicalizeWorkbenchChatSessionKey("agent:panda:main:space:grp-1")).toBe("space:grp-1");
    expect(canonicalizeWorkbenchChatSessionKey("agent:bot-2:imported:x")).toBe(
      "agent:bot-2:imported:x",
    );
  });

  it("binds URL session and leftover spaceId onto the same destination", () => {
    expect(resolveWorkbenchSessionKeyFromUrlSearch("?session=agent:panda:main:space:grp-1")).toBe(
      "space:grp-1",
    );
    expect(resolveWorkbenchSessionKeyFromUrlSearch("?spaceId=grp-1")).toBe("space:grp-1");
    expect(resolveWorkbenchSessionKeyFromUrlSearch("?spaceId=space:grp-1")).toBe("space:grp-1");
    expect(resolveWorkbenchSessionKeyFromUrlSearch("?session=agent:bot-2:main&spaceId=grp-1")).toBe(
      "agent:bot-2:main",
    );
    expect(resolveWorkbenchSessionKeyFromUrlSearch("?objectId=doc-1")).toBeNull();
  });

  it("matches live steward finals onto the two-part agent:main nav key", () => {
    const own = "agent:main:employee:alice";
    expect(
      chatEventMatchesOpenSession("agent:main:employee:alice", "agent:main", {
        ownStewardSessionKey: own,
      }),
    ).toBe(true);
    expect(
      chatEventMatchesOpenSession("agent:main:employee:bob", "agent:main", {
        ownStewardSessionKey: own,
      }),
    ).toBe(false);
  });
});

describe("normalizeChatSessionKeyForMatch", () => {
  it("keeps employee owners distinct and expands main via own key", () => {
    expect(normalizeChatSessionKeyForMatch("main")).toBe("agent:main:main");
    expect(
      normalizeChatSessionKeyForMatch("main", {
        ownStewardSessionKey: "agent:main:employee:u1",
      }),
    ).toBe("agent:main:employee:u1");
    expect(normalizeChatSessionKeyForMatch("agent:main:employee:u1")).toBe(
      "agent:main:employee:u1",
    );
    expect(normalizeChatSessionKeyForMatch("agent:main:employee:u2")).toBe(
      "agent:main:employee:u2",
    );
  });
});
