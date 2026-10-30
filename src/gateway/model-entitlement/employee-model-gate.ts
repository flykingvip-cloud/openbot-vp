/**
 * Employee / managed-enterprise 模型授权闸口（P1 任务 5 / P3 任务 13 / commercial-runtime-closure）。
 *
 * 将「身份解析 → managed policy → EffectiveModelSet → enforce → AOR 选路」收敛为一次调用。
 *
 * Managed enterprise 判定（在 enforce=off 早退之前）：
 * - collaboration group owner entitlement
 * - employee tenant session
 * - bot/agent 归属席位（始终尝试，不依赖配置 scope=all-bot-runs）
 *
 * 托管企业：effective enforce=strict、scope=all-bot-runs；身份解析失败 → allowlist=[] 零出网。
 * 非企业路径：保留配置默认，可 skipped。
 */

import type { OpenBotConfig } from "../../config/types.js";
import { resolveEnterpriseEntitlement } from "../billing/resolve-enterprise-entitlement.js";
import { getSeatEntitlementAssignment } from "../billing/seat-entitlement-assignments-store.js";
import { defaultSeatEntitlementProfileForRole } from "../billing/seat-entitlement-profiles.js";
import { listSeats } from "../billing/seats-store.js";
import type { SeatEntitlementProfileId } from "../billing/types.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import { buildKnowledgeReplyGatewayClient } from "../knowledge/reply-gateway-client.js";
import {
  resolvePlatformModelsConfig,
  resolvePlatformModelsMode,
} from "../models/platform-models-config.js";
import { listRoutingPolicies } from "../policy-engine/policies-store.js";
import { resolveRoutingPolicy } from "../policy-engine/resolve.js";
import { listResourceModelCatalog } from "../resource-catalog/models-catalog-store.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resourceCatalogToAorProfiles } from "./aor-catalog-adapter.js";
import { selectModelOrderWithinEffectiveSet } from "./aor-selection.js";
import { getEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import {
  resolveEntitlementAllowlistForRun,
  resolveModelEntitlementEnforce,
  resolveModelEntitlementScope,
} from "./entitlement-config.js";
import { filterModelIdsBySeatEntitlementProfile } from "./filter-model-ids-by-seat-profile.js";
import { resolveManagedTenantEntitlementPolicy } from "./managed-tenant-enforce.js";
import { getPlanVersionModelBinding } from "./plan-version-model-binding-store.js";
import { resolveAgentRunEntitlementScope } from "./resolve-agent-run-scope.js";
import { resolveEffectiveModelSet } from "./resolve-effective-model-set.js";
import {
  buildTaskCapabilityPlan,
  resolveModalityExecutorWiring,
  classifyTaskCapability,
  estimateTaskContextTokens,
  type ContextEstimateParts,
  type TaskCapabilityPlan,
} from "./task-capability-plan.js";

export type EmployeeEntitlementScopeOverride = {
  tenantId: string;
  seatId: string;
  employeeId?: string;
  userEmail?: string;
};

export type EmployeeModelGateInput = {
  cfg: OpenBotConfig | undefined;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  /** 协作群 bot 回合：强制按群 owner 席位解析 entitlement / credits。 */
  collaborationGroupOwnerEntitlement?: EmployeeEntitlementScopeOverride;
  /** 运行的 bot agentId：始终用于探测企业 bot 归属（不依赖 scope 配置）。 */
  agentId?: string;
  /** 调用方已知的 enterpriseId（商业闸口传入时优先 managed 信号）。 */
  enterpriseIdHint?: string;
  /**
   * Current user/task text for per-task capability planning (P0/P1).
   * Classification never expands entitlement; plan is built after auth.
   * When classificationSource is task_text, the category drives AOR scoring
   * instead of the package-static taskTypeId.
   */
  taskText?: string;
  /** Optional override for context filtering; defaults to a text-length estimate. */
  estimatedInputTokens?: number;
  /**
   * Full context parts for executable-capacity filtering (P1): history, system
   * prompt, tools, attachments, and output reserve. Merged with taskText.
   */
  contextParts?: ContextEstimateParts;
  entitlementStorePath?: string;
  seatGrantStorePath?: string;
  planVersionBindingStorePath?: string;
  seatAssetsStore?: EnterpriseSeatAssetsStore;
  enterpriseModelAssetStorePath?: string;
  enterpriseModelConnectionStorePath?: string;
  seatEntitlementAssignmentsPath?: string;
  modelCatalogPath?: string;
  overAllocationPath?: string;
  billingSeatsStorePath?: string;
  commercialBillingSeatId?: string;
  seatEntitlementProfileIdOverride?: string;
  /** 测试注入：已连通的平台模型，避免单测拉探测存储或网关目录。 */
  platformConnectedModelIdsOverride?: string[];
  probeStorePath?: string;
};

export type EmployeeModelGateEntitlementHint = {
  isCollaborationGroupOwner: boolean;
  ownerLabel?: string;
  effectiveReason?: string;
  enterpriseModelCount: number;
  hasSubscription: boolean;
  tierProfileFilteredEmpty?: boolean;
  seatEntitlementProfileId?: string;
};

export type EmployeeModelGateResult = {
  /** Resolved managed tenant id when gate ran in enterprise scope. */
  tenantId?: string;
  allowlist?: string[];
  entitlementHint?: EmployeeModelGateEntitlementHint;
  preferredModelOrder?: string[];
  /** P0 per-task plan inside the authorized set (optional when no allowlist). */
  capabilityPlan?: TaskCapabilityPlan;
  aorFeedback?: {
    taskTypeId: string;
    banditStatePath: string;
  };
  aorRouting?: {
    taskTypeId: string;
    strategy: string;
    auditLogPath: string;
    explanationByModelId: Record<string, { reason: string; score: number }>;
  };
  /**
   * Always-populated effective routing for governance snapshot inheritance.
   * Independent of enableRoutingExplanations / auditLogPath / aorRouting.
   */
  effectiveRouting: {
    mode: "native" | "aor_enhanced";
    selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
  };
  creditReporting?: {
    enterpriseId: string;
    policyId: string;
  };
  seatEntitlementProfileId?: string;
};

type ResolvedScope = {
  tenantId: string;
  seatId: string;
  employeeId?: string;
  userEmail?: string;
};

/**
 * Probe managed-enterprise identity before any enforce=off / scope early-exit.
 * Always attempts bot ownership resolution so cron/channel/followup cannot skip
 * under default scope=employee-chat.
 */
async function resolveManagedEnterpriseScope(input: EmployeeModelGateInput): Promise<{
  resolved: ResolvedScope | null;
  managedCandidate: boolean;
  managedProbeFailed: boolean;
}> {
  let resolved: ResolvedScope | null = null;
  let managedCandidate = Boolean(input.enterpriseIdHint?.trim());
  let managedProbeFailed = false;

  const ownerOverride = input.collaborationGroupOwnerEntitlement;
  if (ownerOverride?.tenantId?.trim() && ownerOverride.seatId?.trim()) {
    managedCandidate = true;
    resolved = {
      tenantId: ownerOverride.tenantId.trim(),
      seatId: ownerOverride.seatId.trim(),
      ...(ownerOverride.employeeId?.trim() ? { employeeId: ownerOverride.employeeId.trim() } : {}),
      ...(ownerOverride.userEmail?.trim() ? { userEmail: ownerOverride.userEmail.trim() } : {}),
    };
    return { resolved, managedCandidate, managedProbeFailed: false };
  }

  if (input.gatewayClientSessionDomain === "employee" && input.gatewayClientUser?.trim()) {
    managedCandidate = true;
    const client = buildKnowledgeReplyGatewayClient({
      gatewayClientUser: input.gatewayClientUser,
      gatewayClientSessionDomain: input.gatewayClientSessionDomain,
    });
    if (client) {
      try {
        const sourceCtx = await resolveKnowledgeSourceContext(client);
        if (sourceCtx.tenantId && sourceCtx.seatId) {
          resolved = {
            tenantId: sourceCtx.tenantId,
            seatId: sourceCtx.seatId,
            userEmail: input.gatewayClientUser.trim(),
            ...(sourceCtx.userId ? { employeeId: sourceCtx.userId } : {}),
          };
        } else {
          managedProbeFailed = true;
        }
      } catch {
        managedProbeFailed = true;
      }
    } else {
      managedProbeFailed = true;
    }
  }

  // Always probe bot ownership for non-employee / unresolved paths (cron, channel, CLI, followup).
  if (!resolved && input.agentId?.trim()) {
    managedCandidate = true;
    try {
      const botScope = await resolveAgentRunEntitlementScope({
        agentId: input.agentId,
        ...(input.seatAssetsStore ? { store: input.seatAssetsStore } : {}),
      });
      if (botScope?.tenantId && botScope.seatId) {
        resolved = {
          tenantId: botScope.tenantId,
          seatId: botScope.seatId,
          ...(botScope.employeeId ? { employeeId: botScope.employeeId } : {}),
        };
        managedProbeFailed = false;
      } else if (input.gatewayClientSessionDomain !== "employee") {
        // Agent present but not enterprise-owned → personal bot.
        managedCandidate = Boolean(input.enterpriseIdHint?.trim());
      } else {
        managedProbeFailed = managedProbeFailed || !resolved;
      }
    } catch {
      managedProbeFailed = true;
    }
  }

  // Commercial layer already knows enterprise + billing seat → treat as resolved managed scope.
  if (!resolved && input.enterpriseIdHint?.trim() && input.commercialBillingSeatId?.trim()) {
    managedCandidate = true;
    resolved = {
      tenantId: input.enterpriseIdHint.trim(),
      seatId: input.commercialBillingSeatId.trim(),
    };
    managedProbeFailed = false;
  }

  // Explicit enterpriseIdHint without seat/agent mapping remains managedCandidate
  // (caller must hard-deny when resolved stays null).
  if (!resolved && input.enterpriseIdHint?.trim()) {
    managedCandidate = true;
    managedProbeFailed = true;
  }

  return { resolved, managedCandidate, managedProbeFailed };
}

/**
 * Bot owner seat is a grant source even when the chatting employee (or the
 * commercial billing seat) resolved first. Same seat is not repeated.
 */
async function resolveBotOwnerSeatIds(input: {
  agentId?: string;
  tenantId: string;
  resolvedSeatId: string;
  seatAssetsStore?: EnterpriseSeatAssetsStore;
}): Promise<string[]> {
  const agentId = input.agentId?.trim();
  if (!agentId) {
    return [];
  }
  try {
    const botScope = await resolveAgentRunEntitlementScope({
      agentId,
      tenantId: input.tenantId,
      ...(input.seatAssetsStore ? { store: input.seatAssetsStore } : {}),
    });
    const botSeatId = botScope?.seatId?.trim();
    if (!botScope || botScope.tenantId !== input.tenantId || !botSeatId) {
      return [];
    }
    if (botSeatId === input.resolvedSeatId.trim()) {
      return [];
    }
    return [botSeatId];
  } catch {
    return [];
  }
}

/**
 * 解析 entitlement 闸口结果（allowlist + 可选 AOR 顺序）。
 */
export async function resolveEmployeeModelGate(
  input: EmployeeModelGateInput,
): Promise<EmployeeModelGateResult> {
  const mode = resolvePlatformModelsMode(input.cfg ?? ({} as OpenBotConfig));
  const configuredEnforce = resolveModelEntitlementEnforce(input.cfg);
  const configuredScope = resolveModelEntitlementScope(input.cfg);

  // 1) Identity probe first — before enforce=off or scope early-exit.
  const { resolved, managedCandidate } = await resolveManagedEnterpriseScope(input);

  // 2) Effective policy: managed defaults before any skip.
  const managed = resolveManagedTenantEntitlementPolicy(input.cfg, {
    isManagedEnterprise: managedCandidate,
  });
  const enforce = managed.enforce;
  const scope = managed.scope;

  // Always expose effective routing (mode from trusted config; strategy default until policy resolves).
  const earlyRouting = {
    mode,
    selectorStrategy: "balanced" as const,
  };

  // 3) Non-managed + enforce off + native → skip (personal path).
  if (!managedCandidate && configuredEnforce === "off" && mode !== "aor_enhanced") {
    return { effectiveRouting: earlyRouting };
  }
  if (!managedCandidate && !resolved) {
    // Personal / unknown: fail-open (no allowlist force).
    return { effectiveRouting: earlyRouting };
  }

  // 4) Managed candidate but identity unresolved → unconditional fail-closed zero egress.
  // Includes: enterpriseIdHint without agent/seat mapping (commercial layer known tenant).
  if (managedCandidate && !resolved) {
    return {
      allowlist: [],
      effectiveRouting: earlyRouting,
      entitlementHint: {
        isCollaborationGroupOwner: false,
        enterpriseModelCount: 0,
        hasSubscription: false,
        effectiveReason: input.enterpriseIdHint?.trim()
          ? "enterprise_id_hint_unresolved"
          : "managed_identity_unresolved",
      },
    };
  }

  if (!resolved) {
    return { effectiveRouting: earlyRouting };
  }

  if (managed.appliedManagedDefaults && managed.unsafeConfigWarning) {
    console.warn(
      JSON.stringify({
        component: "employee-model-gate",
        event: "managed_entitlement_policy",
        tenantId: resolved.tenantId,
        configuredEnforce,
        configuredScope,
        effectiveEnforce: enforce,
        effectiveScope: scope,
        warning: managed.unsafeConfigWarning,
      }),
    );
  }

  const supplementalSeatIds = await resolveBotOwnerSeatIds({
    agentId: input.agentId,
    tenantId: resolved.tenantId,
    resolvedSeatId: resolved.seatId,
    seatAssetsStore: input.seatAssetsStore,
  });

  const effective = await resolveEffectiveModelSet({
    tenantId: resolved.tenantId,
    seatId: resolved.seatId,
    ...(resolved.employeeId ? { employeeId: resolved.employeeId } : {}),
    ...(resolved.userEmail ? { userEmail: resolved.userEmail } : {}),
    cfg: input.cfg,
    seatGrantInheritsEnterprise: enforce !== "strict",
    requirePlatformCatalog: managedCandidate,
    ...(input.commercialBillingSeatId?.trim()
      ? { billingSeatId: input.commercialBillingSeatId.trim() }
      : {}),
    ...(supplementalSeatIds.length > 0 ? { supplementalSeatIds } : {}),
    ...(input.entitlementStorePath ? { entitlementStorePath: input.entitlementStorePath } : {}),
    ...(input.seatGrantStorePath ? { seatGrantStorePath: input.seatGrantStorePath } : {}),
    ...(input.billingSeatsStorePath ? { billingSeatsStorePath: input.billingSeatsStorePath } : {}),
    ...(input.enterpriseModelAssetStorePath
      ? { enterpriseModelAssetStorePath: input.enterpriseModelAssetStorePath }
      : {}),
    ...(input.enterpriseModelConnectionStorePath
      ? { enterpriseModelConnectionStorePath: input.enterpriseModelConnectionStorePath }
      : {}),
    ...(input.platformConnectedModelIdsOverride
      ? { platformConnectedModelIdsOverride: input.platformConnectedModelIdsOverride }
      : {}),
    ...(input.probeStorePath ? { probeStorePath: input.probeStorePath } : {}),
  });

  const allowlistBase =
    enforce === "off" ? undefined : resolveEntitlementAllowlistForRun(enforce, effective);

  const entitlement = await getEnterpriseModelEntitlement(
    resolved.tenantId,
    input.entitlementStorePath,
  );
  const planVersionId = entitlement?.planVersionId;
  const binding = planVersionId
    ? await getPlanVersionModelBinding(planVersionId, input.planVersionBindingStorePath)
    : null;

  const tenantEntitlement = await resolveEnterpriseEntitlement(resolved.tenantId);
  const tenantAllowedTiers = binding?.allowedTiers?.length
    ? binding.allowedTiers
    : (tenantEntitlement?.allowedTiers ?? []);

  let allowlist = allowlistBase;
  const allowlistBeforeProfileFilter = allowlistBase !== undefined ? [...allowlistBase] : undefined;
  const profileSeatId = input.commercialBillingSeatId?.trim() || resolved.seatId;
  const seats = await listSeats(resolved.tenantId, input.billingSeatsStorePath);
  const seat = seats.find((row) => row.id === profileSeatId);
  let seatEntitlementProfileId: SeatEntitlementProfileId | undefined =
    input.seatEntitlementProfileIdOverride?.trim() as SeatEntitlementProfileId | undefined;
  if (!seatEntitlementProfileId) {
    const assignment = await getSeatEntitlementAssignment(
      resolved.tenantId,
      profileSeatId,
      input.seatEntitlementAssignmentsPath,
    );
    seatEntitlementProfileId =
      assignment?.profileId ??
      (seat ? defaultSeatEntitlementProfileForRole(seat.currentRole) : undefined);
  }

  if (allowlist !== undefined) {
    allowlist = await filterModelIdsBySeatEntitlementProfile({
      tenantId: resolved.tenantId,
      seatId: profileSeatId,
      modelIds: allowlist,
      tenantAllowedTiers,
      seatEntitlementAssignmentsPath: input.seatEntitlementAssignmentsPath,
      seatsStorePath: input.billingSeatsStorePath,
      modelCatalogPath: input.modelCatalogPath,
      overAllocationPath: input.overAllocationPath,
    });
  }

  const policies = await listRoutingPolicies();
  const resolvedPolicy = resolveRoutingPolicy({
    policyId: binding?.policyId,
    allowedPolicies: binding?.allowedPolicies,
    legacySelectorStrategy: binding?.aorExecution?.selectorStrategy,
    policies,
  });
  const creditReporting = planVersionId
    ? { enterpriseId: resolved.tenantId, policyId: resolvedPolicy.policyId }
    : undefined;

  const effectiveModelIdsForRun = allowlist !== undefined ? allowlist : effective.allowedModelIds;

  // P1: classify current task before AOR so identified categories drive scoring.
  // Package-static taskTypeId remains the fallback when classification is heuristic_default.
  // Classification never expands the authorized set.
  const taskClassification = classifyTaskCapability(input.taskText);
  const packageTaskTypeId = binding?.aorExecution?.taskTypeId?.trim() || "default";
  const taskTypeIdForAor =
    taskClassification.classificationSource === "task_text"
      ? taskClassification.categoryId
      : packageTaskTypeId;

  const contextEstimate =
    input.estimatedInputTokens !== undefined && !input.contextParts
      ? undefined
      : estimateTaskContextTokens({
          ...input.contextParts,
          taskText: input.contextParts?.taskText ?? input.taskText,
        });

  let preferredModelOrder: string[] | undefined;
  let aorFeedback: EmployeeModelGateResult["aorFeedback"];
  let aorRouting: EmployeeModelGateResult["aorRouting"];
  // Effective strategy for snapshot inheritance — never gated on explanation/audit.
  let effectiveSelectorStrategy: EmployeeModelGateResult["effectiveRouting"]["selectorStrategy"] =
    resolvedPolicy.selectorStrategy === "cheapest" ||
    resolvedPolicy.selectorStrategy === "best_quality" ||
    resolvedPolicy.selectorStrategy === "balanced" ||
    resolvedPolicy.selectorStrategy === "bandit"
      ? resolvedPolicy.selectorStrategy
      : "balanced";
  if (mode === "aor_enhanced" && effectiveModelIdsForRun.length > 0) {
    const aorExecution =
      binding?.aorExecution || resolvedPolicy.selectorStrategy
        ? {
            taskTypeId: taskTypeIdForAor,
            selectorStrategy: resolvedPolicy.selectorStrategy,
            evaluatorMode: binding?.aorExecution?.evaluatorMode?.trim() || "content",
          }
        : undefined;
    if (aorExecution) {
      const catalogEntries = await listResourceModelCatalog(input.modelCatalogPath);
      const { profiles, missingCostModelIds } = resourceCatalogToAorProfiles(catalogEntries);
      if (missingCostModelIds.length > 0) {
        console.warn(
          JSON.stringify({
            component: "employee-model-gate",
            event: "aor_missing_cost",
            count: missingCostModelIds.length,
            sample: missingCostModelIds.slice(0, 5),
          }),
        );
      }
      const costProfile = contextEstimate
        ? {
            expectedInputTokens: Math.max(1, contextEstimate.estimatedInputTokens),
            expectedOutputTokens: Math.max(1, contextEstimate.outputReserveTokens),
          }
        : input.estimatedInputTokens !== undefined
          ? {
              expectedInputTokens: Math.max(1, Math.floor(input.estimatedInputTokens)),
              expectedOutputTokens: 1024,
            }
          : undefined;
      const selection = selectModelOrderWithinEffectiveSet({
        mode,
        effectiveModelIds: effectiveModelIdsForRun,
        aorExecution,
        catalog: profiles,
        ...(costProfile ? { costProfile } : {}),
      });
      if (selection.strategy !== "native") {
        preferredModelOrder = selection.orderedModelIds;
        // Only claim the selector strategy when ranking used real catalog evidence.
        // synthetic_only / ranking failure returns strategy "native" — keep balanced default.
        if (
          selection.strategy === "cheapest" ||
          selection.strategy === "best_quality" ||
          selection.strategy === "balanced" ||
          selection.strategy === "bandit"
        ) {
          effectiveSelectorStrategy = selection.strategy;
        }
      } else if (selection.catalogCoverage === "synthetic_only") {
        console.warn(
          JSON.stringify({
            component: "employee-model-gate",
            event: "aor_synthetic_catalog_fallback",
            mode,
            reason: "all_profiles_synthetic_neutral",
            sample: (selection.syntheticModelIds ?? []).slice(0, 5),
          }),
        );
      }
      const aorCfg = resolvePlatformModelsConfig(input.cfg ?? ({} as OpenBotConfig)).aor;
      if (aorCfg.enableBandit && aorCfg.banditStatePath) {
        aorFeedback = {
          taskTypeId: aorExecution.taskTypeId,
          banditStatePath: aorCfg.banditStatePath,
        };
      }
      if (
        selection.strategy !== "native" &&
        aorCfg.enableRoutingExplanations &&
        aorCfg.auditLogPath &&
        selection.routingExplanation
      ) {
        const explanationByModelId: Record<string, { reason: string; score: number }> = {};
        for (const row of selection.routingExplanation) {
          explanationByModelId[row.modelId] = { reason: row.reason, score: row.score };
        }
        aorRouting = {
          taskTypeId: aorExecution.taskTypeId,
          strategy: String(selection.strategy),
          auditLogPath: aorCfg.auditLogPath,
          explanationByModelId,
        };
      }
    }
  }

  let capabilityPlan: TaskCapabilityPlan | undefined;
  if (allowlist !== undefined) {
    const catalogEntriesForPlan = await listResourceModelCatalog(input.modelCatalogPath);
    const modelContextWindows: Record<string, number> = {};
    for (const entry of catalogEntriesForPlan) {
      if (typeof entry.contextWindow === "number" && entry.contextWindow > 0) {
        modelContextWindows[entry.modelId] = entry.contextWindow;
      }
    }
    capabilityPlan = buildTaskCapabilityPlan({
      taskText: input.taskText,
      authorizedModelIds: allowlist,
      preferredModelOrderFromAuth: preferredModelOrder ?? allowlist,
      modelContextWindows,
      executorWiring: resolveModalityExecutorWiring(input.cfg),
      ...(input.contextParts
        ? {
            contextParts: {
              ...input.contextParts,
              taskText: input.contextParts.taskText ?? input.taskText,
            },
          }
        : input.estimatedInputTokens !== undefined
          ? { estimatedInputTokens: input.estimatedInputTokens }
          : contextEstimate
            ? { contextEstimate }
            : {}),
    });
    // Prefer the executable order for downstream consumers; authorized set stays on allowlist.
    // Over-context models are dropped here and cannot re-enter via AOR preferred order.
    if (capabilityPlan.preferredModelOrder.length > 0) {
      preferredModelOrder = capabilityPlan.preferredModelOrder;
    } else if (capabilityPlan.failure.kind === "no_executable_candidates") {
      preferredModelOrder = [];
    }
  }

  const tierProfileFilteredEmpty =
    allowlist !== undefined &&
    allowlist.length === 0 &&
    (allowlistBeforeProfileFilter?.length ?? 0) > 0;

  return {
    ...(resolved?.tenantId ? { tenantId: resolved.tenantId } : {}),
    ...(allowlist !== undefined ? { allowlist } : {}),
    ...(preferredModelOrder ? { preferredModelOrder } : {}),
    ...(capabilityPlan ? { capabilityPlan } : {}),
    ...(aorFeedback ? { aorFeedback } : {}),
    ...(aorRouting ? { aorRouting } : {}),
    effectiveRouting: {
      mode,
      selectorStrategy: effectiveSelectorStrategy,
    },
    ...(creditReporting ? { creditReporting } : {}),
    ...(seatEntitlementProfileId ? { seatEntitlementProfileId } : {}),
    ...(allowlist !== undefined
      ? {
          entitlementHint: {
            isCollaborationGroupOwner: Boolean(input.collaborationGroupOwnerEntitlement),
            enterpriseModelCount: effective.allowedModelIds.length,
            hasSubscription: Boolean(entitlement?.planVersionId),
            effectiveReason: effective.reason,
            ...(tierProfileFilteredEmpty ? { tierProfileFilteredEmpty: true } : {}),
            ...(seatEntitlementProfileId ? { seatEntitlementProfileId } : {}),
          },
        }
      : {}),
  };
}

/**
 * 向后兼容包装：仅返回 entitlement allowlist（P1 既有调用方与测试沿用）。
 */
export async function resolveEmployeeEntitlementAllowlist(
  input: EmployeeModelGateInput,
): Promise<string[] | undefined> {
  const result = await resolveEmployeeModelGate(input);
  return result.allowlist;
}
