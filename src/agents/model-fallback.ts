import { isContextCapSelectionBlockedError } from "../agent-runtime/model/rule-adaptation/context-cap-selection.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "../config/model-input.js";
import {
  observeModelCandidate,
  type ExecutorEvidenceContext,
} from "../executor-evidence/model-call-evidence.js";
import { isEnterpriseRuntimeModelId } from "../gateway/enterprise-model/ids.js";
import type { GovernanceMode } from "../gateway/governance/decision.js";
import {
  filterModelCandidatesByPlatformAdmission,
  PlatformAdmissionEmptyError,
  type RuntimeAdmissionInput,
} from "../gateway/models/capability-admission/apply-runtime-admission.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { sanitizeForLog } from "../terminal/ansi.js";
import {
  ensureAuthProfileStore,
  loadAuthProfileStoreForSecretsRuntime,
  getSoonestCooldownExpiry,
  isProfileInCooldown,
  resolveProfilesUnavailableReason,
  resolveAuthProfileOrder,
} from "./auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import type { AllowlistEnforcement } from "./embedded-model-governance.js";
import {
  coerceToFailoverError,
  describeFailoverError,
  isFailoverError,
  isTimeoutError,
} from "./failover-error.js";
import {
  recordModelGovernanceDecision,
  type ModelGovernanceContext,
} from "./model-fallback-governance.js";
import { logModelFallbackDecision } from "./model-fallback-observation.js";
import type { FallbackAttempt, ModelCandidate } from "./model-fallback.types.js";
import {
  buildConfiguredAllowlistKeys,
  buildModelAliasIndex,
  isCliProvider,
  modelKey,
  normalizeModelRef,
  resolveConfiguredModelRef,
  resolveModelRefFromString,
} from "./model-selection.js";
import type { FailoverReason } from "./pi-embedded-helpers.js";
import { isLikelyContextOverflowError } from "./pi-embedded-helpers.js";
import { isSandboxAccountIdentityError } from "./sandbox/account-scope.js";
import { isSandboxInfraPreReplyError } from "./sandbox/docker-engine-client.js";

const log = createSubsystemLogger("model-fallback");

/**
 * Entitlement hard-deny 过滤层（model-entitlement-chain P1）。
 *
 * 与 `buildConfiguredAllowlistKeys` 的「配置级 allowlist」**并存但语义更强**：
 * allowlist 允许 explicit candidate / explicit fallback 绕过（见 createModelCandidateCollector
 * 与 resolveFallbackCandidates 的 addExplicitCandidate）；hard-deny 则是**硬边界**——
 * 任何不在 `effectiveModelIds` 内的候选（含 primary / explicit fallback / AOR 选出的）
 * 一律剔除，不得越过（design Property 7）。
 *
 * 调用约定：在候选解析（resolveFallbackCandidates）产出之后、执行之前统一应用。
 * 仅在 entitlement 已解析（state="resolved"）时调用；missing 态由上层灰度开关处理。
 */
export function applyEntitlementHardDeny(
  candidates: readonly ModelCandidate[],
  effectiveModelIds: readonly string[],
): ModelCandidate[] {
  const allowed = new Set(effectiveModelIds.map((id) => id.trim()).filter((id) => id.length > 0));
  return candidates.filter((candidate) =>
    allowed.has(modelKey(candidate.provider, candidate.model)),
  );
}

/**
 * 保集合重排（model-entitlement-chain P3）。
 *
 * 按 `preferredOrder`（AOR selector 在 EffectiveModelSet 内选出的顺序）对候选重排：
 * 命中顺序者按该顺序前置，其余候选保持原有相对次序追加。**不增删任何候选**，
 * 因此候选集合与重排前完全一致（Property 4：与 native 候选集合恒等，仅顺序不同）。
 */
export function applyPreferredModelOrder(
  candidates: readonly ModelCandidate[],
  preferredOrder: readonly string[],
): ModelCandidate[] {
  const rank = new Map<string, number>();
  preferredOrder.forEach((id, index) => {
    const key = id.trim();
    if (key && !rank.has(key)) {
      rank.set(key, index);
    }
  });
  // stable sort：命中者按 rank，未命中者落到末尾并保持原序。
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .toSorted((a, b) => {
      const ra =
        rank.get(modelKey(a.candidate.provider, a.candidate.model)) ?? Number.MAX_SAFE_INTEGER;
      const rb =
        rank.get(modelKey(b.candidate.provider, b.candidate.model)) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) {
        return ra - rb;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.candidate);
}

/**
 * Seat-granted enterprise models (`ent/...`) are not in `models.providers` and
 * are absent from the session/config candidate chain unless the session is
 * already pinned to them. Hard-deny then removes the platform primary and
 * throws MODEL_ENTITLEMENT_EMPTY even though the allowlist is non-empty.
 * Append those ids so a granted BYOK model can actually run. Platform ids stay
 * limited to the configured chain (Property 7).
 */
export function appendGrantedEnterpriseCandidates(
  candidates: readonly ModelCandidate[],
  allowlist: readonly string[] | undefined,
): ModelCandidate[] {
  if (!allowlist || allowlist.length === 0) {
    return [...candidates];
  }
  const extras = buildCandidatesFromPreferredModelOrder(
    allowlist.filter((id) => isEnterpriseRuntimeModelId(id)),
  );
  if (extras.length === 0) {
    return [...candidates];
  }
  const seen = new Set(
    candidates.map((candidate) => modelKey(candidate.provider, candidate.model)),
  );
  const next = [...candidates];
  for (const extra of extras) {
    const key = modelKey(extra.provider, extra.model);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(extra);
  }
  return next;
}

function allowlistIsEnterpriseCatalogOnly(allowlist: readonly string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0) {
    return false;
  }
  return allowlist.every((id) => isEnterpriseRuntimeModelId(id.trim()));
}

