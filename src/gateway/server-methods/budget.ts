/**
 * 企业预算 handler（WRITE + `usage:budget` 成员权限双闸，R6 / R14）。
 *
 * 方法：budget.set / budget.get
 */

import { getBudget, listBudgetEvents, setBudget } from "../billing/budgets-store.js";
import { USAGE_BUDGET_PERMISSION } from "../billing/scope.js";
import type { BudgetControls } from "../billing/types.js";
import {
  ensurePermission,
  isRecord,
  numberValue,
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function parseControls(raw: unknown): Partial<BudgetControls> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const controls: Partial<BudgetControls> = {};
  if (typeof raw.limitAiCalls === "boolean") {
    controls.limitAiCalls = raw.limitAiCalls;
  }
  if (typeof raw.limitBotCreation === "boolean") {
    controls.limitBotCreation = raw.limitBotCreation;
  }
  if (typeof raw.autoDowngrade === "boolean") {
    controls.autoDowngrade = raw.autoDowngrade;
  }
  return controls;
}

export const budgetHandlers: GatewayRequestHandlers = {
  "budget.set": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      // 双闸：operator WRITE scope（method-scopes 已校验）+ 成员 usage:budget 权限。
      if (!ensurePermission(scope, USAGE_BUDGET_PERMISSION, respond)) {
        return;
      }
      const monthlyLimitCents = numberValue(params.monthlyLimitCents);
      if (monthlyLimitCents === null) {
        respondInvalid(respond, "monthlyLimitCents 是必填项");
        return;
      }
      if (monthlyLimitCents < 0) {
        respondInvalid(respond, "monthlyLimitCents 不能为负数");
        return;
      }
      const alertThresholdRaw = numberValue(params.alertThreshold);
      if (alertThresholdRaw !== null && (alertThresholdRaw < 0 || alertThresholdRaw > 1)) {
        respondInvalid(respond, "alertThreshold 必须在 0 到 1 之间");
        return;
      }
      const budget = await setBudget({
        enterpriseId: scope.enterpriseId,
        monthlyLimitCents,
        alertThreshold: alertThresholdRaw ?? undefined,
        controls: parseControls(params.controls),
      });
      respond(true, { budget });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "budget.get": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const budget = await getBudget(scope.enterpriseId);
      const history = await listBudgetEvents(scope.enterpriseId);
      respond(true, { budget, history });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
