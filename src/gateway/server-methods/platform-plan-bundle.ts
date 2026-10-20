/**
 * 平台端「套餐版本 + 模型绑定」一体化 handler。
 *
 * 目标：
 * - 以服务端单入口承接 plan + binding 的组合读写，避免前端串两个 RPC
 * - 保持数据层解耦：billing store 与 plan-model-binding store 仍分别落盘
 * - 为后续 pricing 页主流程切换到统一接口提供稳定基础
 */

import { loadConfig } from "../../config/config.js";
import { assertPlanVersionCapabilityMutable } from "../billing/plan-version-capability-guard.js";
import {
  activatePlanVersion,
  createPlan,
  deletePlanVersion,
  deprecatePlanVersion,
  getPlanVersion,
  listPlans,
  listPlanVersions,
  setPlanMarketingTags,
  setPlanMatchingProfile,
  updatePlan,
} from "../billing/plans-store.js";
import { provisionEnterpriseSubscription } from "../billing/subscription-provisioning.js";
import {
  isPlanVersionReferenced,
  migrateActiveSubscriptionsToPlanVersion,
} from "../billing/subscriptions-store.js";
import type {
  BillingCycle,
  PlanMatchingProfile,
  PricingType,
  PlanMarketingTag,
  SeatRole,
} from "../billing/types.js";
import { comparePlanVersions } from "../billing/version-lifecycle.js";
import { checkPlanBindingIntegrity } from "../model-entitlement/doctor-checks.js";
import { resolveModelEntitlementRoutingMode } from "../model-entitlement/entitlement-config.js";
import { refreshEntitlementsForPlanVersion } from "../model-entitlement/entitlement-projection.js";
import { previewPlanAllocation } from "../model-entitlement/plan-allocation-preview.js";
import {
  PLAN_BINDING_VISION_BLOCKER,
  planBindingIncludesVisionModel,
} from "../model-entitlement/plan-binding-vision.js";
import {
  deletePlanVersionModelBinding,
  getPlanVersionModelBinding,
  normalizeModelBudgetMap,
  normalizeModelQuotaMap,
  upsertPlanVersionModelBinding,
} from "../model-entitlement/plan-version-model-binding-store.js";
import { listConfiguredModelIds } from "../model-entitlement/resolve-effective-model-set.js";
import type { ModelBudget, ModelQuota } from "../model-entitlement/types.js";
import {
  deletePlanEntitlementSnapshot,
  getPlanEntitlementSnapshot,
  upsertPlanEntitlementSnapshot,
} from "../package-entitlement/plan-version-entitlement-store.js";
import type {
  EntitlementOveragePolicy,
  EntitlementSnapshot,
} from "../package-entitlement/types.js";
import { buildPricingCatalogViewModel } from "../platform/pricing/pricing-view-model.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { listResourceModelCatalog } from "../resource-catalog/models-catalog-store.js";
import { resolveModelsFromTiers } from "../resource-catalog/resolve.js";
import {
  exactMember,
  isRecord,
  numberValue,
  oneOf,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

const PRICING_TYPES = ["seat", "usage", "extra"] as const;

const BILLING_CYCLES = ["monthly", "quarterly", "annual"] as const;

const OVERAGE_POLICY_TYPES = ["block", "credits_only", "pay_as_you_go"] as const;

/** 解析超额策略；undefined=未传，null=格式非法。 */
function parseOveragePolicy(raw: unknown): EntitlementOveragePolicy | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    return null;
  }
  const type = oneOf(raw.type, OVERAGE_POLICY_TYPES);
  if (!type) {
    return null;
  }
  return {
    type,
    allowBurstConcurrency: raw.allowBurstConcurrency === true,
  };
}

function overagePolicyFromParams(params: Record<string, unknown>): {
  overagePolicy?: EntitlementOveragePolicy;
  error?: string;
} {
  const parsed = parseOveragePolicy(params.overagePolicy);
  if (parsed === null) {
    return {
      error:
        "overagePolicy 必须是 { type: block|credits_only|pay_as_you_go, allowBurstConcurrency? } 对象",
    };
  }
  return parsed !== undefined ? { overagePolicy: parsed } : {};
}

/** 校验计费周期，返回合法 BillingCycle 或 null。 */
function parseBillingCycle(raw: string | null): BillingCycle | null {
  return exactMember(raw, BILLING_CYCLES);
}
const SELECTOR_STRATEGIES = ["cheapest", "best_quality", "balanced", "bandit"] as const;
const MARKETING_TAGS = ["default", "recommended"] as const;

function parseMarketingTags(raw: unknown): PlanMarketingTag[] | null {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const tags: PlanMarketingTag[] = [];
  for (const entry of raw) {
    const tag = exactMember(entry, MARKETING_TAGS);
    if (!tag) {
      return null;
    }
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

function parseMatchingProfile(raw: unknown): PlanMatchingProfile | null {
  if (raw === undefined) {
    return {};
  }
  if (!isRecord(raw)) {
    return null;
  }
  const profile: PlanMatchingProfile = {};
  if (raw.targetPersonas !== undefined) {
    if (!Array.isArray(raw.targetPersonas)) {
      return null;
    }
    const tags: string[] = [];
    for (const entry of raw.targetPersonas) {
      if (typeof entry !== "string") {
        return null;
      }
      const trimmed = entry.trim();
      if (trimmed && !tags.includes(trimmed)) {
        tags.push(trimmed);
      }
    }
    profile.targetPersonas = tags;
  }
  if (raw.matchingPriority !== undefined) {
    const priority = numberValue(raw.matchingPriority);
    if (priority == null) {
      return null;
    }
    profile.matchingPriority = priority;
  }
  if (raw.inPlanFlexibilityNotes !== undefined) {
    if (typeof raw.inPlanFlexibilityNotes !== "string") {
      return null;
    }
    profile.inPlanFlexibilityNotes = raw.inPlanFlexibilityNotes;
  }
  if (raw.beyondPlanNotes !== undefined) {
    if (typeof raw.beyondPlanNotes !== "string") {
      return null;
    }
    profile.beyondPlanNotes = raw.beyondPlanNotes;
  }
  return profile;
}

function actorId(client: GatewayClient | null): string {
  return client?.user?.trim().toLowerCase() || "platform-admin";
}

function parseSeatQuota(raw: unknown): Partial<Record<SeatRole, number>> {
  const quota: Partial<Record<SeatRole, number>> = {};
  if (!isRecord(raw)) {
    return quota;
  }
  for (const role of ["viewer", "creator", "admin"] as SeatRole[]) {
    const value = numberValue(raw[role]);
    if (value !== null && value >= 0) {
      quota[role] = Math.floor(value);
    }
  }
  return quota;
}

function parsePricing(raw: unknown):
  | { ok: true; pricing: Array<{ type: PricingType; key: string; priceCents: number }> }
  | {
      ok: false;
      error: string;
    } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "pricing 必须是数组" };
  }
  const pricing: Array<{ type: PricingType; key: string; priceCents: number }> = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      return { ok: false, error: "pricing 项必须是对象" };
    }
    const type = oneOf(entry.type, PRICING_TYPES);
    const key = stringValue(entry.key);
    const priceCents = numberValue(entry.priceCents);
    if (!type) {
      return { ok: false, error: `无效的定价类型：${String(entry.type)}` };
    }
    if (!key) {
      return { ok: false, error: "定价项缺少 key" };
    }
    if (priceCents === null || priceCents < 0) {
      return { ok: false, error: "定价项缺少合法的 priceCents" };
    }
    pricing.push({ type, key, priceCents });
  }
  return { ok: true, pricing };
}

