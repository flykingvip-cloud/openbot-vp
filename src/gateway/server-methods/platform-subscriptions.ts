/**
 * 平台订阅商业指标 RPC。
 */

import { buildPlatformCommercialSummary } from "../billing/plan-commercial-summary.js";
import { respondUnavailable } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const platformSubscriptionsHandlers: GatewayRequestHandlers = {
  "platform-subscriptions.summary": async ({ respond }) => {
    try {
      const summary = await buildPlatformCommercialSummary();
      respond(true, summary);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