function entitlementFilterWillApply(params: {
  governanceMode?: GovernanceMode;

  entitlementAllowlist?: readonly string[];
  allowlistEnforcement?: AllowlistEnforcement;
}): boolean {
  if (params.entitlementAllowlist === undefined) {
    return false;
  }
  if (params.governanceMode === undefined) {
    return true;
  }
  const enforcement = params.allowlistEnforcement ?? "governance-mode";
  return enforcement === "preexisting" || params.governanceMode === "enforced";
}

export function buildCandidatesFromPreferredModelOrder(
  preferredOrder: readonly string[],
): ModelCandidate[] {
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];
  for (const raw of preferredOrder) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    const slash = trimmed.indexOf("/");
    if (slash <= 0 || slash === trimmed.length - 1) {
      continue;
    }
    seen.add(trimmed);
    candidates.push({
      provider: trimmed.slice(0, slash),
      model: trimmed.slice(slash + 1),
    });
  }
  return candidates;
}

export type ModelFallbackRunOptions = {
  allowTransientCooldownProbe?: boolean;
};

type ModelFallbackRunFn<T> = (
  provider: string,
  model: string,
  options?: ModelFallbackRunOptions,
) => Promise<T>;

/**
 * Fallback abort check. Only treats explicit AbortError names as user aborts.
 * Message-based checks (e.g., "aborted") can mask timeouts and skip fallback.
 */
function isFallbackAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  if (isFailoverError(err)) {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  return name === "AbortError";
}

function shouldRethrowAbort(err: unknown): boolean {
  return isFallbackAbortError(err) && !isTimeoutError(err);
}

function createModelCandidateCollector(allowlist: Set<string> | null | undefined): {
  candidates: ModelCandidate[];
  addExplicitCandidate: (candidate: ModelCandidate) => void;
  addAllowlistedCandidate: (candidate: ModelCandidate) => void;
} {
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];

  const addCandidate = (candidate: ModelCandidate, enforceAllowlist: boolean) => {
    if (!candidate.provider || !candidate.model) {
      return;
    }
    const key = modelKey(candidate.provider, candidate.model);
    if (seen.has(key)) {
      return;
    }
    if (enforceAllowlist && allowlist && !allowlist.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };

  const addExplicitCandidate = (candidate: ModelCandidate) => {
    addCandidate(candidate, false);
  };
  const addAllowlistedCandidate = (candidate: ModelCandidate) => {
    addCandidate(candidate, true);
  };

  return { candidates, addExplicitCandidate, addAllowlistedCandidate };
}

type ModelFallbackErrorHandler = (attempt: {
  provider: string;
  model: string;
  error: unknown;
  attempt: number;
  total: number;
}) => void | Promise<void>;

type ModelFallbackRunResult<T> = {
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
};

function buildFallbackSuccess<T>(params: {
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
}): ModelFallbackRunResult<T> {
  return {
    result: params.result,
    provider: params.provider,
    model: params.model,
    attempts: params.attempts,
  };
}

async function runFallbackCandidate<T>(params: {
  run: ModelFallbackRunFn<T>;
  provider: string;
  model: string;
  options?: ModelFallbackRunOptions;
  evidence?: ExecutorEvidenceContext | null;
  attemptIndex?: number;
}): Promise<{ ok: true; result: T } | { ok: false; error: unknown }> {
  try {
    const result = await observeModelCandidate({
      context: params.evidence,
      attemptIndex: params.attemptIndex ?? 0,
      provider: params.provider,
      model: params.model,
      classifyError: (err) => {
        if (shouldRethrowAbort(err)) {
          return "cancelled";
        }
        if (isTimeoutError(err)) {
          return "timeout";
        }
        return "error";
      },
      usageFromResult: (value) => {
        if (!value || typeof value !== "object") {
          return undefined;
        }
        const meta = (value as { meta?: { agentMeta?: { usage?: unknown } } }).meta;
        return meta?.agentMeta?.usage;
      },
      run: async () =>
        params.options
          ? await params.run(params.provider, params.model, params.options)
          : await params.run(params.provider, params.model),
    });
    return {
      ok: true,
      result,
    };
  } catch (err) {
    // Budget exhaustion is a task stop, not a provider failover. Trying the next
    // model would be another call the tip gate already refused.
    if (err instanceof Error && err.name === "TaskBudgetExceededError") {
      throw err;
    }
    // Context-cap selection source blocks (identity, corrupt snapshot, or
    // production path closed) are policy stops, not unknown model failures.
    // Another candidate cannot repair them; do not rotate to the next model.
    if (isContextCapSelectionBlockedError(err)) {
      throw err;
    }
    if (shouldRethrowAbort(err)) {
      throw err;
    }
    return { ok: false, error: err };
  }
}

async function runFallbackAttempt<T>(params: {
  run: ModelFallbackRunFn<T>;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
  options?: ModelFallbackRunOptions;
  evidence?: ExecutorEvidenceContext | null;
  attemptIndex?: number;
}): Promise<{ success: ModelFallbackRunResult<T> } | { error: unknown }> {
  const runResult = await runFallbackCandidate({
    run: params.run,
    provider: params.provider,
    model: params.model,
    options: params.options,
    evidence: params.evidence,
    attemptIndex: params.attemptIndex,
  });
  if (runResult.ok) {
    return {
      success: buildFallbackSuccess({
        result: runResult.result,
        provider: params.provider,
        model: params.model,
        attempts: params.attempts,
      }),
    };
  }
  return { error: runResult.error };
}

function sameModelCandidate(a: ModelCandidate, b: ModelCandidate): boolean {
  return a.provider === b.provider && a.model === b.model;
}

