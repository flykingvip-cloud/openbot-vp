import { loadCronStore } from "../../cron/store.js";
import { readAdminProgressLedger } from "../../progress-ledger/admin-read.js";
import { isProgressLedgerEnabled } from "../../progress-ledger/feature.js";
import { getLedgerMetrics } from "../../progress-ledger/metrics.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const progressLedgerHandlers: GatewayRequestHandlers = {
  /**
   * Operator / admin read of long-horizon progress. Same Projection as cron.list.
   * Never writes the ledger.
   */
  "progress-ledger.admin.list": async ({ params, respond, context }) => {
    const record = params && typeof params === "object" ? params : {};
    const limit =
      typeof (record as { limit?: unknown }).limit === "number"
        ? (record as { limit: number }).limit
        : undefined;
    try {
      if (!isProgressLedgerEnabled()) {
        respond(true, {
          projectionKind: "canonical",
          items: [],
          metrics: getLedgerMetrics().snapshot(),
        });
        return;
      }
      const store = await loadCronStore(context.cronStorePath);
      const result = await readAdminProgressLedger({
        jobs: store.jobs ?? [],
        cronStorePath: context.cronStorePath,
        ...(limit !== undefined ? { limit } : {}),
      });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list progress ledger";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
};
