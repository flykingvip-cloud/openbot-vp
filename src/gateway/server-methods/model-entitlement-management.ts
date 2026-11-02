/**
 * 模型 entitlement 管理 handler（P2，任务 10）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§4.1, §8.2, R2.1/R3.1/R4.1）。
 *
 * 两组方法：
 * - 平台侧 `platform-model-binding.*`（legacy）：请改用 `platform-plan-bundle.*`。
 *   平台控制面方法，沿用本仓库平台 handler 既有惯例（网关受信，loopback/trusted-proxy）。
 * - 企业侧 `enterprise-model-grant.*`：对 seat/employee 授予/撤销模型，企业作用域隔离。
 *   授权方法强制 `grantedModelIds ⊆ EnterpriseModelCeiling`
 *   （SubscriptionModelSet ∪ ActiveTenantOwnedModelSet；越权被拒）。
 */

import { loadConfig } from "../../config/config.js";
import { getPlanVersion, listPlans } from "../billing/plans-store.js";
import { listSeats } from "../billing/seats-store.js";
import { listEnterpriseModelAssets } from "../enterprise-model/asset-store.js";
import {
  reconcileVerifiedEnterpriseModelAssets,
  resolveEnterpriseModelCeiling,
} from "../enterprise-model/ceiling.js";
import { listEnterpriseModelConnections } from "../enterprise-model/connection-store.js";
import {
  resolvePlatformPlanModels,
  type PlatformPlanModelState,
} from "../enterprise-model/plan-model-projection.js";
import { listUnusableEnterpriseModelWarnings } from "../enterprise-model/unusable-models.js";
import { getEnterpriseModelEntitlement } from "../model-entitlement/enterprise-model-entitlement-store.js";
import { resolveModelEntitlementRoutingMode } from "../model-entitlement/entitlement-config.js";
import {
  ensureEntitlementProjectionConsumerRegistered,
  refreshEntitlementsForPlanVersion,
} from "../model-entitlement/entitlement-projection.js";
import { mirrorBillingGrantToOrgSeats } from "../model-entitlement/mirror-billing-grant-to-org-seats.js";
import {
  getPlanVersionModelBinding,
  listPlanVersionModelBindings,
  normalizeModelQuotaMap,
  upsertPlanVersionModelBinding,
} from "../model-entitlement/plan-version-model-binding-store.js";
import { listConfiguredModelIds } from "../model-entitlement/resolve-effective-model-set.js";
import {
  forgetModelIdsFromTenantGrants,
  getModelGrant,
  listSeatModelGrantsForTenant,
  revokeModelGrant,
  setModelGrant,
  setModelGrantsAtomic,
  type ModelGrantMergeMode,
} from "../model-entitlement/seat-model-grant-store.js";
import type {
  ModelGrantSubjectType,
  ModelQuota,
  ModelRef,
  PlanModelAorExecution,
  SeatModelGrant,
} from "../model-entitlement/types.js";
import { loadEnterpriseVisiblePlatformModelIds } from "../models/load-connected-platform-model-ids.js";
import { partitionPlatformModelIds } from "../models/platform-model-connection.js";
import {
  exactMember,
  isRecord,
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const SELECTOR_STRATEGIES = ["cheapest", "best_quality", "balanced", "bandit"] as const;

// 模块加载即注册 entitlement 投影消费者（订阅变更 → 刷新企业 entitlement，task 9）。
ensureEntitlementProjectionConsumerRegistered();

function parseModelIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const ids = raw.map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => v.length > 0);
  return [...new Set(ids)];
}

/**
 * 解析 modelQuota 为 `Record<modelId, ModelQuota>`（每模型 { maxRequests?, maxTokens? }）。
 * 与 platform-plan-bundle 路径统一；兼容 legacy 单值 `Record<modelId, number>`。
 */
function parseModelQuota(raw: unknown): Record<string, ModelQuota> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  return normalizeModelQuotaMap(raw);
}

