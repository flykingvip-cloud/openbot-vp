import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileKeyForTenant } from "./canonical.js";
import { ConversationTaskConfigStore, TenantAllowlistCache } from "./config-store.js";
import { ConversationTaskStoreError } from "./errors.js";
import { ConversationTaskFlagCache } from "./flag-cache.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-config-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function store(now: () => number = () => 1_000): ConversationTaskConfigStore {
  return new ConversationTaskConfigStore({ storeRoot: root, now });
}

describe("ConversationTaskConfigStore — tenant allowlist (AC5/C4)", () => {
  it("defaults to empty: unknown tenant is not allowed", () => {
    const s = store();
    expect(s.isTenantAllowed("tenant-a")).toBe(false);
    s.close();
  });

  it("enables a tenant, persists across reopen", () => {
    const s1 = store();
    const r = s1.setTenantAllow({
      tenantId: "tenant-a",
      enabled: true,
      actor: "ops-1",
      reason: "internal canary",
    });
    expect(r.ok).toBe(true);
    expect(s1.isTenantAllowed("tenant-a")).toBe(true);
    expect(s1.isTenantAllowed("tenant-b")).toBe(false);
    s1.close();

    const s2 = store(); // reopen same root
    expect(s2.isTenantAllowed("tenant-a")).toBe(true);
    s2.close();
  });

  it("stores no plaintext tenantId (keyed by fileKeyForTenant only)", () => {
    const s = store();
    s.setTenantAllow({ tenantId: "tenant-secret", enabled: true, actor: "ops", reason: "x" });
    const raw = fs.readFileSync(path.join(root, "config-store.db"));
    expect(raw.includes(Buffer.from("tenant-secret"))).toBe(false);
    // The key present is the SHA-256 file key, not the raw value.
    const key = fileKeyForTenant("tenant-secret");
    expect(s.isTenantAllowed("tenant-secret")).toBe(true);
    expect(key).not.toContain("tenant-secret");
    s.close();
  });

  it("versioned CAS: stale expectedVersion => state_changed_retry_required", () => {
    const s = store();
    const r1 = s.setTenantAllow({ tenantId: "t", enabled: true, actor: "ops", reason: "v1" });
    expect(r1).toEqual({ ok: true, stateVersion: 1 });
    const stale = s.setTenantAllow({
      tenantId: "t",
      enabled: false,
      actor: "ops",
      reason: "stale",
      expectedVersion: 0,
    });
    expect(stale).toEqual({ ok: false, reason: "state_changed_retry_required" });
    // still enabled (stale write rejected)
    expect(s.isTenantAllowed("t")).toBe(true);
    const ok = s.setTenantAllow({
      tenantId: "t",
      enabled: false,
      actor: "ops",
      reason: "ok",
      expectedVersion: 1,
    });
    expect(ok).toEqual({ ok: true, stateVersion: 2 });
    expect(s.isTenantAllowed("t")).toBe(false);
    s.close();
  });

  it("requires a trusted tenantId and actor to write", () => {
    const s = store();
    expect(() =>
      s.setTenantAllow({ tenantId: "", enabled: true, actor: "ops", reason: "x" }),
    ).toThrow(ConversationTaskStoreError);
    expect(() =>
      s.setTenantAllow({ tenantId: "t", enabled: true, actor: "", reason: "x" }),
    ).toThrow(/actor_required/);
    s.close();
  });

  it("read error fails closed (false)", () => {
    const s = store();
    s.setTenantAllow({ tenantId: "t", enabled: true, actor: "ops", reason: "x" });
    s.close(); // subsequent reads on a closed db throw => caught => false
    expect(s.isTenantAllowed("t")).toBe(false);
  });

  it("hasAnyEnabledTenant is false when empty or the last row is disabled", () => {
    const s = store();
    expect(s.hasAnyEnabledTenant()).toBe(false);
    s.setTenantAllow({ tenantId: "canary", enabled: true, actor: "ops", reason: "canary" });
    expect(s.hasAnyEnabledTenant()).toBe(true);
    s.setTenantAllow({ tenantId: "canary", enabled: false, actor: "ops", reason: "full-enable" });
    expect(s.hasAnyEnabledTenant()).toBe(false);
    expect(s.isTenantAllowed("canary")).toBe(false);
    s.close();
  });

  it("hasAnyEnabledTenant fails closed (true) after the store is closed", () => {
    const s = store();
    s.close();
    expect(s.hasAnyEnabledTenant()).toBe(true);
  });
});

