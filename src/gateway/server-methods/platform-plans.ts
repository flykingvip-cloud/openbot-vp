/**
 * 平台端套餐 / 定价 handler（ADMIN）。价格唯一真相，企业不可写（R1 / R2 / R14）。
 *
 * 方法：
 * - platform-plans.create / platform-plans.update / platform-plans.list
 * - platform-pricing.set / platform-pricing.list
 * - platform-pricing.create-version / activate / deprecate / list-versions / diff（版本生命周期）
 */

import { loadConfig } from "../../config/config.js";
import {
  activatePlanVersion,
  createPlan,
  createPlanVersion,
  deletePlanVersion,
  deprecatePlanVersion,
  getCurrentPlanVersion,
  getPlan,
  getPlanVersion,
  listPlans,
  listPlanVersions,
  updatePlan,
} from "../billing/plans-store.js";
import { isPlanVersionReferenced } from "../billing/subscriptions-store.js";
import type { BillingCycle, PricingType, SeatRole } from "../billing/types.js";
import { comparePlanVersions } from "../billing/version-lifecycle.js";
import {
  deletePlanVersionModelBinding,
  getPlanVersionModelBinding,
  upsertPlanVersionModelBinding,
} from "../model-entitlement/plan-version-model-binding-store.js";
import { listConfiguredModelIds } from "../model-entitlement/resolve-effective-model-set.js";
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

