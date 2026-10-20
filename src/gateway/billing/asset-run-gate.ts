import {
  assetControlKey,
  readTenantControls,
} from "../enterprise-security/tenant-controls-store.js";
import { resolveContainingCycle } from "./billing-period.js";
import { costCentsForRecord } from "./organization-monthly-seat-usage.js";
import { getPlanVersion } from "./plans-store.js";
/**
 * Per-asset pause and per-agent budget checked by authorizeCommercialRun.
 * Group spend is not metered here: usage rows have no group id.
 */
import type { Subscription } from "./types.js";
import { listUsageRecords } from "./usage-records-store.js";

export type AssetRunBlock = {
  blocked: true;
  reason: "ASSET_PAUSED" | "ASSET_BUDGET_EXCEEDED";
  message: string;
};

export type AssetRunAllow = { blocked: false };

function pauseMessage(assetType: "agent" | "group"): string {
  return assetType === "group"
    ? "该协作小组已暂停，新的运行不会开始。"
    : "该机器人已暂停，新的运行不会开始。";
}

export async function evaluateAssetPause(params: {
  enterpriseId: string;
  agentId?: string;
  groupId?: string;
}): Promise<AssetRunBlock | AssetRunAllow> {
  let controls;
  try {
    controls = await readTenantControls(params.enterpriseId);
  } catch {
    return {
      blocked: true,
      reason: "ASSET_PAUSED",
      message: "对象暂停状态无法读取，本次运行已拒绝。",
    };
  }
  const agentId = params.agentId?.trim();
  if (agentId) {
    const pause = controls.assetPauses[assetControlKey("agent", agentId)];
    if (pause?.paused) {
      return { blocked: true, reason: "ASSET_PAUSED", message: pauseMessage("agent") };
    }
  }
  const groupId = params.groupId?.trim();
  if (groupId) {
    const pause = controls.assetPauses[assetControlKey("group", groupId)];
    if (pause?.paused) {
      return { blocked: true, reason: "ASSET_PAUSED", message: pauseMessage("group") };
    }
  }
  return { blocked: false };
}

export async function evaluateAssetBudget(params: {
  enterpriseId: string;
  agentId?: string;
  subscription: Pick<Subscription, "id" | "startTime" | "planVersionId" | "commercialContract">;
  now?: Date;
  plansPath?: string;
  usagePath?: string;
}): Promise<AssetRunBlock | AssetRunAllow> {
  const agentId = params.agentId?.trim();
  if (!agentId) {
    return { blocked: false };
  }
  let controls;
  try {
    controls = await readTenantControls(params.enterpriseId);
  } catch {
    return {
      blocked: true,
      reason: "ASSET_BUDGET_EXCEEDED",
      message: "对象预算无法读取，本次运行已拒绝。",
    };
  }
  const budget = controls.assetBudgets[assetControlKey("agent", agentId)];
  if (!budget) {
    return { blocked: false };
  }
  if (budget.monthlyLimitCents <= 0) {
    return {
      blocked: true,
      reason: "ASSET_BUDGET_EXCEEDED",
      message: "该机器人月度限额为 0，新的运行不会开始。",
    };
  }
  let cycleStart: string;
  let cycleEnd: string;
  try {
    const cycle = resolveContainingCycle(params.subscription, params.now ?? new Date());
    cycleStart = cycle.cycleStart;
    cycleEnd = cycle.cycleEnd;
  } catch {
    return {
      blocked: true,
      reason: "ASSET_BUDGET_EXCEEDED",
      message: "无法确定该机器人的账期，本次运行已拒绝。",
    };
  }
  let records;
  try {
    records = await listUsageRecords(
      params.enterpriseId,
      { agentId, startTime: cycleStart, endTime: cycleEnd },
      params.usagePath,
    );
  } catch {
    return {
      blocked: true,
      reason: "ASSET_BUDGET_EXCEEDED",
      message: "无法读取该机器人的用量，本次运行已拒绝。",
    };
  }
  if (records.length === 0) {
    return { blocked: false };
  }
  const version = await getPlanVersion(params.subscription.planVersionId, params.plansPath);
  if (!version) {
    return {
      blocked: true,
      reason: "ASSET_BUDGET_EXCEEDED",
      message: "缺少套餐定价，无法确认该机器人是否超出限额。",
    };
  }
  const missing = new Set<string>();
  let cents = 0;
  for (const record of records) {
    const before = missing.size;
    cents += costCentsForRecord(record, version, missing);
    if (missing.size > before) {
      return {
        blocked: true,
        reason: "ASSET_BUDGET_EXCEEDED",
        message: "用量缺少单价，无法确认该机器人是否超出限额。",
      };
    }
  }
  if (cents >= budget.monthlyLimitCents) {
    return {
      blocked: true,
      reason: "ASSET_BUDGET_EXCEEDED",
      message: "该机器人本账期花费已达到单独限额，新的运行不会开始。",
    };
  }
  return { blocked: false };
}