function throwFallbackFailureSummary(params: {
  attempts: FallbackAttempt[];
  candidates: ModelCandidate[];
  lastError: unknown;
  label: string;
  formatAttempt: (attempt: FallbackAttempt) => string;
}): never {
  if (params.attempts.length <= 1 && params.lastError) {
    throw params.lastError;
  }
  const summary =
    params.attempts.length > 0 ? params.attempts.map(params.formatAttempt).join(" | ") : "unknown";
  throw new Error(
    `All ${params.label} failed (${params.attempts.length || params.candidates.length}): ${summary}`,
    {
      cause: params.lastError instanceof Error ? params.lastError : undefined,
    },
  );
}

function resolveImageFallbackCandidates(params: {
  cfg: OpenBotConfig | undefined;
  defaultProvider: string;
  modelOverride?: string;
}): ModelCandidate[] {
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg ?? {},
    defaultProvider: params.defaultProvider,
  });
  const allowlist = buildConfiguredAllowlistKeys({
    cfg: params.cfg,
    defaultProvider: params.defaultProvider,
  });
  const { candidates, addExplicitCandidate, addAllowlistedCandidate } =
    createModelCandidateCollector(allowlist);

  const addRaw = (raw: string, opts?: { allowlist?: boolean }) => {
    const resolved = resolveModelRefFromString({
      raw: String(raw ?? ""),
      defaultProvider: params.defaultProvider,
      aliasIndex,
    });
    if (!resolved) {
      return;
    }
    if (opts?.allowlist) {
      addAllowlistedCandidate(resolved.ref);
      return;
    }
    addExplicitCandidate(resolved.ref);
  };

  if (params.modelOverride?.trim()) {
    addRaw(params.modelOverride);
  } else {
    const primary = resolveAgentModelPrimaryValue(params.cfg?.agents?.defaults?.imageModel);
    if (primary?.trim()) {
      addRaw(primary);
    }
  }

  const imageFallbacks = resolveAgentModelFallbackValues(params.cfg?.agents?.defaults?.imageModel);

  for (const raw of imageFallbacks) {
    // Explicitly configured image fallbacks should remain reachable even when a
    // model allowlist is present.
    addRaw(raw);
  }

  return candidates;
}

function resolveFallbackCandidates(params: {
  cfg: OpenBotConfig | undefined;
  provider: string;
  model: string;
  /** Optional explicit fallbacks list; when provided (even empty), replaces agents.defaults.model.fallbacks. */
  fallbacksOverride?: string[];
}): ModelCandidate[] {
  const primary = params.cfg
    ? resolveConfiguredModelRef({
        cfg: params.cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      })
    : null;
  const defaultProvider = primary?.provider ?? DEFAULT_PROVIDER;
  const defaultModel = primary?.model ?? DEFAULT_MODEL;
  const providerRaw = String(params.provider ?? "").trim() || defaultProvider;
  const modelRaw = String(params.model ?? "").trim() || defaultModel;
  const normalizedPrimary = normalizeModelRef(providerRaw, modelRaw);
  const configuredPrimary = normalizeModelRef(defaultProvider, defaultModel);
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg ?? {},
    defaultProvider,
  });
  const allowlist = buildConfiguredAllowlistKeys({
    cfg: params.cfg,
    defaultProvider,
  });
  const { candidates, addExplicitCandidate } = createModelCandidateCollector(allowlist);

  addExplicitCandidate(normalizedPrimary);

  const modelFallbacks = (() => {
    if (params.fallbacksOverride !== undefined) {
      return params.fallbacksOverride;
    }
    const configuredFallbacks = resolveAgentModelFallbackValues(
      params.cfg?.agents?.defaults?.model,
    );
    // When user runs a different provider than config, only use configured fallbacks
    // if the current model is already in that chain (e.g. session on first fallback).
    if (normalizedPrimary.provider !== configuredPrimary.provider) {
      const isConfiguredFallback = configuredFallbacks.some((raw) => {
        const resolved = resolveModelRefFromString({
          raw: String(raw ?? ""),
          defaultProvider,
          aliasIndex,
        });
        return resolved ? sameModelCandidate(resolved.ref, normalizedPrimary) : false;
      });
      return isConfiguredFallback ? configuredFallbacks : [];
    }
    // Same provider: always use full fallback chain (model version differences within provider).
    return configuredFallbacks;
  })();

  for (const raw of modelFallbacks) {
    const resolved = resolveModelRefFromString({
      raw: String(raw ?? ""),
      defaultProvider,
      aliasIndex,
    });
    if (!resolved) {
      continue;
    }
    // Fallbacks are explicit user intent; do not silently filter them by the
    // model allowlist.
    addExplicitCandidate(resolved.ref);
  }

  if (params.fallbacksOverride === undefined && primary?.provider && primary.model) {
    addExplicitCandidate({ provider: primary.provider, model: primary.model });
  }

  return candidates;
}

const lastProbeAttempt = new Map<string, number>();
const MIN_PROBE_INTERVAL_MS = 30_000; // 30 seconds between probes per key
const PROBE_MARGIN_MS = 2 * 60 * 1000;
const PROBE_SCOPE_DELIMITER = "::";
const PROBE_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PROBE_KEYS = 256;

function resolveProbeThrottleKey(provider: string, agentDir?: string): string {
  const scope = String(agentDir ?? "").trim();
  return scope ? `${scope}${PROBE_SCOPE_DELIMITER}${provider}` : provider;
}

function pruneProbeState(now: number): void {
  for (const [key, ts] of lastProbeAttempt) {
    if (!Number.isFinite(ts) || ts <= 0 || now - ts > PROBE_STATE_TTL_MS) {
      lastProbeAttempt.delete(key);
    }
  }
}

