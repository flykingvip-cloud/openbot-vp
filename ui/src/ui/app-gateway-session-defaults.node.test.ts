/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { applySessionDefaults } from "./app-gateway-session-defaults.ts";
import type { GatewayHost } from "./gateway-host.ts";

vi.mock("./app-settings.ts", () => ({
  applySettings: (host: { settings: unknown }, next: unknown) => {
    (host as { settings: unknown }).settings = next;
  },
}));

function createHost(
  overrides: Partial<{
    sessionKey: string;
    workbenchTeamSelectedKey: string;
    settingsSessionKey: string;
    lastActiveSessionKey: string;
  }> = {},
): GatewayHost {
  const sessionKey = overrides.sessionKey ?? "main";
  const settingsSessionKey = overrides.settingsSessionKey ?? sessionKey;
  const lastActiveSessionKey = overrides.lastActiveSessionKey ?? settingsSessionKey;
  return {
    sessionKey,
    workbenchTeamSelectedKey: overrides.workbenchTeamSelectedKey ?? "",
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: settingsSessionKey,
      lastActiveSessionKey,
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
      sessionSeenAt: {},
    },
  } as unknown as GatewayHost;
}

describe("applySessionDefaults foreign sticky steward reset", () => {
  const elle = "agent:main:employee:475156c1-03e7-44ad-9fb2-fcc880374b82";
  const daniel = "agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa";
  const defaults = {
    mainSessionKey: elle,
    mainKey: "main",
    defaultAgentId: "main",
  };

  it("resets sticky foreign employee steward sessionKey and workbench selection to own mainSessionKey", () => {
    const host = createHost({
      sessionKey: daniel,
      settingsSessionKey: daniel,
      lastActiveSessionKey: daniel,
      workbenchTeamSelectedKey: daniel,
    });

    applySessionDefaults(host, defaults);

    expect(host.sessionKey).toBe(elle);
    expect(host.workbenchTeamSelectedKey).toBe(elle);
    expect(host.settings.sessionKey).toBe(elle);
    expect(host.settings.lastActiveSessionKey).toBe(elle);
  });

  it("preserves the caller's own employee steward key", () => {
    const host = createHost({
      sessionKey: elle,
      settingsSessionKey: elle,
      lastActiveSessionKey: elle,
      workbenchTeamSelectedKey: elle,
    });

    applySessionDefaults(host, defaults);

    expect(host.sessionKey).toBe(elle);
    expect(host.workbenchTeamSelectedKey).toBe(elle);
    expect(host.settings.sessionKey).toBe(elle);
  });

  it("does not rewrite collaboration space keys to steward", () => {
    const space = "space:grp-daniel-hhd-gmail-com-upbeyond";
    const host = createHost({
      sessionKey: space,
      settingsSessionKey: space,
      lastActiveSessionKey: space,
      workbenchTeamSelectedKey: space,
    });

    applySessionDefaults(host, defaults);

    expect(host.sessionKey).toBe(space);
    expect(host.workbenchTeamSelectedKey).toBe(space);
    expect(host.settings.sessionKey).toBe(space);
  });

  it("still rewrites bare main aliases to own mainSessionKey", () => {
    const host = createHost({
      sessionKey: "main",
      settingsSessionKey: "agent:main",
      lastActiveSessionKey: "main",
      workbenchTeamSelectedKey: "agent:main",
    });

    applySessionDefaults(host, defaults);

    expect(host.sessionKey).toBe(elle);
    expect(host.workbenchTeamSelectedKey).toBe(elle);
    expect(host.settings.sessionKey).toBe(elle);
    expect(host.settings.lastActiveSessionKey).toBe(elle);
  });

  it("resets foreign workbench selection even when sessionKey was already own", () => {
    const host = createHost({
      sessionKey: elle,
      settingsSessionKey: elle,
      lastActiveSessionKey: elle,
      workbenchTeamSelectedKey: daniel,
    });

    applySessionDefaults(host, defaults);

    expect(host.sessionKey).toBe(elle);
    expect(host.workbenchTeamSelectedKey).toBe(elle);
  });

  it("scrubs sticky workbenchProfileName when it equals 大白管家", () => {
    const host = createHost({
      sessionKey: elle,
      settingsSessionKey: elle,
      lastActiveSessionKey: elle,
      workbenchTeamSelectedKey: elle,
    });
    (host.settings as { workbenchProfileName?: string }).workbenchProfileName = "大白管家";

    applySessionDefaults(host, defaults);

    expect(host.settings.workbenchProfileName).toBeUndefined();
    expect(host.sessionKey).toBe(elle);
  });

  it("scrubs sticky workbenchProfileName when it equals openbot", () => {
    const host = createHost({
      sessionKey: elle,
      settingsSessionKey: elle,
      lastActiveSessionKey: elle,
      workbenchTeamSelectedKey: elle,
    });
    (host.settings as { workbenchProfileName?: string }).workbenchProfileName = "openbot";

    applySessionDefaults(host, defaults);

    expect(host.settings.workbenchProfileName).toBeUndefined();
  });
});