const METER_UNITS = new Set(["credit", "token", "cent", "count"]);

function parseMeters(raw: unknown):
  | {
      ok: true;
      meters?: Array<{
        key: string;
        unit: "credit" | "token" | "cent" | "count";
        includedQuota?: number;
        chargeIncludedAtUsagePrice: boolean;
        allowOverage: boolean;
        aggregate?: "sum";
        rounding?: "integer";
      }>;
    }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, meters: undefined };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: "meters 必须是数组" };
  }
  const meters: Array<{
    key: string;
    unit: "credit" | "token" | "cent" | "count";
    includedQuota?: number;
    chargeIncludedAtUsagePrice: boolean;
    allowOverage: boolean;
    aggregate?: "sum";
    rounding?: "integer";
  }> = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      return { ok: false, error: "meters 项必须是对象" };
    }
    const key = stringValue(entry.key);
    const unit = stringValue(entry.unit);
    if (!key) {
      return { ok: false, error: "meter 缺少 key" };
    }
    if (!unit || !METER_UNITS.has(unit)) {
      return { ok: false, error: `meter unit 无效：${String(entry.unit)}` };
    }
    const includedQuota = numberValue(entry.includedQuota);
    meters.push({
      key,
      unit: unit as "credit" | "token" | "cent" | "count",
      ...(includedQuota !== null ? { includedQuota } : {}),
      chargeIncludedAtUsagePrice: entry.chargeIncludedAtUsagePrice === true,
      allowOverage: entry.allowOverage === true,
      aggregate: "sum",
      rounding: "integer",
    });
  }
  return { ok: true, meters };
}

function parseAorExecution(raw: unknown):
  | undefined
  | {
      taskTypeId: string;
      selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
      evaluatorMode: string;
    }
  | { error: string } {
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

function parseAllowedModelIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  return [...new Set(raw.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean))];
}

function parseAllowedTiers(raw: unknown): string[] | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  return [...new Set(raw.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean))];
}

function parseAllowedPolicies(raw: unknown): string[] | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  return [...new Set(raw.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean))];
}

function parsePolicyId(raw: unknown): string | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = stringValue(raw);
  return value ?? null;
}

