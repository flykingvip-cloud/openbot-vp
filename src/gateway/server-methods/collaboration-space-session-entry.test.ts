import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import {
  findCollaborationSpaceStoreEntry,
  listRedundantGroupMirrorKeys,
} from "./collaboration-space-session-entry.js";

function entry(sessionId: string, updatedAt = 1): SessionEntry {
  return { sessionId, updatedAt };
}

describe("findCollaborationSpaceStoreEntry", () => {
  it("returns only the canonical space row, never a bot or steward mirror", () => {
    const store = {
      "space:alpha": entry("alias"),
      "agent:main:space:alpha": entry("mirror"),
    };
    expect(findCollaborationSpaceStoreEntry(store, "space:alpha")?.sessionId).toBe("alias");
    expect(findCollaborationSpaceStoreEntry(store, "agent:main:space:alpha")?.sessionId).toBe(
      "mirror",
    );
  });

  it("does not promote a steward mirror when the space row has no sessionId", () => {
    const store: Record<string, SessionEntry> = {
      "space:alpha": { sessionId: "", updatedAt: 1 } as SessionEntry,
      "agent:bot-z:main:space:alpha": entry("late-bot", 99),
      "agent:main:space:alpha": entry("steward", 2),
    };
    expect(findCollaborationSpaceStoreEntry(store, "space:alpha")?.sessionId).toBe("");
  });

  it("does not fall back to newest mirror keys", () => {
    const store = {
      "space:alpha": { sessionId: "", updatedAt: 1 } as SessionEntry,
      "agent:bot-a:main:space:alpha": entry("bot-a", 10),
      "agent:main:wechat:space:alpha": entry("steward-channel", 8),
    };
    expect(findCollaborationSpaceStoreEntry(store, "space:alpha")?.sessionId).toBe("");
  });
});

describe("listRedundantGroupMirrorKeys", () => {
  it("lists every agent-scoped space mirror and keeps the canonical space key", () => {
    const store = {
      "space:alpha": entry("alias"),
      "agent:main:space:alpha": entry("mirror"),
      "agent:panda:main:space:alpha": entry("panda"),
      "agent:panda:main": entry("one-to-one"),
      "space:other": entry("other"),
    };
    expect(listRedundantGroupMirrorKeys(store, "alpha").toSorted()).toEqual([
      "agent:main:space:alpha",
      "agent:panda:main:space:alpha",
    ]);
  });
});