describe("ConversationTaskConfigStore — flags + shadow-only guarantee (AC5/C3)", () => {
  it("defaults OFF; enables detection/qualification via CAS", () => {
    const s = store();
    expect(s.isFlagEnabled("detection")).toBe(false);
    expect(s.setFlag("detection", true, "ops", "canary")).toEqual({ ok: true, stateVersion: 1 });
    expect(s.isFlagEnabled("detection")).toBe(true);
    expect(s.isFlagEnabled("qualification")).toBe(false);
    s.close();
  });

  it("forbidden flags can never be enabled or read as on", () => {
    const s = store();
    for (const flag of ["activation", "projection", "authorization"] as const) {
      expect(() => s.setFlag(flag, true, "ops", "nope")).toThrow(/forbidden_flag/);
      expect(s.isFlagEnabled(flag)).toBe(false);
    }
    s.close();
  });

  it("readEnablementStatus hides tenant ids and marks forbidden flags", () => {
    const s = store();
    s.setFlag("detection", true, "ops", "canary");
    s.setTenantAllow({ tenantId: "tenant-secret", enabled: true, actor: "ops", reason: "x" });
    const status = s.readEnablementStatus();
    expect(status.flags.find((row) => row.flag === "detection")).toMatchObject({
      enabled: true,
      state: "on",
      actor: "ops",
    });
    expect(status.flags.find((row) => row.flag === "authorization")?.state).toBe("forbidden(off)");
    expect(status.allowlist.enabledCount).toBe(1);
    expect(JSON.stringify(status)).not.toContain("tenant-secret");
    s.close();
  });

  it("flagReader feeds ConversationTaskFlagCache (hot-read, fail-safe-off)", () => {
    let now = 0;
    const s = store(() => now);
    s.setFlag("detection", true, "ops", "canary");
    const cache = new ConversationTaskFlagCache({ reader: s.flagReader(), now: () => now });
    expect(cache.isEnabled("detection")).toBe(true);
    expect(cache.isEnabled("activation")).toBe(false); // forbidden stays off
    // turn off, invalidate, observe
    s.setFlag("detection", false, "ops", "rollback");
    cache.invalidate("detection");
    expect(cache.isEnabled("detection")).toBe(false);
    s.close();
  });
});

describe("TenantAllowlistCache — TTL + invalidate + fail-safe (AC5)", () => {
  it("caches within TTL, refreshes after, and invalidate() forces a re-read", () => {
    let now = 0;
    let live = false;
    const cache = new TenantAllowlistCache({ ttlMs: 3_000, reader: () => live, now: () => now });
    expect(cache.isAllowed("t")).toBe(false);
    live = true;
    expect(cache.isAllowed("t")).toBe(false); // cached OFF within TTL
    now = 3_001;
    expect(cache.isAllowed("t")).toBe(true); // TTL expired => re-read
    live = false;
    cache.invalidate("t");
    expect(cache.isAllowed("t")).toBe(false); // invalidate forces re-read
  });

  it("reader throw is fail-safe-off (false)", () => {
    const cache = new TenantAllowlistCache({
      reader: () => {
        throw new Error("config unavailable");
      },
    });
    expect(cache.isAllowed("t")).toBe(false);
  });

  it("clamps TTL to the 5s hard cap", () => {
    let now = 0;
    let live = true;
    const cache = new TenantAllowlistCache({ ttlMs: 60_000, reader: () => live, now: () => now });
    expect(cache.isAllowed("t")).toBe(true);
    live = false;
    now = 5_001; // beyond the 5s cap => must have expired
    expect(cache.isAllowed("t")).toBe(false);
  });
});