function parseOptionalTrimmedString(raw: unknown): string | undefined | null {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalNonNegativeInt(raw: unknown): number | undefined | null {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const value = numberValue(raw);
  if (value === null || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function parseEntitlementFeatures(
  raw: unknown,
): EntitlementSnapshot["features"] | undefined | null {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!isRecord(raw)) {
    return null;
  }
  const features: NonNullable<EntitlementSnapshot["features"]> = {};
  if (raw.auditLog !== undefined) {
    if (typeof raw.auditLog !== "boolean") {
      return null;
    }
    features.auditLog = raw.auditLog;
  }
  if (raw.mfa !== undefined) {
    if (typeof raw.mfa !== "boolean") {
      return null;
    }
    features.mfa = raw.mfa;
  }
  if (raw.sso !== undefined) {
    if (typeof raw.sso !== "boolean") {
      return null;
    }
    features.sso = raw.sso;
  }
  if (raw.vpcIsolation !== undefined) {
    if (typeof raw.vpcIsolation !== "boolean") {
      return null;
    }
    features.vpcIsolation = raw.vpcIsolation;
  }
  return Object.keys(features).length > 0 ? features : {};
}

function parseMarketingFeatures(raw: unknown): string[] | undefined | null {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  return [...new Set(raw.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean))];
}

function parseMarketingPresentation(params: Record<string, unknown>): {
  slogan?: string;
  targetAudience?: string;
  marketingFeatures?: string[];
  error?: string;
} {
  const slogan = parseOptionalTrimmedString(params.slogan);
  if (slogan === null) {
    return { error: "slogan 必须是字符串" };
  }
  const targetAudience = parseOptionalTrimmedString(params.targetAudience);
  if (targetAudience === null) {
    return { error: "targetAudience 必须是字符串" };
  }
  const marketingFeatures = parseMarketingFeatures(params.marketingFeatures);
  if (marketingFeatures === null) {
    return { error: "marketingFeatures 必须是字符串数组" };
  }
  return {
    ...(slogan !== undefined ? { slogan } : {}),
    ...(targetAudience !== undefined ? { targetAudience } : {}),
    ...(marketingFeatures !== undefined ? { marketingFeatures } : {}),
  };
}

function bindingUpsertFields(params: Record<string, unknown>) {
  const allowedTiers = parseAllowedTiers(params.allowedTiers);
  const allowedPolicies = parseAllowedPolicies(params.allowedPolicies);
  const policyId = parsePolicyId(params.policyId);
  return { allowedTiers, allowedPolicies, policyId };
}

function parseAiProfileQuota(
  raw: unknown,
): Partial<Record<"basic" | "pro" | "elite", number>> | undefined | null {
  if (raw === undefined) {
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const out: Partial<Record<"basic" | "pro" | "elite", number>> = {};
  for (const key of ["basic", "pro", "elite"] as const) {
    const value = obj[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num) || num < 0) {
      return null;
    }
    out[key] = Math.floor(num);
  }
  return out;
}

async function syncEntitlementSnapshot(input: {
  planVersionId: string;
  monthlyPriceCents: number;
  monthlyCredits: number;
  seatQuota: Partial<Record<SeatRole, number>>;
  botQuota: number;
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
  maxConcurrentRuns?: number;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  overagePolicy?: EntitlementOveragePolicy;
  allowedPolicies?: string[];
  allowedTiers?: string[];
  allowCustomPolicy?: boolean;
  allowPrivateModels?: boolean;
  features?: EntitlementSnapshot["features"];
}) {
  const existing = await getPlanEntitlementSnapshot(input.planVersionId);
  await assertPlanVersionCapabilityMutable(input.planVersionId, {
    kind: "entitlement",
    hasExistingRecord: Boolean(existing),
  });
  await upsertPlanEntitlementSnapshot({
    planVersionId: input.planVersionId,
    monthlyPriceCents: input.monthlyPriceCents,
    monthlyCredits: input.monthlyCredits,
    maxSeats: input.seatQuota,
    maxBots: input.botQuota,
    ...(input.aiProfileQuota
      ? { aiProfileQuota: input.aiProfileQuota }
      : existing?.aiProfileQuota
        ? { aiProfileQuota: existing.aiProfileQuota }
        : {}),
    ...(input.maxConcurrentRuns !== undefined
      ? { maxConcurrentRuns: input.maxConcurrentRuns }
      : {}),
    ...(input.maxWorkflows !== undefined ? { maxWorkflows: input.maxWorkflows } : {}),
    ...(input.maxKnowledgeBases !== undefined
      ? { maxKnowledgeBases: input.maxKnowledgeBases }
      : {}),
    overagePolicy: input.overagePolicy ?? existing?.overagePolicy,
    allowedPolicies: input.allowedPolicies ?? [],
    allowedTiers: input.allowedTiers ?? [],
    ...(input.allowCustomPolicy !== undefined
      ? { allowCustomPolicy: input.allowCustomPolicy }
      : {}),
    ...(input.allowPrivateModels !== undefined
      ? { allowPrivateModels: input.allowPrivateModels }
      : {}),
    ...(input.features !== undefined ? { features: input.features } : {}),
  });
  // 能力事实写入后（调用方已先 upsertPlanVersionModelBinding），刷新所有锁定该版本的
  // 存量订阅企业 entitlement 投影，与 model-entitlement-management.set 路径对齐。
  // 否则平台经 bundle 改绑定/权益后，存量租户仍读旧/空 EnterpriseModelEntitlement，
  // 导致企业端「可用模型」滞后或显示为 0。无锁定该版本的租户时为幂等 no-op。
  await refreshEntitlementsForPlanVersion(input.planVersionId, {
    routingMode: resolveModelEntitlementRoutingMode(loadConfig()),
  });
}

function bindingExtrasFromParams(params: Record<string, unknown>) {
  const { allowedTiers, allowedPolicies, policyId } = bindingUpsertFields(params);
  return {
    ...(allowedTiers ? { allowedTiers } : {}),
    ...(allowedPolicies ? { allowedPolicies } : {}),
    ...(policyId ? { policyId } : {}),
  };
}

/**
 * 解析 modelQuota 入参为 `Record<modelId, ModelQuota>`（每模型 { maxRequests?, maxTokens? }）。
 * 兼容 legacy 单值形态 `Record<modelId, number>`（视作 maxRequests），由归一化器处理。
 */
function parseModelQuota(raw: unknown): Record<string, ModelQuota> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  return normalizeModelQuotaMap(raw);
}

/**
 * Phase 4：解析 modelBudgets 入参为 `Record<modelId, ModelBudget>`
 * （每模型 { monthlyCreditsCap?, spendCapCents? }）。独立于 modelQuota。
 */
function parseModelBudgets(raw: unknown): Record<string, ModelBudget> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  return normalizeModelBudgetMap(raw);
}

/**
 * Phase 3（后端结构收敛）：Tier 是套餐配置真源，`allowedModelIds` 降级为「派生缓存」。
 *
 * - 当 `allowedTiers` 存在：服务端按 Tier 投影资源目录解析出模型池，作为权威 `allowedModelIds`，
 *   不再信任调用方手工传入的 `allowedModelIds`（前端 Phase 1 已先行投影，这里是服务端兜底/真源）。
 * - 当无 `allowedTiers`（legacy 绑定）：保留手工 `allowedModelIds`，保持向后兼容。
 *
 * 仍向后端 store 写出 `allowedModelIds`（兼容企业端/员工端 entitlement 链路），
 * 只是其来源从「人工双配」收敛为「Tier 派生」。
 */
async function resolveEffectiveModelIds(
  allowedTiers: readonly string[] | undefined,
  manualModelIds: readonly string[],
): Promise<string[]> {
  if (!allowedTiers || allowedTiers.length === 0) {
    return [...manualModelIds];
  }
  const catalog = await listResourceModelCatalog();
  return resolveModelsFromTiers({ allowedTierIds: allowedTiers, catalog }).modelIds;
}

function validateBindingInput(
  allowedModelIds: string[],
  modelQuota: Record<string, ModelQuota> | undefined,
  options?: { requireNonEmpty?: boolean; modelBudgets?: Record<string, ModelBudget> },
): string[] {
  const blockers: string[] = [];
  if (options?.requireNonEmpty !== false && allowedModelIds.length === 0) {
    blockers.push("至少需绑定 1 个可用模型。");
  }
  const catalog = new Set(listConfiguredModelIds(loadConfig()));
  const invalidModelIds = allowedModelIds.filter((id) => !catalog.has(id));
  if (invalidModelIds.length > 0) {
    blockers.push(`以下模型不在当前平台目录内：${invalidModelIds.join(", ")}`);
  }
  if (modelQuota) {
    const invalidQuotaKeys = Object.keys(modelQuota).filter(
      (key) => !allowedModelIds.includes(key),
    );
    if (invalidQuotaKeys.length > 0) {
      blockers.push(`以下 modelQuota 条目不在 allowedModelIds 内：${invalidQuotaKeys.join(", ")}`);
    }
  }
  if (options?.modelBudgets) {
    const invalidBudgetKeys = Object.keys(options.modelBudgets).filter(
      (key) => !allowedModelIds.includes(key),
    );
    if (invalidBudgetKeys.length > 0) {
      blockers.push(
        `以下 modelBudgets 条目不在 allowedModelIds 内：${invalidBudgetKeys.join(", ")}`,
      );
    }
  }
  return blockers;
}

