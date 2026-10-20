/**
 * 平台端 Policy Engine handler（Package V2 Phase 2）。
 */

import {
  ensureBuiltinRoutingPolicies,
  getRoutingPolicy,
  listRoutingPolicies,
} from "../policy-engine/policies-store.js";
import { respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const policyEngineHandlers: GatewayRequestHandlers = {
  "platform-policy.overview": async ({ respond }) => {
    try {
      const policies = await ensureBuiltinRoutingPolicies();
      respond(true, { policies });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-policy.list": async ({ respond }) => {
    try {
      respond(true, { policies: await listRoutingPolicies() });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-policy.get": async ({ params, respond }) => {
    try {
      const policyId = stringValue(params.policyId);
      if (!policyId) {
        respondInvalid(respond, "policyId 是必填项");
        return;
      }
      const policy = await getRoutingPolicy(policyId);
      if (!policy) {
        respondInvalid(respond, `未找到策略：${policyId}`);
        return;
      }
      respond(true, { policy });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