function enforceProbeStateCap(): void {
  while (lastProbeAttempt.size > MAX_PROBE_KEYS) {
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, ts] of lastProbeAttempt) {
      if (ts < oldestTs) {
        oldestKey = key;
        oldestTs = ts;
      }
    }
    if (!oldestKey) {
      break;
    }
    lastProbeAttempt.delete(oldestKey);
  }
}

function isProbeThrottleOpen(now: number, throttleKey: string): boolean {
  pruneProbeState(now);
  const lastProbe = lastProbeAttempt.get(throttleKey) ?? 0;
  return now - lastProbe >= MIN_PROBE_INTERVAL_MS;
}

function markProbeAttempt(now: number, throttleKey: string): void {
  pruneProbeState(now);
  lastProbeAttempt.set(throttleKey, now);
  enforceProbeStateCap();
}

function shouldProbePrimaryDuringCooldown(params: {
  isPrimary: boolean;
  hasFallbackCandidates: boolean;
  now: number;
  throttleKey: string;
  authStore: ReturnType<typeof ensureAuthProfileStore>;
  profileIds: string[];
}): boolean {
  if (!params.isPrimary || !params.hasFallbackCandidates) {
    return false;
  }

  if (!isProbeThrottleOpen(params.now, params.throttleKey)) {
    return false;
  }

  const soonest = getSoonestCooldownExpiry(params.authStore, params.profileIds);
  if (soonest === null || !Number.isFinite(soonest)) {
    return true;
  }

  // Probe when cooldown already expired or within the configured margin.
  return params.now >= soonest - PROBE_MARGIN_MS;
}

/** @internal – exposed for unit tests only */
export const _probeThrottleInternals = {
  lastProbeAttempt,
  MIN_PROBE_INTERVAL_MS,
  PROBE_MARGIN_MS,
  PROBE_STATE_TTL_MS,
  MAX_PROBE_KEYS,
  resolveProbeThrottleKey,
  isProbeThrottleOpen,
  pruneProbeState,
  markProbeAttempt,
} as const;

type CooldownDecision =
  | {
      type: "skip";
      reason: FailoverReason;
      error: string;
    }
  | {
      type: "attempt";
      reason: FailoverReason;
      markProbe: boolean;
    };

function resolveCooldownDecision(params: {
  candidate: ModelCandidate;
  isPrimary: boolean;
  requestedModel: boolean;
  hasFallbackCandidates: boolean;
  now: number;
  probeThrottleKey: string;
  authStore: ReturnType<typeof ensureAuthProfileStore>;
  profileIds: string[];
}): CooldownDecision {
  const shouldProbe = shouldProbePrimaryDuringCooldown({
    isPrimary: params.isPrimary,
    hasFallbackCandidates: params.hasFallbackCandidates,
    now: params.now,
    throttleKey: params.probeThrottleKey,
    authStore: params.authStore,
    profileIds: params.profileIds,
  });

  const inferredReason =
    resolveProfilesUnavailableReason({
      store: params.authStore,
      profileIds: params.profileIds,
      now: params.now,
    }) ?? "rate_limit";
  const isPersistentAuthIssue = inferredReason === "auth" || inferredReason === "auth_permanent";
  if (isPersistentAuthIssue) {
    return {
      type: "skip",
      reason: inferredReason,
      error: `Provider ${params.candidate.provider} has ${inferredReason} issue (skipping all models)`,
    };
  }

  // Billing is semi-persistent: the user may fix their balance, or a transient
  // 402 might have been misclassified. Probe single-provider setups on the
  // standard throttle so they can recover without a restart; when fallbacks
  // exist, only probe near cooldown expiry so the fallback chain stays preferred.
  if (inferredReason === "billing") {
    const shouldProbeSingleProviderBilling =
      params.isPrimary &&
      !params.hasFallbackCandidates &&
      isProbeThrottleOpen(params.now, params.probeThrottleKey);
    if (params.isPrimary && (shouldProbe || shouldProbeSingleProviderBilling)) {
      return { type: "attempt", reason: inferredReason, markProbe: true };
    }
    return {
      type: "skip",
      reason: inferredReason,
      error: `Provider ${params.candidate.provider} has ${inferredReason} issue (skipping all models)`,
    };
  }

  // For primary: try when requested model or when probe allows.
  // For same-provider fallbacks: only relax cooldown on transient provider
  // limits, which are often model-scoped and can recover on a sibling model.
  const shouldAttemptDespiteCooldown =
    (params.isPrimary && (!params.requestedModel || shouldProbe)) ||
    (!params.isPrimary && (inferredReason === "rate_limit" || inferredReason === "overloaded"));
  if (!shouldAttemptDespiteCooldown) {
    return {
      type: "skip",
      reason: inferredReason,
      error: `Provider ${params.candidate.provider} is in cooldown (all profiles unavailable)`,
    };
  }

  return {
    type: "attempt",
    reason: inferredReason,
    markProbe: params.isPrimary && shouldProbe,
  };
}

/** 员工端 MODEL_ENTITLEMENT_EMPTY 对用户展示的默认中文提示（design §8.2 / Property 3）。 */
export const MODEL_ENTITLEMENT_EMPTY_USER_MESSAGE =
  "当前暂无可用 AI 模型。请联系企业管理员在「席位与权限」完成模型授权。";

/** 运行时 entitlement 解析摘要，用于生成更具体的员工端提示（不含 tenantId / allowedModelIds 等内部字段）。 */
export type ModelEntitlementEmptyHint = {
  /** 协作群 bot 回合：模型授权归属群 owner 席位。 */
  isCollaborationGroupOwner?: boolean;
  /** 群 owner 或当前员工的可读标识（通常为邮箱）。 */
  ownerLabel?: string;
  /** resolveEffectiveModelSet 的 reason（内部诊断，不直接展示）。 */
  effectiveReason?: string;
  /** 企业 entitlement 中配置的模型数量。 */
  enterpriseModelCount?: number;
  /** 企业是否已绑定计费套餐版本。 */
  hasSubscription?: boolean;
  /** 席位商业档位过滤后 allowlist 为空。 */
  tierProfileFilteredEmpty?: boolean;
  /** 生效的席位商业档位 id（basic_ai / pro_ai / elite_ai / premier_ai）。 */
  seatEntitlementProfileId?: string;
};

