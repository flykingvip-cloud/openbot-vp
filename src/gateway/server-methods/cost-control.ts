/**
 * 成本控制闸口 handler（READ）。执行前校验受控调用是否放行（R8 / R23）。
 *
 * 方法：cost-control.check
 */

import type { GateAction } from "../billing/control.js";
import { enforceCostControl } from "../billing/enforce.js";
import { computeBudgetStatus } from "../billing/runtime.js";
import {
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const costControlHandlers: GatewayRequestHandlers = {
  "cost-control.check": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const action = stringValue(params.action) as GateAction | null;
      if (action !== "ai" && action !== "bot") {
        respondInvalid(respond, "action 必须是 'ai' 或 'bot'");
        return;
      }
      const decision = await enforceCostControl({ enterpriseId: scope.enterpriseId, action });
      const status = await computeBudgetStatus(scope.enterpriseId);
      if (decision.allowed) {
        respond(true, { allowed: true, budgetLevel: status.level });
      } else {
        respond(true, { allowed: false, reason: decision.reason, budgetLevel: status.level });
      }
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
