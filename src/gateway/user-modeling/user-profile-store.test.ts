import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { detectUserPreferenceDirectives } from "./derive.js";
import { DEFAULT_USER_PROFILE } from "./types.js";
import { hashUserKey, resolveUserModelingKey } from "./user-key.js";
import {
  applyUserInteractionSignals,
  assessAndMarkUserProfileEffect,
  readUserProfile,
  resetUserProfile,
  resolveUserProfileInstructions,
  writeUserProfile,
} from "./user-profile-store.js";

const cfg = {} as OpenBotConfig;
const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function testKey(suffix: string) {
  const dir = path.join(os.tmpdir(), `user-modeling-${suffix}-${Date.now()}`);
  tmpDirs.push(dir);
  const key = resolveUserModelingKey({
    channel: "webchat",
    peerId: `user-${suffix}@example.com`,
    tenantId: null,
  })!;
  return { key, opts: { userModelingDir: dir } };
}

describe("user-profile-store", () => {
  it("round-trips profile write/read", async () => {
    const { key, opts } = testKey("rw");
    await writeUserProfile(
      cfg,
      key,
      { ...DEFAULT_USER_PROFILE, preferredOutputFormat: "concise", verbosity: "terse" },
      opts,
    );
    const stored = await readUserProfile(cfg, key, opts);
    expect(stored?.preferredOutputFormat).toBe("concise");
  });

  it("skips write when delta is empty", async () => {
    const { key, opts } = testKey("empty");
    const result = await applyUserInteractionSignals(cfg, key, { directives: [] }, 0, opts);
    expect(result).toBeNull();
    expect(await readUserProfile(cfg, key, opts)).toBeNull();
  });

  it("applies explicit directive and renders instructions", async () => {
    const { key, opts } = testKey("apply");
    await applyUserInteractionSignals(
      cfg,
      key,
      { directives: detectUserPreferenceDirectives("简洁点") },
      0,
      opts,
    );
    const instructions = await resolveUserProfileInstructions(cfg, key, opts);
    expect(instructions).toContain("concise");
  });

  it("reset removes persisted profile", async () => {
    const { key, opts } = testKey("reset");
    await writeUserProfile(cfg, key, { ...DEFAULT_USER_PROFILE, verbosity: "terse" }, opts);
    await resetUserProfile(cfg, key, opts);
    expect(await readUserProfile(cfg, key, opts)).toBeNull();
  });

  it("rolls back regressed changes and suppresses repeat delta", async () => {
    const { key, opts } = testKey("rollback");
    await applyUserInteractionSignals(
      cfg,
      key,
      { directives: detectUserPreferenceDirectives("简洁点") },
      0,
      opts,
    );
    const assessed = await assessAndMarkUserProfileEffect(cfg, key, 3, opts);
    expect(assessed?.status).toBe("regressed");
    expect(assessed?.rolledBack).toBe(true);
    const repeat = await applyUserInteractionSignals(
      cfg,
      key,
      { directives: detectUserPreferenceDirectives("简洁点") },
      0,
      opts,
    );
    expect(repeat).toBeNull();
  });

  it("hashes user keys without embedding raw email in path", () => {
    const key = resolveUserModelingKey({
      channel: "telegram",
      peerId: "12345",
      tenantId: "acme",
    })!;
    const hash = hashUserKey(key);
    expect(hash).not.toContain("12345");
    expect(hash.length).toBe(32);
  });

  it("isolates profiles per tenant for the same canonical user", async () => {
    const dirT1 = path.join(os.tmpdir(), `um-tenant-t1-${Date.now()}`);
    const dirT2 = path.join(os.tmpdir(), `um-tenant-t2-${Date.now()}`);
    tmpDirs.push(dirT1, dirT2);
    const keyT1 = resolveUserModelingKey({
      channel: "webchat",
      peerId: "same@example.com",
      tenantId: "tenant-a",
    })!;
    const keyT2 = { ...keyT1, tenantId: "tenant-b" };
    expect(hashUserKey(keyT1)).not.toBe(hashUserKey(keyT2));
    await applyUserInteractionSignals(
      cfg,
      keyT1,
      { directives: detectUserPreferenceDirectives("简洁点") },
      0,
      { userModelingDir: dirT1 },
    );
    const t1Instructions = await resolveUserProfileInstructions(cfg, keyT1, {
      userModelingDir: dirT1,
    });
    const t2Instructions = await resolveUserProfileInstructions(cfg, keyT2, {
      userModelingDir: dirT2,
    });
    expect(t1Instructions).toContain("concise");
    expect(t2Instructions).toBeUndefined();
  });
});
