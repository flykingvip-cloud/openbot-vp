import { describe, expect, it } from "vitest";
import { BillingIngestClient, USAGE_INGEST_REPORT_METHOD } from "./billing-ingest.js";
import { FakeGatewayRpcTransport } from "./gateway-rpc.js";

describe("BillingIngestClient", () => {
  it("calls usage-ingest.report for each payload", async () => {
    const transport = new FakeGatewayRpcTransport({
      [USAGE_INGEST_REPORT_METHOD]: (params) => ({
        recorded: true,
        eventId: (params as { eventId?: string }).eventId,
      }),
    });
    const client = new BillingIngestClient(transport);
    const results = await client.reportAll([
      { eventId: "e1", key: "ai_token", quantity: 100 },
      { eventId: "e2", key: "aor_task", quantity: 1 },
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.recorded)).toBe(true);
    expect(transport.calls.map((c) => c.method)).toEqual([
      USAGE_INGEST_REPORT_METHOD,
      USAGE_INGEST_REPORT_METHOD,
    ]);
  });
});
