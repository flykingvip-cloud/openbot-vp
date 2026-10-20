/**
 * Operator-facing RPCs for evolution-runtime-closure governance state.
 *
 * Tenant operators (operator.approvals): object-scoped act on their agents only.
 * Platform admins (operator.admin): global kill-switch / config / skill-auto pass;
 * full snapshot when reading.
 */

import {
  applyGovernanceRuntimeAction,
  cancelSkillAutoInstallJob,
  configureEffectVerifyMs,
  DEFAULT_EFFECT_VERIFY_MS,
  enrollSkillAutoInstall,
  getEvolutionGovernanceMode,
  getEvolutionGovernanceSchedulerConfig,
  isGovernanceKillSwitchActive,
  isSkillAutoEvolutionEnabled,
  readGovernancePersistedState,
  runSkillAutoEvolutionPass,
  setGovernanceKillSwitch,
  writeGovernancePersistedState,
  type GovernancePersistedState,
} from "../evolution-governance/index.js";
import { getPatternCandidate } from "../pattern-detection/index.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { readAttributionStats } from "../skill-invocation/index.js";
import {
  assertClientMayAccessAgentDetailed,
  assertClientMayAccessCandidate,
  assertClientMayGovernRedirect,
  assertClientMayGovernRuntimeAgent,
  isRuntimeAgentInTenant,
  isRuntimeAgentUniqueOwnerForTenant,
  requireAuthenticatedOperatorPrincipal,
  requirePlatformGovernanceAdmin,
  resolveCallerGovernanceTenant,
} from "./operator-access.js";
import { optionalString, requiredString } from "./request-params.js";
import type { GatewayRequestHandlers } from "./types.js";

function humanResumeAgent(params: { runtimeAgentId: string; reason?: string }): {
  ok: boolean;
  reason?: string;
  affectedBindingIds: string[];
  closedEffects: number;
} {
  const runtimeAgentId = params.runtimeAgentId.trim();
  const result = applyGovernanceRuntimeAction({
    runtimeAgentId,
    action: "resume",
    reason: params.reason ?? "human-resume",
    idempotencyKey: `human-resume:${runtimeAgentId}:${Date.now()}`,
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, affectedBindingIds: [], closedEffects: 0 };
  }
  const state = readGovernancePersistedState();
  const effects = state.effectVerifications ?? [];
  let closed = 0;
  const now = new Date().toISOString();
  const nextEffects = effects.map((e) => {
    if (e.runtimeAgentId === runtimeAgentId && e.status === "open") {
      closed += 1;
      return {
        ...e,
        status: "resumed" as const,
        closedAt: now,
        outcomeNote: params.reason ?? "human-resume",
      };
    }
    return e;
  });
  writeGovernancePersistedState({
    ...state,
    effectVerifications: nextEffects,
  });
  return {
    ok: true,
    affectedBindingIds: result.affectedBindingIds,
    closedEffects: closed,
  };
}

function humanHoldAgent(params: { runtimeAgentId: string; reason?: string }): {
  ok: boolean;
  closedEffects: number;
} {
  const runtimeAgentId = params.runtimeAgentId.trim();
  const state = readGovernancePersistedState();
  const effects = state.effectVerifications ?? [];
  let closed = 0;
  const now = new Date().toISOString();
  const nextEffects = effects.map((e) => {
    if (e.runtimeAgentId === runtimeAgentId && e.status === "open") {
      closed += 1;
      return {
        ...e,
        status: "held" as const,
        closedAt: now,
        outcomeNote: params.reason ?? "human-hold",
      };
    }
    return e;
  });
  writeGovernancePersistedState({
    ...state,
    effectVerifications: nextEffects,
  });
  return { ok: true, closedEffects: closed };
}

async function filterAgentIdSet(
  agentIds: Iterable<string>,
  tenantId: string,
): Promise<Set<string>> {
  const allowed = new Set<string>();
  for (const id of agentIds) {
    if (await isRuntimeAgentInTenant(id, tenantId)) {
      allowed.add(id);
    }
  }
  return allowed;
}

/**
 * Tenant-scope a governance snapshot. Platform admin (tenantId=null) sees all.
 */