/** 校验计费周期，返回合法 BillingCycle 或 null。 */
function parseBillingCycle(raw: string | null): BillingCycle | null {
  return exactMember(raw, BILLING_CYCLES);
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

function parsePricing(
  raw: unknown,
):
  | { ok: true; pricing: Array<{ type: PricingType; key: string; priceCents: number }> }
  | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, pricing: [] };
  }
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
    if (priceCents === null) {
      return { ok: false, error: "定价项缺少 priceCents" };
    }
    if (priceCents < 0) {
      return { ok: false, error: "priceCents 不能为负数" };
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

function actorId(client: GatewayClient | null): string {
  return client?.user?.trim().toLowerCase() || "platform-admin";
}

async function inheritPlanVersionBinding(planId: string, versionId: string): Promise<void> {
  const current = await getCurrentPlanVersion(planId);
  if (!current) {
    return;
  }
  const binding = await getPlanVersionModelBinding(current.id);
  if (!binding) {
    return;
  }
  await upsertPlanVersionModelBinding({
    planVersionId: versionId,
    allowedModelIds: binding.allowedModelIds,
    ...(binding.modelQuota ? { modelQuota: binding.modelQuota } : {}),
    ...(binding.aorExecution ? { aorExecution: binding.aorExecution } : {}),
  });
}

async function getPlanVersionBindingIssues(
  versionId: string,
): Promise<{ hasBinding: boolean; blockers: string[] }> {
  const binding = await getPlanVersionModelBinding(versionId);
  if (!binding) {
    return { hasBinding: false, blockers: ["该版本尚未配置可用模型绑定。"] };
  }
  if (binding.allowedModelIds.length === 0) {
    return { hasBinding: true, blockers: ["该版本的可用模型集合为空，不能激活。"] };
  }
  const catalog = new Set(listConfiguredModelIds(loadConfig()));
  const invalidModelIds = binding.allowedModelIds.filter((modelId) => !catalog.has(modelId));
  if (invalidModelIds.length > 0) {
    return {
      hasBinding: true,
      blockers: [`该版本包含目录外模型，不能激活：${invalidModelIds.join(", ")}`],
    };
  }
  return { hasBinding: true, blockers: [] };
}

export const platformPlansHandlers: GatewayRequestHandlers = {
  "platform-plans.create": async ({ client, params, respond }) => {
    try {
      const name = stringValue(params.name);
      const billingCycleRaw = stringValue(params.billingCycle);
      const basePriceCents = numberValue(params.basePriceCents);
      if (!name) {
        respondInvalid(respond, "name 是必填项");
        return;
      }
      const billingCycle = parseBillingCycle(billingCycleRaw);
      if (!billingCycle) {
        respondInvalid(respond, "billingCycle 仅支持 'monthly' | 'quarterly' | 'annual'");
        return;
      }
      if (basePriceCents === null) {
        respondInvalid(respond, "basePriceCents 是必填项");
        return;
      }
      if (basePriceCents < 0) {
        respondInvalid(respond, "basePriceCents 不能为负数");
        return;
      }
      const botQuota = numberValue(params.botQuota) ?? 0;
      if (botQuota < 0) {
        respondInvalid(respond, "botQuota 不能为负数");
        return;
      }
      const pricingResult = parsePricing(params.pricing);
      if (!pricingResult.ok) {
        respondInvalid(respond, pricingResult.error);
        return;
      }
      const metersResult = parseMeters(params.meters);
      if (!metersResult.ok) {
        respondInvalid(respond, metersResult.error);
        return;
      }
      try {
        const plan = await createPlan({
          name,
          billingCycle,
          basePriceCents,
          seatQuota: parseSeatQuota(params.seatQuota),
          botQuota: Math.floor(botQuota),
          pricing: pricingResult.pricing,
          ...(metersResult.meters ? { meters: metersResult.meters } : {}),
          createdByUserId: actorId(client),
        });
        respond(true, { planId: plan.id, plan });
      } catch (err) {
        if (err instanceof Error && err.name === "MeterValidationError") {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plans.update": async ({ client, params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      const basePriceCents = numberValue(params.basePriceCents);
      if (basePriceCents !== null && basePriceCents < 0) {
        respondInvalid(respond, "basePriceCents 不能为负数");
        return;
      }
      const botQuota = numberValue(params.botQuota);
      if (botQuota !== null && botQuota < 0) {
        respondInvalid(respond, "botQuota 不能为负数");
        return;
      }
      let pricing: Array<{ type: PricingType; key: string; priceCents: number }> | undefined;
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
      let result;
      try {
        result = await updatePlan({
          planId,
          name: stringValue(params.name) ?? undefined,
          basePriceCents: basePriceCents ?? undefined,
          seatQuota: params.seatQuota !== undefined ? parseSeatQuota(params.seatQuota) : undefined,
          botQuota: botQuota !== null ? Math.floor(botQuota) : undefined,
          pricing,
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
      await inheritPlanVersionBinding(planId, result.version.id);
      respond(true, { planVersionId: result.version.id, plan: result.plan });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-plans.list": async ({ respond }) => {
    try {
      const plans = await listPlans();
      respond(true, { plans });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};

export const platformPricingHandlers: GatewayRequestHandlers = {
  // 定价以 PlanVersion 不可变快照承载；set 等价于对该 plan 追加一个新版本，
  // 在现有 pricing 基础上 upsert (type,key)。
  "platform-pricing.set": async ({ client, params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      const type = oneOf(params.type, PRICING_TYPES);
      const key = stringValue(params.key);
      const priceCents = numberValue(params.priceCents);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      if (!type) {
        respondInvalid(respond, `无效的定价类型：${String(params.type)}`);
        return;
      }
      if (!key) {
        respondInvalid(respond, "key 是必填项");
        return;
      }
      if (priceCents === null) {
        respondInvalid(respond, "priceCents 是必填项");
        return;
      }
      if (priceCents < 0) {
        respondInvalid(respond, "priceCents 不能为负数");
        return;
      }
      const plan = await getPlan(planId);
      if (!plan) {
        respondInvalid(respond, `未找到套餐：${planId}`);
        return;
      }
      const currentVersion = await getCurrentPlanVersion(planId);
      const existingPricing = (currentVersion?.snapshot.pricing ?? []).map((p) => ({
        type: p.type,
        key: p.key,
        priceCents: p.priceCents,
      }));
      const idx = existingPricing.findIndex((p) => p.type === type && p.key === key);
      if (idx >= 0) {
        existingPricing[idx] = { type, key, priceCents };
      } else {
        existingPricing.push({ type, key, priceCents });
      }
      const result = await updatePlan({
        planId,
        pricing: existingPricing,
        createdByUserId: actorId(client),
      });
      if (!result) {
        respondInvalid(respond, `未找到套餐：${planId}`);
        return;
      }
      const pricingId = result.version.snapshot.pricing.find(
        (p) => p.type === type && p.key === key,
      )?.id;
      respond(true, { pricingId, planVersionId: result.version.id });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  // 企业端可读的只读定价视图（R2.7 / R3.1）。
  "platform-pricing.list": async ({ params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      const currentVersion = await getCurrentPlanVersion(planId);
      respond(true, { pricing: currentVersion?.snapshot.pricing ?? [] });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  // 创建 draft 版本（R24.1/24.6）。
  "platform-pricing.create-version": async ({ client, params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      const pricingResult = parsePricing(params.pricing);
      if (!pricingResult.ok) {
        respondInvalid(respond, pricingResult.error);
        return;
      }
      const metersResult = parseMeters(params.meters);
      if (!metersResult.ok) {
        respondInvalid(respond, metersResult.error);
        return;
      }
      const botQuota = numberValue(params.botQuota);
      if (botQuota !== null && botQuota < 0) {
        respondInvalid(respond, "botQuota 不能为负数");
        return;
      }
      const basePriceCents = numberValue(params.basePriceCents);
      if (basePriceCents !== null && basePriceCents < 0) {
        respondInvalid(respond, "basePriceCents 不能为负数");
        return;
      }
      let version;
      try {
        version = await createPlanVersion({
          planId,
          pricing: pricingResult.pricing,
          basePriceCents: basePriceCents ?? undefined,
          seatQuota: params.seatQuota !== undefined ? parseSeatQuota(params.seatQuota) : undefined,
          botQuota: botQuota !== null ? Math.floor(botQuota) : undefined,
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
      if (!version) {
        respondInvalid(respond, `未找到套餐：${planId}`);
        return;
      }
      await inheritPlanVersionBinding(planId, version.id);
      respond(true, { planVersionId: version.id, version });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  // 激活 draft 版本（R24.2/R25，requestId 幂等）。
  "platform-pricing.activate": async ({ client, params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      const versionId = stringValue(params.versionId);
      const requestId = stringValue(params.requestId) ?? `activate-${versionId}`;
      if (!planId || !versionId) {
        respondInvalid(respond, "planId 与 versionId 是必填项");
        return;
      }
      const bindingIssues = await getPlanVersionBindingIssues(versionId);
      if (bindingIssues.blockers.length > 0) {
        respondInvalid(respond, bindingIssues.blockers.join(" "));
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
      respond(true, { planVersion: result.planVersion });
    } catch (err) {
      // 非法流转（如激活非 draft）→ INVALID_REQUEST
      respondInvalid(respond, err instanceof Error ? err.message : String(err));
    }
  },

  // 废弃 active 版本（R24.2/R25.6，终态）。
  "platform-pricing.deprecate": async ({ client, params, respond }) => {
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
      respond(true, { planVersion: result.planVersion });
    } catch (err) {
      respondInvalid(respond, err instanceof Error ? err.message : String(err));
    }
  },

  // 删除某 draft / deprecated 版本（清理冗余历史）。
  // 守卫：active 不可删、currentVersionId 指向版本不可删、被任一订阅引用不可删。
  "platform-pricing.delete-version": async ({ params, respond }) => {
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
      respond(true, { deletedVersionId: versionId });
    } catch (err) {
      respondInvalid(respond, err instanceof Error ? err.message : String(err));
    }
  },

  // 列出某套餐全部版本（含 status）。
  "platform-pricing.list-versions": async ({ params, respond }) => {
    try {
      const planId = stringValue(params.planId);
      if (!planId) {
        respondInvalid(respond, "planId 是必填项");
        return;
      }
      const versions = await listPlanVersions(planId);
      respond(true, { versions });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  // 后端计算两版本定价差异（UI 展示「改了什么」，避免前端 diff 不一致）。
  /** @deprecated 请使用 `platform-plan-bundle.diff`；保留供旧客户端兼容。 */
  "platform-pricing.diff": async ({ params, respond }) => {
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
};
