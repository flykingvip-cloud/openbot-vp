import { describe, expect, it } from "vitest";
import {
  buildContactCards,
  buildGroupCards,
  deriveSessionCards,
} from "../../../data/frontstage-session-cards.ts";
import type { SessionsListResult } from "../../../types.ts";
import { buildWorkbenchHomeModelFromState } from "./workbench-home-model.ts";

describe("employee sessions preservation (Phase 5.3)", () => {
  it("derives employee-facing chat cards from sessions.list without management actions", () => {
    const now = Date.now();
    const sessionsResult = {
      count: 3,
      sessions: [
        {
          key: "agent:main:telegram:direct:alice",
          kind: "direct",
          label: "Alice",
          subject: "Alice",
          surface: "telegram",
          updatedAt: now - 1_000,
          lastMessagePreview: "follow up",
        },
        {
          key: "agent:main:telegram:group:product-room",
          kind: "group",
          label: "Product Room",
          subject: "Product Room",
          surface: "telegram",
          room: "product-room",
          updatedAt: now - 2_000,
          lastMessagePreview: "standup",
        },
        {
          key: "main",
          kind: "global",
          label: "Main Assistant",
          subject: "Main Assistant",
          updatedAt: now - 3_000,
          lastMessagePreview: "main thread",
        },
      ],
    } as SessionsListResult;

    const directCards = deriveSessionCards(sessionsResult, ["direct"]);
    const contacts = buildContactCards(sessionsResult);
    const groups = buildGroupCards(sessionsResult);

    expect(directCards).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      title: "Alice",
      latestSessionKey: "agent:main:telegram:direct:alice",
    });
    expect(groups[0]).toMatchObject({
      latestSessionKey: "agent:main:telegram:group:product-room",
    });
    expect(groups[0]?.title).toBeTruthy();
  });

  it("keeps sessions.list consumption read-only in workbench home projections", () => {
    const now = Date.now();
    const model = buildWorkbenchHomeModelFromState({
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "user",
        agents: [
          { id: "main", name: "Main Assistant", identity: { emoji: "MA", name: "Main Assistant" } },
        ],
      } as never,
      sessionsResult: {
        count: 2,
        sessions: [
          {
            key: "agent:main:telegram:direct:alice",
            kind: "direct",
            label: "Alice",
            subject: "Alice",
            surface: "telegram",
            updatedAt: now - 1_000,
            lastMessagePreview: "latest thread",
          },
          {
            key: "agent:main:telegram:group:product-room",
            kind: "group",
            label: "Product Room",
            subject: "Product Room",
            surface: "telegram",
            room: "product-room",
            updatedAt: now - 2_000,
            lastMessagePreview: "room thread",
          },
        ],
      } as never,
      sessionSeenAt: {},
      activeSessionKey: "agent:main:telegram:direct:alice",
      teamObjects: {},
      teamOrder: [],
      channelsSnapshot: null,
      presenceEntries: [],
      connected: true,
      cronNext: null,
      lastError: null,
    });

    expect(model.recentSessions.map((entry) => entry.key)).toEqual([
      "agent:main:telegram:direct:alice",
      "agent:main:telegram:group:product-room",
    ]);
    expect(model.contactCards.map((entry) => entry.latestSessionKey)).toEqual([
      "agent:main:telegram:direct:alice",
    ]);
    expect(model.groupCards.map((entry) => entry.latestSessionKey)).toEqual([
      "agent:main:telegram:group:product-room",
    ]);
    expect(
      "onPatch" in (model.contactCards[0] as unknown as Record<string, unknown>) ||
        "onDelete" in (model.contactCards[0] as unknown as Record<string, unknown>),
    ).toBe(false);
  });
});