async function scopeGovernanceStateForCaller(
  state: GovernancePersistedState,
  tenantId: string | null,
): Promise<{
  assets: unknown[];
  anomalies: unknown[];
  actions: unknown[];
  metrics: unknown[];
  effectVerifications: unknown[];
  limits: Record<string, unknown>;
  redirects: Record<string, unknown>;
  skillAutoJobs: Record<string, unknown>;
}> {
  if (!tenantId) {
    return {
      assets: state.assets,
      anomalies: state.anomalies,
      actions: state.actions,
      metrics: state.metrics,
      effectVerifications: state.effectVerifications ?? [],
      limits: state.limits ?? {},
      redirects: state.redirects ?? {},
      skillAutoJobs: (state.skillAutoJobs ?? {}) as Record<string, unknown>,
    };
  }

  const effects = state.effectVerifications ?? [];
  const limitKeys = Object.keys(state.limits ?? {});
  const redirectKeys = Object.keys(state.redirects ?? {});
  const effectAgentIds = effects.map((e) => e.runtimeAgentId).filter(Boolean);
  const assetAgentIds = (state.assets as Array<{ runtimeAgentId?: string }>)
    .map((a) => a.runtimeAgentId)
    .filter((id): id is string => Boolean(id));
  const metricAgentIds = (state.metrics as Array<{ runtimeAgentId?: string }>)
    .map((m) => m.runtimeAgentId)
    .filter((id): id is string => Boolean(id));
  const actionAgentIds = (state.actions as Array<{ runtimeAgentId?: string }>)
    .map((a) => a.runtimeAgentId)
    .filter((id): id is string => Boolean(id));
  const anomalyAssetIds = (
    state.anomalies as Array<{ assetId?: string; runtimeAgentId?: string }>
  ).flatMap(
    (a) => [a.runtimeAgentId, a.assetId?.replace(/^asset:bot:/, "")].filter(Boolean) as string[],
  );

  const candidateIds = new Set([
    ...limitKeys,
    ...redirectKeys,
    ...effectAgentIds,
    ...assetAgentIds,
    ...metricAgentIds,
    ...actionAgentIds,
    ...anomalyAssetIds,
  ]);
  const visible = await filterAgentIdSet(candidateIds, tenantId);

  const assets = (state.assets as Array<{ runtimeAgentId?: string }>).filter(
    (a) => a.runtimeAgentId && visible.has(a.runtimeAgentId),
  );
  const metrics = (state.metrics as Array<{ runtimeAgentId?: string }>).filter(
    (m) => m.runtimeAgentId && visible.has(m.runtimeAgentId),
  );
  const actions = (state.actions as Array<{ runtimeAgentId?: string }>).filter(
    (a) => a.runtimeAgentId && visible.has(a.runtimeAgentId),
  );
  const anomalies = (
    state.anomalies as Array<{ assetId?: string; runtimeAgentId?: string }>
  ).filter((a) => {
    if (a.runtimeAgentId && visible.has(a.runtimeAgentId)) {
      return true;
    }
    const fromAsset = a.assetId?.replace(/^asset:bot:/, "");
    return Boolean(fromAsset && visible.has(fromAsset));
  });
  const effectVerifications = effects.filter((e) => visible.has(e.runtimeAgentId));

  const limits: Record<string, unknown> = {};
  for (const [id, rec] of Object.entries(state.limits ?? {})) {
    if (visible.has(id)) {
      limits[id] = rec;
    }
  }
  const redirects: Record<string, unknown> = {};
  for (const [id, rec] of Object.entries(state.redirects ?? {})) {
    if (visible.has(id)) {
      redirects[id] = rec;
    }
  }

  // Jobs with authority tenantId: exact match only (no shared-agent fallback).
  // Legacy jobs missing tenantId: fail-closed (omit from tenant snapshot).
  const skillAutoJobs: Record<string, unknown> = {};
  for (const [id, job] of Object.entries(state.skillAutoJobs ?? {})) {
    const j = job as { tenantId?: string | null };
    if (typeof j.tenantId === "string" && j.tenantId.trim() === tenantId) {
      skillAutoJobs[id] = job;
    }
  }

  return {
    assets,
    anomalies,
    actions,
    metrics,
    effectVerifications,
    limits,
    redirects,
    skillAutoJobs,
  };
}

