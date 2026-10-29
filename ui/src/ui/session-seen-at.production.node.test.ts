/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { markSessionSeen } from "./app-settings.ts";
import {
  partitionSessionSeenKey,
  resolveSessionSeenAliasOptionsFromTrustedSession,
  resolveSessionSeenAtMs,
} from "./session-seen-at.ts";
import type { UiSettings } from "./storage.ts";

vi.mock("./storage.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage.ts")>();
  return {
    ...actual,
    saveSettings: vi.fn(),
  };
});

const U1 = "agent:main:employee:u1";
const SPACE = "space:shared-group";

function createSeenHost(tenantId: string, sessionSeenAt: Record<string, number> = {}) {
  const settings: UiSettings = {
    gatewayUrl: "",
    token: "",
    sessionKey: U1,
    lastActiveSessionKey: U1,
    sessionSeenAt,
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
  };
  const host = {
    settings,
    hello: {
      auth: { provider: "trusted-proxy" as const, user: "u1", tenantId },
      snapshot: {
        sessionDefaults: {
          mainSessionKey: U1,
          mainKey: "main",
          defaultAgentId: "main",
        },
      },
    },
    platformAuthState: {
      enabled: true,
      session: { tenantId, user: "u1" },
    },
    bootstrapAuthSession: null,
    bootstrapDataSpace: { mode: "managed" as const },
    applySettings: vi.fn((next: UiSettings) => {
      host.settings = next;
    }),
  };
  return host;
}

describe("R3 production callers: markSessionSeen + trusted tenant", () => {
  it("writes tenant-partitioned space cursor (not u: only)", () => {
    const seenAt = 1_700_000_000_600;
    const host = createSeenHost("tenant-a");
    markSessionSeen(host, SPACE, seenAt);

    const optsA = resolveSessionSeenAliasOptionsFromTrustedSession({
      hello: host.hello,
      platformAuthState: host.platformAuthState,
      bootstrapDataSpace: host.bootstrapDataSpace,
      ownStewardSessionKey: U1,
    });
    expect(optsA.tenantId).toBe("tenant-a");
    expect(optsA.spaceMode).toBe("managed");
    expect(host.settings.sessionSeenAt[SPACE]).toBeUndefined();
    expect(host.settings.sessionSeenAt[partitionSessionSeenKey("u:u1", SPACE)]).toBeUndefined();
    expect(host.settings.sessionSeenAt[partitionSessionSeenKey("t:tenant-a|u:u1", SPACE)]).toBe(
      seenAt,
    );
    expect(resolveSessionSeenAtMs(host.settings.sessionSeenAt, SPACE, optsA)).toBe(seenAt);
  });

  it("paired: same user switch tenant + same groupId refresh does not inherit; return restores A", () => {
    const seenAt = 1_700_000_000_700;
    const hostA = createSeenHost("tenant-a");
    markSessionSeen(hostA, SPACE, seenAt);
    const map = { ...hostA.settings.sessionSeenAt };

    // Switch tenant (production read under B with same shared map).
    const hostB = createSeenHost("tenant-b", map);
    const optsB = resolveSessionSeenAliasOptionsFromTrustedSession({
      hello: hostB.hello,
      platformAuthState: hostB.platformAuthState,
      bootstrapDataSpace: hostB.bootstrapDataSpace,
      ownStewardSessionKey: U1,
    });
    expect(optsB.tenantId).toBe("tenant-b");
    expect(resolveSessionSeenAtMs(map, SPACE, optsB)).toBe(0);
    expect(resolveSessionSeenAtMs(map, "agent:main:space:shared-group", optsB)).toBe(0);

    // Return to original tenant — cursor still present and resolves.
    const optsA = resolveSessionSeenAliasOptionsFromTrustedSession({
      hello: hostA.hello,
      platformAuthState: hostA.platformAuthState,
      bootstrapDataSpace: hostA.bootstrapDataSpace,
      ownStewardSessionKey: U1,
    });
    expect(resolveSessionSeenAtMs(map, SPACE, optsA)).toBe(seenAt);
  });

  it("managed identity not ready: markSessionSeen does not write bare/u-only space cursor", () => {
    const seenAt = 1_700_000_000_800;
    const host = createSeenHost("tenant-a");
    // Tenant missing on trusted session surfaces.
    host.hello.auth.tenantId = "";
    host.platformAuthState.session.tenantId = "";
    markSessionSeen(host, SPACE, seenAt);
    expect(host.settings.sessionSeenAt).toEqual({});
    expect(host.applySettings).not.toHaveBeenCalled();
  });
});
