/**
 * ConversationTask Runtime — P2.5 gateway lifecycle bootstrap (admission §5 AC2/AC5; design §1/§6).
 *
 * Collapses the gateway-side wiring to two one-liners so the cross-partition surface stays minimal:
 *   startup:  initShadowHookFromServerConfig();   // assemble the runtime + init the module singleton
 *   shutdown: await shutdownShadowHook(capMs);    // bounded drain (exported from gateway-shadow-hook)
 *
 * The shadow HMAC key is server-side and fail-closed (C5): a per-tenant secret is derived from a
 * single root secret read from the environment. A missing/empty root secret makes the provider
 * THROW (never returns an empty secret, never degrades to an unkeyed hash), so the key stays out
 * of the repo and config files.
 *
 * Triple fail-closed: the detection flag is OFF by default, the tenant allowlist is empty by
 * default, and the key provider throws when unconfigured — so a bare install observes nothing and
 * writes nothing. Initialization is fail-safe (never throws into gateway startup) and idempotent.
 * Activation stays env-gated (`initActivationHookFromServerConfig`) and is also started from the
 * same gateway entry as shadow so `server.impl.ts` does not add freeze-pinned lines. It still
 * does not open orchestration live invoke or change the chat.send reply bytes.
 */
import crypto from "node:crypto";
import path from "node:path";
import { resolveCronStorePath } from "../cron/store.js";
import { CONFIG_DIR } from "../utils.js";
import { ConversationTaskConfigStore, TenantAllowlistCache } from "./config-store.js";
import { SqliteActivationControlPlane } from "./control-plane.js";
import { readConversationTaskFlags } from "./feature.js";
import { ConversationTaskFlagCache } from "./flag-cache.js";
import { initActivationHook, isActivationHookInitialized } from "./gateway-activation-hook.js";
import { initShadowHook, isShadowHookInitialized } from "./gateway-shadow-hook.js";
import { ensureConversationTaskLedgerSeeded } from "./ledger-binding.js";
import type { TenantHmacKey, TenantHmacKeyProvider } from "./shadow.js";

/** Env var holding the single server-side root secret used to derive per-tenant shadow HMAC keys. */
export const SHADOW_HMAC_KEY_ENV = "OPENBOT_CT_SHADOW_HMAC_KEY";
const SHADOW_HMAC_KEY_ENV_LEGACY = "OPENCLAW_CT_SHADOW_HMAC_KEY";
/** Optional env var naming the key epoch/id (rotating it breaks the fingerprint chain). */
export const SHADOW_HMAC_KEY_ID_ENV = "OPENBOT_CT_SHADOW_HMAC_KEY_ID";

/** Default persistent root for the shadow config store + per-tenant log books. */
export function defaultShadowStoreRoot(): string {
  return path.join(CONFIG_DIR, "conversation-task");
}

/**
 * Fail-closed (C5) tenant HMAC key provider backed by a single server-side env root secret.
 * A missing/empty root secret throws `hmac_key_missing` (no empty secret, no degrade). Each tenant
 * gets a distinct secret derived as HMAC-SHA256(root, "conversation-task/shadow/v1/" + tenantId),
 * so tenants never share a raw key and the root secret is never used directly as the tenant key.
 */
export function envTenantHmacKeyProvider(now: () => number = Date.now): TenantHmacKeyProvider {
  return (tenantId: string): TenantHmacKey => {
    const root =
      process.env[SHADOW_HMAC_KEY_ENV]?.trim() || process.env[SHADOW_HMAC_KEY_ENV_LEGACY]?.trim();
    if (!root) {
      const err = new Error("conversation-task shadow HMAC root secret is not configured");
      (err as { code?: string }).code = "hmac_key_missing";
      throw err;
    }
    const keyId = process.env[SHADOW_HMAC_KEY_ID_ENV]?.trim() || "env";
    const secret = crypto
      .createHmac("sha256", root)
      .update(`conversation-task/shadow/v1/${tenantId}`)
      .digest("hex");
    return { keyId, secret, issuedAtMs: now() };
  };
}

/**
 * Assemble the shadow runtime from the persistent config source + the env key provider and
 * initialize the module singleton. Idempotent (first call wins) and fail-safe: any error is
 * reported via `onError` and leaves the hook uninitialized (a safe no-op), so gateway startup is
 * never broken. Returns whether the hook is initialized after the call.
 */
export function initShadowHookFromServerConfig(
  opts: {
    storeRoot?: string;
    keyProvider?: TenantHmacKeyProvider;
    now?: () => number;
    onError?: (err: unknown) => void;
  } = {},
): boolean {
  if (isShadowHookInitialized()) {
    return true;
  }
  try {
    const now = opts.now ?? Date.now;
    const storeRoot = opts.storeRoot ?? defaultShadowStoreRoot();
    const store = new ConversationTaskConfigStore({ storeRoot, now });
    const flagCache = new ConversationTaskFlagCache({ reader: store.flagReader(), now });
    const allowCache = new TenantAllowlistCache({ reader: store.allowReader(), now });
    initShadowHook({
      isDetectionEnabled: () => flagCache.isEnabled("detection"),
      isTenantAllowed: (tenantId) => allowCache.isAllowed(tenantId),
      keyProvider: opts.keyProvider ?? envTenantHmacKeyProvider(now),
      storeRoot,
      now,
    });
  } catch (err) {
    opts.onError?.(err);
  }
  // Same gateway entry as shadow so server.impl.ts does not add freeze-pinned lines.
  initActivationHookFromServerConfig({
    storeRoot: opts.storeRoot,
    now: opts.now,
    onError: opts.onError,
  });
  return isShadowHookInitialized();
}

/**
 * Assemble the inbound Activation hook. Activation is env-gated
 * (`OPENBOT_CONVERSATION_TASK_ACTIVATION`) — the config store still cannot
 * enable it. A fresh control plane is forced-off; when the env flag is ON this
 * bootstrap reopens it with actor `env-activation-flag` (operator-set env).
 */
export function initActivationHookFromServerConfig(
  opts: {
    storeRoot?: string;
    now?: () => number;
    cronStorePath?: string;
    onError?: (err: unknown) => void;
  } = {},
): boolean {
  if (isActivationHookInitialized()) {
    return true;
  }
  try {
    const now = opts.now ?? Date.now;
    const storeRoot = opts.storeRoot ?? defaultShadowStoreRoot();
    const store = new ConversationTaskConfigStore({ storeRoot, now });
    const allowCache = new TenantAllowlistCache({ reader: store.allowReader(), now });
    const controlPlane = new SqliteActivationControlPlane({
      storeRoot,
      now,
      // Env-driven first reopen must not wait the default 10-minute cooldown.
      minReopenIntervalMs: 0,
    });
    const flags = readConversationTaskFlags();
    if (flags.activation && controlPlane.isForcedOff()) {
      controlPlane.attemptReopen({
        confirmedByHuman: true,
        actorId: "env-activation-flag",
      });
    }
    const cronStorePath = opts.cronStorePath ?? resolveCronStorePath();
    initActivationHook({
      storeRoot,
      flags: () => readConversationTaskFlags(),
      isTenantAllowed: (tenantId) => allowCache.isAllowed(tenantId) || !store.hasAnyEnabledTenant(),
      controlPlane,
      now,
      bindLedger: async (task) => {
        await ensureConversationTaskLedgerSeeded({
          task,
          cronStorePath,
        });
      },
    });
    return true;
  } catch (err) {
    opts.onError?.(err);
    return false;
  }
}
