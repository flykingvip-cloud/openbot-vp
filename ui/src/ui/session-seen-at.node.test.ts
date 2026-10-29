import { describe, expect, it } from "vitest";
import {
  bumpSessionSeenAt,
  resolveSessionSeenAtMs,
  sessionSeenAliasKeys,
} from "./session-seen-at.ts";

describe("sessionSeenAliasKeys", () => {
  it("links steward aliases used by Gateway employee isolation", () => {
    const aliases = sessionSeenAliasKeys("agent:main:employee:u1");
    expect(aliases).toEqual(
      expect.arrayContaining(["agent:main:employee:u1", "main", "agent:main", "agent:main:main"]),
    );
  });

  it("links collaboration space mirrors to space:<id>", () => {
    const aliases = sessionSeenAliasKeys("agent:bot-2:main:space:grp-rd");
    expect(aliases).toEqual(
      expect.arrayContaining(["agent:bot-2:main:space:grp-rd", "space:grp-rd"]),
    );
  });
});

describe("resolveSessionSeenAtMs / bumpSessionSeenAt", () => {
  it("reads seen cursor written under a steward alias", () => {
    const seenAt = 1_700_000_000_000;
    const map = bumpSessionSeenAt({}, "agent:main:main", seenAt);
    expect(resolveSessionSeenAtMs(map, "agent:main:employee:u1")).toBe(seenAt);
    expect(resolveSessionSeenAtMs(map, "main")).toBe(seenAt);
  });

  it("reads seen cursor written under space:<id> for mirror rows", () => {
    const seenAt = 1_700_000_000_100;
    const map = bumpSessionSeenAt({}, "space:grp-rd", seenAt);
    expect(resolveSessionSeenAtMs(map, "agent:main:space:grp-rd")).toBe(seenAt);
  });
});
