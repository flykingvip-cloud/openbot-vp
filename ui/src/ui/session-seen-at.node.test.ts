import { describe, expect, it } from "vitest";
import {
  bumpSessionSeenAt,
  partitionSessionSeenKey,
  resolveSessionSeenAliasOptionsFromTrustedSession,
  resolveSessionSeenAtMs,
  resolveSessionSeenPartitionId,
  resolveSessionSeenSpaceMode,
  resolveTrustedSessionTenantIdForSeen,
  scrubSessionSeenAtForOwnSteward,
  sessionSeenAliasKeys,
} from "./session-seen-at.ts";

const U1 = "agent:main:employee:u1";
const U2 = "agent:main:employee:u2";
const SPACE = "space:shared-group";
const SPACE_MIRROR = "agent:main:space:shared-group";

describe("sessionSeenAliasKeys", () => {
  it("same-employee: main aliases expand only onto the trusted own steward", () => {
    const aliases = sessionSeenAliasKeys("agent:main:main", { ownStewardSessionKey: U1 });
    expect(aliases).toEqual(expect.arrayContaining(["agent:main:main", "main", "agent:main", U1]));
    expect(aliases).not.toEqual(expect.arrayContaining([U2]));
  });

  it("different employees do NOT share aliases via public main", () => {
    const u1Aliases = sessionSeenAliasKeys(U1);
    expect(u1Aliases).toEqual([U1]);
    expect(u1Aliases).not.toEqual(expect.arrayContaining(["main", "agent:main:main", U2]));

    const u1WithOwn = sessionSeenAliasKeys(U1, { ownStewardSessionKey: U1 });
    expect(u1WithOwn).toEqual(expect.arrayContaining([U1]));
    expect(u1WithOwn).not.toEqual(expect.arrayContaining(["main", "agent:main:main"]));

    const u2WithOwnU1 = sessionSeenAliasKeys(U2, { ownStewardSessionKey: U1 });
    expect(u2WithOwnU1).toEqual([U2]);
    expect(u2WithOwnU1).not.toEqual(expect.arrayContaining(["main", U1]));
  });

  it("links collaboration space mirrors to space:<id>", () => {
    const aliases = sessionSeenAliasKeys("agent:bot-2:main:space:grp-rd");
    expect(aliases).toEqual(
      expect.arrayContaining(["agent:bot-2:main:space:grp-rd", "space:grp-rd"]),
    );
  });

  it("with trusted own steward, space aliases are identity-partitioned (not bare space:)", () => {
    const aliases = sessionSeenAliasKeys(SPACE, { ownStewardSessionKey: U1 });
    const partition = resolveSessionSeenPartitionId({ ownStewardSessionKey: U1 });
    expect(partition).toBe("u:u1");
    expect(aliases).toEqual([partitionSessionSeenKey(partition!, SPACE)]);
    expect(aliases).not.toEqual(expect.arrayContaining([SPACE]));
  });

  it("managed + tenant: space aliases use tenant+user partition", () => {
    const opts = {
      ownStewardSessionKey: U1,
      tenantId: "tenant-a",
      spaceMode: "managed" as const,
    };
    expect(resolveSessionSeenPartitionId(opts)).toBe("t:tenant-a|u:u1");
    expect(sessionSeenAliasKeys(SPACE, opts)).toEqual([
      partitionSessionSeenKey("t:tenant-a|u:u1", SPACE),
    ]);
  });

  it("managed + identity not ready: no bare/user-only space aliases", () => {
    expect(
      sessionSeenAliasKeys(SPACE, {
        ownStewardSessionKey: U1,
        spaceMode: "managed",
      }),
    ).toEqual([]);
    expect(
      sessionSeenAliasKeys(SPACE, {
        spaceMode: "managed",
        tenantId: "tenant-a",
      }),
    ).toEqual([]);
    expect(sessionSeenAliasKeys(SPACE, { spaceMode: "managed" })).toEqual([]);
  });
});

