/**
 * Billing 读 + 结算 handler，及事件消费者（R7 / R10 / R12 / R18 / R19 / R22）。
 *
 * 方法：billing.dashboard / billing.analytics / billing.attribution-by-seat /
 *       billing.attribution-by-position / billing.export-position-report /
 *       billing.backfill-usage-attribution /
 *       billing.list-bills / billing.get-bill /
 *       billing.export-bill / billing.preview / billing.settle
 *
 * 事件消费：注册到 billingEventBus，事件到达 → 重算当日 estimated 快照并 append。
 * settle 入口前全量 replayPending。dashboard 只做有截止时间的有限重放，
 * 避免失败事件积压时请求一直不返回、客户端把连接当成 1006 关掉。
 */

import { loadConfig } from "../../config/config.js";
import { omitCommercialCostKeys } from "../../shared/usage-cost-layer.js";
import {
  ContractEndedError,
  CycleNotEndedError,
  InvalidContractError,
  NoCompletedCycleError,
  NoPendingSettlementError,
} from "../billing/billing-period.js";
import { reconcileEnterpriseCredits } from "../billing/billing-reconciliation.js";
import { replaySnapshot } from "../billing/billing-replay-coalesce.js";
import { countActiveBotsAt } from "../billing/bot-resources-store.js";
import { billingEventBus } from "../billing/event-bus.js";
import { appendSnapshot, getBill, listBills } from "../billing/ledger-store.js";
import { buildMeterDefinitions } from "../billing/meter-contract.js";
import {
  getOverAllocationState,
  resolveCommercialGovernanceStatus,
} from "../billing/over-allocation-store.js";
import { getPlanVersion } from "../billing/plans-store.js";
import {
  buildPositionAttribution,
  buildPositionDailyUsageRows,
  type OrgPositionContext,
} from "../billing/position-attribution.js";
import {
  formatPositionDailyCsv,
  formatPositionSummaryCsv,
} from "../billing/position-report-export.js";
import {
  resolveTenantCreditsStatus,
  resolveEnterpriseEconomics,
} from "../billing/record-credit-usage.js";
import { resolveCommercialRuntimeDrift } from "../billing/resolve-commercial-runtime-drift.js";
import { resolveEnterpriseAIGovernanceProjection } from "../billing/resolve-enterprise-ai-governance.js";
import { resolveKnowledgeGovernanceCreditsSummary } from "../billing/resolve-knowledge-governance-credits-summary.js";
import { resolveTenantCapabilities } from "../billing/resolve-tenant-capabilities.js";
import {
  computeBudgetStatus,
  computeCurrentCycleCost,
  resolveEnterpriseCycleWindow,
} from "../billing/runtime.js";
import { buildSeatAttribution } from "../billing/seat-attribution.js";
import { listSeatEntitlementProfileIntervals } from "../billing/seat-entitlement-assignments-store.js";
import { listSeatIntervals, listSeats } from "../billing/seats-store.js";
import { SettlementConfigError } from "../billing/settlement-service.js";
import { settleEnterpriseCycle } from "../billing/settlement-service.js";
import { getActiveSubscription } from "../billing/subscriptions-store.js";
import { listTenantCreditsCycles } from "../billing/tenant-credits-store.js";
import type { DurableEvent } from "../billing/types.js";
import type { Seat } from "../billing/types.js";
import {
  backfillUsageAttribution,
  buildRunIdAgentIndexFromResolver,
} from "../billing/usage-attribution-backfill.js";
import { listUsageRecords } from "../billing/usage-records-store.js";
import { computeEnterpriseConsumptionForecast } from "../consumption-forecast/compute-enterprise-forecast.js";
import {
  type EnterpriseSeatAssetsStore,
  type EnterprisePositionSeat,
} from "../enterprise-seat-assets-store.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { resolveEnterpriseBillingMode } from "../package-entitlement/resolve-billing-mode.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import { listCreditWeights } from "../resource-catalog/credit-weights-store.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import {
  buildSessionStorePathResolver,
  resolveControlPlaneStorePathForClient,
} from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import {
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

// ── 事件消费者：增量重算 estimated 快照（幂等覆盖，R22.2）────────────────────
let consumerRegistered = false;

async function consumeEvent(durable: DurableEvent): Promise<void> {
  const enterpriseId = durable.enterpriseId;
  await replaySnapshot(enterpriseId, async () => {
    const cost = await computeCurrentCycleCost(enterpriseId, "estimated");
    if (cost) {
      await appendSnapshot(cost.snapshot);
    }
  });
}

/** 注册事件消费者（幂等，进程内只注册一次）。 */
export function ensureBillingConsumerRegistered(): void {
  if (consumerRegistered) {
    return;
  }
  consumerRegistered = true;
  billingEventBus.on((durable) => consumeEvent(durable));
}

// 模块加载即注册消费者。
ensureBillingConsumerRegistered();

const MAX_POSITION_REPORT_RANGE_MS = 93 * 24 * 60 * 60 * 1000;

function listOrgSeatsForEnterprise(
  seatStore: EnterpriseSeatAssetsStore,
  enterpriseId: string,
): EnterprisePositionSeat[] {
  const canonical = canonicalizeTenantId(enterpriseId) ?? enterpriseId;
  return Object.values(seatStore.seats)
    .filter((seat) => (canonicalizeTenantId(seat.tenantId) ?? seat.tenantId) === canonical)
    .toSorted((left, right) => left.title.localeCompare(right.title));
}

function mapOrgSeatToPositionContext(
  seatStore: EnterpriseSeatAssetsStore,
  tenantId: string,
  seat: EnterprisePositionSeat,
): OrgPositionContext {
  const activeBinding =
    Object.values(seatStore.bindings).find(
      (entry) =>
        entry.tenantId === seat.tenantId &&
        entry.seatId === seat.seatId &&
        entry.bindingStatus === "active",
    ) ?? null;
  return {
    orgSeatId: seat.seatId,
    positionTitle: seat.title,
    teamLabel: seat.teamLabel?.trim() || "未分组",
    memberUserId: seat.currentEmployeeId ?? activeBinding?.employeeId ?? null,
    agentIds: [...seat.defaultAgentAssetIds],
  };
}

function resolveOrgPositionContexts(
  seatStore: EnterpriseSeatAssetsStore,
  enterpriseId: string,
  billingSeats: readonly Seat[] = [],
): OrgPositionContext[] {
  const canonical = canonicalizeTenantId(enterpriseId) ?? enterpriseId;
  const orgSeats = listOrgSeatsForEnterprise(seatStore, enterpriseId);
  if (orgSeats.length > 0) {
    return orgSeats.map((seat) => mapOrgSeatToPositionContext(seatStore, canonical, seat));
  }
  // 仅有账单 Seat（分配席位档位）、尚未配置组织岗位时，按账单席位生成汇报行。
  return billingSeats.map((seat) => ({
    orgSeatId: `billing:${seat.id}`,
    positionTitle: seat.userId,
    teamLabel: "账单席位",
    memberUserId: seat.userId,
    agentIds: [],
  }));
}

async function loadPositionAttributionForScope(args: {
  enterpriseId: string;
  startTime: string;
  endTime: string;
}) {
  const subscription = await getActiveSubscription(args.enterpriseId);
  if (!subscription) {
    return {
      subscribed: false as const,
      cycleStart: args.startTime,
      cycleEnd: args.endTime,
      rows: [],
      summary: { seatCostCents: 0, usageCostCents: 0, extraCostCents: 0, totalCostCents: 0 },
      missingPriceKeys: [] as string[],
    };
  }
  const version = await getPlanVersion(subscription.planVersionId);
  if (!version) {
    throw new Error("订阅锁定的套餐版本不存在，无法计算归因。");
  }
  // Scope.enterpriseId is already authorized; resolve L1 seat-assets by tenant id so
  // managed mode works when billing scope came from params.tenantId (no client session).
  const seatStore = await loadSeatAssetsStoreForTenantId(args.enterpriseId);
  const entitlement = await getPlanEntitlementSnapshot(subscription.planVersionId);
  const [billingSeats, intervals, usageRecords, botCount, aiProfileIntervals] = await Promise.all([
    listSeats(args.enterpriseId),
    listSeatIntervals(args.enterpriseId),
    listUsageRecords(args.enterpriseId, {
      startTime: args.startTime,
      endTime: args.endTime,
    }),
    countActiveBotsAt(args.enterpriseId, args.endTime),
    listSeatEntitlementProfileIntervals(args.enterpriseId),
  ]);
  const meters = buildMeterDefinitions({
    version,
    entitlement,
    usageKeys: [...new Set(usageRecords.map((u) => u.key))],
  });
  const positions = resolveOrgPositionContexts(seatStore, args.enterpriseId, billingSeats);
  return {
    subscribed: true as const,
    ...buildPositionAttribution({
      version,
      positions,
      billingSeats,
      intervals,
      usageRecords,
      cycleStart: args.startTime,
      cycleEnd: args.endTime,
      meters,
      botCount,
      aiProfileIntervals,
      aiProfileQuota: entitlement?.aiProfileQuota,
    }),
  };
}

function assertPositionReportRange(
  respond: RespondFn,
  startTime: string,
  endTime: string,
): boolean {
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    respondInvalid(respond, "无效的时间区间");
    return false;
  }
  if (endMs - startMs > MAX_POSITION_REPORT_RANGE_MS) {
    respondInvalid(respond, "岗位汇报导出区间不能超过 93 天");
    return false;
  }
  return true;
}