/** 按 entitlement 断点生成员工可读提示，避免暴露 tenantId / allowedModelIds 等内部术语。 */
export function buildModelEntitlementEmptyUserMessage(hint?: ModelEntitlementEmptyHint): string {
  // 无运行时摘要时不要猜「企业套餐未配置」——缺 hint 时 enterpriseModelCount 默认 0 会误伤。
  if (!hint) {
    return MODEL_ENTITLEMENT_EMPTY_USER_MESSAGE;
  }
  const ownerSuffix = hint.ownerLabel?.trim() ? `（${hint.ownerLabel.trim()}）` : "";
  const groupLead = hint.isCollaborationGroupOwner
    ? `协作群 AI 需使用群主席位${ownerSuffix}上的模型授权。`
    : "";
  const reason = hint.effectiveReason?.trim() ?? "";
  const enterpriseModelCount = hint.enterpriseModelCount ?? 0;

  // 具体 reason 优先；勿因 count 默认 0 盖过「无席位 grant」等更准确断点。
  if (reason === "no active seat/employee grant") {
    return (
      groupLead +
      (hint.isCollaborationGroupOwner
        ? "该席位尚未同步模型授权。请联系企业管理员在「席位与权限」点击「同步全部席位授权」。"
        : "当前席位尚未同步模型授权。请联系企业管理员在「席位与权限」为您分配席位，并点击「同步全部席位授权」。")
    );
  }

  if (reason === "no entitled model is active in platform catalog") {
    return "企业已授权的模型在当前环境中不可用。请联系企业管理员或平台运维检查套餐模型配置。";
  }

  if (reason === "seat grant does not intersect enterprise entitlement") {
    return "当前席位的模型授权与企业套餐不一致。请联系企业管理员在「席位与权限」重新同步席位授权。";
  }

  if (hint.tierProfileFilteredEmpty) {
    const profileLabel =
      hint.seatEntitlementProfileId === "premier_ai"
        ? "旗舰 AI"
        : hint.seatEntitlementProfileId === "elite_ai"
          ? "高级 AI"
          : hint.seatEntitlementProfileId === "pro_ai"
            ? "专业 AI"
            : hint.seatEntitlementProfileId === "basic_ai"
              ? "基础 AI"
              : "当前";
    return (
      groupLead +
      `已分配模型与${profileLabel}档位不兼容（模型 tier 超出席位允许范围）。请联系企业管理员在「席位与权限」调整席位 AI 档位，或重新分配兼容的模型授权。`
    );
  }

  if (reason === "enterprise entitlement is empty" || enterpriseModelCount === 0) {
    if (hint.hasSubscription === false) {
      return (
        groupLead +
        "当前企业尚未订阅套餐或未开通模型权益。请联系企业管理员前往「套餐与订阅」完成订阅，再在「席位与权限」分配席位并同步授权。"
      );
    }
    return (
      groupLead +
      "企业套餐尚未配置可用模型。请联系企业管理员在「套餐与订阅」确认套餐权益，并在「席位与权限」完成席位模型授权。"
    );
  }

  if (hint.isCollaborationGroupOwner) {
    return groupLead + "当前群主席位暂无可用模型。请联系企业管理员在「席位与权限」完成模型授权。";
  }

  return MODEL_ENTITLEMENT_EMPTY_USER_MESSAGE;
}

export class ModelEntitlementEmptyError extends Error {
  code = "MODEL_ENTITLEMENT_EMPTY" as const;
  constructor(message = "No model is authorized for this employee/seat.") {
    super(message);
    this.name = "ModelEntitlementEmptyError";
  }
}

export function isModelEntitlementEmptyError(err: unknown): err is ModelEntitlementEmptyError {
  if (err instanceof ModelEntitlementEmptyError) {
    return true;
  }
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "MODEL_ENTITLEMENT_EMPTY"
  );
}

