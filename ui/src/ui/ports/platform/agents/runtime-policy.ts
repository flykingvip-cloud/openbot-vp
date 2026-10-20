/**
 * Strategy-card source: `agent-runtime.policy.get` / `agent-runtime.policy.update`.
 * Null fields stay 「未接入」. Auth rate limits are not this document.
 *
 * Units are global policy, not per binding:
 * - `perCapabilityQps`: requests per second for one capability (fractional allowed).
 * - `perTenantDailyCap`: whole requests per day for one tenant.
 * `fallback.mode` is the global switch (`auto-standby` | `none`).
 * Per-binding `fallbackBindingId` is not written by this document.
 */

import type { LoadStrategy } from "../../../capability/runtime-canonical/index.ts";

export const RUNTIME_POLICY_GET_METHOD = "agent-runtime.policy.get";
export const RUNTIME_POLICY_UPDATE_METHOD = "agent-runtime.policy.update";

export type RuntimePolicyConflict = "highest-success" | "priority" | "manual";
export type RuntimePolicyFallbackMode = "auto-standby" | "none";

export type RuntimePolicyDocument = {
  loadDefaults: {
    default: LoadStrategy | null;
    byCapabilityKind: Record<string, LoadStrategy | null>;
  } | null;
  conflict: RuntimePolicyConflict | null;
  fallback: { mode: RuntimePolicyFallbackMode | null };
  rateLimit: {
    perCapabilityQps: number | null;
    perTenantDailyCap: number | null;
  } | null;
};

export const UNCONFIGURED_RUNTIME_POLICY: RuntimePolicyDocument = {
  loadDefaults: null,
  conflict: null,
  fallback: { mode: null },
  rateLimit: null,
};

const LOAD_STRATEGIES = new Set<LoadStrategy>(["eager", "lazy", "on-demand"]);
const CONFLICTS = new Set<RuntimePolicyConflict>(["highest-success", "priority", "manual"]);
const FALLBACK_MODES = new Set<RuntimePolicyFallbackMode>(["auto-standby", "none"]);

export const LOAD_STRATEGY_LABELS: Record<LoadStrategy, string> = {
  eager: "预加载",
  lazy: "延迟加载",
  "on-demand": "按需加载",
};

export const CONFLICT_LABELS: Record<RuntimePolicyConflict, string> = {
  "highest-success": "自动选择成功率最高",
  priority: "按优先级",
  manual: "人工指定",
};

export const FALLBACK_MODE_LABELS: Record<RuntimePolicyFallbackMode, string> = {
  "auto-standby": "自动切换备用",
  none: "不自动切换",
};

/** Requests per second, counted per capability. Global policy field. */
export const PER_CAPABILITY_QPS_UNIT_LABEL = "次/秒 · 每个能力";
/** Whole requests per day, counted per tenant. Global policy field. */
export const PER_TENANT_DAILY_CAP_UNIT_LABEL = "次/天 · 每个租户";

export const RUNTIME_POLICY_RATE_UNIT_COPY = {
  perCapabilityQps:
    "每能力 QPS 的单位是次/秒（requests/second），按每个能力计。这是全局策略，不是单条绑定。",
  perTenantDailyCap:
    "每租户每日上限的单位是次/天（requests/day），按每个租户计，必须是整数。这是全局策略，不是单条绑定。",
  fallback:
    "Fallback 用全局 fallback.mode：auto-standby 是自动切换备用，none 是不自动切换。每条绑定上的 fallbackBindingId 仍是绑定级字段，这张卡片不改它。",
} as const;

export function formatPerCapabilityQps(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "未接入";
  }
  return `${value} ${PER_CAPABILITY_QPS_UNIT_LABEL}`;
}

export function formatPerTenantDailyCap(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isInteger(value)) {
    return "未接入";
  }
  return `${value} ${PER_TENANT_DAILY_CAP_UNIT_LABEL}`;
}

export function formatFallbackMode(mode: RuntimePolicyFallbackMode | null | undefined): string {
  if (!mode) {
    return "未接入";
  }
  return `${FALLBACK_MODE_LABELS[mode]}（${mode}）`;
}

export function policyFieldLabel(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "未接入";
  }
  return String(value);
}

export function loadStrategyLabel(value: LoadStrategy | null | undefined): string {
  if (!value) {
    return "未接入";
  }
  return LOAD_STRATEGY_LABELS[value];
}

function isLoadStrategy(value: unknown): value is LoadStrategy {
  return typeof value === "string" && LOAD_STRATEGIES.has(value as LoadStrategy);
}