function parseAorExecution(raw: unknown): PlanModelAorExecution | undefined | { error: string } {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!isRecord(raw)) {
    return { error: "aorExecution 必须是对象" };
  }
  const taskTypeId = stringValue(raw.taskTypeId);
  const selectorStrategy = stringValue(raw.selectorStrategy);
  const evaluatorMode = stringValue(raw.evaluatorMode);
  if (!taskTypeId || !selectorStrategy || !evaluatorMode) {
    return { error: "aorExecution 需包含 taskTypeId / selectorStrategy / evaluatorMode" };
  }
  const strategy = exactMember(selectorStrategy, SELECTOR_STRATEGIES);
  if (!strategy) {
    return { error: `selectorStrategy 非法：${selectorStrategy}` };
  }
  return {
    taskTypeId,
    selectorStrategy: strategy,
    evaluatorMode,
  };
}

function parseSubjectType(raw: unknown): ModelGrantSubjectType | null {
  const v = stringValue(raw);
  return v === "seat" || v === "employee" ? v : null;
}

function parseMergeMode(raw: unknown): ModelGrantMergeMode | null {
  if (raw === undefined || raw === null || raw === "") {
    return "replace";
  }
  const v = stringValue(raw);
  return v === "replace" || v === "union" ? v : null;
}

/** 把「上界为空」翻译成管理员能直接照做的一句话，而不是笼统的「无法授权」。 */
function describeEmptyCeiling(state: PlatformPlanModelState): string {
  switch (state) {
    case "no_subscription":
      return "本企业没有生效中的套餐订阅，平台不下发任何模型。请先开通/续订套餐，或接入企业自供模型（BYOK）后再授权。";
    case "no_plan_binding":
      return "本企业套餐版本尚未配置模型绑定，平台侧没有可下发的模型。请联系平台为该套餐版本设置可用模型，或接入企业自供模型（BYOK）。";
    case "binding_empty":
      return "本企业套餐绑定当前解析为空（Tier 下没有启用的模型）。请联系平台检查套餐 Tier 与模型目录启用状态，或接入企业自供模型（BYOK）。";
    default:
      return "本企业模型上界为空，无法授权。请先由平台下发套餐绑定，或接入企业自供模型。";
  }
}

async function loadGatewayCatalogModelIds(context: {
  loadGatewayModelCatalog?: () => Promise<Array<{ provider?: string; id?: string }>>;
}): Promise<string[]> {
  if (typeof context?.loadGatewayModelCatalog !== "function") {
    return [];
  }
  try {
    const catalog = await context.loadGatewayModelCatalog();
    return catalog
      .map((entry) => {
        const provider = entry.provider?.trim() ?? "";
        const id = entry.id?.trim() ?? "";
        return provider && id ? `${provider}/${id}` : "";
      })
      .filter((id) => id.length > 0);
  } catch {
    return [];
  }
}

function idsNotAlreadyGranted(
  requested: readonly ModelRef[],
  retained: readonly ModelRef[],
): ModelRef[] {
  const kept = new Set(retained.map((id) => id.trim()).filter((id) => id.length > 0));
  return requested.filter((id) => !kept.has(id.trim()));
}

async function assertGrantedWithinCeiling(params: {
  tenantId: string;
  grantedModelIds: ModelRef[];
  /**
   * Ids already stored on this subject's active grant.
   * Keeping or removing them is not a new authorization. Only ids that are
   * not in this set must sit inside the current ceiling. Otherwise one stale
   * `ent/…` row blocks every later checkbox on the seat.
   */
  retainedModelIds?: readonly ModelRef[];
  respond: RespondFn;
}): Promise<boolean> {
  const fresh = idsNotAlreadyGranted(params.grantedModelIds, params.retainedModelIds ?? []);
  if (fresh.length === 0) {
    return true;
  }
  // 先按需回填套餐投影：存量租户的 entitlement 可能从未投影过（投影只在 billing
  // 事件时跑），否则套餐里明明有的模型会被判为越权。管理写路径可以承担这次回填。
  const platformPlan = await resolvePlatformPlanModels({
    tenantId: params.tenantId,
    reconcile: true,
  });
  // 连通成功后登记的企业模型曾被写成 health=unknown，进不了上界。写授权前先按
  // 仍处于已验证连接的资产回填健康态，否则模型库里的自供模型会被判越权。
  await reconcileVerifiedEnterpriseModelAssets({ tenantId: params.tenantId });
  const ceiling = await resolveEnterpriseModelCeiling({ tenantId: params.tenantId });
  if (ceiling.ceilingModelIds.length === 0) {
    respondInvalid(params.respond, describeEmptyCeiling(platformPlan.state));
    return false;
  }
  const allowed = new Set(ceiling.ceilingModelIds);
  const overreach = fresh.filter((id) => !allowed.has(id));
  if (overreach.length > 0) {
    respondInvalid(
      params.respond,
      `以下模型不在本企业模型上界（套餐∪企业自供）内，不能授权：${overreach.join(", ")}`,
    );
    return false;
  }
  return true;
}

