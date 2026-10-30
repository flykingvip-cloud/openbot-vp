import { createHash } from "node:crypto";
/**
 * Conversation lifecycle feature flags (plan §14.4).
 *
 * Resolution order for env-backed booleans (highest wins):
 * 1. Env var override (`OPENBOT_CONVERSATION_*` = 1/0/true/false/yes/no/on/off)
 * 2. Config `conversation.*` when the boolean is set
 * 3. Safe production default
 * Invalid or empty env does not override config. Rollout can still freeze
 * product-surface flags (UI, semantic search, retention enforce). Projection
 * and the context planner stay at the resolved boolean when rollout is inactive.
 *
 * When a subject is outside the rollout gate, product-facing / irreversible
 * features stay off (UI, semantic search, retention enforce) while catalog
 * mapping remains available for compatibility.
 */
import type { OpenBotConfig } from "../config/config.js";

export type ResolvedConversationFlags = {
  catalogEnabled: boolean;
  lazyBackfill: boolean;
  uiEnabled: boolean;
  historyCursorEnabled: boolean;
  sourceIdentityEnabled: boolean;
  sourceLifecycleEnabled: boolean;
  projectionEnabled: boolean;
  contextPlannerEnabled: boolean;
  searchSemanticEnabled: boolean;
  retentionEnforceEnabled: boolean;
  /** True when subject is inside the configured rollout window. */
  rolloutActive: boolean;
  /** Human-readable reason when rollout is inactive (for logs/metrics). */
  rolloutReason: string | null;
};

/** Per-tenant / pilot gradual rollout (plan §14.4). */
export type ConversationRolloutConfig = {
  /**
   * When non-empty, only these tenant IDs receive product features.
   * Empty / omitted = all tenants (subject to percent/blocklist).
   */
  tenantAllowlist?: string[];
  /** Always exclude these tenant IDs. */
  tenantBlocklist?: string[];
  /** 0–100 canary: hash(tenantId) % 100 < percent. Omitted = 100%. */
  tenantPercent?: number;
  /** Optional principal (user) allowlist for internal pilot. */
  principalAllowlist?: string[];
  /** Optional seat allowlist for enterprise pilot seats. */
  seatAllowlist?: string[];
};

export type ConversationConfigSlice = {
  catalog?: { enabled?: boolean; lazyBackfill?: boolean };
  ui?: { enabled?: boolean };
  history?: { cursorEnabled?: boolean };
  sourceIdentity?: { enabled?: boolean };
  sourceLifecycle?: { enabled?: boolean };
  projection?: { enabled?: boolean };
  contextPlanner?: { enabled?: boolean };
  search?: { semanticEnabled?: boolean };
  retention?: { enforceEnabled?: boolean };
  /** Gradual rollout by tenant / seat / principal. */
  rollout?: ConversationRolloutConfig;
};

export type ConversationFlagSubject = {
  tenantId?: string | null;
  principalId?: string | null;
  seatId?: string | null;
};

function asConversationConfig(cfg?: OpenBotConfig | null): ConversationConfigSlice | undefined {
  const raw = (cfg as { conversation?: ConversationConfigSlice } | null | undefined)?.conversation;
  return raw && typeof raw === "object" ? raw : undefined;
}

function resolveBool(raw: boolean | undefined, defaultValue: boolean): boolean {
  return typeof raw === "boolean" ? raw : defaultValue;
}

/** Explicit env override. Empty or unrecognized values fall through. */
export function readEnvBoolOverride(key: string): boolean | undefined {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return undefined;
}

/** Env override, then explicit config, then default. */
export function resolveLayeredBool(
  envKey: string,
  configValue: boolean | undefined,
  defaultValue: boolean,
): boolean {
  const override = readEnvBoolOverride(envKey);
  if (typeof override === "boolean") {
    return override;
  }
  if (typeof configValue === "boolean") {
    return configValue;
  }
  return defaultValue;
}