async function validateBindingVisionBlockers(
  allowedModelIds: string[],
  cfg?: ReturnType<typeof loadConfig>,
): Promise<string[]> {
  if (allowedModelIds.length === 0) {
    return [];
  }
  const includesVision = await planBindingIncludesVisionModel(cfg ?? loadConfig(), allowedModelIds);
  return includesVision ? [] : [PLAN_BINDING_VISION_BLOCKER];
}

async function buildBundleOverview() {
  const cfg = loadConfig();
  const catalog = listConfiguredModelIds(cfg);
  const plans = await listPlans();
  const rows = await Promise.all(
    plans.map(async (plan) => {
      const versions = await listPlanVersions(plan.id);
      const versionRows = await Promise.all(
        versions.map(async (version) => {
          const binding = await getPlanVersionModelBinding(version.id);
          const entitlementSnapshot = await getPlanEntitlementSnapshot(version.id);
          const invalidModelIds =
            binding?.allowedModelIds.filter((id) => !catalog.includes(id)) ?? [];
          const blockers: string[] = [];
          if (!binding) {
            blockers.push("missing_binding");
          } else {
            if (binding.allowedModelIds.length === 0) {
              blockers.push("empty_binding");
            }
            if (invalidModelIds.length > 0) {
              blockers.push("invalid_catalog");
            }
            if (
              binding.allowedModelIds.length > 0 &&
              invalidModelIds.length === 0 &&
              !(await planBindingIncludesVisionModel(cfg, binding.allowedModelIds))
            ) {
              blockers.push("missing_vision_model");
            }
          }
          return {
            versionId: version.id,
            version: version.version,
            status: version.status,
            snapshot: version.snapshot,
            ...(binding ? { binding } : {}),
            ...(entitlementSnapshot ? { entitlementSnapshot } : {}),
            bindingState: !binding
              ? "missing"
              : invalidModelIds.length > 0
                ? "invalid_catalog"
                : binding.allowedModelIds.length === 0
                  ? "empty"
                  : "valid",
            activationReady: blockers.length === 0,
            activationBlockers: blockers,
          };
        }),
      );
      return {
        plan,
        versions: versionRows,
      };
    }),
  );
  const activePlans = rows.map((row) => row.plan).filter((plan) => plan.status === "active");
  const entitlementByPlanVersionId = new Map<string, EntitlementSnapshot | undefined>();
  for (const row of rows) {
    if (row.plan.status !== "active") {
      continue;
    }
    const current = row.versions.find((version) => version.versionId === row.plan.currentVersionId);
    if (current?.entitlementSnapshot) {
      entitlementByPlanVersionId.set(row.plan.currentVersionId, current.entitlementSnapshot);
    }
  }
  const pricingCatalog = buildPricingCatalogViewModel({
    plans: activePlans,
    entitlementByPlanVersionId,
  });
  return { catalog, plans: rows, pricingCatalog };
}

let bundleOverviewInFlight: Promise<Awaited<ReturnType<typeof buildBundleOverview>>> | null = null;
let bundleOverviewJsonInFlight: Promise<string> | null = null;
const OVERVIEW_CONN_WINDOW_MS = 1_000;
const OVERVIEW_CONN_MAX_REQUESTS = 3;
const overviewWindowByConn = new Map<string, { windowStartMs: number; count: number }>();
const overviewInFlightConnIds = new Set<string>();

async function buildBundleOverviewShared() {
  if (bundleOverviewInFlight) {
    return bundleOverviewInFlight;
  }
  const task = buildBundleOverview().finally(() => {
    bundleOverviewInFlight = null;
  });
  bundleOverviewInFlight = task;
  return task;
}

async function buildBundleOverviewSerializedShared() {
  if (bundleOverviewJsonInFlight) {
    return bundleOverviewJsonInFlight;
  }
  const task = buildBundleOverviewShared()
    .then((overview) => JSON.stringify(overview))
    .finally(() => {
      bundleOverviewJsonInFlight = null;
    });
  bundleOverviewJsonInFlight = task;
  return task;
}

function checkOverviewConnBurst(connId: string | null | undefined): {
  suppress: boolean;
  retryAfterMs: number;
  count: number;
} {
  const id = connId?.trim();
  if (!id) {
    return { suppress: false, retryAfterMs: 0, count: 0 };
  }
  const now = Date.now();
  const existing = overviewWindowByConn.get(id);
  if (!existing || now - existing.windowStartMs >= OVERVIEW_CONN_WINDOW_MS) {
    overviewWindowByConn.set(id, { windowStartMs: now, count: 1 });
    return { suppress: false, retryAfterMs: 0, count: 1 };
  }
  existing.count += 1;
  const retryAfterMs = Math.max(0, existing.windowStartMs + OVERVIEW_CONN_WINDOW_MS - now);
  return {
    suppress: existing.count > OVERVIEW_CONN_MAX_REQUESTS,
    retryAfterMs,
    count: existing.count,
  };
}

async function buildBundlePlan(planId: string) {
  const overview = await buildBundleOverviewShared();
  return overview.plans.find((row) => row.plan.id === planId) ?? null;
}

