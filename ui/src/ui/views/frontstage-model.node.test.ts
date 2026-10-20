import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionsListResult } from "../types.ts";

function sessions(rows: SessionsListResult["sessions"]): SessionsListResult {
  return {
    count: rows.length,
    sessions: rows,
    defaults: { model: null, contextTokens: null },
    path: "/tmp/sessions.json",
    ts: Date.now(),
  };
}

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

async function loadModel() {
  return import("../data/frontstage-session-cards.ts");
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", createStorageMock());
});

describe("deriveSessionCards", () => {
  it("keeps only the requested chat types", async () => {
    const { deriveSessionCards } = await loadModel();
    const result = deriveSessionCards(
      sessions([
        {
          key: "agent:main:telegram:direct:alice",
          kind: "direct",
          subject: "Alice",
          surface: "Telegram",
          updatedAt: 20,
        },
        {
          key: "agent:main:telegram:group:eng",
          kind: "group",
          subject: "Engineering",
          surface: "Telegram",
          updatedAt: 10,
        },
      ]),
      ["direct"],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("agent:main:telegram:direct:alice");
  });
});

describe("buildContactCards", () => {
  it("groups direct sessions for the same remote contact across personas", async () => {
    const { buildContactCards } = await loadModel();
    const result = buildContactCards(
      sessions([
        {
          key: "agent:main:telegram:direct:alice",
          kind: "direct",
          subject: "Alice",
          surface: "Telegram",
          updatedAt: 30,
        },
        {
          key: "agent:work:telegram:direct:alice",
          kind: "direct",
          displayName: "Alice Zhang",
          surface: "Telegram",
          updatedAt: 20,
        },
        {
          key: "agent:main:slack:direct:bob",
          kind: "direct",
          subject: "Bob",
          surface: "Slack",
          updatedAt: 10,
        },
      ]),
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "telegram:alice",
      title: "Alice",
      latestSessionKey: "agent:main:telegram:direct:alice",
      sessionCount: 2,
    });
    expect(result[0]?.personaIds.toSorted()).toEqual(["main", "work"]);
    expect(result[0]?.surfaces).toEqual(["Telegram"]);
  });

  it("falls back to subject and surface when the key is not canonical", async () => {
    const { buildContactCards } = await loadModel();
    const result = buildContactCards(
      sessions([
        {
          key: "custom-direct-1",
          kind: "direct",
          subject: "Charlie",
          surface: "Signal",
          updatedAt: 10,
        },
        {
          key: "custom-direct-2",
          kind: "direct",
          subject: "Charlie",
          surface: "Signal",
          updatedAt: 5,
        },
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "signal:charlie",
      title: "Charlie",
      sessionCount: 2,
    });
  });
});

describe("buildGroupCards", () => {
  it("groups multi-persona sessions for the same room", async () => {
    const { buildGroupCards } = await loadModel();
    const result = buildGroupCards(
      sessions([
        {
          key: "agent:main:telegram:group:eng-room",
          kind: "group",
          room: "Engineering",
          surface: "Telegram",
          updatedAt: 30,
        },
        {
          key: "agent:work:telegram:group:eng-room",
          kind: "group",
          room: "Engineering",
          surface: "Telegram",
          updatedAt: 20,
        },
        {
          key: "agent:main:discord:channel:announcements",
          kind: "unknown",
          space: "Announcements",
          surface: "Discord",
          updatedAt: 10,
        },
      ]),
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "telegram:group:eng-room",
      title: "Engineering",
      chatType: "group",
      latestSessionKey: "agent:main:telegram:group:eng-room",
      sessionCount: 2,
    });
    expect(result[0]?.personaIds.toSorted()).toEqual(["main", "work"]);
  });

  it("falls back to surface and room metadata for non-canonical keys", async () => {
    const { buildGroupCards } = await loadModel();
    const result = buildGroupCards(
      sessions([
        {
          key: "legacy-group-1",
          kind: "group",
          room: "Design Guild",
          surface: "Slack",
          updatedAt: 8,
        },
        {
          key: "legacy-group-2",
          kind: "group",
          room: "Design Guild",
          surface: "Slack",
          updatedAt: 6,
        },
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "slack:group:design guild",
      title: "Design Guild",
      sessionCount: 2,
    });
  });
});
