import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationTaskConfigStore } from "./config-store.js";
import { CONVERSATION_TASK_ENV } from "./feature.js";
import {
  isActivationHookInitialized,
  observeInboundTurnActivation,
  resetActivationHookForTests,
} from "./gateway-activation-hook.js";
import {
  isShadowHookInitialized,
  resetShadowHookForTests,
  shutdownShadowHook,
} from "./gateway-shadow-hook.js";
import {
  envTenantHmacKeyProvider,
  initActivationHookFromServerConfig,
  initShadowHookFromServerConfig,
  SHADOW_HMAC_KEY_ENV,
  SHADOW_HMAC_KEY_ID_ENV,
} from "./runtime-bootstrap.js";
import type { TenantHmacKey } from "./shadow.js";

const NOW = () => 1_000;
const ENV_KEYS = [
  SHADOW_HMAC_KEY_ENV,
  SHADOW_HMAC_KEY_ID_ENV,
  "OPENCLAW_CT_SHADOW_HMAC_KEY",
  CONVERSATION_TASK_ENV.activation,
];
const savedEnv: Record<string, string | undefined> = {};

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-boot-"));
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  resetShadowHookForTests();
  resetActivationHookForTests();
});
afterEach(async () => {
  await shutdownShadowHook(500);
  resetShadowHookForTests();
  resetActivationHookForTests();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe("envTenantHmacKeyProvider (C5 fail-closed)", () => {
  it("throws hmac_key_missing when the root secret env is unset", () => {
    const provider = envTenantHmacKeyProvider(NOW);
    let code: string | undefined;
    try {
      provider("tenant-x");
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe("hmac_key_missing");
  });

  it("throws when the root secret is only whitespace (no empty-secret degrade)", () => {
    process.env[SHADOW_HMAC_KEY_ENV] = "   ";
    expect(() => envTenantHmacKeyProvider(NOW)("tenant-x")).toThrowError();
  });

  it("derives a distinct, deterministic per-tenant key when configured", () => {
    process.env[SHADOW_HMAC_KEY_ENV] = "root-secret";
    const provider = envTenantHmacKeyProvider(NOW);
    const a1 = provider("tenant-a");
    const a2 = provider("tenant-a");
    const b = provider("tenant-b");
    expect(a1.secret).toBeTruthy();
    expect(a1.keyId).toBe("env");
    expect(a1.issuedAtMs).toBe(1_000);
    expect(a2.secret).toBe(a1.secret); // deterministic per tenant
    expect(b.secret).not.toBe(a1.secret); // distinct across tenants
  });

  it("honors a custom key id env", () => {
    process.env[SHADOW_HMAC_KEY_ENV] = "root-secret";
    process.env[SHADOW_HMAC_KEY_ID_ENV] = "epoch-2";
    expect(envTenantHmacKeyProvider(NOW)("tenant-a").keyId).toBe("epoch-2");
  });
});

describe("initShadowHookFromServerConfig", () => {
  const key: TenantHmacKey = { keyId: "k1", secret: "s", issuedAtMs: 0 };

  it("initializes the module singleton and is idempotent", () => {
    expect(isShadowHookInitialized()).toBe(false);
    expect(isActivationHookInitialized()).toBe(false);
    expect(
      initShadowHookFromServerConfig({ storeRoot: root, keyProvider: () => key, now: NOW }),
    ).toBe(true);
    expect(isShadowHookInitialized()).toBe(true);
    expect(isActivationHookInitialized()).toBe(true);
    // second call is a no-op that still reports initialized (first call wins)
    expect(
      initShadowHookFromServerConfig({ storeRoot: root, keyProvider: () => key, now: NOW }),
    ).toBe(true);
  });

  it("is fail-safe: reports via onError and stays uninitialized when store init fails", () => {
    // A storeRoot under a regular file makes the store's mkdir/open fail (ENOTDIR).
    const filePath = path.join(root, "not-a-dir");
    fs.writeFileSync(filePath, "x");
    const errors: unknown[] = [];
    const ok = initShadowHookFromServerConfig({
      storeRoot: path.join(filePath, "sub"),
      keyProvider: () => key,
      now: NOW,
      onError: (e) => errors.push(e),
    });
    expect(ok).toBe(false);
    expect(isShadowHookInitialized()).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe("initActivationHookFromServerConfig", () => {
  it("initializes the activation singleton and is idempotent", () => {
    expect(isActivationHookInitialized()).toBe(false);
    expect(initActivationHookFromServerConfig({ storeRoot: root, now: NOW })).toBe(true);
    expect(isActivationHookInitialized()).toBe(true);
    expect(initActivationHookFromServerConfig({ storeRoot: root, now: NOW })).toBe(true);
  });

  it("admits every authenticated tenant when the allowlist has no enabled row", () => {
    process.env[CONVERSATION_TASK_ENV.activation] = "1";
    expect(initActivationHookFromServerConfig({ storeRoot: root, now: NOW })).toBe(true);
    expect(
      observeInboundTurnActivation({
        tenantId: "tenant-b",
        requesterId: "user-2",
        conversationId: "conv-full",
        employeeScopeAllowed: true,
        messageId: "m-full",
        text: "每天监控竞品价格,如果异常就预警",
      }),
    ).toBe("activated");
  });

  it("stays canary-scoped while any allowlist row is enabled", () => {
    const store = new ConversationTaskConfigStore({ storeRoot: root, now: NOW });
    store.setTenantAllow({
      tenantId: "tenant-a",
      enabled: true,
      actor: "ops",
      reason: "canary",
    });
    store.close();
    process.env[CONVERSATION_TASK_ENV.activation] = "1";
    expect(initActivationHookFromServerConfig({ storeRoot: root, now: NOW })).toBe(true);
    expect(
      observeInboundTurnActivation({
        tenantId: "tenant-b",
        requesterId: "user-2",
        conversationId: "conv-other",
        employeeScopeAllowed: true,
        messageId: "m-other",
        text: "每天监控竞品价格,如果异常就预警",
      }),
    ).toBe("skipped_tenant_not_allowed");
  });
});
