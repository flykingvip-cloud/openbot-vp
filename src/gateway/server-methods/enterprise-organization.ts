import { loadConfig } from "../../config/config.js";
import { requireResolvedEnterpriseTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import { resolvePlatformAuthConfig } from "../platform-auth/config.js";
import { buildPlatformOrganizationSnapshot } from "../platform-auth/memberships.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import { loadStore as loadPlatformAuthStore } from "../platform-auth/store.js";
import { respondUnavailable } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

/**
 * Organization snapshot RPCs.
 * Note: `enterprise.organization.monthly-seat-usage` is owned by
 * `enterprise-organization-monthly-usage.ts` (session-cost scan). Do not
 * re-register it here — later spreads would silently overwrite.
 */
export const enterpriseOrganizationHandlers: GatewayRequestHandlers = {
  "enterprise.organization.snapshot": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    try {
      const cfg = loadConfig();
      const platformAuthConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
      if (!platformAuthConfig) {
        respond(true, { tenantId, organization: null });
        return;
      }
      const [platformStore, seatStore] = await Promise.all([
        loadPlatformAuthStore(platformAuthConfig),
        loadSeatAssetsStoreForTenantId(tenantId),
      ]);
      const organization = buildPlatformOrganizationSnapshot({
        store: platformStore,
        seatStore,
        enterpriseId: tenantId,
      });
      respond(true, {
        tenantId,
        organization: organization ?? null,
      });
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },
};
