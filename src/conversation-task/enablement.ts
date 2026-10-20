/**
 * Gate C enablement service. Dry-run by default; never opens activation.
 * Does not mint ConversationTask identity or write Progress Ledger.
 */

import {
  ConversationTaskConfigStore,
  type ConfigCasResult,
  type EnablementStatus,
} from "./config-store.js";
import { ConversationTaskStoreError } from "./errors.js";
import {
  SHADOW_ALLOWED_FLAGS,
  SHADOW_FORBIDDEN_FLAGS,
  type ConversationTaskFlag,
} from "./feature.js";
import { SHADOW_HMAC_KEY_ENV } from "./runtime-bootstrap.js";

const SHADOW_HMAC_KEY_ENV_LEGACY = "OPENCLAW_CT_SHADOW_HMAC_KEY";

export type ShadowEnablementFlag = (typeof SHADOW_ALLOWED_FLAGS)[number];

export type EnablementWriteKind = "allow-tenant" | "deny-tenant" | "enable-flag" | "disable-flag";

export type EnablementWritePreview = {
  applied: false;
  kind: EnablementWriteKind;
  actor: string;
  reason: string;
  flag?: ShadowEnablementFlag;
  enabled?: boolean;
  tenantIdPresent: boolean;
};

export type EnablementWriteApplied = {
  applied: true;
  kind: EnablementWriteKind;
  actor: string;
  reason: string;
  flag?: ShadowEnablementFlag;
  enabled?: boolean;
  tenantIdPresent: boolean;
  stateVersion: number;
};

export type EnablementWriteResult = EnablementWritePreview | EnablementWriteApplied;

export type EnablementStatusView = EnablementStatus & {
  hmacKeyConfigured: boolean;
};

function requireActorReason(actor: string, reason: string): { actor: string; reason: string } {
  const actorId = actor.trim();
  const why = reason.trim();
  if (!actorId || !why) {
    throw new ConversationTaskStoreError(
      "actor_required",
      "write operations require --actor and --reason",
    );
  }
  return { actor: actorId, reason: why };
}

function requireShadowFlag(flag: string): ShadowEnablementFlag {
  const name = flag.trim() as ConversationTaskFlag;
  if ((SHADOW_FORBIDDEN_FLAGS as readonly string[]).includes(name)) {
    throw new ConversationTaskStoreError(
      "forbidden_flag",
      `${name} must stay OFF in P2.5 shadow-only; refusing to enable`,
    );
  }
  if (!(SHADOW_ALLOWED_FLAGS as readonly string[]).includes(name)) {
    throw new ConversationTaskStoreError(
      "unknown_flag",
      "only detection or qualification may change",
    );
  }
  return name;
}

export function isHmacKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[SHADOW_HMAC_KEY_ENV]?.trim() || env[SHADOW_HMAC_KEY_ENV_LEGACY]?.trim());
}

export function readEnablementStatusView(
  store: ConversationTaskConfigStore,
  env: NodeJS.ProcessEnv = process.env,
): EnablementStatusView {
  return {
    ...store.readEnablementStatus(),
    hmacKeyConfigured: isHmacKeyConfigured(env),
  };
}

function toPreview(
  kind: EnablementWriteKind,
  params: {
    actor: string;
    reason: string;
    flag?: ShadowEnablementFlag;
    enabled?: boolean;
    tenantIdPresent: boolean;
  },
): EnablementWritePreview {
  return {
    applied: false,
    kind,
    actor: params.actor,
    reason: params.reason,
    tenantIdPresent: params.tenantIdPresent,
    ...(params.flag ? { flag: params.flag } : {}),
    ...(params.enabled != null ? { enabled: params.enabled } : {}),
  };
}

function finishWrite(
  kind: EnablementWriteKind,
  cas: ConfigCasResult,
  params: {
    actor: string;
    reason: string;
    flag?: ShadowEnablementFlag;
    enabled?: boolean;
    tenantIdPresent: boolean;
  },
): EnablementWriteApplied {
  if (!cas.ok) {
    throw new ConversationTaskStoreError(cas.reason, "config store CAS rejected the write");
  }
  return {
    applied: true,
    kind,
    actor: params.actor,
    reason: params.reason,
    tenantIdPresent: params.tenantIdPresent,
    stateVersion: cas.stateVersion,
    ...(params.flag ? { flag: params.flag } : {}),
    ...(params.enabled != null ? { enabled: params.enabled } : {}),
  };
}

export function setTenantAllowlistEntry(params: {
  store: ConversationTaskConfigStore;
  tenantId: string;
  enabled: boolean;
  actor: string;
  reason: string;
  confirm?: boolean;
}): EnablementWriteResult {
  const { actor, reason } = requireActorReason(params.actor, params.reason);
  const tenantId = params.tenantId.trim();
  if (!tenantId) {
    throw new ConversationTaskStoreError("tenant_required", "a trusted tenantId is required");
  }
  const kind: EnablementWriteKind = params.enabled ? "allow-tenant" : "deny-tenant";
  const preview = toPreview(kind, {
    actor,
    reason,
    enabled: params.enabled,
    tenantIdPresent: true,
  });
  if (!params.confirm) {
    return preview;
  }
  return finishWrite(
    kind,
    params.store.setTenantAllow({ tenantId, enabled: params.enabled, actor, reason }),
    preview,
  );
}

export function setShadowFlag(params: {
  store: ConversationTaskConfigStore;
  flag: string;
  enabled: boolean;
  actor: string;
  reason: string;
  confirm?: boolean;
}): EnablementWriteResult {
  const { actor, reason } = requireActorReason(params.actor, params.reason);
  const flag = requireShadowFlag(params.flag);
  if (params.enabled) {
    requireShadowFlag(flag);
  }
  const kind: EnablementWriteKind = params.enabled ? "enable-flag" : "disable-flag";
  const preview = toPreview(kind, {
    actor,
    reason,
    flag,
    enabled: params.enabled,
    tenantIdPresent: false,
  });
  if (!params.confirm) {
    return preview;
  }
  return finishWrite(kind, params.store.setFlag(flag, params.enabled, actor, reason), preview);
}