export async function runWithModelFallback<T>(params: {
  cfg: OpenBotConfig | undefined;
  provider: string;
  model: string;
  runId?: string;
  agentDir?: string;
  /**
   * When set, each fallback candidate gets its own callId before `run`.
   * Omitted means no extra evidence collection.
   */
  executorEvidence?: ExecutorEvidenceContext | null;
  /** Optional explicit fallbacks list; when provided (even empty), replaces agents.defaults.model.fallbacks. */
  fallbacksOverride?: string[];
  /**
   * Entitlement hard-deny allowlist（model-entitlement-chain P1）。
   * 当**已定义**（即使为空数组）时，候选会被 `applyEntitlementHardDeny` 硬过滤；
   * 过滤后为空 → 抛 `ModelEntitlementEmptyError`，**不发起任何 LLM 调用**。
   * `undefined` 表示不强制（非 employee 会话 / 灰度放行 / enforce=off）。
   */
  entitlementAllowlist?: string[];
  /**
   * AOR 选路偏好顺序（model-entitlement-chain P3）。
   * 仅在 `aor_enhanced` 下由 AOR selector 给出；对**已通过 hard-deny 的候选**做
   * 「保集合重排」——命中顺序者前置，其余保持相对次序。**不增删候选**（Property 4），
   * 因此与 `native` 的候选集合恒等，仅 primary/fallback 顺序不同。
   */
  preferredModelOrder?: string[];
  /**
   * Governance mode (governance closure plan v1.0 §4.3 / ADR-6, PR-1a).
   * - `undefined`: today's behavior — a defined `entitlementAllowlist` hard-filters.
   *   Callers that have not been migrated yet stay here (registered-gap).
   * - `legacy`: records `skipped` + `legacy` (never `allow`). Does not filter, except that
   *   `allowlistEnforcement: "preexisting"` with an allowlist array keeps its hard filter
   *   (P3-2 rework). Without an allowlist nothing is filtered.
   * - `shadow`: computes the would-deny against `entitlementAllowlist` and records it.
   *   With default `allowlistEnforcement: "governance-mode"`, does NOT filter candidates.
   *   With `allowlistEnforcement: "preexisting"`, still hard-filters (P3-1 embedded paths).
   * - `enforced`: filters like `undefined` and records the decision.
   */
  governanceMode?: GovernanceMode;
  /** Trusted host policy for metadata-only inference; never request-controlled. */
  authStoreReadOnly?: boolean;

  /**
   * Controls when an allowlist hard-filters candidates (P3-1).
   * - `governance-mode` (default): filter only when `governanceMode === "enforced"`.
   * - `preexisting`: hard-filter whenever allowlist is an array (incl. empty), matching
   *   the pre-migration behavior of auto-reply / followup / cron-isolated. Not a mode.
   *   Applies under every explicit mode, including `legacy` (P3-2 rework): a configured
   *   legacy mode is not a rollback of this filter.
   * Ignored when `governanceMode` is `undefined` (that path hard-filters on its own).
   */
  allowlistEnforcement?: AllowlistEnforcement;
  /**
   * Reason when no allowlist is supplied under an explicit mode.
   * Text callers default to `enterprise-scope-without-allowlist`; memory flush
   * passes `parent-model-set-absent` when the parent snapshot is missing.
   */
  absentAllowlistReason?: string;
  /** Correlation fields for the model-entitlement envelope (ids only, no credentials). */
  governanceContext?: ModelGovernanceContext;
  /**
   * Platform capability admission. Omitted fields still consult the catalog and
   * admission store. Personal / enterprise BYOK ids are not platform-scoped.
   * Excluded platform models are removed before any run, including pin and fallback.
   */
  runtimeAdmission?: RuntimeAdmissionInput;
  run: ModelFallbackRunFn<T>;
  onError?: ModelFallbackErrorHandler;
}): Promise<ModelFallbackRunResult<T>> {
  // Always start from session/config candidates. preferredModelOrder is a
  // within-set reorder only (Property 4) — never replace the candidate list,
  // or session-pinned ent/* BYOK models disappear whenever AOR only ranks
  // platform catalog ids.
  let candidates = resolveFallbackCandidates({
    cfg: params.cfg,
    provider: params.provider,
    model: params.model,
    fallbacksOverride: params.fallbacksOverride,
  });
  const requestedKey = modelKey(params.provider, params.model);
  const requestedIsEnterprise = isEnterpriseRuntimeModelId(requestedKey);
  // An allowlist that contains only ent/* ids is a catalog substitute, not a
  // configured primary. Do not append those ids or hard-filter the agent
  // primary (for example deepseek) down to them.
  const enterpriseSubstituteOnly =
    !requestedIsEnterprise && allowlistIsEnterpriseCatalogOnly(params.entitlementAllowlist);
  // Only when the allowlist will actually hard-filter. Shadow-only mode must
  // keep today's session candidate and must not switch the run onto BYOK.
  // Append granted ent/* models only when this turn already selected one.
  if (entitlementFilterWillApply(params) && requestedIsEnterprise && !enterpriseSubstituteOnly) {
    candidates = appendGrantedEnterpriseCandidates(candidates, params.entitlementAllowlist);
  }
  if (params.governanceMode === undefined) {
    if (params.entitlementAllowlist !== undefined && !enterpriseSubstituteOnly) {
      candidates = applyEntitlementHardDeny(candidates, params.entitlementAllowlist);
      if (candidates.length === 0) {
        // Resolved entitlement with no authorized candidate → hard deny, zero out-of-network.
        throw new ModelEntitlementEmptyError();
      }
    }
  } else {
    const enforcement = params.allowlistEnforcement ?? "governance-mode";
    // The hard-filter result exists whenever the allowlist is an array, under any
    // explicit mode (P3-2 rework: legacy included). Whether it applies is decided below.
    const filtered =
      Array.isArray(params.entitlementAllowlist) && !enterpriseSubstituteOnly
        ? applyEntitlementHardDeny(candidates, params.entitlementAllowlist)
        : undefined;
    // Preexisting: keep the hard-filter these paths already applied before explicit mode,
    // in every mode including legacy. governance-mode: only `enforced` applies the filter;
    // `shadow` and `legacy` record only. The legacy envelope stays `skipped`.
    const applyFilter =
      filtered !== undefined &&
      (enforcement === "preexisting" || params.governanceMode === "enforced");
    recordModelGovernanceDecision({
      mode: params.governanceMode,
      before: candidates,
      after: filtered,
      filterApplied: applyFilter,
      runId: params.runId,
      context: params.governanceContext,
      isCliBackend: (candidate) => isCliProvider(candidate.provider, params.cfg),
      ...(params.absentAllowlistReason
        ? { absentAllowlistReason: params.absentAllowlistReason }
        : {}),
    });
    if (applyFilter) {
      candidates = filtered;
      if (candidates.length === 0) {
        throw new ModelEntitlementEmptyError();
      }
    }
  }
  if (params.preferredModelOrder && params.preferredModelOrder.length > 0) {
    candidates = applyPreferredModelOrder(candidates, params.preferredModelOrder);
  }
  // The model this turn already selected stays first. A preferred order must
  // not move an enterprise catalog id ahead of a configured platform primary.
  const requestedIdx = candidates.findIndex(
    (candidate) => modelKey(candidate.provider, candidate.model) === requestedKey,
  );
  if (requestedIdx > 0) {
    const [requested] = candidates.splice(requestedIdx, 1);
    candidates.unshift(requested);
  }
  const admission = await filterModelCandidatesByPlatformAdmission({
    candidates,
    runtime: params.runtimeAdmission,
  });
  if (admission.engaged && admission.decision) {
    candidates = admission.candidates;
    if (candidates.length === 0) {
      throw new PlatformAdmissionEmptyError(admission.decision);
    }
  }
  const authStore = params.cfg
    ? params.authStoreReadOnly
      ? loadAuthProfileStoreForSecretsRuntime(params.agentDir)
      : ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false })
    : null;
  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;
  const cooldownProbeUsedProviders = new Set<string>();

  const hasFallbackCandidates = candidates.length > 1;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const isPrimary = i === 0;
    const requestedModel =
      params.provider === candidate.provider && params.model === candidate.model;
    let runOptions: ModelFallbackRunOptions | undefined;
    let attemptedDuringCooldown = false;
    let transientProbeProviderForAttempt: string | null = null;
    if (authStore) {
      const profileIds = resolveAuthProfileOrder({
        cfg: params.cfg,
        store: authStore,
        provider: candidate.provider,
      });
      const isAnyProfileAvailable = profileIds.some((id) => !isProfileInCooldown(authStore, id));

      if (profileIds.length > 0 && !isAnyProfileAvailable) {
        // All profiles for this provider are in cooldown.
        const now = Date.now();
        const probeThrottleKey = resolveProbeThrottleKey(candidate.provider, params.agentDir);
        const decision = resolveCooldownDecision({
          candidate,
          isPrimary,
          requestedModel,
          hasFallbackCandidates,
          now,
          probeThrottleKey,
          authStore,
          profileIds,
        });

        if (decision.type === "skip") {
          attempts.push({
            provider: candidate.provider,
            model: candidate.model,
            error: decision.error,
            reason: decision.reason,
          });
          logModelFallbackDecision({
            decision: "skip_candidate",
            runId: params.runId,
            requestedProvider: params.provider,
            requestedModel: params.model,
            candidate,
            attempt: i + 1,
            total: candidates.length,
            reason: decision.reason,
            error: decision.error,
            nextCandidate: candidates[i + 1],
            isPrimary,
            requestedModelMatched: requestedModel,
            fallbackConfigured: hasFallbackCandidates,
            profileCount: profileIds.length,
          });
          continue;
        }

        if (decision.markProbe) {
          markProbeAttempt(now, probeThrottleKey);
        }
        if (
          decision.reason === "rate_limit" ||
          decision.reason === "overloaded" ||
          decision.reason === "billing"
        ) {
          // Probe at most once per provider per fallback run when all profiles
          // are cooldowned. Re-probing every same-provider candidate can stall
          // cross-provider fallback on providers with long internal retries.
          const isTransientCooldownReason =
            decision.reason === "rate_limit" || decision.reason === "overloaded";
          if (isTransientCooldownReason && cooldownProbeUsedProviders.has(candidate.provider)) {
            const error = `Provider ${candidate.provider} is in cooldown (probe already attempted this run)`;
            attempts.push({
              provider: candidate.provider,
              model: candidate.model,
              error,
              reason: decision.reason,
            });
            logModelFallbackDecision({
              decision: "skip_candidate",
              runId: params.runId,
              requestedProvider: params.provider,
              requestedModel: params.model,
              candidate,
              attempt: i + 1,
              total: candidates.length,
              reason: decision.reason,
              error,
              nextCandidate: candidates[i + 1],
              isPrimary,
              requestedModelMatched: requestedModel,
              fallbackConfigured: hasFallbackCandidates,
              profileCount: profileIds.length,
            });
            continue;
          }
          runOptions = { allowTransientCooldownProbe: true };
          if (isTransientCooldownReason) {
            transientProbeProviderForAttempt = candidate.provider;
          }
        }
        attemptedDuringCooldown = true;
        logModelFallbackDecision({
          decision: "probe_cooldown_candidate",
          runId: params.runId,
          requestedProvider: params.provider,
          requestedModel: params.model,
          candidate,
          attempt: i + 1,
          total: candidates.length,
          reason: decision.reason,
          nextCandidate: candidates[i + 1],
          isPrimary,
          requestedModelMatched: requestedModel,
          fallbackConfigured: hasFallbackCandidates,
          allowTransientCooldownProbe: runOptions?.allowTransientCooldownProbe,
          profileCount: profileIds.length,
        });
      }
    }

    const attemptRun = await runFallbackAttempt({
      run: params.run,
      ...candidate,
      attempts,
      options: runOptions,
      evidence: params.executorEvidence,
      attemptIndex: i,
    });
    if ("success" in attemptRun) {
      if (i > 0 || attempts.length > 0 || attemptedDuringCooldown) {
        logModelFallbackDecision({
          decision: "candidate_succeeded",
          runId: params.runId,
          requestedProvider: params.provider,
          requestedModel: params.model,
          candidate,
          attempt: i + 1,
          total: candidates.length,
          previousAttempts: attempts,
          isPrimary,
          requestedModelMatched: requestedModel,
          fallbackConfigured: hasFallbackCandidates,
        });
      }
      const notFoundAttempt =
        i > 0 ? attempts.find((a) => a.reason === "model_not_found") : undefined;
      if (notFoundAttempt) {
        log.warn(
          `Model "${sanitizeForLog(notFoundAttempt.provider)}/${sanitizeForLog(notFoundAttempt.model)}" not found. Fell back to "${sanitizeForLog(candidate.provider)}/${sanitizeForLog(candidate.model)}".`,
        );
      }
      return attemptRun.success;
    }
    const err = attemptRun.error;
    {
      if (transientProbeProviderForAttempt) {
        const probeFailureReason = describeFailoverError(err).reason;
        const shouldPreserveTransientProbeSlot =
          probeFailureReason === "model_not_found" ||
          probeFailureReason === "format" ||
          probeFailureReason === "auth" ||
          probeFailureReason === "auth_permanent" ||
          probeFailureReason === "session_expired";
        if (!shouldPreserveTransientProbeSlot) {
          cooldownProbeUsedProviders.add(transientProbeProviderForAttempt);
        }
      }
      // Context overflow errors should be handled by the inner runner's
      // compaction/retry logic, not by model fallback.  If one escapes as a
      // throw, rethrow it immediately rather than trying a different model
      // that may have a smaller context window and fail worse.
      const errMessage = err instanceof Error ? err.message : String(err);
      if (isLikelyContextOverflowError(errMessage)) {
        throw err;
      }
      // Sandbox / 云电脑 create failures are infra, not per-model. Fail overing
      // only burns another candidate (and another create) and wraps the honest
      // 云电脑 notice as "All models failed".
      if (isSandboxInfraPreReplyError(errMessage) || isSandboxAccountIdentityError(err)) {
        throw err;
      }
      const normalized =
        coerceToFailoverError(err, {
          provider: candidate.provider,
          model: candidate.model,
        }) ?? err;

      // Even unrecognized errors should not abort the fallback loop when
      // there are remaining candidates.  Only abort/context-overflow errors
      // (handled above) are truly non-retryable.
      const isKnownFailover = isFailoverError(normalized);
      if (!isKnownFailover && i === candidates.length - 1) {
        throw err;
      }

      lastError = isKnownFailover ? normalized : err;
      const described = describeFailoverError(normalized);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: described.message,
        reason: described.reason ?? "unknown",
        status: described.status,
        code: described.code,
      });
      logModelFallbackDecision({
        decision: "candidate_failed",
        runId: params.runId,
        requestedProvider: params.provider,
        requestedModel: params.model,
        candidate,
        attempt: i + 1,
        total: candidates.length,
        reason: described.reason,
        status: described.status,
        code: described.code,
        error: described.message,
        nextCandidate: candidates[i + 1],
        isPrimary,
        requestedModelMatched: requestedModel,
        fallbackConfigured: hasFallbackCandidates,
      });
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: isKnownFailover ? normalized : err,
        attempt: i + 1,
        total: candidates.length,
      });
    }
  }

  throwFallbackFailureSummary({
    attempts,
    candidates,
    lastError,
    label: "models",
    formatAttempt: (attempt) =>
      `${attempt.provider}/${attempt.model}: ${attempt.error}${
        attempt.reason ? ` (${attempt.reason})` : ""
      }`,
  });
}

