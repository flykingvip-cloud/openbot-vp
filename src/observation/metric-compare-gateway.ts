/** Optional comparison helper for the existing observation query handler. No RPC registration. */
import type { OpenBotConfig } from "../config/config.js";
import {
  resolveDiagnosisProductionAuth,
  type DiagnosisGatewayAuthDeps,
  type DiagnosisGatewayAuthClient,
} from "../diagnosis/report-query-gateway.js";
import type { GatewayClient } from "../gateway/server-methods/types.js";
import { normalizeTaskOutcomeSubjectRef } from "../task-outcome/subject-ref.js";
import { createMetricCompareQuery } from "./metric-compare-query.js";
export function createMetricCompareGatewayHelper(options: {
  cfg: OpenBotConfig;
  authDeps?: DiagnosisGatewayAuthDeps;
  now?: () => number;
}) {
  return async (client: GatewayClient | null, comparison: unknown) => {
    const query = createMetricCompareQuery({
      cfg: options.cfg,
      now: options.now,
      authorize: async () => {
        const scopes = client?.connect.scopes ?? [];
        if (!client || (!scopes.includes("operator.read") && !scopes.includes("operator.admin"))) {
          return null;
        }
        const auth = await resolveDiagnosisProductionAuth(
          client as unknown as DiagnosisGatewayAuthClient,
          options.authDeps,
        );
        const freshScopes = client.connect.scopes ?? [];
        if (
          !auth ||
          (!freshScopes.includes("operator.read") && !freshScopes.includes("operator.admin"))
        ) {
          return null;
        }
        return {
          subjectRef: normalizeTaskOutcomeSubjectRef(
            client.platformUserId?.trim() || auth.principal.principalId,
          ),
          tenantId: auth.trusted.tenantId,
        };
      },
    });
    return query(comparison);
  };
}
