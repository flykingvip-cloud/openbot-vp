/**
 * 平台分配预览 handler。
 *
 * - platform-allocation.preview-plan：平台预览套餐对应的企业角色档案
 */

import { previewPlanAllocation } from "../model-entitlement/plan-allocation-preview.js";
import { respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const platformAllocationHandlers: GatewayRequestHandlers = {
  "platform-allocation.preview-plan": async ({ params, respond }) => {
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
};
