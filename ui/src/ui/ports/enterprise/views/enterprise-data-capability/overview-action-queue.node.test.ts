import { describe, expect, it } from "vitest";
import { buildOverviewActionQueue } from "./overview-action-queue.ts";

describe("buildOverviewActionQueue", () => {
  it("aggregates source, projection, approval and disabled product signals", () => {
    const items = buildOverviewActionQueue({
      summary: {
        pendingApprovals: 2,
      },
      sourceHealth: [
        {
          sourceId: "s1",
          displayName: "CRM",
          category: "crm",
          status: "error",
        },
      ],
      pendingApprovals: [
        {
          approvalId: "a1",
          category: "data_access",
          displayName: "申请",
          requestedAt: "2026-07-20T00:00:00Z",
          status: "pending",
        },
      ],
      capabilityRows: [
        {
          capabilityId: "c1",
          displayName: "停用产品",
          sourceNames: [],
          targetLabels: [],
          knowledgeObjectCount: 0,
          enabled: false,
          lastRunAt: null,
        },
      ],
      materializationFailureCount: 3,
    });
    expect(items.map((item) => item.kind)).toEqual([
      "source_health",
      "projection_failure",
      "pending_approval",
      "capability_disabled",
    ]);
    expect(items.find((item) => item.kind === "pending_approval")?.primary).toBe("governance");
    expect(items.find((item) => item.kind === "source_health")?.detail).toBe("异常");
  });
});
