import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationTaskConfigStore } from "./config-store.js";
import { readEnablementStatusView, setShadowFlag, setTenantAllowlistEntry } from "./enablement.js";
import { ConversationTaskStoreError } from "./errors.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-enable-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function store(): ConversationTaskConfigStore {
  return new ConversationTaskConfigStore({ storeRoot: root, now: () => 1_000 });
}

describe("conversation-task enablement (Gate C tooling)", () => {
  it("status is fail-closed and never includes plaintext tenant ids", () => {
    const s = store();
    s.setTenantAllow({
      tenantId: "tenant-secret",
      enabled: true,
      actor: "ops",
      reason: "internal",
    });
    const view = readEnablementStatusView(s, {});
    expect(view.hmacKeyConfigured).toBe(false);
    expect(view.allowlist.enabledCount).toBe(1);
    expect(JSON.stringify(view)).not.toContain("tenant-secret");
    expect(view.flags.find((row) => row.flag === "activation")?.state).toBe("forbidden(off)");
    expect(view.flags.find((row) => row.flag === "detection")?.enabled).toBe(false);
    s.close();
  });

  it("allows 租户001 without leaking the plaintext tenant id", () => {
    const s = store();
    const applied = setTenantAllowlistEntry({
      store: s,
      tenantId: "租户001",
      enabled: true,
      actor: "local-test",
      reason: "operator requested tenant 001 shadow dry-run",
      confirm: true,
    });
    expect(applied.applied).toBe(true);
    expect(s.isTenantAllowed("租户001")).toBe(true);
    const view = readEnablementStatusView(s, {});
    const dumped = JSON.stringify(view);
    expect(dumped).not.toContain("租户001");
    expect(view.allowlist.enabledCount).toBe(1);
    expect(view.allowlist.entries[0]?.tenantKeyPrefix).toMatch(/^[0-9a-f]{12}$/i);
    s.close();
  });

  it("does not write without confirm", () => {
    const s = store();
    const preview = setTenantAllowlistEntry({
      store: s,
      tenantId: "t1",
      enabled: true,
      actor: "ops",
      reason: "canary",
    });
    expect(preview.applied).toBe(false);
    expect(s.isTenantAllowed("t1")).toBe(false);
    const applied = setTenantAllowlistEntry({
      store: s,
      tenantId: "t1",
      enabled: true,
      actor: "ops",
      reason: "canary",
      confirm: true,
    });
    expect(applied.applied).toBe(true);
    expect(s.isTenantAllowed("t1")).toBe(true);
    s.close();
  });

  it("rejects forbidden flags before touching the store", () => {
    const s = store();
    expect(() =>
      setShadowFlag({
        store: s,
        flag: "activation",
        enabled: true,
        actor: "ops",
        reason: "nope",
        confirm: true,
      }),
    ).toThrow(ConversationTaskStoreError);
    expect(s.isFlagEnabled("activation")).toBe(false);
    s.close();
  });

  it("rejects writes without actor or reason", () => {
    const s = store();
    expect(() =>
      setShadowFlag({
        store: s,
        flag: "detection",
        enabled: true,
        actor: " ",
        reason: "canary",
        confirm: true,
      }),
    ).toThrow(/actor_required/);
    expect(s.isFlagEnabled("detection")).toBe(false);
    s.close();
  });

  it("enables and disables detection with confirm", () => {
    const s = store();
    const enabled = setShadowFlag({
      store: s,
      flag: "detection",
      enabled: true,
      actor: "ops",
      reason: "canary",
      confirm: true,
    });
    expect(enabled).toMatchObject({ applied: true, flag: "detection", enabled: true });
    expect(s.isFlagEnabled("detection")).toBe(true);
    setShadowFlag({
      store: s,
      flag: "detection",
      enabled: false,
      actor: "ops",
      reason: "rollback",
      confirm: true,
    });
    expect(s.isFlagEnabled("detection")).toBe(false);
    s.close();
  });

  it("closed store status is fail-closed off/empty", () => {
    const s = store();
    s.close();
    const view = readEnablementStatusView(s, { OPENBOT_CT_SHADOW_HMAC_KEY: "set-but-unread" });
    expect(view.allowlist.enabledCount).toBe(0);
    expect(view.flags.every((row) => !row.enabled)).toBe(true);
    expect(view.hmacKeyConfigured).toBe(true);
    expect(JSON.stringify(view)).not.toContain("set-but-unread");
  });
});