function parseCsvEnv(key: string): string[] {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeId(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Stable 0–99 bucket for canary percent. */
export function tenantRolloutBucket(tenantId: string): number {
  const digest = createHash("sha256").update(`conv-rollout-v1\0${tenantId}`).digest();
  return digest[0] % 100;
}

export function evaluateConversationRollout(params: {
  rollout?: ConversationRolloutConfig | null;
  subject?: ConversationFlagSubject | null;
  env?: NodeJS.ProcessEnv;
}): { active: boolean; reason: string | null } {
  const env = params.env ?? process.env;
  const subject = params.subject ?? {};
  const tenantId = normalizeId(subject.tenantId);
  const principalId = normalizeId(subject.principalId);
  const seatId = normalizeId(subject.seatId);

  const cfg = params.rollout ?? {};
  const envAllow = parseCsvEnv("OPENBOT_CONVERSATION_ROLLOUT_TENANT_IDS");
  const envBlock = parseCsvEnv("OPENBOT_CONVERSATION_ROLLOUT_TENANT_BLOCKLIST");
  const envPrincipal = parseCsvEnv("OPENBOT_CONVERSATION_ROLLOUT_PRINCIPAL_IDS");
  const envSeat = parseCsvEnv("OPENBOT_CONVERSATION_ROLLOUT_SEAT_IDS");
  const envPercentRaw = env.OPENBOT_CONVERSATION_ROLLOUT_PERCENT?.trim();
  const envPercent =
    envPercentRaw && Number.isFinite(Number(envPercentRaw))
      ? Math.min(100, Math.max(0, Number(envPercentRaw)))
      : null;

  const tenantAllowlist = [
    ...(cfg.tenantAllowlist ?? []).map(normalizeId).filter(Boolean),
    ...envAllow,
  ];
  const tenantBlocklist = [
    ...(cfg.tenantBlocklist ?? []).map(normalizeId).filter(Boolean),
    ...envBlock,
  ];
  const principalAllowlist = [
    ...(cfg.principalAllowlist ?? []).map(normalizeId).filter(Boolean),
    ...envPrincipal,
  ];
  const seatAllowlist = [...(cfg.seatAllowlist ?? []).map(normalizeId).filter(Boolean), ...envSeat];
  const tenantPercent =
    envPercent ??
    (typeof cfg.tenantPercent === "number" && Number.isFinite(cfg.tenantPercent)
      ? Math.min(100, Math.max(0, Math.floor(cfg.tenantPercent)))
      : null);

  // No subject + no restrictions → fully active (local / tests).
  const hasAnyRestriction =
    tenantAllowlist.length > 0 ||
    tenantBlocklist.length > 0 ||
    principalAllowlist.length > 0 ||
    seatAllowlist.length > 0 ||
    (tenantPercent != null && tenantPercent < 100);

  if (!hasAnyRestriction) {
    return { active: true, reason: null };
  }

  if (tenantId && tenantBlocklist.includes(tenantId)) {
    return { active: false, reason: "tenant_blocklist" };
  }

  if (tenantAllowlist.length > 0) {
    if (!tenantId || !tenantAllowlist.includes(tenantId)) {
      return { active: false, reason: "tenant_not_in_allowlist" };
    }
  }

  if (principalAllowlist.length > 0) {
    if (!principalId || !principalAllowlist.includes(principalId)) {
      return { active: false, reason: "principal_not_in_allowlist" };
    }
  }

  if (seatAllowlist.length > 0) {
    if (!seatId || !seatAllowlist.includes(seatId)) {
      return { active: false, reason: "seat_not_in_allowlist" };
    }
  }

  if (tenantPercent != null && tenantPercent < 100) {
    // Local mode without tenantId: treat as in-rollout for developer convenience
    // unless percent is 0 (global kill).
    if (tenantPercent === 0) {
      return { active: false, reason: "tenant_percent_zero" };
    }
    if (tenantId) {
      const bucket = tenantRolloutBucket(tenantId);
      if (bucket >= tenantPercent) {
        return { active: false, reason: `tenant_percent_bucket_${bucket}` };
      }
    }
  }

  return { active: true, reason: null };
}

/**
 * Resolve conversation lifecycle flags for a config + optional request subject.
 * Catalog defaults on for local contracts; product UI / enforce stay off until pilot.
 */
export function resolveConversationFlags(
  cfg?: OpenBotConfig | null,
  subject?: ConversationFlagSubject | null,
): ResolvedConversationFlags {
  const c = asConversationConfig(cfg);
  const rollout = evaluateConversationRollout({
    rollout: c?.rollout,
    subject,
  });

  // Base resolution (config + env + defaults).
  const base: ResolvedConversationFlags = {
    catalogEnabled: resolveBool(c?.catalog?.enabled, true),
    lazyBackfill: resolveBool(c?.catalog?.lazyBackfill, true),
    uiEnabled: resolveBool(c?.ui?.enabled, false),
    historyCursorEnabled: resolveLayeredBool(
      "OPENBOT_CONVERSATION_HISTORY_CURSOR",
      c?.history?.cursorEnabled,
      true,
    ),
    sourceIdentityEnabled: resolveBool(c?.sourceIdentity?.enabled, true),
    sourceLifecycleEnabled: resolveBool(c?.sourceLifecycle?.enabled, true),
    projectionEnabled: resolveLayeredBool(
      "OPENBOT_CONVERSATION_PROJECTION",
      c?.projection?.enabled,
      true,
    ),
    contextPlannerEnabled: resolveLayeredBool(
      "OPENBOT_CONVERSATION_CONTEXT_PLANNER",
      c?.contextPlanner?.enabled,
      true,
    ),
    searchSemanticEnabled: resolveLayeredBool(
      "OPENBOT_CONVERSATION_SEMANTIC_SEARCH",
      c?.search?.semanticEnabled,
      false,
    ),
    retentionEnforceEnabled: resolveLayeredBool(
      "OPENBOT_CONVERSATION_RETENTION_ENFORCE",
      c?.retention?.enforceEnabled,
      false,
    ),
    rolloutActive: rollout.active,
    rolloutReason: rollout.reason,
  };

  if (rollout.active) {
    return base;
  }

  // Outside rollout: keep catalog/lazy mapping for compatibility, freeze product surface.
  return {
    ...base,
    uiEnabled: false,
    searchSemanticEnabled: false,
    retentionEnforceEnabled: false,
    // Projection / planner stay on by default (local-only, non-blocking) unless
    // explicitly disabled — they do not change product UX entry points.
    rolloutActive: false,
    rolloutReason: rollout.reason,
  };
}

/** Safe production defaults for docs / onboarding examples. */
export const CONVERSATION_PRODUCTION_DEFAULTS: ConversationConfigSlice = {
  catalog: { enabled: true, lazyBackfill: true },
  ui: { enabled: false },
  history: { cursorEnabled: true },
  sourceIdentity: { enabled: true },
  sourceLifecycle: { enabled: true },
  projection: { enabled: true },
  contextPlanner: { enabled: true },
  search: { semanticEnabled: false },
  retention: { enforceEnabled: false },
  rollout: {
    tenantPercent: 0,
    tenantAllowlist: [],
  },
};