const DEFAULT_BILLING_DASHBOARD_DEADLINE_MS = 12_000;
const DASHBOARD_REPLAY_DEADLINE_MS = 2_000;
const DASHBOARD_REPLAY_MAX_EVENTS = 20;
const DASHBOARD_REPLAY_PER_EVENT_MS = 750;

function billingDashboardDeadlineMs(): number {
  const raw = Number(process.env.OPENBOT_BILLING_DASHBOARD_DEADLINE_MS);
  if (Number.isFinite(raw) && raw >= 20 && raw <= 40_000) {
    return Math.floor(raw);
  }
  return DEFAULT_BILLING_DASHBOARD_DEADLINE_MS;
}

function respondOnce(respond: RespondFn): RespondFn {
  let settled = false;
  return (ok, payload, error) => {
    if (settled) {
      return;
    }
    settled = true;
    respond(ok, payload, error);
  };
}

export const billingHandlers: GatewayRequestHandlers = {
  "billing.dashboard": async ({ client, params, respond }) => {
    const safeRespond = respondOnce(respond);
    const deadlineMs = billingDashboardDeadlineMs();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        respondUnavailable(
          safeRespond,
          new Error(`billing.dashboard timed out after ${deadlineMs}ms before a payload was ready`),
        );
        resolve();
      }, deadlineMs);
    });
    const work = (async () => {
      try {
        const scope = await requireEnterpriseScope(client, safeRespond, params);
        if (!scope) {
          return;
        }
        const replay = await billingEventBus.replayPending(undefined, {
          enterpriseId: scope.enterpriseId,
          deadlineMs: Math.min(DASHBOARD_REPLAY_DEADLINE_MS, deadlineMs),
          maxEvents: DASHBOARD_REPLAY_MAX_EVENTS,
          perEventMs: DASHBOARD_REPLAY_PER_EVENT_MS,
        });
        const now = new Date();
        const creditWeightsPromise = listCreditWeights();
        const [
          cost,
          status,
          billingMode,
          creditsStatus,
          economics,
          commercialGovernanceStatus,
          aiGovernance,
          overAllocation,
          consumptionForecast,
          creditsReconciliation,
          knowledgeGovernanceCredits,
          _creditWeights,
          commercialRuntimeDrift,
        ] = await Promise.all([
          computeCurrentCycleCost(scope.enterpriseId, "estimated", now),
          computeBudgetStatus(scope.enterpriseId, now),
          resolveEnterpriseBillingMode(scope.enterpriseId),
          resolveTenantCreditsStatus(scope.enterpriseId),
          resolveEnterpriseEconomics(scope.enterpriseId),
          resolveCommercialGovernanceStatus(scope.enterpriseId),
          resolveEnterpriseAIGovernanceProjection(scope.enterpriseId),
          getOverAllocationState(scope.enterpriseId),
          computeEnterpriseConsumptionForecast(scope.enterpriseId, now),
          reconcileEnterpriseCredits(scope.enterpriseId),
          resolveKnowledgeGovernanceCreditsSummary(scope.enterpriseId, now),
          creditWeightsPromise,
          creditWeightsPromise.then((weights) =>
            resolveCommercialRuntimeDrift(scope.enterpriseId, weights),
          ),
        ]);
        const computedAt = now.toISOString();
        const tenantCapabilities = resolveTenantCapabilities();
        const stale = replay.truncated || replay.timedOutEvents > 0;
        if (!cost) {
          // 无生效订阅：空态（R15.3 / R7.5）。
          safeRespond(
            true,
            omitCommercialCostKeys({
              subscribed: false,
              accruedCents: 0,
              seatCostCents: 0,
              usageCostCents: 0,
              extraCostCents: 0,
              predictedCents: status.predictedCents,
              budgetStatus: status,
              billingMode,
              creditsStatus,
              economics,
              commercialGovernanceStatus,
              aiGovernance,
              overAllocation,
              consumptionForecast,
              creditsReconciliation,
              knowledgeGovernanceCredits,
              commercialRuntimeDrift,
              snapshotType: "estimated",
              computedAt,
              stale,
              tenantCapabilities,
            }),
          );
          return;
        }
        safeRespond(
          true,
          omitCommercialCostKeys({
            subscribed: true,
            planView: cost.plan,
            cycleStart: cost.cycleStart,
            cycleEnd: cost.cycleEnd,
            accruedCents:
              billingMode === "enterprise_budget" ? status.accruedCents : cost.bill.totalCostCents,
            seatCostCents: cost.bill.seatCostCents,
            usageCostCents: cost.bill.usageCostCents,
            extraCostCents: cost.bill.extraCostCents,
            missingPriceKeys: cost.snapshot.missingPriceKeys,
            predictedCents: status.predictedCents,
            budgetStatus: status,
            billingMode,
            creditsStatus,
            economics,
            commercialGovernanceStatus,
            aiGovernance,
            overAllocation,
            consumptionForecast,
            creditsReconciliation,
            knowledgeGovernanceCredits,
            commercialRuntimeDrift,
            snapshotType: "estimated",
            computedAt,
            stale,
            tenantCapabilities,
          }),
        );
      } catch (err) {
        respondUnavailable(safeRespond, err);
      }
    })();
    try {
      await Promise.race([work, deadline]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  },

  "billing.analytics": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const now = new Date();
      const { cycleStart, cycleEnd } = await resolveEnterpriseCycleWindow(scope.enterpriseId, now);
      const startTime = stringValue(params.startTime) ?? cycleStart;
      const endTime = stringValue(params.endTime) ?? cycleEnd;
      const usage = await listUsageRecords(scope.enterpriseId, { startTime, endTime });
      const byUser: Record<string, number> = {};
      const byKey: Record<string, number> = {};
      for (const rec of usage) {
        byUser[rec.userId] = (byUser[rec.userId] ?? 0) + rec.quantity;
        byKey[rec.key] = (byKey[rec.key] ?? 0) + rec.quantity;
      }
      const totalQuantity = usage.reduce((acc, r) => acc + r.quantity, 0);
      respond(true, {
        startTime,
        endTime,
        totalQuantity,
        byUser,
        byKey,
        recordCount: usage.length,
        tenantCapabilities: resolveTenantCapabilities(),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "billing.attribution-by-seat": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const now = new Date();
      const { cycleStart, cycleEnd } = await resolveEnterpriseCycleWindow(scope.enterpriseId, now);
      const startTime = stringValue(params.startTime) ?? cycleStart;
      const endTime = stringValue(params.endTime) ?? cycleEnd;
      const subscription = await getActiveSubscription(scope.enterpriseId);
      if (!subscription) {
        respond(true, {
          subscribed: false,
          cycleStart: startTime,
          cycleEnd: endTime,
          rows: [],
          summary: { seatCostCents: 0, usageCostCents: 0, extraCostCents: 0, totalCostCents: 0 },
          missingPriceKeys: [],
        });
        return;
      }
      const version = await getPlanVersion(subscription.planVersionId);
      if (!version) {
        respondInvalid(respond, "订阅锁定的套餐版本不存在，无法计算归因。");
        return;
      }
      const entitlement = await getPlanEntitlementSnapshot(subscription.planVersionId);
      const [seats, intervals, usageRecords, botCount, aiProfileIntervals] = await Promise.all([
        listSeats(scope.enterpriseId),
        listSeatIntervals(scope.enterpriseId),
        listUsageRecords(scope.enterpriseId, { startTime, endTime }),
        countActiveBotsAt(scope.enterpriseId, endTime),
        listSeatEntitlementProfileIntervals(scope.enterpriseId),
      ]);
      const meters = buildMeterDefinitions({
        version,
        entitlement,
        usageKeys: [...new Set(usageRecords.map((u) => u.key))],
      });
      const attribution = buildSeatAttribution({
        version,
        seats,
        intervals,
        usageRecords,
        cycleStart: startTime,
        cycleEnd: endTime,
        meters,
        botCount,
        aiProfileIntervals,
        aiProfileQuota: entitlement?.aiProfileQuota,
      });
      respond(true, {
        subscribed: true,
        cycleStart: attribution.cycleStart,
        cycleEnd: attribution.cycleEnd,
        rows: attribution.rows,
        summary: attribution.summary,
        missingPriceKeys: attribution.missingPriceKeys,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "billing.attribution-by-position": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const now = new Date();
      const { cycleStart, cycleEnd } = await resolveEnterpriseCycleWindow(scope.enterpriseId, now);
      const startTime = stringValue(params.startTime) ?? cycleStart;
      const endTime = stringValue(params.endTime) ?? cycleEnd;
      if (!assertPositionReportRange(respond, startTime, endTime)) {
        return;
      }
      const attribution = await loadPositionAttributionForScope({
        enterpriseId: scope.enterpriseId,
        startTime,
        endTime,
      });
      respond(true, {
        subscribed: attribution.subscribed,
        cycleStart: attribution.cycleStart,
        cycleEnd: attribution.cycleEnd,
        rows: attribution.rows,
        summary: attribution.summary,
        missingPriceKeys: attribution.missingPriceKeys,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "billing.export-position-report": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const now = new Date();
      const { cycleStart, cycleEnd } = await resolveEnterpriseCycleWindow(scope.enterpriseId, now);
      const startTime = stringValue(params.startTime) ?? cycleStart;
      const endTime = stringValue(params.endTime) ?? cycleEnd;
      if (!assertPositionReportRange(respond, startTime, endTime)) {
        return;
      }
      const variant = stringValue(params.variant) ?? "summary";
      if (variant !== "summary" && variant !== "daily") {
        respondInvalid(respond, "variant 必须是 summary 或 daily");
        return;
      }
      const attribution = await loadPositionAttributionForScope({
        enterpriseId: scope.enterpriseId,
        startTime,
        endTime,
      });
      if (!attribution.subscribed) {
        respondInvalid(respond, "当前企业尚未订阅套餐，无法导出岗位汇报。");
        return;
      }
      const subscription = await getActiveSubscription(scope.enterpriseId);
      const version = subscription ? await getPlanVersion(subscription.planVersionId) : null;
      if (!version) {
        respondInvalid(respond, "订阅锁定的套餐版本不存在，无法导出。");
        return;
      }
      const seatStore = await loadSeatAssetsStoreForTenantId(scope.enterpriseId);
      const billingSeats = await listSeats(scope.enterpriseId);
      const positions = resolveOrgPositionContexts(seatStore, scope.enterpriseId, billingSeats);
      const usageRecords = await listUsageRecords(scope.enterpriseId, { startTime, endTime });
      const stamp = startTime.slice(0, 10);
      const dataSource = "billing";
      if (variant === "daily") {
        const dailyRows = buildPositionDailyUsageRows({ version, positions, usageRecords });
        respond(true, {
          filename: `position-report-daily-${stamp}.csv`,
          contentType: "text/csv",
          content: formatPositionDailyCsv(dailyRows, startTime, endTime, dataSource),
        });
        return;
      }
      respond(true, {
        filename: `position-report-summary-${stamp}.csv`,
        contentType: "text/csv",
        content: formatPositionSummaryCsv(attribution, { dataSource }),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "billing.backfill-usage-attribution": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const now = new Date();
      const { cycleStart, cycleEnd } = await resolveEnterpriseCycleWindow(scope.enterpriseId, now);
      const startTime = stringValue(params.startTime) ?? cycleStart;
      const endTime = stringValue(params.endTime) ?? cycleEnd;
      if (!assertPositionReportRange(respond, startTime, endTime)) {
        return;
      }
      const dryRun = params.dryRun === true;
      const cfg = loadConfig();
      const seatAssetsPath = await resolveControlPlaneStorePathForClient(
        client,
        TENANT_SEAT_ASSETS_FILE,
        cfg,
      );
      const resolveAgentStorePath = await buildSessionStorePathResolver(client, cfg);
      const result = await backfillUsageAttribution({
        enterpriseId: scope.enterpriseId,
        startTime,
        endTime,
        dryRun,
        cfg,
        seatAssetsPath,
        runIndex: buildRunIdAgentIndexFromResolver(cfg, resolveAgentStorePath),
      });
      respond(true, result);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "billing.list-bills": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const bills = await listBills(scope.enterpriseId);
      respond(true, { bills });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "billing.list-credits-cycles": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const rawLimit = params.limit;
      const limit =
        typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.floor(rawLimit)
          : undefined;
      const cycles = await listTenantCreditsCycles(scope.enterpriseId, { limit });
      respond(true, { cycles });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "billing.get-bill": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const billId = stringValue(params.billId);
      if (!billId) {
        respondInvalid(respond, "billId 是必填项");
        return;
      }
      const bill = await getBill(scope.enterpriseId, billId);
      if (!bill) {
        respondInvalid(respond, `未找到账单：${billId}`);
        return;
      }
      respond(true, { bill, items: bill.items });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "billing.export-bill": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const billId = stringValue(params.billId);
      if (!billId) {
        respondInvalid(respond, "billId 是必填项");
        return;
      }
      const bill = await getBill(scope.enterpriseId, billId);
      if (!bill) {
        respondInvalid(respond, `未找到账单：${billId}`);
        return;
      }
      // 简单 JSON 导出（CSV/PDF 可后续扩展）。
      const filename = `bill-${bill.cycleStart.slice(0, 10)}.json`;
      respond(true, {
        filename,
        contentType: "application/json",
        content: JSON.stringify(bill, null, 2),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  // 周期预览：estimated 成本，不落 final Bill（可在账期中调用）。
  // at >= contractEnd 时返回受控错误（合同已结束），不得伪装为服务不可用。
  "billing.preview": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      await billingEventBus.replayPending();
      const now = stringValue(params.now);
      const settleAt = now ? new Date(now) : new Date();
      try {
        const result = await settleEnterpriseCycle({
          enterpriseId: scope.enterpriseId,
          mode: "estimated",
          now: settleAt,
        });
        if (!result) {
          respondInvalid(respond, "当前没有生效订阅，无法预览。");
          return;
        }
        respond(true, {
          bill: result.bill,
          snapshot: result.snapshot,
          settlementKey: result.settlementKey,
          cycleStart: result.cycle.cycleStart,
          cycleEnd: result.cycle.cycleEnd,
          periodIndex: result.cycle.periodIndex,
          mode: "estimated",
        });
      } catch (err) {
        if (
          err instanceof ContractEndedError ||
          err instanceof InvalidContractError ||
          err instanceof CycleNotEndedError ||
          err instanceof SettlementConfigError
        ) {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  // 周期结算：账期结束后幂等生成唯一 final 账单 + final 快照（R22.3 / R22.4）。
  "billing.settle": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      await billingEventBus.replayPending();
      const now = stringValue(params.now);
      const settleAt = now ? new Date(now) : new Date();
      try {
        const cycleStart = stringValue(params.cycleStart);
        const subscriptionId = stringValue(params.subscriptionId);
        const result = await settleEnterpriseCycle({
          enterpriseId: scope.enterpriseId,
          mode: "final",
          now: settleAt,
          ...(cycleStart ? { cycleStart } : {}),
          ...(subscriptionId ? { subscriptionId } : {}),
        });
        if (!result) {
          respondInvalid(respond, "当前没有可结算订阅，无法结算。");
          return;
        }
        respond(true, {
          bill: result.bill,
          snapshot: result.snapshot,
          settlementKey: result.settlementKey,
          deduped: result.deduped,
          subscriptionId: result.subscription.id,
          cycleStart: result.cycle.cycleStart,
          cycleEnd: result.cycle.cycleEnd,
          periodIndex: result.cycle.periodIndex,
          mode: "final",
        });
      } catch (err) {
        if (
          err instanceof CycleNotEndedError ||
          err instanceof NoCompletedCycleError ||
          err instanceof NoPendingSettlementError ||
          err instanceof ContractEndedError ||
          err instanceof InvalidContractError ||
          err instanceof SettlementConfigError
        ) {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
