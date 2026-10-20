import { getOverAllocationState } from "../billing/over-allocation-store.js";
import { resolveTenantCreditsStatus } from "../billing/record-credit-usage.js";
import { computeBudgetStatus } from "../billing/runtime.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { buildEnterpriseNotices } from "../workbench/enterprise-notices-read-model.js";
import { resolveTenantOfflineChannels } from "../workbench/tenant-channel-health.js";
import { requireEnterpriseScope } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const enterpriseNoticesHandlers: GatewayRequestHandlers = {
  /**
   * Enterprise-ADMIN "system notices" projection for the enterprise overview.
   * Aggregates the install/admin-scoped signals deliberately excluded from the
   * per-employee 重要通知 card: financial (budget threshold / over-allocation /
   * credits) + channel connectivity (offline tenant channels).
   *
   * Admin gate: `requireEnterpriseScope` only resolves a tenant — it does NOT
   * enforce admin — so a plain enterprise employee is explicitly rejected here.
   * All financial data is scoped to the caller's own tenant; channel offline is
   * scoped to the tenant's configured accounts (see resolveTenantOfflineChannels).
   */
  "enterprise.notices.list": async ({ params, respond, client, context }) => {
    const record = params && typeof params === "object" ? params : {};
    const scope = await requireEnterpriseScope(client, respond, record);
    if (!scope) {
      // requireEnterpriseScope already responded with the tenant-resolution error.
      return;
    }
    if (!scope.isEnterpriseAdmin) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "enterprise admin scope required"),
      );
      return;
    }
    try {
      const now = new Date();
      // Each source is best-effort: a missing subscription / store yields null
      // (no alert) rather than failing the whole notices payload.
      const budget = await computeBudgetStatus(scope.enterpriseId, now).catch(() => null);
      const overAllocation = await getOverAllocationState(scope.enterpriseId).catch(() => null);
      const credits = await resolveTenantCreditsStatus(scope.enterpriseId).catch(() => null);
      const offlineChannels = await resolveTenantOfflineChannels({
        enterpriseId: scope.enterpriseId,
        runtime: context.getRuntimeSnapshot(),
        now: now.getTime(),
      }).catch(() => []);
      respond(true, buildEnterpriseNotices({ budget, overAllocation, credits, offlineChannels }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list enterprise notices";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
};