async function retainedGrantModelIds(params: {
  tenantId: string;
  subjectType: ModelGrantSubjectType;
  subjectId: string;
}): Promise<ModelRef[]> {
  const existing = await getModelGrant({
    tenantId: params.tenantId,
    subjectType: params.subjectType,
    subjectId: params.subjectId,
  });
  if (!existing || existing.status !== "active") {
    return [];
  }
  return existing.grantedModelIds;
}

async function mirrorSeatGrantIfNeeded(params: {
  tenantId: string;
  subjectType: ModelGrantSubjectType;
  subjectId: string;
  grant: SeatModelGrant;
  actorUserId?: string;
}): Promise<void> {
  if (params.subjectType !== "seat") {
    return;
  }
  const billingSeat = (await listSeats(params.tenantId)).find((row) => row.id === params.subjectId);
  if (!billingSeat?.userId) {
    return;
  }
  await mirrorBillingGrantToOrgSeats({
    tenantId: params.tenantId,
    userId: billingSeat.userId,
    userEmail: billingSeat.userId.includes("@") ? billingSeat.userId : undefined,
    grant: params.grant,
    ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
  });
}

function validateAllowedModelIdsAgainstCatalog(
  allowedModelIds: readonly string[],
  catalog: ReadonlySet<string>,
): string[] {
  return allowedModelIds.filter((id) => !catalog.has(id));
}