export function parseRuntimePolicyDocument(value: unknown): RuntimePolicyDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<RuntimePolicyDocument>;
  if (
    !("loadDefaults" in raw) ||
    !("conflict" in raw) ||
    !("fallback" in raw) ||
    !("rateLimit" in raw)
  ) {
    return null;
  }
  if (raw.conflict !== null && !CONFLICTS.has(raw.conflict as RuntimePolicyConflict)) {
    return null;
  }
  if (!raw.fallback || typeof raw.fallback !== "object") {
    return null;
  }
  const mode = raw.fallback.mode;
  if (mode !== null && !FALLBACK_MODES.has(mode)) {
    return null;
  }
  let loadDefaults: RuntimePolicyDocument["loadDefaults"] = null;
  if (raw.loadDefaults !== null) {
    if (!raw.loadDefaults || typeof raw.loadDefaults !== "object") {
      return null;
    }
    if (raw.loadDefaults.default !== null && !isLoadStrategy(raw.loadDefaults.default)) {
      return null;
    }
    if (
      !raw.loadDefaults.byCapabilityKind ||
      typeof raw.loadDefaults.byCapabilityKind !== "object"
    ) {
      return null;
    }
    const byCapabilityKind: Record<string, LoadStrategy | null> = {};
    for (const [key, entry] of Object.entries(raw.loadDefaults.byCapabilityKind)) {
      if (entry !== null && !isLoadStrategy(entry)) {
        return null;
      }
      byCapabilityKind[key] = entry;
    }
    loadDefaults = { default: raw.loadDefaults.default, byCapabilityKind };
  }
  let rateLimit: RuntimePolicyDocument["rateLimit"] = null;
  if (raw.rateLimit !== null) {
    if (!raw.rateLimit || typeof raw.rateLimit !== "object") {
      return null;
    }
    const qps = raw.rateLimit.perCapabilityQps;
    const cap = raw.rateLimit.perTenantDailyCap;
    if (qps !== null && (typeof qps !== "number" || !Number.isFinite(qps))) {
      return null;
    }
    if (cap !== null && (typeof cap !== "number" || !Number.isFinite(cap))) {
      return null;
    }
    rateLimit = { perCapabilityQps: qps, perTenantDailyCap: cap };
  }
  return {
    loadDefaults,
    conflict: raw.conflict ?? null,
    fallback: { mode: mode ?? null },
    rateLimit,
  };
}

export function runtimePolicyEqual(
  left: RuntimePolicyDocument,
  right: RuntimePolicyDocument,
): boolean {
  return JSON.stringify(normalizePolicy(left)) === JSON.stringify(normalizePolicy(right));
}

function normalizePolicy(policy: RuntimePolicyDocument): RuntimePolicyDocument {
  const kinds = policy.loadDefaults?.byCapabilityKind ?? {};
  const byCapabilityKind = Object.fromEntries(
    Object.entries(kinds).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return {
    loadDefaults: policy.loadDefaults
      ? { default: policy.loadDefaults.default, byCapabilityKind }
      : null,
    conflict: policy.conflict,
    fallback: { mode: policy.fallback.mode },
    rateLimit: policy.rateLimit
      ? {
          perCapabilityQps: policy.rateLimit.perCapabilityQps,
          perTenantDailyCap: policy.rateLimit.perTenantDailyCap,
        }
      : null,
  };
}

export async function requestRuntimePolicyGet(
  request: <T>(method: string, params: unknown) => Promise<T>,
): Promise<{ ok: true; policy: RuntimePolicyDocument } | { ok: false; error: string }> {
  try {
    const payload = await request<unknown>(RUNTIME_POLICY_GET_METHOD, {});
    const policy = parseRuntimePolicyDocument(payload);
    if (!policy) {
      return { ok: false, error: "策略源返回与契约不一致，未展示示意数字" };
    }
    return { ok: true, policy };
  } catch (error) {
    const message = error instanceof Error ? error.message : "策略源读取失败";
    return { ok: false, error: message };
  }
}

export async function requestRuntimePolicyUpdate(
  request: <T>(method: string, params: unknown) => Promise<T>,
  policy: RuntimePolicyDocument,
): Promise<{ ok: true; policy: RuntimePolicyDocument } | { ok: false; error: string }> {
  try {
    const payload = await request<unknown>(RUNTIME_POLICY_UPDATE_METHOD, policy);
    const next = parseRuntimePolicyDocument(payload);
    if (!next || !runtimePolicyEqual(next, policy)) {
      return { ok: false, error: "网关返回与请求不一致，未记为成功" };
    }
    return { ok: true, policy: next };
  } catch (error) {
    const message = error instanceof Error ? error.message : "策略保存失败";
    return { ok: false, error: message };
  }
}
