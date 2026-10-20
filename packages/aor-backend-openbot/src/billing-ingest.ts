import type { UsageIngestPayload } from "@openbot/aor-core";
import type { GatewayRpcTransport } from "./gateway-rpc.js";

/** Public RPC method used by cost-budget UI (`COST_BUDGET_ENDPOINTS.usageReport`). */
export const USAGE_INGEST_REPORT_METHOD = "usage-ingest.report";

export interface UsageIngestReportResult {
  recorded: boolean;
  deduped?: boolean;
}

/**
 * Report AOR usage into OpenBot billing via the public `usage-ingest.report` RPC.
 * Records appear in cost-budget analytics/dashboard after gateway ingestion.
 */
export class BillingIngestClient {
  constructor(private readonly transport: GatewayRpcTransport) {}

  async report(payload: UsageIngestPayload): Promise<UsageIngestReportResult> {
    return this.transport.call<UsageIngestReportResult>(USAGE_INGEST_REPORT_METHOD, payload);
  }

  async reportAll(payloads: UsageIngestPayload[]): Promise<UsageIngestReportResult[]> {
    const results: UsageIngestReportResult[] = [];
    for (const payload of payloads) {
      results.push(await this.report(payload));
    }
    return results;
  }
}
