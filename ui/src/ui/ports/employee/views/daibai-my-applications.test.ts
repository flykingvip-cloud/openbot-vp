import { describe, expect, it } from "vitest";
import {
  buildOptimisticDaibaiMcpApplication,
  daibaiApplicationAdminEdcTarget,
  daibaiApplicationCanCancel,
  daibaiApplicationStatusLabel,
  mergeDaibaiMyApplications,
  parseDaibaiMyApplicationsResponse,
  resolveDaibaiApplicationProductStatus,
  sortDaibaiMyApplications,
  type DaibaiMyApplication,
} from "./daibai-my-applications.ts";

function app(
  partial: Partial<DaibaiMyApplication> & Pick<DaibaiMyApplication, "approvalId" | "status">,
): DaibaiMyApplication {
  return {
    category: partial.category ?? "mcp_tool_mapping",
    displayName: partial.displayName ?? partial.approvalId,
    ...partial,
  };
}

describe("daibai my-applications status labels", () => {
  it("maps pending review, fulfillment, rejected, and cancelled", () => {
    expect(
      resolveDaibaiApplicationProductStatus({ status: "pending", reviewState: "submitted" }),
    ).toBe("submitted");
    expect(daibaiApplicationStatusLabel({ status: "pending", reviewState: "submitted" })).toBe(
      "已提交",
    );
    expect(resolveDaibaiApplicationProductStatus({ status: "pending" })).toBe("submitted");
    expect(daibaiApplicationStatusLabel({ status: "pending", reviewState: "in_review" })).toBe(
      "审批中",
    );
    expect(
      daibaiApplicationStatusLabel({
        status: "approved",
        fulfillmentStatus: "pending_admin_save",
      }),
    ).toBe("已批准（待管理员开通）");
    expect(daibaiApplicationStatusLabel({ status: "approved", fulfillmentStatus: "failed" })).toBe(
      "已批准（待管理员开通）",
    );
    expect(
      daibaiApplicationStatusLabel({ status: "approved", fulfillmentStatus: "fulfilled" }),
    ).toBe("已开通");
    expect(
      daibaiApplicationStatusLabel({ status: "approved", fulfillmentStatus: "not_required" }),
    ).toBe("已批准");
    expect(daibaiApplicationStatusLabel({ status: "rejected" })).toBe("已拒绝");
    expect(daibaiApplicationStatusLabel({ status: "cancelled" })).toBe("已撤回");
  });

  it("sorts capability-access categories ahead of other requests", () => {
    const sorted = sortDaibaiMyApplications([
      app({
        approvalId: "other",
        category: "data_access",
        status: "pending",
        requestedAt: "2026-10-16T03:00:00.000Z",
      }),
      app({
        approvalId: "pack-old",
        category: "pack_skill_review",
        status: "pending",
        requestedAt: "2026-10-16T01:00:00.000Z",
      }),
      app({
        approvalId: "mcp-new",
        category: "mcp_tool_mapping",
        status: "pending",
        requestedAt: "2026-10-16T02:00:00.000Z",
      }),
      app({
        approvalId: "oi",
        category: "oi_enrollment",
        status: "approved",
        requestedAt: "2026-10-16T04:00:00.000Z",
      }),
      app({
        approvalId: "pack-new",
        category: "pack_skill_review",
        status: "rejected",
        requestedAt: "2026-10-16T05:00:00.000Z",
      }),
      app({
        approvalId: "mcp-old",
        category: "mcp_tool_mapping",
        status: "cancelled",
        requestedAt: "2026-10-16T00:00:00.000Z",
      }),
    ]);
    expect(sorted.map((item) => item.approvalId)).toEqual([
      "mcp-new",
      "mcp-old",
      "oi",
      "pack-new",
      "pack-old",
      "other",
    ]);
  });

  it("parses list payloads and lets a later server row replace the optimistic submit", () => {
    const listed = parseDaibaiMyApplicationsResponse({
      requests: [
        {
          approvalId: "apr-1",
          category: "mcp_tool_mapping",
          displayName: "hubspot-crm / list_leads",
          status: "approved",
          reviewState: "in_review",
          fulfillmentStatus: "pending_admin_save",
          subjectPayload: { mcpServer: "hubspot-crm", mcpTool: "list_leads" },
          requestedAt: "2026-10-16T01:00:00.000Z",
        },
        { approvalId: "", status: "pending" },
        { approvalId: "bad", status: "nope" },
      ],
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("approved");

    const optimistic = buildOptimisticDaibaiMcpApplication({
      approvalId: "apr-1",
      mcpServer: "hubspot-crm",
      mcpTool: "list_leads",
      catalogId: "crm",
    });
    expect(optimistic.reviewState).toBe("submitted");
    expect(optimistic.status).toBe("pending");
    const merged = mergeDaibaiMyApplications(listed, [optimistic]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("approved");
    expect(daibaiApplicationStatusLabel(merged[0])).toBe("已批准（待管理员开通）");
  });

  it("offers admin EDC only for approved MCP rows waiting on Save, and cancel only while pending", () => {
    const pending = app({
      approvalId: "p",
      status: "pending",
      reviewState: "submitted",
      subjectPayload: { mcpServer: "hub", mcpTool: "list" },
    });
    const waiting = app({
      approvalId: "w",
      status: "approved",
      fulfillmentStatus: "pending_admin_save",
      subjectId: "mcp:hub%20spot/list_leads",
    });
    const failed = app({
      approvalId: "f",
      status: "approved",
      fulfillmentStatus: "failed",
      subjectPayload: { mcpServer: "mail", mcpTool: "list" },
    });
    const fulfilled = app({
      approvalId: "d",
      status: "approved",
      fulfillmentStatus: "fulfilled",
      subjectPayload: { mcpServer: "mail", mcpTool: "list" },
    });
    const oi = app({
      approvalId: "o",
      category: "oi_enrollment",
      status: "approved",
      fulfillmentStatus: "pending_admin_save",
    });

    expect(daibaiApplicationCanCancel(pending)).toBe(true);
    expect(daibaiApplicationCanCancel(waiting)).toBe(false);
    expect(daibaiApplicationAdminEdcTarget(pending)).toBeNull();
    expect(daibaiApplicationAdminEdcTarget(fulfilled)).toBeNull();
    expect(daibaiApplicationAdminEdcTarget(oi)).toBeNull();
    expect(daibaiApplicationAdminEdcTarget(waiting)).toEqual({
      mcpServer: "hub spot",
      mcpTool: "list_leads",
      approvalId: "w",
      edc: "capabilities",
    });
    expect(daibaiApplicationAdminEdcTarget(failed)?.mcpServer).toBe("mail");
  });
});