describe("R3 production: applySessionDefaults threads trusted tenantId", () => {
  const U1 = "agent:main:employee:u1";
  const SPACE = "space:shared-group";
  const seenAt = 1_700_000_000_500;
  const defaults = {
    mainSessionKey: U1,
    mainKey: "main",
    defaultAgentId: "main",
  };

  function createManagedHost(tenantId: string, sessionSeenAt: Record<string, number>) {
    const host = createHost({ sessionKey: U1, settingsSessionKey: U1, lastActiveSessionKey: U1 });
    (host as { hello: unknown }).hello = {
      auth: { provider: "trusted-proxy", user: "u1", tenantId },
      snapshot: { sessionDefaults: defaults },
    };
    (host as { platformAuthState: unknown }).platformAuthState = {
      enabled: true,
      session: { tenantId, user: "u1" },
    };
    (host as unknown as { bootstrapDataSpace: unknown }).bootstrapDataSpace = { mode: "managed" };
    host.settings.sessionSeenAt = sessionSeenAt;
    return host;
  }

  it("same user switch tenant + same groupId: scrub keeps A, B does not inherit", async () => {
    const {
      bumpSessionSeenAt,
      resolveSessionSeenAtMs,
      resolveSessionSeenAliasOptionsFromTrustedSession,
    } = await import("./session-seen-at.ts");

    const optsA = resolveSessionSeenAliasOptionsFromTrustedSession({
      platformAuthState: { enabled: true, session: { tenantId: "tenant-a", user: "u1" } },
      bootstrapDataSpace: { mode: "managed" },
      ownStewardSessionKey: U1,
    });
    const map = bumpSessionSeenAt({}, SPACE, seenAt, optsA);
    expect(optsA.tenantId).toBe("tenant-a");
    expect(optsA.spaceMode).toBe("managed");

    const host = createManagedHost("tenant-b", map);
    applySessionDefaults(host, defaults);

    const optsB = resolveSessionSeenAliasOptionsFromTrustedSession({
      hello: host.hello,
      platformAuthState: (host as { platformAuthState?: unknown }).platformAuthState as never,
      bootstrapDataSpace: { mode: "managed" },
      ownStewardSessionKey: U1,
    });
    expect(optsB.tenantId).toBe("tenant-b");
    // Refresh shape on tenant B: same groupId must not inherit A's cursor.
    expect(resolveSessionSeenAtMs(host.settings.sessionSeenAt, SPACE, optsB)).toBe(0);
    expect(
      resolveSessionSeenAtMs(host.settings.sessionSeenAt, "agent:main:space:shared-group", optsB),
    ).toBe(0);
    // Returning to A remains explicit — partition kept.
    expect(
      resolveSessionSeenAtMs(host.settings.sessionSeenAt, SPACE, {
        ...optsA,
      }),
    ).toBe(seenAt);
  });
});
