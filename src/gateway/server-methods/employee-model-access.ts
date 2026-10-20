/**
 * 员工端只读「可用模型 + 拒绝原因」handler（P2，任务 12）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§8.2，R5.2）。
 *
 * 单方法 `employee-model-access.summary`：解析当前员工的受信 seat 上下文，
 * 调 `resolveEffectiveModelSet` 产出有效模型集合，映射为员工端只读摘要。
 *
 * **只读**：不接受任何客户端注入的 tenantId/seatId/employeeId（全部 server-side 解析），
 * 不暴露平台模型管理复杂度（仅返回 modelIds + state + reason + seatId）。
 */

import { loadConfig } from "../../config/config.js";
import { resolveTrustedEnterpriseDataExecutionContext } from "../enterprise-data/enterprise-data-seat-context.js";
import { resolveModelEntitlementEnforce } from "../model-entitlement/entitlement-config.js";
import { filterEmployeeDisplayModelIds } from "../model-entitlement/filter-employee-display-models.js";
import { resolveEffectiveModelSet } from "../model-entitlement/resolve-effective-model-set.js";
import { respondUnavailable } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

/** 员工端只读摘要（与 UI 侧 `EmployeeModelEntitlementSummary` 对齐）。 */
export type EmployeeModelEntitlementSummary = {
  modelIds: string[];
  state: "missing" | "resolved";
  reason: string;
  seatId?: string;
};

export const employeeModelAccessHandlers: GatewayRequestHandlers = {
  "employee-model-access.summary": async ({ client, respond }) => {
    try {
      // server-side 解析受信 seat 上下文（无注入面）。
      let ctx: { tenantId: string; seatId: string; employeeId: string };
      try {
        const resolved = await resolveTrustedEnterpriseDataExecutionContext(client);
        ctx = {
          tenantId: resolved.tenantId,
          seatId: resolved.seatId,
          employeeId: resolved.employeeId,
        };
      } catch {
        // 无 seat 上下文（未绑定 / 未登录企业）：按「未配置」两态之一返回，不报错。
        const summary: EmployeeModelEntitlementSummary = {
          modelIds: [],
          state: "missing",
          reason: "当前账号未绑定企业席位，暂无模型授权信息。",
        };
        respond(true, { summary });
        return;
      }

      const cfg = loadConfig();
      // missing-allow 灰度下「未配置」继承企业全集；strict 下不继承。
      const enforce = resolveModelEntitlementEnforce(cfg);
      const result = await resolveEffectiveModelSet({
        tenantId: ctx.tenantId,
        employeeId: ctx.employeeId,
        seatId: ctx.seatId,
        cfg,
        seatGrantInheritsEnterprise: enforce !== "strict",
      });

      // 展示 = 权益交集 ∩ 网关实际可调用（排除 CLI/监督通道与未配置 provider）。
      const displayModelIds = filterEmployeeDisplayModelIds(result.allowedModelIds, cfg);
      const dropped = result.allowedModelIds.length - displayModelIds.length;
      // 员工端文案：不暴露 ceiling ∩ grant 等内部解析细节。
      let reason = result.reason;
      if (result.state === "resolved") {
        if (displayModelIds.length > 0) {
          reason =
            dropped > 0
              ? `当前席位有 ${displayModelIds.length} 个可调用模型（已按可调用范围收敛）。`
              : "当前席位可调用的套餐模型。";
        } else if (dropped > 0) {
          reason = "授权模型当前均不可调用或未配置到网关。";
        }
      }
      const summary: EmployeeModelEntitlementSummary = {
        modelIds: displayModelIds,
        state: result.state,
        reason,
        seatId: ctx.seatId,
      };
      respond(true, { summary });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