export const platformModelBindingHandlers: GatewayRequestHandlers = {
  "platform-model-binding.set": async ({ params, respond }) => {
    try {
      const planVersionId = stringValue(params.planVersionId);
      if (!planVersionId) {
        respondInvalid(respond, "planVersionId 是必填项");
        return;
      }
      const allowedModelIds = parseModelIds(params.allowedModelIds);
      if (allowedModelIds === null) {
        respondInvalid(respond, "allowedModelIds 必须是字符串数组");
        return;
      }
      const version = await getPlanVersion(planVersionId);
      if (!version) {
        respondInvalid(respond, `套餐版本不存在：${planVersionId}`);
        return;
      }
      // Phase 3：tier-backed 绑定由 Tier 投影管理（allowedModelIds 为派生缓存）。
      // 封住 legacy 旁路：禁止本入口手工改写已带 allowedTiers 绑定的模型集合，
      // 避免它被重新改回「双轨真相」（手工 allowedModelIds 与 Tier 投影并存）。
      const existingBinding = await getPlanVersionModelBinding(planVersionId);
      if (existingBinding?.allowedTiers && existingBinding.allowedTiers.length > 0) {
        respondInvalid(
          respond,
          "该套餐版本已由 Tier 投影管理（allowedModelIds 为派生缓存），不能通过 legacy 入口手工改写模型集合；请用 platform-plan-bundle.update 按 Tier 重新配置。",
        );
        return;
      }
      if (version.status === "active" && allowedModelIds.length === 0) {
        respondInvalid(respond, "已生效版本不能清空可用模型集合。");
        return;
      }
      const aor = parseAorExecution(params.aorExecution);
      if (aor && "error" in aor) {
        respondInvalid(respond, aor.error);
        return;
      }
      const catalog = new Set(listConfiguredModelIds(loadConfig()));
      const invalidModelIds = validateAllowedModelIdsAgainstCatalog(allowedModelIds, catalog);
      if (invalidModelIds.length > 0) {
        respondInvalid(
          respond,
          `以下模型不在当前平台目录内，不能绑定：${invalidModelIds.join(", ")}`,
        );
        return;
      }
      const binding = await upsertPlanVersionModelBinding({
        planVersionId,
        allowedModelIds,
        modelQuota: parseModelQuota(params.modelQuota),
        aorExecution: aor,
      });
      // 立即把绑定变更投影到所有锁定该 planVersion 的存量订阅企业 entitlement，
      // 避免存量租户继续拿旧 entitlement（不依赖之后偶发的订阅变更事件）。
      const refreshedTenantIds = await refreshEntitlementsForPlanVersion(planVersionId, {
        routingMode: resolveModelEntitlementRoutingMode(loadConfig()),
      });
      respond(true, { binding, refreshedTenantIds });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-model-binding.get": async ({ params, respond }) => {
    try {
      const planVersionId = stringValue(params.planVersionId);
      if (!planVersionId) {
        respondInvalid(respond, "planVersionId 是必填项");
        return;
      }
      const binding = await getPlanVersionModelBinding(planVersionId);
      respond(true, { binding });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-model-binding.list": async ({ respond }) => {
    try {
      const bindings = await listPlanVersionModelBindings();
      respond(true, { bindings });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  // 平台「套餐⇄模型」统一视图（P6）：聚合 套餐(billing) + 当前版本模型绑定(旁路表) +
  // 平台目录(active) + 反向索引(模型→含它的套餐)，把两个 store 合并成单一真相视图。
  "platform-model-binding.overview": async ({ respond }) => {
    try {
      const cfg = loadConfig();
      const catalog = listConfiguredModelIds(cfg); // 平台目录上界（active modelRef）
      const [plans, bindings] = await Promise.all([listPlans(), listPlanVersionModelBindings()]);
      const bindingByVersion = new Map(bindings.map((b) => [b.planVersionId, b]));

      const reverseIndex: Record<string, string[]> = {};
      const planRows = plans.map((plan) => {
        const binding = bindingByVersion.get(plan.currentVersionId) ?? null;
        const allowedModelIds = binding?.allowedModelIds ?? [];
        for (const modelId of allowedModelIds) {
          (reverseIndex[modelId] ??= []).push(plan.id);
        }
        return {
          planId: plan.id,
          name: plan.name,
          status: plan.status,
          currentVersionId: plan.currentVersionId,
          allowedModelIds,
          ...(binding?.aorExecution ? { aorExecution: binding.aorExecution } : {}),
          ...(binding?.modelQuota ? { modelQuota: binding.modelQuota } : {}),
        };
      });

      respond(true, { catalog, plans: planRows, reverseIndex });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};

export const enterpriseModelGrantHandlers: GatewayRequestHandlers = {
  "enterprise-model-grant.grant": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      // 治理边界：授权变更仅限企业管理员（防御纵深，叠加 session-domain=enterprise 闸）。
      if (!scope.isEnterpriseAdmin) {
        respondInvalid(respond, "仅企业管理员可授予模型授权。");
        return;
      }
      const subjectType = parseSubjectType(params.subjectType);
      const subjectId = stringValue(params.subjectId);
      if (!subjectType || !subjectId) {
        respondInvalid(respond, "subjectType（seat|employee）与 subjectId 必填");
        return;
      }
      const grantedModelIds = parseModelIds(params.grantedModelIds);
      if (grantedModelIds === null) {
        respondInvalid(respond, "grantedModelIds 必须是字符串数组");
        return;
      }
      const mergeMode = parseMergeMode(params.mergeMode);
      if (!mergeMode) {
        respondInvalid(respond, "mergeMode 仅支持 replace|union");
        return;
      }
      // 越权校验：新加入的 id 必须 ⊆ EnterpriseModelCeiling（套餐 ∪ 企业 BYOK）。
      // 已经写在授权里、后来离开上界的 id 可以保留或取消，不能挡住同一次保存。
      const retainedModelIds = await retainedGrantModelIds({
        tenantId: scope.enterpriseId,
        subjectType,
        subjectId,
      });
      if (
        !(await assertGrantedWithinCeiling({
          tenantId: scope.enterpriseId,
          grantedModelIds,
          retainedModelIds,
          respond,
        }))
      ) {
        return;
      }
      const grant = await setModelGrant({
        tenantId: scope.enterpriseId,
        subjectType,
        subjectId,
        ...(stringValue(params.seatId) ? { seatId: stringValue(params.seatId)! } : {}),
        ...(stringValue(params.employeeId) ? { employeeId: stringValue(params.employeeId)! } : {}),
        grantedModelIds,
        mergeMode,
        ...(client?.user ? { actorUserId: client.user } : {}),
      });
      await mirrorSeatGrantIfNeeded({
        tenantId: scope.enterpriseId,
        subjectType,
        subjectId,
        grant,
        ...(client?.user ? { actorUserId: client.user } : {}),
      });
      respond(true, { grant });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  /**
   * Atomically grant to multiple seats/employees (single store write).
   * Wizard initial auth MUST use this with mergeMode=union to avoid wiping / partial writes.
   */
  "enterprise-model-grant.grantBatch": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      if (!scope.isEnterpriseAdmin) {
        respondInvalid(respond, "仅企业管理员可授予模型授权。");
        return;
      }
      const defaultMergeMode = parseMergeMode(params.mergeMode);
      if (!defaultMergeMode) {
        respondInvalid(respond, "mergeMode 仅支持 replace|union");
        return;
      }
      if (!Array.isArray(params.grants) || params.grants.length === 0) {
        respondInvalid(respond, "grants 必须是非空数组");
        return;
      }
      const items: Array<{
        subjectType: ModelGrantSubjectType;
        subjectId: string;
        seatId?: string;
        employeeId?: string;
        grantedModelIds: ModelRef[];
        mergeMode: ModelGrantMergeMode;
      }> = [];
      const allModelIds = new Set<string>();
      for (const raw of params.grants) {
        if (!isRecord(raw)) {
          respondInvalid(respond, "grants[] 每项必须是对象");
          return;
        }
        const subjectType = parseSubjectType(raw.subjectType);
        const subjectId = stringValue(raw.subjectId);
        if (!subjectType || !subjectId) {
          respondInvalid(respond, "grants[] 需要 subjectType（seat|employee）与 subjectId");
          return;
        }
        const grantedModelIds = parseModelIds(raw.grantedModelIds);
        if (grantedModelIds === null) {
          respondInvalid(respond, "grants[].grantedModelIds 必须是字符串数组");
          return;
        }
        const itemMerge =
          raw.mergeMode === undefined ? defaultMergeMode : parseMergeMode(raw.mergeMode);
        if (!itemMerge) {
          respondInvalid(respond, "grants[].mergeMode 仅支持 replace|union");
          return;
        }
        const retainedModelIds = await retainedGrantModelIds({
          tenantId: scope.enterpriseId,
          subjectType,
          subjectId,
        });
        for (const id of idsNotAlreadyGranted(grantedModelIds, retainedModelIds)) {
          allModelIds.add(id);
        }
        items.push({
          subjectType,
          subjectId,
          ...(stringValue(raw.seatId) ? { seatId: stringValue(raw.seatId)! } : {}),
          ...(stringValue(raw.employeeId) ? { employeeId: stringValue(raw.employeeId)! } : {}),
          grantedModelIds,
          mergeMode: itemMerge,
        });
      }
      if (
        !(await assertGrantedWithinCeiling({
          tenantId: scope.enterpriseId,
          grantedModelIds: [...allModelIds],
          respond,
        }))
      ) {
        return;
      }
      const grants = await setModelGrantsAtomic({
        tenantId: scope.enterpriseId,
        items,
        ...(client?.user ? { actorUserId: client.user } : {}),
      });
      for (const grant of grants) {
        await mirrorSeatGrantIfNeeded({
          tenantId: scope.enterpriseId,
          subjectType: grant.subjectType,
          subjectId: grant.subjectId,
          grant,
          ...(client?.user ? { actorUserId: client.user } : {}),
        });
      }
      respond(true, { grants });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-model-grant.revoke": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      // 治理边界：撤销同样仅限企业管理员。
      if (!scope.isEnterpriseAdmin) {
        respondInvalid(respond, "仅企业管理员可撤销模型授权。");
        return;
      }
      const subjectType = parseSubjectType(params.subjectType);
      const subjectId = stringValue(params.subjectId);
      if (!subjectType || !subjectId) {
        respondInvalid(respond, "subjectType（seat|employee）与 subjectId 必填");
        return;
      }
      const grant = await revokeModelGrant({
        tenantId: scope.enterpriseId,
        subjectType,
        subjectId,
        ...(client?.user ? { actorUserId: client.user } : {}),
      });
      respond(true, { grant });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-model-grant.list": async ({ client, params, respond, context }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      // 先按需回填套餐投影，再解析 ceiling：存量租户（投影事件从未触发）打开企业
      // AI 模型页即自愈，不必等下一次订阅变更。reconcile 只在这条企业读路径上开启，
      // 运行时 gate 仍走只读的 resolveEnterpriseModelCeiling。
      const platformPlan = await resolvePlatformPlanModels({
        tenantId: scope.enterpriseId,
        reconcile: true,
      });
      const entitlement = await getEnterpriseModelEntitlement(scope.enterpriseId);
      // 打开「模型授权」时自愈：已验证连接上的 unknown 资产提升为 healthy，
      // 否则席位勾选只剩套餐模型（上界不含企业自供）。
      await reconcileVerifiedEnterpriseModelAssets({ tenantId: scope.enterpriseId });
      const ceiling = await resolveEnterpriseModelCeiling({ tenantId: scope.enterpriseId });
      const knownAssets = await listEnterpriseModelAssets(scope.enterpriseId);
      const connections = await listEnterpriseModelConnections(scope.enterpriseId);
      let grants = await listSeatModelGrantsForTenant(scope.enterpriseId);
      const unusableModels = listUnusableEnterpriseModelWarnings({
        connections,
        assets: knownAssets,
        grantedModelIds: grants.flatMap((grant) => grant.grantedModelIds),
      });
      const staleEnterpriseIds = unusableModels
        .filter((warning) => warning.kind === "grant" && warning.modelId)
        .map((warning) => warning.modelId as string);
      if (staleEnterpriseIds.length > 0) {
        await forgetModelIdsFromTenantGrants({
          tenantId: scope.enterpriseId,
          modelIds: staleEnterpriseIds,
          ...(client?.user ? { actorUserId: client.user } : {}),
        });
        grants = await listSeatModelGrantsForTenant(scope.enterpriseId);
      }
      const connected = await loadEnterpriseVisiblePlatformModelIds({
        cfg: loadConfig(),
        gatewayCatalogModelIds: await loadGatewayCatalogModelIds(context),
      });
      const visibleSubscription = partitionPlatformModelIds(
        ceiling.subscriptionModelIds,
        connected,
      );
      const visibleCeiling = partitionPlatformModelIds(ceiling.ceilingModelIds, connected);
      const grantedIds = grants.flatMap((grant) => grant.grantedModelIds);
      const suppressedPlatformModelIds = [
        ...new Set(
          partitionPlatformModelIds([...ceiling.subscriptionModelIds, ...grantedIds], connected)
            .suppressed,
        ),
      ].toSorted();
      respond(true, {
        entitlement: entitlement ?? null,
        allowedModelIds: entitlement?.allowedModelIds ?? [],
        ceilingModelIds: visibleCeiling.visible,
        subscriptionModelIds: visibleSubscription.visible,
        tenantOwnedModelIds: ceiling.tenantOwnedModelIds,
        /** 企业自供连接失败、资产不健康，或授权指向已删除的运行时模型。 */
        unusableModels,
        /**
         * 套餐或历史授权里的平台模型，但已离开平台模型池，或未通过连通校验。
         * 企业列表不渲染，授权记录仍保留。
         */
        suppressedPlatformModelIds,
        /** 平台套餐可调用模型（含 Tier/能力/单价/额度元数据），供企业端模型池展示。 */
        platformModels: platformPlan.models.filter((model) => connected.has(model.modelId)),
        /** 平台侧解析上下文；`state` 解释「平台提供模型为 0」的确切原因。 */
        planContext: {
          state: platformPlan.state,
          ...(platformPlan.planId ? { planId: platformPlan.planId } : {}),
          ...(platformPlan.planName ? { planName: platformPlan.planName } : {}),
          ...(platformPlan.planVersionId ? { planVersionId: platformPlan.planVersionId } : {}),
          allowedTiers: platformPlan.allowedTiers,
          allowlistSource: platformPlan.allowlistSource,
          entitlementStale: platformPlan.entitlementStale,
          reconciled: platformPlan.reconciled,
        },
        grants,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
