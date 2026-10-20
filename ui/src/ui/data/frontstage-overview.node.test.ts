import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsListResult, ChannelsStatusSnapshot, SessionsListResult } from "../types.ts";

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

describe("frontstage overview helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds persona cards with session and relationship counts", async () => {
    const { buildFrontstagePersonaCards } = await import("./frontstage-overview.ts");
    const agentsList = {
      defaultId: "main",
      agents: [
        { id: "main", name: "Main", identity: { emoji: "MA", name: "Main" } },
        { id: "work", name: "Work", identity: { emoji: "WK", name: "Work" } },
      ],
    } as AgentsListResult;
    const sessionsResult = {
      sessions: [
        { key: "main", kind: "global", updatedAt: 30 },
        {
          key: "agent:main:telegram:direct:alice",
          kind: "direct",
          updatedAt: 20,
        },
        {
          key: "agent:work:telegram:group:eng",
          kind: "group",
          updatedAt: 10,
        },
      ],
    } as SessionsListResult;

    const cards = buildFrontstagePersonaCards({ agentsList, sessionsResult });

    expect(cards).toMatchObject([
      { id: "main", sessionsCount: 2, relationshipCount: 1 },
      { id: "work", sessionsCount: 1, relationshipCount: 1 },
    ]);
  });

  it("flattens channel accounts with labels", async () => {
    const { flattenChannelAccounts } = await import("./frontstage-overview.ts");
    const snapshot = {
      channelOrder: ["telegram"],
      channelLabels: { telegram: "Telegram" },
      channelAccounts: {
        telegram: [{ accountId: "acct-1", connected: true }],
      },
    } as unknown as ChannelsStatusSnapshot;

    expect(flattenChannelAccounts(snapshot)).toMatchObject([
      {
        channelId: "telegram",
        channelLabel: "Telegram",
        account: { accountId: "acct-1", connected: true },
      },
    ]);
  });
});
