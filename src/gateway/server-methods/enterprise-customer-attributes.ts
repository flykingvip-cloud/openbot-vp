/**
 * Read-only enterprise customer attributes for digital humans / agents.
 *
 * Method:
 * - `enterprise.customer-attributes.get` — projection for the caller's enterprise
 *   (or an authorized requested tenantId). No assignment / nurture side effects.
 */

import { loadConfig } from "../../config/config.js";
import { resolvePlatformAuthConfig } from "../platform-auth/config.js";
import { buildEnterpriseCustomerAttributes } from "../platform-auth/enterprise-customer-attributes.js";
import { loadStore } from "../platform-auth/store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { requireEnterpriseScope } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const enterpriseCustomerAttributesHandlers: GatewayRequestHandlers = {
  "enterprise.customer-attributes.get": async ({ client, params, respond }) => {
    const record = params && typeof params === "object" ? params : {};
    const scope = await requireEnterpriseScope(client, respond, record);
    if (!scope) {
      return;
    }
    try {
      const cfg = loadConfig();
      const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
      if (!authConfig?.enabled) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "platform auth is not enabled"),
        );
        return;
      }
      const store = await loadStore(authConfig);
      const attributes = buildEnterpriseCustomerAttributes({
        store,
        enterpriseId: scope.enterpriseId,
      });
      if (!attributes) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "enterprise not found for resolved tenant"),
        );
        return;
      }
      respond(true, { attributes });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to load enterprise customer attributes";
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
    }
  },
};
