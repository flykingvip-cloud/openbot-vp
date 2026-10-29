import { describe, expect, it } from "vitest";
import {
  bumpSessionSeenAt,
  resolveSessionSeenAtMs,
  scrubSessionSeenAtForOwnSteward,
  sessionSeenAliasKeys,
} from "./session-seen-at.ts";

const U1 = "agent:main:employee:u1";
const U2 = "agent:main:employee:u2";

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
});
