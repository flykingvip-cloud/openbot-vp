import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationTaskConfigStore, TenantAllowlistCache } from "./config-store.js";
import { readEnablementStatusView, setShadowFlag, setTenantAllowlistEntry } from "./enablement.js";
import { ConversationTaskStoreError } from "./errors.js";
import { ConversationTaskFlagCache } from "./flag-cache.js";
import { createShadowRuntime, type ShadowMetricEvent } from "./shadow-observer.js";
import type { TenantHmacKey } from "./shadow.js";

const TENANT = "租户001";
const CONVERSATION = "conv-TENANT001";
const MESSAGE = "msg-TENANT001";
const TEXT = "每周监控竞品价格，异常时分析并通知我";
const KEY: TenantHmacKey = { keyId: "canary-k1", secret: "canary-secret-one", issuedAtMs: 0 };
const NOW = () => 1_000;

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-canary-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function walkFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

function assertShadowDiskHasNoTurnSecrets(dir: string): void {
  for (const file of walkFiles(dir)) {
    const bytes = fs.readFileSync(file);
    expect(path.basename(file)).not.toContain(TENANT);
    expect(bytes.includes(Buffer.from(CONVERSATION))).toBe(false);
    expect(bytes.includes(Buffer.from(MESSAGE))).toBe(false);
    expect(bytes.includes(Buffer.from(TEXT))).toBe(false);
    expect(bytes.includes(Buffer.from("fp_"))).toBe(false);
  }
}

function assertAllowlistStoreHasNoPlaintextTenant(dir: string): void {
  const configDb = path.join(dir, "config-store.db");
  expect(fs.existsSync(configDb)).toBe(true);
  expect(fs.readFileSync(configDb).includes(Buffer.from(TENANT))).toBe(false);
}

function enableCanary(store: ConversationTaskConfigStore): void {
  setTenantAllowlistEntry({
    store,
    tenantId: TENANT,
    enabled: true,
    actor: "local-test",
    reason: "operator requested tenant 001 shadow canary",
    confirm: true,
  });
  setShadowFlag({
    store,
    flag: "detection",
    enabled: true,
    actor: "local-test",
    reason: "tenant 001 shadow canary",
    confirm: true,
  });
  setShadowFlag({
    store,
    flag: "qualification",
    enabled: true,
    actor: "local-test",
    reason: "tenant 001 shadow canary",
    confirm: true,
  });
}

describe("Gate C local canary for 租户001", () => {
  it("enablement APIs allow the tenant without leaking plaintext or opening activation", () => {
    const store = new ConversationTaskConfigStore({ storeRoot: root, now: NOW });
    enableCanary(store);
    expect(store.isTenantAllowed(TENANT)).toBe(true);
    expect(store.isFlagEnabled("activation")).toBe(false);
    expect(() =>
      setShadowFlag({
        store,
        flag: "activation",
        enabled: true,
        actor: "local-test",
        reason: "must stay forbidden",
        confirm: true,
      }),
    ).toThrow(ConversationTaskStoreError);
    const view = readEnablementStatusView(store, {});
    const dumped = JSON.stringify(view);
    expect(dumped).not.toContain(TENANT);
    expect(view.flags.find((row) => row.flag === "activation")?.state).toBe("forbidden(off)");
    expect(view.hmacKeyConfigured).toBe(false);
    store.close();
    assertAllowlistStoreHasNoPlaintextTenant(root);
  });

  it("missing HMAC still observes then fail-closes the write with no plaintext on disk", async () => {
    const store = new ConversationTaskConfigStore({ storeRoot: root, now: NOW });
    enableCanary(store);
    const flagCache = new ConversationTaskFlagCache({ reader: store.flagReader(), now: NOW });
    const allowCache = new TenantAllowlistCache({ reader: store.allowReader(), now: NOW });
    const metrics: ShadowMetricEvent[] = [];
    const rt = createShadowRuntime({
      isDetectionEnabled: () => flagCache.isEnabled("detection"),
      isTenantAllowed: (tenantId) => allowCache.isAllowed(tenantId),
      keyProvider: () => {
        throw new Error("hmac_key_missing");
      },
      storeRoot: root,
      now: NOW,
      onMetric: (event) => metrics.push(event),
    });
    expect(
      rt.observer.observe(
        {
          tenantId: TENANT,
          requesterId: "user-1",
          conversationId: CONVERSATION,
          authorizedConversationIds: new Set([CONVERSATION]),
          employeeScopeAllowed: true,
        },
        { messageId: MESSAGE, text: TEXT },
      ),
    ).toBe("observed");
    await rt.runner.shutdown(2_000);
    expect(
      metrics.some(
        (row) =>
          row.type === "write_error" || (row.type === "runner" && row.event.type === "failure"),
      ),
    ).toBe(true);
    expect(rt.registry.book(TENANT).size()).toBe(0);
    await rt.shutdown();
    assertAllowlistStoreHasNoPlaintextTenant(root);
    assertShadowDiskHasNoTurnSecrets(root);
    store.close();
  });

  it("in-memory HMAC writes one shadow row without plaintext tenant, conversation, or text", async () => {
    const store = new ConversationTaskConfigStore({ storeRoot: root, now: NOW });
    enableCanary(store);
    const flagCache = new ConversationTaskFlagCache({ reader: store.flagReader(), now: NOW });
    const allowCache = new TenantAllowlistCache({ reader: store.allowReader(), now: NOW });
    const rt = createShadowRuntime({
      isDetectionEnabled: () => flagCache.isEnabled("detection"),
      isTenantAllowed: (tenantId) => allowCache.isAllowed(tenantId),
      keyProvider: () => KEY,
      storeRoot: root,
      now: NOW,
    });
    expect(
      rt.observer.observe(
        {
          tenantId: TENANT,
          requesterId: "user-1",
          conversationId: CONVERSATION,
          authorizedConversationIds: new Set([CONVERSATION]),
          employeeScopeAllowed: true,
        },
        { messageId: MESSAGE, text: TEXT },
      ),
    ).toBe("observed");
    await rt.runner.shutdown(2_000);
    expect(rt.registry.book(TENANT).size()).toBe(1);
    await rt.shutdown();
    assertAllowlistStoreHasNoPlaintextTenant(root);
    assertShadowDiskHasNoTurnSecrets(root);
    expect(store.isFlagEnabled("activation")).toBe(false);
    store.close();
  });
});