export const platformPlanBundleHandlers: GatewayRequestHandlers = {
  "platform-plan-bundle.overview": async ({ client, params, respond }) => {
    try {
      const debugSource = stringValue(params.debugSource);
      const debugPath = stringValue(params.debugPath);
      const debugModuleUrl = stringValue(params.debugModuleUrl);
      const connId = client?.connId?.trim();
      if (connId && overviewInFlightConnIds.has(connId)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "platform-plan-bundle.overview already in progress for this connection",
            {
              retryable: true,
              retryAfterMs: 250,
            },
          ),
          {
            inflightOverviewSuppressed: true,
            retryAfterMs: 250,
            ...(debugSource ? { debugSource } : {}),
            ...(debugPath ? { debugPath } : {}),
            ...(debugModuleUrl ? { debugModuleUrl } : {}),
          },
        );
        return;
      }
      const burst = checkOverviewConnBurst(client?.connId);
      if (burst.suppress) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "platform-plan-bundle.overview temporarily rate limited; retry shortly",
            {
              retryable: true,
              retryAfterMs: burst.retryAfterMs,
            },
          ),
          {
            suppressedRepeatedOverview: true,
            repeatedOverviewCount: burst.count,
            retryAfterMs: burst.retryAfterMs,
            ...(debugSource ? { debugSource } : {}),
            ...(debugPath ? { debugPath } : {}),
            ...(debugModuleUrl ? { debugModuleUrl } : {}),
          },
        );
        return;
      }
      if (connId) {
        overviewInFlightConnIds.add(connId);
      }
      try {
        const [overview, serialized] = await Promise.all([
          buildBundleOverviewShared(),
          buildBundleOverviewSerializedShared(),
        ]);
        respond(true, overview, undefined, {
          __preSerializedPayloadJson: serialized,
          repeatedOverviewCount: burst.count,
          ...(debugSource ? { debugSource } : {}),
          ...(debugPath ? { debugPath } : {}),
          ...(debugModuleUrl ? { debugModuleUrl } : {}),
        });
      } finally {
        if (connId) {
          overviewInFlightConnIds.delete(connId);
        }
      }
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.list": async ({ respond }) => {
    try {
      const overview = await buildBundleOverviewShared();
      respond(true, { plans: overview.plans });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.get": async ({ params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      const plan = await buildBundlePlan(planId);
      if (!plan) {
        respondInvalid(respond, `未找到套餐：${planId}`);
        return;
      }
      respond(true, plan);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.create": async ({ client, params, respond }) => {
    try {
      const name = stringValue(params.name);
      const billingCycleRaw = stringValue(params.billingCycle);
      const basePriceCents = numberValue(params.basePriceCents);
      const botQuota = numberValue(params.botQuota) ?? 0;
      const pricingResult = parsePricing(params.pricing);
      const metersResult = parseMeters(params.meters);
      const allowedModelIds = parseAllowedModelIds(params.allowedModelIds);
      const allowedTiers = parseAllowedTiers(params.allowedTiers);
      const modelQuota = parseModelQuota(params.modelQuota);
      const modelBudgets = parseModelBudgets(params.modelBudgets);
      const aorExecution = parseAorExecution(params.aorExecution);
      if (!name) {
        respondInvalid(respond, "name 是必填项");
        return;
      }
      const billingCycle = parseBillingCycle(billingCycleRaw);
      if (!billingCycle) {
        respondInvalid(respond, "billingCycle 仅支持 'monthly' | 'quarterly' | 'annual'");
        return;
      }
      if (basePriceCents === null || basePriceCents < 0) {
        respondInvalid(respond, "basePriceCents 是必填且不能为负数");
        return;
      }
      if (botQuota < 0) {
        respondInvalid(respond, "botQuota 不能为负数");
        return;
      }
      if (!pricingResult.ok) {
        respondInvalid(respond, pricingResult.error);
        return;
      }
      if (!metersResult.ok) {
        respondInvalid(respond, metersResult.error);
        return;
      }
      if (allowedModelIds === null) {
        respondInvalid(respond, "allowedModelIds 必须是字符串数组");
        return;
      }
      if (allowedTiers === null) {
        respondInvalid(respond, "allowedTiers 必须是字符串数组");
        return;
      }
      const { allowedPolicies, policyId } = bindingUpsertFields(params);
      if (allowedPolicies === null) {
        respondInvalid(respond, "allowedPolicies 必须是字符串数组");
        return;
      }
      if (policyId === null) {
        respondInvalid(respond, "policyId 必须是字符串");
        return;
      }
      if (aorExecution && "error" in aorExecution) {
        respondInvalid(respond, aorExecution.error);
        return;
      }
      const overageFields = overagePolicyFromParams(params);
      if (overageFields.error) {
        respondInvalid(respond, overageFields.error);
        return;
      }
      const maxWorkflows = parseOptionalNonNegativeInt(params.maxWorkflows);
      if (maxWorkflows === null) {
        respondInvalid(respond, "maxWorkflows 不能为负数");
        return;
      }
      const maxKnowledgeBases = parseOptionalNonNegativeInt(params.maxKnowledgeBases);
      if (maxKnowledgeBases === null) {
        respondInvalid(respond, "maxKnowledgeBases 不能为负数");
        return;
      }
      const features = parseEntitlementFeatures(params.features);
      if (features === null) {
        respondInvalid(respond, "features 必须是合法的布尔字段对象");
        return;
      }
      // Phase 3：Tier 为配置真源 → 服务端按 Tier 投影派生 allowedModelIds（无 Tier 时保留手工值）。
      const effectiveModelIds = await resolveEffectiveModelIds(allowedTiers, allowedModelIds);
      const blockers = [
        ...validateBindingInput(effectiveModelIds, modelQuota, { modelBudgets }),
        ...(await validateBindingVisionBlockers(effectiveModelIds)),
      ];
      if (blockers.length > 0) {
        respondInvalid(respond, blockers.join(" "));
        return;
      }
      const marketing = parseMarketingPresentation(params);
      if (marketing.error) {
        respondInvalid(respond, marketing.error);
        return;
      }
      let plan;
      try {
        plan = await createPlan({
          name,
          billingCycle,
          basePriceCents,
          seatQuota: parseSeatQuota(params.seatQuota),
          botQuota: Math.floor(botQuota),
          pricing: pricingResult.pricing,
          ...(metersResult.meters ? { meters: metersResult.meters } : {}),
          createdByUserId: actorId(client),
          ...(marketing.slogan ? { slogan: marketing.slogan } : {}),
          ...(marketing.targetAudience ? { targetAudience: marketing.targetAudience } : {}),
          ...(marketing.marketingFeatures
            ? { marketingFeatures: marketing.marketingFeatures }
            : {}),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "MeterValidationError") {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
      const seatQuota = parseSeatQuota(params.seatQuota);
      const monthlyCredits = numberValue(params.monthlyCredits) ?? 0;
      if (monthlyCredits < 0) {
        respondInvalid(respond, "monthlyCredits 不能为负数");
        return;
      }
      await upsertPlanVersionModelBinding({
        planVersionId: plan.currentVersionId,
        allowedModelIds: effectiveModelIds,
        ...bindingExtrasFromParams(params),
        ...(modelQuota ? { modelQuota } : {}),
        ...(modelBudgets ? { modelBudgets } : {}),
        ...(aorExecution ? { aorExecution } : {}),
      });
      const aiProfileQuota = parseAiProfileQuota(params.aiProfileQuota);
      if (aiProfileQuota === null) {
        respondInvalid(respond, "aiProfileQuota 必须是 basic/pro/elite 非负整数对象");
        return;
      }
      await syncEntitlementSnapshot({
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: basePriceCents,
        monthlyCredits,
        seatQuota,
        botQuota: Math.floor(botQuota),
        ...(aiProfileQuota !== undefined ? { aiProfileQuota } : {}),
        ...(numberValue(params.maxConcurrentRuns) !== null
          ? { maxConcurrentRuns: Math.max(0, Math.floor(numberValue(params.maxConcurrentRuns)!)) }
          : {}),
        ...(maxWorkflows !== undefined ? { maxWorkflows } : {}),
        ...(maxKnowledgeBases !== undefined ? { maxKnowledgeBases } : {}),
        ...(overageFields.overagePolicy ? { overagePolicy: overageFields.overagePolicy } : {}),
        allowedPolicies: allowedPolicies ?? [],
        allowedTiers: allowedTiers ?? [],
        ...(typeof params.allowCustomPolicy === "boolean"
          ? { allowCustomPolicy: params.allowCustomPolicy }
          : {}),
        ...(typeof params.allowPrivateModels === "boolean"
          ? { allowPrivateModels: params.allowPrivateModels }
          : {}),
        ...(features !== undefined ? { features } : {}),
      });
      const version = await getPlanVersion(plan.currentVersionId);
      respond(true, {
        plan,
        version,
        binding: await getPlanVersionModelBinding(plan.currentVersionId),
        entitlementSnapshot: await getPlanEntitlementSnapshot(plan.currentVersionId),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.create-version": async ({ client, params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      const pricingResult = parsePricing(params.pricing);
      const metersResult = parseMeters(params.meters);
      const allowedModelIds = parseAllowedModelIds(params.allowedModelIds);
      const allowedTiers = parseAllowedTiers(params.allowedTiers);
      const modelQuota = parseModelQuota(params.modelQuota);
      const modelBudgets = parseModelBudgets(params.modelBudgets);
      const aorExecution = parseAorExecution(params.aorExecution);
      if (!pricingResult.ok) {
        respondInvalid(respond, pricingResult.error);
        return;
      }
      if (!metersResult.ok) {
        respondInvalid(respond, metersResult.error);
        return;
      }
      if (allowedModelIds === null) {
        respondInvalid(respond, "allowedModelIds 必须是字符串数组");
        return;
      }
      if (allowedTiers === null) {
        respondInvalid(respond, "allowedTiers 必须是字符串数组");
        return;
      }
      const { allowedPolicies, policyId } = bindingUpsertFields(params);
      if (allowedPolicies === null) {
        respondInvalid(respond, "allowedPolicies 必须是字符串数组");
        return;
      }
      if (policyId === null) {
        respondInvalid(respond, "policyId 必须是字符串");
        return;
      }
      if (aorExecution && "error" in aorExecution) {
        respondInvalid(respond, aorExecution.error);
        return;
      }
      const overageFields = overagePolicyFromParams(params);
      if (overageFields.error) {
        respondInvalid(respond, overageFields.error);
        return;
      }
      const maxWorkflows = parseOptionalNonNegativeInt(params.maxWorkflows);
      if (maxWorkflows === null) {
        respondInvalid(respond, "maxWorkflows 不能为负数");
        return;
      }
      const maxKnowledgeBases = parseOptionalNonNegativeInt(params.maxKnowledgeBases);
      if (maxKnowledgeBases === null) {
        respondInvalid(respond, "maxKnowledgeBases 不能为负数");
        return;
      }
      const features = parseEntitlementFeatures(params.features);
      if (features === null) {
        respondInvalid(respond, "features 必须是合法的布尔字段对象");
        return;
      }
      // Phase 3：Tier 为配置真源 → 服务端按 Tier 投影派生 allowedModelIds（无 Tier 时保留手工值）。
      const effectiveModelIds = await resolveEffectiveModelIds(allowedTiers, allowedModelIds);
      const blockers = [
        ...validateBindingInput(effectiveModelIds, modelQuota, { modelBudgets }),
        ...(await validateBindingVisionBlockers(effectiveModelIds)),
      ];
      if (blockers.length > 0) {
        respondInvalid(respond, blockers.join(" "));
        return;
      }
      let result;
      try {
        result = await updatePlan({
          planId,
          name: stringValue(params.name) ?? undefined,
          basePriceCents: numberValue(params.basePriceCents) ?? undefined,
          seatQuota: params.seatQuota !== undefined ? parseSeatQuota(params.seatQuota) : undefined,
          botQuota: numberValue(params.botQuota) ?? undefined,
          pricing: pricingResult.pricing,
          ...(metersResult.meters ? { meters: metersResult.meters } : {}),
          createdByUserId: actorId(client),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "MeterValidationError") {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
      if (!result) {
        respondInvalid(respond, `未找到套餐：${planId}`);
        return;
      }
      await upsertPlanVersionModelBinding({
        planVersionId: result.version.id,
        allowedModelIds: effectiveModelIds,
        ...bindingExtrasFromParams(params),
        ...(modelQuota ? { modelQuota } : {}),
        ...(modelBudgets ? { modelBudgets } : {}),
        ...(aorExecution ? { aorExecution } : {}),
      });
      const monthlyCredits = numberValue(params.monthlyCredits) ?? 0;
      if (monthlyCredits < 0) {
        respondInvalid(respond, "monthlyCredits 不能为负数");
        return;
      }
      const aiProfileQuota = parseAiProfileQuota(params.aiProfileQuota);
      if (aiProfileQuota === null) {
        respondInvalid(respond, "aiProfileQuota 必须是 basic/pro/elite 非负整数对象");
        return;
      }
      await syncEntitlementSnapshot({
        planVersionId: result.version.id,
        monthlyPriceCents: result.version.snapshot.basePriceCents,
        monthlyCredits,
        seatQuota: result.version.snapshot.seatQuota,
        botQuota: result.version.snapshot.botQuota,
        ...(aiProfileQuota !== undefined ? { aiProfileQuota } : {}),
        ...(numberValue(params.maxConcurrentRuns) !== null
          ? { maxConcurrentRuns: Math.max(0, Math.floor(numberValue(params.maxConcurrentRuns)!)) }
          : {}),
        ...(maxWorkflows !== undefined ? { maxWorkflows } : {}),
        ...(maxKnowledgeBases !== undefined ? { maxKnowledgeBases } : {}),
        ...(overageFields.overagePolicy ? { overagePolicy: overageFields.overagePolicy } : {}),
        allowedPolicies: allowedPolicies ?? [],
        allowedTiers: allowedTiers ?? [],
        ...(typeof params.allowCustomPolicy === "boolean"
          ? { allowCustomPolicy: params.allowCustomPolicy }
          : {}),
        ...(typeof params.allowPrivateModels === "boolean"
          ? { allowPrivateModels: params.allowPrivateModels }
          : {}),
        ...(features !== undefined ? { features } : {}),
      });
      respond(true, {
        plan: result.plan,
        version: result.version,
        binding: await getPlanVersionModelBinding(result.version.id),
        entitlementSnapshot: await getPlanEntitlementSnapshot(result.version.id),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.update": async ({ client, params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      const allowedModelIds = parseAllowedModelIds(params.allowedModelIds);
      const allowedTiers = parseAllowedTiers(params.allowedTiers);
      const modelQuota = parseModelQuota(params.modelQuota);
      const modelBudgets = parseModelBudgets(params.modelBudgets);
      const aorExecution = parseAorExecution(params.aorExecution);
      if (allowedModelIds === null) {
        respondInvalid(respond, "allowedModelIds 必须是字符串数组");
        return;
      }
      if (allowedTiers === null) {
        respondInvalid(respond, "allowedTiers 必须是字符串数组");
        return;
      }
      const { allowedPolicies, policyId } = bindingUpsertFields(params);
      if (allowedPolicies === null) {
        respondInvalid(respond, "allowedPolicies 必须是字符串数组");
        return;
      }
      if (policyId === null) {
        respondInvalid(respond, "policyId 必须是字符串");
        return;
      }
      if (aorExecution && "error" in aorExecution) {
        respondInvalid(respond, aorExecution.error);
        return;
      }
      const overageFields = overagePolicyFromParams(params);
      if (overageFields.error) {
        respondInvalid(respond, overageFields.error);
        return;
      }
      const maxWorkflows = parseOptionalNonNegativeInt(params.maxWorkflows);
      if (maxWorkflows === null) {
        respondInvalid(respond, "maxWorkflows 不能为负数");
        return;
      }
      const maxKnowledgeBases = parseOptionalNonNegativeInt(params.maxKnowledgeBases);
      if (maxKnowledgeBases === null) {
        respondInvalid(respond, "maxKnowledgeBases 不能为负数");
        return;
      }
      const features = parseEntitlementFeatures(params.features);
      if (features === null) {
        respondInvalid(respond, "features 必须是合法的布尔字段对象");
        return;
      }
      let pricing:
        | Array<{
            type: PricingType;
            key: string;
            priceCents: number;
          }>
        | undefined;
      if (params.pricing !== undefined) {
        const pricingResult = parsePricing(params.pricing);
        if (!pricingResult.ok) {
          respondInvalid(respond, pricingResult.error);
          return;
        }
        pricing = pricingResult.pricing;
      }
      const metersResult = parseMeters(params.meters);
      if (!metersResult.ok) {
        respondInvalid(respond, metersResult.error);
        return;
      }
      // Phase 3：Tier 为配置真源 → 服务端按 Tier 投影派生 allowedModelIds（无 Tier 时保留手工值）。
      const effectiveModelIds = await resolveEffectiveModelIds(allowedTiers, allowedModelIds);
      const blockers = [
        ...validateBindingInput(effectiveModelIds, modelQuota, { modelBudgets }),
        ...(await validateBindingVisionBlockers(effectiveModelIds)),
      ];
      if (blockers.length > 0) {
        respondInvalid(respond, blockers.join(" "));
        return;
      }
      const marketing = parseMarketingPresentation(params);
      if (marketing.error) {
        respondInvalid(respond, marketing.error);
        return;
      }
      let result;
      try {
        result = await updatePlan({
          planId,
          name: stringValue(params.name) ?? undefined,
          basePriceCents: numberValue(params.basePriceCents) ?? undefined,
          seatQuota: params.seatQuota !== undefined ? parseSeatQuota(params.seatQuota) : undefined,
          botQuota: numberValue(params.botQuota) ?? undefined,
          pricing,
          ...(metersResult.meters ? { meters: metersResult.meters } : {}),
          createdByUserId: actorId(client),
          ...(marketing.slogan !== undefined ? { slogan: marketing.slogan ?? "" } : {}),
          ...(marketing.targetAudience !== undefined
            ? { targetAudience: marketing.targetAudience ?? "" }
            : {}),
          ...(marketing.marketingFeatures !== undefined
            ? { marketingFeatures: marketing.marketingFeatures ?? [] }
            : {}),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "MeterValidationError") {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
      if (!result) {
        respondInvalid(respond, `未找到套餐：${planId}`);
        return;
      }
      await upsertPlanVersionModelBinding({
        planVersionId: result.version.id,
        allowedModelIds: effectiveModelIds,
        ...bindingExtrasFromParams(params),
        ...(modelQuota ? { modelQuota } : {}),
        ...(modelBudgets ? { modelBudgets } : {}),
        ...(aorExecution ? { aorExecution } : {}),
      });
      const monthlyCredits = numberValue(params.monthlyCredits) ?? 0;
      if (monthlyCredits < 0) {
        respondInvalid(respond, "monthlyCredits 不能为负数");
        return;
      }
      const aiProfileQuota = parseAiProfileQuota(params.aiProfileQuota);
      if (aiProfileQuota === null) {
        respondInvalid(respond, "aiProfileQuota 必须是 basic/pro/elite 非负整数对象");
        return;
      }
      await syncEntitlementSnapshot({
        planVersionId: result.version.id,
        monthlyPriceCents: result.version.snapshot.basePriceCents,
        monthlyCredits,
        seatQuota: result.version.snapshot.seatQuota,
        botQuota: result.version.snapshot.botQuota,
        ...(aiProfileQuota !== undefined ? { aiProfileQuota } : {}),
        ...(numberValue(params.maxConcurrentRuns) !== null
          ? { maxConcurrentRuns: Math.max(0, Math.floor(numberValue(params.maxConcurrentRuns)!)) }
          : {}),
        ...(maxWorkflows !== undefined ? { maxWorkflows } : {}),
        ...(maxKnowledgeBases !== undefined ? { maxKnowledgeBases } : {}),
        ...(overageFields.overagePolicy ? { overagePolicy: overageFields.overagePolicy } : {}),
        allowedPolicies: allowedPolicies ?? [],
        allowedTiers: allowedTiers ?? [],
        ...(typeof params.allowCustomPolicy === "boolean"
          ? { allowCustomPolicy: params.allowCustomPolicy }
          : {}),
        ...(typeof params.allowPrivateModels === "boolean"
          ? { allowPrivateModels: params.allowPrivateModels }
          : {}),
        ...(features !== undefined ? { features } : {}),
      });
      respond(true, {
        plan: result.plan,
        version: result.version,
        binding: await getPlanVersionModelBinding(result.version.id),
        entitlementSnapshot: await getPlanEntitlementSnapshot(result.version.id),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.activate": async ({ client, params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      const versionId = stringValue(params.versionId);
      const requestId = stringValue(params.requestId) ?? `activate-${versionId}`;
      if (!planId || !versionId) {
        respondInvalid(respond, "planId 与 versionId 是必填项");
        return;
      }
      const targetVersion = await getPlanVersion(versionId);
      if (!targetVersion || targetVersion.planId !== planId) {
        respondInvalid(respond, `未找到套餐或版本：${planId}/${versionId}`);
        return;
      }
      const binding = await getPlanVersionModelBinding(versionId);
      if (!binding) {
        respondInvalid(respond, "该版本尚未配置可用模型绑定。");
        return;
      }
      if (binding.allowedModelIds.length === 0) {
        respondInvalid(respond, "该版本的可用模型集合为空，不能激活。");
        return;
      }
      const blockers = [
        ...validateBindingInput(binding.allowedModelIds, binding.modelQuota),
        ...(await validateBindingVisionBlockers(binding.allowedModelIds)),
      ];
      if (blockers.length > 0) {
        respondInvalid(respond, blockers.join(" "));
        return;
      }
      const result = await activatePlanVersion(
        { planId, versionId, requestId, changedByUserId: actorId(client) },
        undefined,
      );
      if (!result) {
        respondInvalid(respond, `未找到套餐或版本：${planId}/${versionId}`);
        return;
      }
      // 激活后自动把同套餐的现有 active 订阅切到新版本，并立即重建企业侧运行时真相。
      const migratedSubscriptions = await migrateActiveSubscriptionsToPlanVersion({
        planId,
        targetPlanVersionId: versionId,
      });
      for (const subscription of migratedSubscriptions) {
        await provisionEnterpriseSubscription({
          enterpriseId: subscription.enterpriseId,
          planVersionId: subscription.planVersionId,
          subscription,
          actorUserId: actorId(client),
        });
      }
      respond(true, {
        planVersion: result.planVersion,
        binding,
        ...(migratedSubscriptions.length > 0
          ? { autoMigratedEnterprises: migratedSubscriptions.map((sub) => sub.enterpriseId) }
          : {}),
      });
    } catch (err) {
      respondInvalid(respond, err instanceof Error ? err.message : String(err));
    }
  },

  "platform-plan-bundle.deprecate": async ({ client, params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      const versionId = stringValue(params.versionId);
      if (!planId || !versionId) {
        respondInvalid(respond, "planId 与 versionId 是必填项");
        return;
      }
      const result = await deprecatePlanVersion(
        { planId, versionId, changedByUserId: actorId(client) },
        undefined,
      );
      if (!result) {
        respondInvalid(respond, `未找到套餐或版本：${planId}/${versionId}`);
        return;
      }
      const binding = await getPlanVersionModelBinding(versionId);
      respond(true, {
        planVersion: result.planVersion,
        ...(binding ? { binding } : {}),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.set-marketing-tags": async ({ params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      const marketingTags = parseMarketingTags(params.marketingTags);
      if (marketingTags === null) {
        respondInvalid(respond, "marketingTags 必须是 default/recommended 字符串数组");
        return;
      }
      const plan = await setPlanMarketingTags(planId, marketingTags);
      if (!plan) {
        respondInvalid(respond, `未找到套餐：${planId}`);
        return;
      }
      respond(true, { plan });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.set-matching-profile": async ({ params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      const matchingProfile = parseMatchingProfile(params.matchingProfile);
      if (matchingProfile === null) {
        respondInvalid(respond, "matchingProfile 格式无效");
        return;
      }
      const plan = await setPlanMatchingProfile(planId, matchingProfile);
      if (!plan) {
        respondInvalid(respond, `未找到套餐：${planId}`);
        return;
      }
      respond(true, { plan });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.diff": async ({ params, respond }) => {
    try {
      const fromVersionId = stringValue(params.fromVersionId);
      const toVersionId = stringValue(params.toVersionId);
      if (!fromVersionId || !toVersionId) {
        respondInvalid(respond, "fromVersionId 与 toVersionId 是必填项");
        return;
      }
      const from = await getPlanVersion(fromVersionId);
      const to = await getPlanVersion(toVersionId);
      if (!from || !to) {
        respondInvalid(respond, "指定的版本不存在");
        return;
      }
      respond(true, { diff: comparePlanVersions(from, to) });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.consistency": async ({ respond }) => {
    try {
      const cfg = loadConfig();
      const issues = await checkPlanBindingIntegrity(cfg);
      const bindingIssues = issues.filter(
        (issue) =>
          issue.code === "plan_binding_missing" ||
          issue.code === "plan_binding_missing_vision" ||
          issue.code === "plan_binding_orphan" ||
          issue.code === "plan_binding_invalid_catalog",
      );
      respond(true, { issues: bindingIssues });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.preview-allocation": async ({ params, respond }) => {
    try {
      const planVersionId = stringValue(params.planVersionId);
      if (!planVersionId) {
        respondInvalid(respond, "planVersionId 是必填项");
        return;
      }
      const preview = await previewPlanAllocation(planVersionId);
      if (!preview) {
        respondInvalid(respond, `无法预览套餐版本：${planVersionId}`);
        return;
      }
      respond(true, { preview });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plan-bundle.delete-version": async ({ params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      const versionId = stringValue(params.versionId);
      if (!planId || !versionId) {
        respondInvalid(respond, "planId 与 versionId 是必填项");
        return;
      }
      if (await isPlanVersionReferenced(versionId)) {
        respondInvalid(respond, "该版本已被订阅引用，删除会破坏历史账单复算，禁止删除");
        return;
      }
      const result = await deletePlanVersion({ planId, versionId });
      if (!result.ok) {
        switch (result.reason) {
          case "plan-not-found":
          case "version-not-found":
            respondInvalid(respond, `未找到套餐或版本：${planId}/${versionId}`);
            return;
          case "active-forbidden":
            respondInvalid(respond, "生效中的版本不可删除，请先废弃或激活其他版本");
            return;
          case "current-forbidden":
            respondInvalid(respond, "当前指针指向的版本不可删除");
            return;
        }
      }
      await deletePlanVersionModelBinding(versionId);
      await deletePlanEntitlementSnapshot(versionId);
      respond(true, { deletedVersionId: versionId });
    } catch (err) {
      respondInvalid(respond, err instanceof Error ? err.message : String(err));
    }
  },
};
