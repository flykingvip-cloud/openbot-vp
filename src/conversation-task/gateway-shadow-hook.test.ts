import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationTaskConfigStore, TenantAllowlistCache } from "./config-store.js";
import { ConversationTaskFlagCache } from "./flag-cache.js";
import {
  initShadowHook,
  isShadowHookInitialized,
  observeInboundTurnShadow,
  resetShadowHookForTests,
  shutdownShadowHook,
  type GatewayShadowInput,
} from "./gateway-shadow-hook.js";
import type { TenantHmacKey } from "./shadow.js";

const KEY: TenantHmacKey = { keyId: "k1", secret: "secret-one", issuedAtMs: 0 };
const NOW = () => 1_000;

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-hook-"));
  resetShadowHookForTests();
});
afterEach(async () => {
  await shutdownShadowHook(500);
  resetShadowHookForTests();
  fs.rmSync(root, { recursive: true, force: true });
});

function init(opts: { detection?: boolean; allow?: string[] } = {}) {
  const store = new ConversationTaskConfigStore({ storeRoot: root, now: NOW });
  if (opts.detection ?? true) {
    store.setFlag("detection", true, "ops", "canary");
  }
  for (const t of opts.allow ?? ["t-int"]) {
    store.setTenantAllow({ tenantId: t, enabled: true, actor: "ops", reason: "internal" });
  }
  const flagCache = new ConversationTaskFlagCache({ reader: store.flagReader(), now: NOW });
  const allowCache = new TenantAllowlistCache({ reader: store.allowReader(), now: NOW });
  initShadowHook({
    isDetectionEnabled: () => flagCache.isEnabled("detection"),
    isTenantAllowed: (t) => allowCache.isAllowed(t),
    keyProvider: () => KEY,
    storeRoot: root,
    now: NOW,
  });
}

function input(over: Partial<GatewayShadowInput> = {}): GatewayShadowInput {
  return {
    tenantId: "t-int",
    requesterId: "user-1",
    conversationId: "conv-1",
    employeeScopeAllowed: true,
    messageId: "msg-1",
    text: "帮我把季度报告发给全部销售",
    ...over,
  };
}

describe("gateway-shadow-hook", () => {
  it("is a safe no-op when uninitialized", () => {
    expect(isShadowHookInitialized()).toBe(false);
    expect(observeInboundTurnShadow(input())).toBe("uninitialized");
  });

  it("observes an allow-listed, in-scope turn once initialized", () => {
    init();
    expect(isShadowHookInitialized()).toBe(true);
    expect(observeInboundTurnShadow(input())).toBe("observed");
  });

  it("skips an un-authenticated channel turn (no trusted tenant)", () => {
    init();
    expect(observeInboundTurnShadow(input({ tenantId: null }))).toBe("skipped_no_trusted_tenant");
  });

  it("skips a tenant that is not allow-listed", () => {
    init({ allow: [] });
    expect(observeInboundTurnShadow(input())).toBe("skipped_not_allowlisted");
  });

  it("is channel-agnostic: same normalized input shape from any surface", () => {
    init();
    // A telegram-like and a webchat-like turn produce the same boundary result.
    expect(observeInboundTurnShadow(input({ messageId: "tg-1" }))).toBe("observed");
    expect(observeInboundTurnShadow(input({ conversationId: "conv-2", messageId: "web-1" }))).toBe(
      "observed",
    );
  });

  it("initialize is idempotent (first call wins)", () => {
    init();
    init({ allow: ["other"] }); // ignored
    expect(observeInboundTurnShadow(input())).toBe("observed"); // still original config
  });
});