export async function runWithImageModelFallback<T>(params: {
  cfg: OpenBotConfig | undefined;
  modelOverride?: string;
  /**
   * Image entitlement allowlist (plan v1.0 PR-1c). `undefined` does not filter.
   * A defined list is applied only when `governanceMode` is `enforced`.
   */
  entitlementAllowlist?: string[];
  /**
   * Same modes as text fallback. `shadow` records would-deny and still runs
   * today's candidates. Default for image callers is shadow via
   * `OPENBOT_GOVERNANCE_IMAGE_MODEL_MODE`.
   */
  governanceMode?: GovernanceMode;

  governanceContext?: ModelGovernanceContext;
  runId?: string;
  /** Same platform admission input as text fallback. Role stays orchestrator. */
  runtimeAdmission?: RuntimeAdmissionInput;
  run: (provider: string, model: string) => Promise<T>;
  onError?: ModelFallbackErrorHandler;
}): Promise<ModelFallbackRunResult<T>> {
  let candidates = resolveImageFallbackCandidates({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    modelOverride: params.modelOverride,
  });
  if (candidates.length === 0) {
    throw new Error(
      "No image model configured. Set agents.defaults.imageModel.primary or agents.defaults.imageModel.fallbacks.",
    );
  }
  if (params.governanceMode !== undefined) {
    const filtered =
      params.governanceMode !== "legacy" && params.entitlementAllowlist !== undefined
        ? applyEntitlementHardDeny(candidates, params.entitlementAllowlist)
        : undefined;
    recordModelGovernanceDecision({
      mode: params.governanceMode,
      before: candidates,
      after: filtered,
      runId: params.runId,
      // Image / PDF fallback is E10 by definition (its only callers are those tools).
      context: { ...params.governanceContext, entry: "E10" },
      isCliBackend: (candidate) => isCliProvider(candidate.provider, params.cfg),
      absentAllowlistReason: "parent-model-set-absent",
    });
    if (params.governanceMode === "enforced" && filtered !== undefined) {
      candidates = filtered;
      if (candidates.length === 0) {
        throw new ModelEntitlementEmptyError();
      }
    }
  }
  const imageAdmission = await filterModelCandidatesByPlatformAdmission({
    candidates,
    runtime: params.runtimeAdmission,
  });
  if (imageAdmission.engaged && imageAdmission.decision) {
    candidates = imageAdmission.candidates;
    if (candidates.length === 0) {
      throw new PlatformAdmissionEmptyError(imageAdmission.decision);
    }
  }

  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const attemptRun = await runFallbackAttempt({
      run: params.run,
      ...candidate,
      attempts,
      attemptIndex: i,
    });
    if ("success" in attemptRun) {
      return attemptRun.success;
    }
    {
      const err = attemptRun.error;
      lastError = err;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: err instanceof Error ? err.message : String(err),
      });
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: err,
        attempt: i + 1,
        total: candidates.length,
      });
    }
  }

  throwFallbackFailureSummary({
    attempts,
    candidates,
    lastError,
    label: "image models",
    formatAttempt: (attempt) => `${attempt.provider}/${attempt.model}: ${attempt.error}`,
  });
}