export const evolutionGovernanceHandlers: GatewayRequestHandlers = {
  /** Read-only snapshot — tenant-scoped unless platform admin. */
  "evolution-governance.snapshot": async ({ respond, client }) => {
    const caller = await resolveCallerGovernanceTenant(client, { platformAdminSeesAll: true });
    if (client && !caller.isPlatformAdmin && !caller.tenantId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenant membership required"),
      );
      return;
    }
    const state = readGovernancePersistedState();
    const scoped = await scopeGovernanceStateForCaller(state, caller.tenantId);
    const isTenantScoped = Boolean(caller.tenantId);
    const sharedAgentWriteDenied: string[] = [];
    if (isTenantScoped && caller.tenantId) {
      const candidateAgentIds = new Set([
        ...Object.keys(scoped.limits),
        ...Object.keys(scoped.redirects),
        ...(scoped.effectVerifications as Array<{ runtimeAgentId?: string }>)
          .map((e) => e.runtimeAgentId)
          .filter((id): id is string => Boolean(id)),
      ]);
      for (const agentId of candidateAgentIds) {
        if (!(await isRuntimeAgentUniqueOwnerForTenant(agentId, caller.tenantId))) {
          sharedAgentWriteDenied.push(agentId);
        }
      }
      sharedAgentWriteDenied.sort();
    }
    // Platform admin: full global metadata. Tenant operators: no global attribution /
    // jobCursor / scheduler (cross-tenant leakage); mode/killSwitch are coarse flags only.
    respond(
      true,
      {
        killSwitch: isGovernanceKillSwitchActive(),
        mode: getEvolutionGovernanceMode(),
        skillAutoEvolution: isSkillAutoEvolutionEnabled(),
        skillAutoJobs: scoped.skillAutoJobs,
        jobCursor: isTenantScoped ? null : state.jobCursor,
        assets: scoped.assets,
        anomalies: scoped.anomalies,
        actions: scoped.actions,
        metrics: scoped.metrics,
        effectVerifications: scoped.effectVerifications,
        limits: scoped.limits,
        redirects: scoped.redirects,
        /** Co-owned agents visible in this tenant snapshot but not writable without platform admin. */
        sharedAgentWriteDenied: isTenantScoped ? sharedAgentWriteDenied : [],
        scheduler: isTenantScoped ? null : getEvolutionGovernanceSchedulerConfig(),
        effectVerifyMsDefault: isTenantScoped ? null : DEFAULT_EFFECT_VERIFY_MS,
        attribution: isTenantScoped ? null : readAttributionStats(),
        updatedAt: state.updatedAt,
        scopeTenantId: caller.tenantId,
      },
      undefined,
    );
  },

  "evolution-governance.list-effects": async ({ params, respond, client }) => {
    const caller = await resolveCallerGovernanceTenant(client, { platformAdminSeesAll: true });
    if (client && !caller.isPlatformAdmin && !caller.tenantId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenant membership required"),
      );
      return;
    }
    const status = optionalString(params, "status");
    const agentId = optionalString(params, "runtimeAgentId");
    // Read path: membership∩ownership is enough (shared multi-tenant agents are visible).
    // Write path uses assertClientMayGovernRuntimeAgent (unique ownership only).
    if (agentId && client && !caller.isPlatformAdmin) {
      const ok = await assertClientMayAccessAgentDetailed(client, agentId, respond);
      if (!ok) {
        return;
      }
    }
    let effects = readGovernancePersistedState().effectVerifications ?? [];
    if (caller.tenantId) {
      const scoped = await scopeGovernanceStateForCaller(
        readGovernancePersistedState(),
        caller.tenantId,
      );
      effects = scoped.effectVerifications as typeof effects;
    }
    effects = effects.filter((e) => {
      if (status && e.status !== status) {
        return false;
      }
      if (agentId && e.runtimeAgentId !== agentId) {
        return false;
      }
      return true;
    });
    respond(true, { effects }, undefined);
  },

  /**
   * Pending human approvals queue — tenant-filtered.
   */
  "evolution-governance.pending-approvals": async ({ respond, client }) => {
    const caller = await resolveCallerGovernanceTenant(client, { platformAdminSeesAll: true });
    if (client && !caller.isPlatformAdmin && !caller.tenantId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenant membership required"),
      );
      return;
    }
    const state = readGovernancePersistedState();
    const scoped = await scopeGovernanceStateForCaller(state, caller.tenantId);
    const openEffects = (scoped.effectVerifications as Array<Record<string, unknown>>).filter(
      (e) => e.status === "open",
    );
    const limits = scoped.limits;
    const redirects = scoped.redirects;
    const asStr = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
    const canGovernCache = new Map<string, boolean>();
    const resolveCanGovern = async (runtimeAgentId: string): Promise<boolean> => {
      if (caller.isPlatformAdmin) {
        return true;
      }
      if (!caller.tenantId) {
        return false;
      }
      const cached = canGovernCache.get(runtimeAgentId);
      if (cached !== undefined) {
        return cached;
      }
      const ok = await isRuntimeAgentUniqueOwnerForTenant(runtimeAgentId, caller.tenantId);
      canGovernCache.set(runtimeAgentId, ok);
      return ok;
    };

    const effectItems = await Promise.all(
      openEffects.map(async (e) => {
        const runtimeAgentId = asStr(e.runtimeAgentId);
        const canGovern = await resolveCanGovern(runtimeAgentId);
        const reason = asStr(e.reason);
        const writeActions = reason.startsWith("limit:")
          ? (["human-resume", "human-hold", "clear-limit"] as const)
          : (["human-resume", "human-hold"] as const);
        return {
          kind: "effect" as const,
          id: asStr(e.id),
          runtimeAgentId,
          reason,
          verifyAfterAt: typeof e.verifyAfterAt === "string" ? e.verifyAfterAt : null,
          // Shared multi-tenant agents: visible to co-owners, writable only by platform admin.
          requiresPlatformAdmin: !canGovern,
          actions: canGovern ? [...writeActions] : ([] as string[]),
        };
      }),
    );
    const limitItems = await Promise.all(
      Object.entries(limits).map(async ([runtimeAgentId, rec]) => {
        const canGovern = await resolveCanGovern(runtimeAgentId);
        return {
          kind: "limit" as const,
          id: `limit:${runtimeAgentId}`,
          runtimeAgentId,
          reason: (rec as { reason?: string })?.reason ?? "limit",
          verifyAfterAt: null as string | null,
          requiresPlatformAdmin: !canGovern,
          actions: canGovern ? (["clear-limit"] as string[]) : ([] as string[]),
        };
      }),
    );
    const redirectItems = await Promise.all(
      Object.entries(redirects).map(async ([runtimeAgentId, rec]) => {
        const canGovern = await resolveCanGovern(runtimeAgentId);
        return {
          kind: "redirect" as const,
          id: `redirect:${runtimeAgentId}`,
          runtimeAgentId,
          reason: (rec as { reason?: string; targetAgentId?: string })?.reason ?? "redirect",
          targetAgentId: (rec as { targetAgentId?: string })?.targetAgentId ?? null,
          verifyAfterAt: null as string | null,
          requiresPlatformAdmin: !canGovern,
          actions: canGovern ? (["clear-redirect", "human-resume"] as string[]) : ([] as string[]),
        };
      }),
    );
    const items = [...effectItems, ...limitItems, ...redirectItems];
    respond(true, { items, count: items.length, scopeTenantId: caller.tenantId }, undefined);
  },

  "evolution-governance.resolve-approval": async ({ params, respond, client }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    const decision = requiredString(params, "decision", respond);
    if (!runtimeAgentId || !decision) {
      return;
    }
    const access = await assertClientMayGovernRuntimeAgent(client, runtimeAgentId, respond);
    if (!access) {
      return;
    }
    const reason = optionalString(params, "reason") ?? `approval:${decision}`;
    try {
      if (decision === "resume") {
        const result = humanResumeAgent({ runtimeAgentId, reason });
        respond(
          result.ok,
          result,
          result.ok ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "failed"),
        );
        return;
      }
      if (decision === "hold") {
        respond(true, humanHoldAgent({ runtimeAgentId, reason }), undefined);
        return;
      }
      if (decision === "clear_limit") {
        const result = applyGovernanceRuntimeAction({
          runtimeAgentId,
          action: "clear_limit",
          reason,
        });
        respond(
          result.ok,
          result,
          result.ok ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "failed"),
        );
        return;
      }
      if (decision === "clear_redirect") {
        const result = applyGovernanceRuntimeAction({
          runtimeAgentId,
          action: "clear_redirect",
          reason,
        });
        respond(
          result.ok,
          result,
          result.ok ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "failed"),
        );
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "decision must be resume|hold|clear_limit|clear_redirect",
        ),
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },

  /**
   * Global attribution stats — platform admin only (not tenant-partitioned store).
   * Tenant operators must not bypass snapshot filtering via this endpoint.
   */
  "evolution-governance.attribution-stats": ({ respond, client }) => {
    if (!requirePlatformGovernanceAdmin(client, respond)) {
      return;
    }
    respond(true, { stats: readAttributionStats() }, undefined);
  },

  "evolution-governance.human-resume": async ({ params, respond, client }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    if (!runtimeAgentId) {
      return;
    }
    const access = await assertClientMayGovernRuntimeAgent(client, runtimeAgentId, respond);
    if (!access) {
      return;
    }
    const reason = optionalString(params, "reason") ?? undefined;
    try {
      const result = humanResumeAgent({ runtimeAgentId, reason });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "resume failed"),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },

  "evolution-governance.human-hold": async ({ params, respond, client }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    if (!runtimeAgentId) {
      return;
    }
    const access = await assertClientMayGovernRuntimeAgent(client, runtimeAgentId, respond);
    if (!access) {
      return;
    }
    const reason = optionalString(params, "reason") ?? undefined;
    const result = humanHoldAgent({ runtimeAgentId, reason });
    respond(true, result, undefined);
  },

  "evolution-governance.set-kill-switch": ({ params, respond, client }) => {
    if (!requirePlatformGovernanceAdmin(client, respond)) {
      return;
    }
    const enabled = params.enabled;
    if (typeof enabled !== "boolean") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "enabled boolean required"));
      return;
    }
    const state = setGovernanceKillSwitch(enabled);
    respond(true, { killSwitch: state.killSwitch }, undefined);
  },

  "evolution-governance.configure-effect-verify-ms": ({ params, respond, client }) => {
    if (!requirePlatformGovernanceAdmin(client, respond)) {
      return;
    }
    const ms = params.ms;
    if (ms !== null && (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "ms must be non-negative number or null"),
      );
      return;
    }
    configureEffectVerifyMs(typeof ms === "number" ? ms : null);
    respond(true, { ms: typeof ms === "number" ? ms : null }, undefined);
  },

  "evolution-governance.apply-limit": async ({ params, respond, client }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    if (!runtimeAgentId) {
      return;
    }
    const access = await assertClientMayGovernRuntimeAgent(client, runtimeAgentId, respond);
    if (!access) {
      return;
    }
    const reason = optionalString(params, "reason") ?? "human-limit";
    const result = applyGovernanceRuntimeAction({
      runtimeAgentId,
      action: "limit",
      reason,
    });
    respond(
      result.ok,
      result,
      result.ok
        ? undefined
        : errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "limit failed"),
    );
  },

  "evolution-governance.clear-limit": async ({ params, respond, client }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    if (!runtimeAgentId) {
      return;
    }
    const access = await assertClientMayGovernRuntimeAgent(client, runtimeAgentId, respond);
    if (!access) {
      return;
    }
    const result = applyGovernanceRuntimeAction({
      runtimeAgentId,
      action: "clear_limit",
      reason: optionalString(params, "reason") ?? "human-clear-limit",
    });
    respond(
      result.ok,
      result,
      result.ok
        ? undefined
        : errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "clear failed"),
    );
  },

  "evolution-governance.apply-redirect": async ({ params, respond, client }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    const targetAgentId = requiredString(params, "targetAgentId", respond);
    if (!runtimeAgentId || !targetAgentId) {
      return;
    }
    const access = await assertClientMayGovernRedirect(
      client,
      runtimeAgentId,
      targetAgentId,
      respond,
    );
    if (!access) {
      return;
    }
    const result = applyGovernanceRuntimeAction({
      runtimeAgentId,
      action: "redirect",
      redirectTargetAgentId: targetAgentId,
      reason: optionalString(params, "reason") ?? "human-redirect",
    });
    respond(
      result.ok,
      result,
      result.ok
        ? undefined
        : errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "redirect failed"),
    );
  },

  "evolution-governance.clear-redirect": async ({ params, respond, client }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    if (!runtimeAgentId) {
      return;
    }
    const access = await assertClientMayGovernRuntimeAgent(client, runtimeAgentId, respond);
    if (!access) {
      return;
    }
    const result = applyGovernanceRuntimeAction({
      runtimeAgentId,
      action: "clear_redirect",
      reason: optionalString(params, "reason") ?? "human-clear-redirect",
    });
    respond(
      result.ok,
      result,
      result.ok
        ? undefined
        : errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "clear failed"),
    );
  },

  /**
   * Global skill-auto pass — platform admin only (may scan multi-tenant jobs).
   */
  "evolution-governance.run-skill-auto-pass": ({ respond, client }) => {
    if (!requirePlatformGovernanceAdmin(client, respond)) {
      return;
    }
    try {
      respond(true, runSkillAutoEvolutionPass(), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },

  "evolution-governance.enroll-skill-auto": async ({ params, respond, client }) => {
    const candidateId = requiredString(params, "candidateId", respond);
    if (!candidateId) {
      return;
    }
    const existing = getPatternCandidate(candidateId);
    if (!existing) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "candidate not found"));
      return;
    }
    const agentIdParam = optionalString(params, "agentId");
    if (agentIdParam && agentIdParam !== existing.agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "candidate not found"));
      return;
    }
    const access = await assertClientMayAccessCandidate(client, existing, respond);
    if (!access) {
      return;
    }
    const enrolledBy = requireAuthenticatedOperatorPrincipal(client, respond);
    if (!enrolledBy) {
      return;
    }
    const result = enrollSkillAutoInstall({
      candidateId,
      enrolledBy,
    });
    respond(
      result.ok,
      result,
      result.ok
        ? undefined
        : errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "enroll failed"),
    );
  },

  "evolution-governance.cancel-skill-auto": async ({ params, respond, client }) => {
    const candidateId = requiredString(params, "candidateId", respond);
    if (!candidateId) {
      return;
    }
    const existing = getPatternCandidate(candidateId);
    const state = readGovernancePersistedState();
    const job = (
      state.skillAutoJobs as
        | Record<string, { agentId?: string; tenantId?: string | null; candidateId?: string }>
        | undefined
    )?.[candidateId];

    // Map key / job.candidateId / live candidate.candidateId must agree.
    if (job) {
      const jobCand = job.candidateId?.trim() ?? candidateId;
      if (jobCand !== candidateId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "ownership-mismatch"));
        return;
      }
    }
    if (existing && existing.candidateId !== candidateId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "ownership-mismatch"));
      return;
    }
    if (existing && job) {
      const jobAgent = job.agentId?.trim() ?? "";
      const jobTenant = job.tenantId ?? null;
      const candTenant = existing.tenantId ?? null;
      if (jobAgent && jobAgent !== existing.agentId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "ownership-mismatch"));
        return;
      }
      if (jobTenant !== candTenant) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "ownership-mismatch"));
        return;
      }
      if (job.candidateId && job.candidateId !== existing.candidateId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "ownership-mismatch"));
        return;
      }
    }
    const ownerAgentId = existing?.agentId ?? job?.agentId;
    if (!ownerAgentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "candidate not found"));
      return;
    }
    const agentIdParam = optionalString(params, "agentId");
    if (agentIdParam && agentIdParam !== ownerAgentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "candidate not found"));
      return;
    }
    const ownerTenantId = existing?.tenantId ?? job?.tenantId ?? null;
    const access = await assertClientMayAccessCandidate(
      client,
      {
        agentId: ownerAgentId,
        tenantId: ownerTenantId,
      },
      respond,
    );
    if (!access) {
      return;
    }
    const cancelledBy = requireAuthenticatedOperatorPrincipal(client, respond);
    if (!cancelledBy) {
      return;
    }
    const result = cancelSkillAutoInstallJob({
      candidateId,
      reason: optionalString(params, "reason") ?? undefined,
      cancelledBy,
    });
    respond(
      result.ok,
      result,
      result.ok
        ? undefined
        : errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "cancel failed"),
    );
  },
};