describe("resolveSessionSeenAtMs / bumpSessionSeenAt", () => {
  it("same-employee mirror keys sync (refresh shape)", () => {
    const seenAt = 1_700_000_000_000;
    const map = bumpSessionSeenAt({}, "agent:main:main", seenAt, { ownStewardSessionKey: U1 });
    expect(resolveSessionSeenAtMs(map, U1, { ownStewardSessionKey: U1 })).toBe(seenAt);
    expect(resolveSessionSeenAtMs(map, "main", { ownStewardSessionKey: U1 })).toBe(seenAt);
  });

  it("different employees do NOT clear each other", () => {
    const seenAt = 1_700_000_000_000;
    const map = bumpSessionSeenAt({}, U1, seenAt, { ownStewardSessionKey: U1 });
    expect(resolveSessionSeenAtMs(map, U2, { ownStewardSessionKey: U2 })).toBe(0);
    expect(resolveSessionSeenAtMs(map, U2)).toBe(0);
    // Even leftover public main from u1 must not clear u2 when resolving the employee key.
    const withMain = bumpSessionSeenAt({}, "agent:main:main", seenAt, { ownStewardSessionKey: U1 });
    expect(resolveSessionSeenAtMs(withMain, U2, { ownStewardSessionKey: U2 })).toBe(0);
  });

  it("account switch does NOT inherit the previous user's seen cursor", () => {
    const seenAt = 1_700_000_000_050;
    // u1 marks steward read (writes main + u1).
    let map = bumpSessionSeenAt({}, "main", seenAt, { ownStewardSessionKey: U1 });
    expect(resolveSessionSeenAtMs(map, U1, { ownStewardSessionKey: U1 })).toBe(seenAt);

    // Switch to u2: employee-key resolve must stay unread.
    expect(resolveSessionSeenAtMs(map, U2, { ownStewardSessionKey: U2 })).toBe(0);

    // Scrub drops ambiguous shared main + foreign employee keys.
    map = scrubSessionSeenAtForOwnSteward(map, U2);
    expect(map[U1]).toBeUndefined();
    expect(map.main).toBeUndefined();
    expect(resolveSessionSeenAtMs(map, "main", { ownStewardSessionKey: U2 })).toBe(0);
    expect(resolveSessionSeenAtMs(map, U2, { ownStewardSessionKey: U2 })).toBe(0);
  });

  it("reads seen cursor written under space:<id> for mirror rows", () => {
    const seenAt = 1_700_000_000_100;
    const map = bumpSessionSeenAt({}, "space:grp-rd", seenAt);
    expect(resolveSessionSeenAtMs(map, "agent:main:space:grp-rd")).toBe(seenAt);
  });

  it("anti: same group, two users — must not inherit space seenAt after scrub", () => {
    const seenAt = 1_700_000_000_200;
    // u1 opens shared group and writes seenAt (partitioned under u1).
    let map = bumpSessionSeenAt({}, SPACE, seenAt, { ownStewardSessionKey: U1 });
    expect(resolveSessionSeenAtMs(map, SPACE, { ownStewardSessionKey: U1 })).toBe(seenAt);
    expect(resolveSessionSeenAtMs(map, SPACE_MIRROR, { ownStewardSessionKey: U1 })).toBe(seenAt);

    // u2 querying the same group mirror must not see u1's cursor even before scrub.
    expect(resolveSessionSeenAtMs(map, SPACE, { ownStewardSessionKey: U2 })).toBe(0);
    expect(resolveSessionSeenAtMs(map, SPACE_MIRROR, { ownStewardSessionKey: U2 })).toBe(0);

    // Existing scrub on identity switch must also drop any leftover unpartitioned
    // space keys from older builds + foreign partitions.
    const legacy = { ...map, [SPACE]: seenAt, [SPACE_MIRROR]: seenAt };
    map = scrubSessionSeenAtForOwnSteward(legacy, U2);
    expect(map[SPACE]).toBeUndefined();
    expect(map[SPACE_MIRROR]).toBeUndefined();
    for (const key of Object.keys(map)) {
      expect(key.startsWith("seen:u:u1:")).toBe(false);
      expect(key.includes("|u:u1:")).toBe(false);
    }
    expect(resolveSessionSeenAtMs(map, SPACE, { ownStewardSessionKey: U2 })).toBe(0);
    expect(resolveSessionSeenAtMs(map, SPACE_MIRROR, { ownStewardSessionKey: U2 })).toBe(0);
  });

  it("anti: different tenants sharing local groupId must not cross; return restores original", () => {
    const seenAt = 1_700_000_000_300;
    const tenantA = {
      ownStewardSessionKey: U1,
      tenantId: "tenant-a",
      spaceMode: "managed" as const,
    };
    const tenantB = {
      ownStewardSessionKey: U1,
      tenantId: "tenant-b",
      spaceMode: "managed" as const,
    };
    let map = bumpSessionSeenAt({}, SPACE, seenAt, tenantA);
    expect(resolveSessionSeenAtMs(map, SPACE, tenantA)).toBe(seenAt);
    expect(resolveSessionSeenAtMs(map, SPACE, tenantB)).toBe(0);
    expect(resolveSessionSeenAtMs(map, SPACE_MIRROR, tenantB)).toBe(0);

    // Scrub on tenant switch keeps same-owner other-tenant partitions so
    // returning to A is explicit — reads stay tenant-scoped (B still unread).
    map = scrubSessionSeenAtForOwnSteward(map, U1, {
      tenantId: "tenant-b",
      spaceMode: "managed",
    });
    expect(resolveSessionSeenAtMs(map, SPACE, tenantB)).toBe(0);
    expect(Object.keys(map).some((k) => k.includes("tenant-a"))).toBe(true);
    expect(resolveSessionSeenAtMs(map, SPACE, tenantA)).toBe(seenAt);
  });

  it("managed: bump/resolve no-op when tenant identity not ready", () => {
    const seenAt = 1_700_000_000_350;
    const incomplete = { ownStewardSessionKey: U1, spaceMode: "managed" as const };
    const map = bumpSessionSeenAt({}, SPACE, seenAt, incomplete);
    expect(map).toEqual({});
    expect(resolveSessionSeenAtMs({ [SPACE]: seenAt }, SPACE, incomplete)).toBe(0);
    expect(
      resolveSessionSeenAtMs(
        { [partitionSessionSeenKey("u:u1", SPACE)]: seenAt },
        SPACE,
        incomplete,
      ),
    ).toBe(0);
  });

  it("anti: after switch + refresh must not resurrect prior user's space cursor", () => {
    const seenAt = 1_700_000_000_400;
    // Prior user left both partitioned and legacy unpartitioned space cursors.
    let map = bumpSessionSeenAt({}, SPACE, seenAt, { ownStewardSessionKey: U1 });
    map = { ...map, [SPACE]: seenAt };

    // Switch identity (hello scrub) then simulate refresh by resolving from the
    // persisted scrubbed map only — prior space cursor must stay gone.
    map = scrubSessionSeenAtForOwnSteward(map, U2);
    expect(map[SPACE]).toBeUndefined();
    expect(resolveSessionSeenAtMs(map, SPACE, { ownStewardSessionKey: U2 })).toBe(0);
    expect(resolveSessionSeenAtMs(map, SPACE_MIRROR, { ownStewardSessionKey: U2 })).toBe(0);

    // A second scrub (refresh / re-hello) must not resurrect anything.
    map = scrubSessionSeenAtForOwnSteward(map, U2);
    expect(resolveSessionSeenAtMs(map, SPACE, { ownStewardSessionKey: U2 })).toBe(0);
  });

  it("managed scrub drops user-only partitions leftover from personal mode", () => {
    const seenAt = 1_700_000_000_450;
    const map = bumpSessionSeenAt({}, SPACE, seenAt, { ownStewardSessionKey: U1 });
    const scrubbed = scrubSessionSeenAtForOwnSteward(map, U1, {
      tenantId: "tenant-a",
      spaceMode: "managed",
    });
    expect(Object.keys(scrubbed).some((k) => k.startsWith("seen:u:u1:"))).toBe(false);
    expect(
      resolveSessionSeenAtMs(scrubbed, SPACE, {
        ownStewardSessionKey: U1,
        tenantId: "tenant-a",
        spaceMode: "managed",
      }),
    ).toBe(0);
  });
});

describe("resolveSessionSeenAliasOptionsFromTrustedSession", () => {
  it("resolves tenant once from platformAuth → trusted-proxy hello → bootstrap", () => {
    expect(
      resolveTrustedSessionTenantIdForSeen({
        platformAuthState: { enabled: true, session: { tenantId: "t-platform", user: "u1" } },
        hello: { auth: { provider: "trusted-proxy", user: "u1", tenantId: "t-hello" } },
        bootstrapAuthSession: { tenantId: "t-boot", user: "u1" },
      }),
    ).toBe("t-platform");
    expect(
      resolveTrustedSessionTenantIdForSeen({
        hello: { auth: { provider: "trusted-proxy", user: "u1", tenantId: "t-hello" } },
        bootstrapAuthSession: { tenantId: "t-boot", user: "u1" },
      }),
    ).toBe("t-hello");
    expect(
      resolveTrustedSessionTenantIdForSeen({
        bootstrapAuthSession: { tenantId: "t-boot", user: "u1" },
      }),
    ).toBe("t-boot");
  });

  it("managed mode from bootstrapDataSpace or platformAuth.enabled", () => {
    expect(resolveSessionSeenSpaceMode({ bootstrapDataSpace: { mode: "managed" } })).toBe(
      "managed",
    );
    expect(resolveSessionSeenSpaceMode({ bootstrapDataSpace: { mode: "local" } })).toBe("personal");
    expect(resolveSessionSeenSpaceMode({ platformAuthState: { enabled: true } })).toBe("managed");
    expect(resolveSessionSeenSpaceMode({})).toBe("personal");
  });

  it("production entrypoint threads tenantId + managed spaceMode", () => {
    const opts = resolveSessionSeenAliasOptionsFromTrustedSession({
      platformAuthState: { enabled: true, session: { tenantId: "tenant-a", user: "u1" } },
      bootstrapDataSpace: { mode: "managed" },
      ownStewardSessionKey: U1,
    });
    expect(opts).toEqual({
      ownStewardSessionKey: U1,
      tenantId: "tenant-a",
      spaceMode: "managed",
    });
    expect(resolveSessionSeenPartitionId(opts)).toBe("t:tenant-a|u:u1");
  });
});
