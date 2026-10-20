import { describe, expect, it } from "vitest";
import {
  DAIBAI_MCP_SCAN_HINTS_BY_TEMPLATE,
  daibaiMcpScanCtaIsExplicitApplyOnly,
  isDaibaiMcpDiscoveryPermissionFailure,
  rankOrFilterMcpDiscoveryForDaibaiRole,
  suggestDaibaiMcpScanHints,
  type DaibaiMcpDiscoverySnapshot,
} from "./daibai-mcp-scan.ts";

function snapshot(
  partial: Partial<DaibaiMcpDiscoverySnapshot> & {
    items: DaibaiMcpDiscoverySnapshot["items"];
  },
): DaibaiMcpDiscoverySnapshot {
  return {
    remoteToolsList: partial.remoteToolsList ?? "ok",
    gap: partial.gap ?? "none",
    items: partial.items,
    ...(partial.filterApplied !== undefined ? { filterApplied: partial.filterApplied } : {}),
    ...(partial.catalogId ? { catalogId: partial.catalogId } : {}),
    ...(partial.templateId ? { templateId: partial.templateId } : {}),
    ...(partial.emptyReason !== undefined ? { emptyReason: partial.emptyReason } : {}),
    ...(partial.matchedHints ? { matchedHints: partial.matchedHints } : {}),
  };
}

describe("daibai MCP scan (Stage C)", () => {
  it("suggests static keyword hints per pilot catalog / template", () => {
    expect(suggestDaibaiMcpScanHints("email").templateId).toBe("personal_mail_assistant");
    expect(suggestDaibaiMcpScanHints("email").hints[0]?.keywords).toContain("mail");
    expect(suggestDaibaiMcpScanHints("crm").hints[0]?.keywords).toContain("crm");
    expect(suggestDaibaiMcpScanHints("contract").hints[0]?.keywords).toContain("approval");
    expect(suggestDaibaiMcpScanHints("sales_assistant").hasRoleTemplate).toBe(true);
    expect(suggestDaibaiMcpScanHints("calendar").hasRoleTemplate).toBe(false);
    expect(suggestDaibaiMcpScanHints("calendar").hints).toEqual([]);
    expect(DAIBAI_MCP_SCAN_HINTS_BY_TEMPLATE.generic_worker).toEqual([]);
  });

  it("filters and ranks discovery items for crm; unmapped CTA is mcp_scan_apply only", () => {
    const result = rankOrFilterMcpDiscoveryForDaibaiRole(
      snapshot({
        items: [
          {
            serverName: "linear",
            toolName: "list_issues",
            status: "unmapped",
            capabilityId: null,
            capabilityKey: null,
            capabilityDisplayName: null,
          },
          {
            serverName: "hubspot-crm",
            toolName: "list_leads",
            status: "unmapped",
            capabilityId: null,
            capabilityKey: null,
            capabilityDisplayName: null,
          },
          {
            serverName: "salesforce",
            toolName: "get_opportunity",
            status: "mapped_pending_grant",
            capabilityId: "cap-sf",
            capabilityKey: "sales.opportunity",
            capabilityDisplayName: "Salesforce Opportunity",
          },
          {
            serverName: "crm-gateway",
            toolName: "sync_customers",
            status: "authorized",
            capabilityId: "cap-crm",
            capabilityKey: "crm.sync",
            capabilityDisplayName: "CRM Sync",
          },
        ],
      }),
      "crm",
    );

    expect(result.hasRoleTemplate).toBe(true);
    expect(result.emptyReason).toBeNull();
    expect(result.candidates.map((c) => c.serverName)).toEqual([
      "hubspot-crm",
      "salesforce",
      "crm-gateway",
    ]);
    expect(result.candidates.find((c) => c.serverName === "linear")).toBeUndefined();

    const hubspot = result.candidates.find((c) => c.serverName === "hubspot-crm");
    expect(hubspot).toMatchObject({
      status: "unmapped",
      cta: "mcp_scan_apply",
      ctaLabel: "提交企业审批",
    });
    expect(hubspot?.note).toMatch(/不会自动 grant/);

    const pending = result.candidates.find((c) => c.serverName === "salesforce");
    expect(pending).toMatchObject({
      status: "mapped_pending_grant",
      cta: "mcp_scan_apply",
      ctaLabel: "提交席位授权审批",
    });

    const authorized = result.candidates.find((c) => c.serverName === "crm-gateway");
    expect(authorized).toMatchObject({
      status: "authorized",
      cta: null,
      ctaLabel: null,
    });

    expect(result.candidates.every((c) => daibaiMcpScanCtaIsExplicitApplyOnly(c.cta))).toBe(true);
    expect(result.usedStaticFallback).toBe(false);
  });

  it("returns empty + static Stage B fallback when remote list unavailable", () => {
    const result = rankOrFilterMcpDiscoveryForDaibaiRole(
      snapshot({
        remoteToolsList: "unavailable",
        gap: "remote_tools_list_unavailable",
        items: [],
      }),
      "contract",
    );
    expect(result.candidates).toEqual([]);
    expect(result.emptyReason).toBe("remote_unavailable");
    expect(result.usedStaticFallback).toBe(true);
    expect(result.staticFallbackHints.some((h) => h.key === "mcp_approval")).toBe(true);
  });

  it("returns no_match without inventing candidates when items exist but none match role", () => {
    const result = rankOrFilterMcpDiscoveryForDaibaiRole(
      snapshot({
        items: [
          {
            serverName: "linear",
            toolName: "list_issues",
            status: "unmapped",
            capabilityId: null,
            capabilityKey: null,
            capabilityDisplayName: null,
          },
        ],
      }),
      "email",
    );
    expect(result.candidates).toEqual([]);
    expect(result.emptyReason).toBe("no_match");
    expect(result.staticFallbackHints).toEqual([]);
    expect(result.usedStaticFallback).toBe(false);
  });

  it("returns no_role for unmapped catalog ids", () => {
    const result = rankOrFilterMcpDiscoveryForDaibaiRole(snapshot({ items: [] }), "calendar");
    expect(result.hasRoleTemplate).toBe(false);
    expect(result.emptyReason).toBe("no_role");
    expect(result.candidates).toEqual([]);
  });

  it("never exposes grant-like CTAs", () => {
    const result = rankOrFilterMcpDiscoveryForDaibaiRole(
      snapshot({
        items: [
          {
            serverName: "approval-bot",
            toolName: "submit",
            status: "unmapped",
            capabilityId: null,
            capabilityKey: null,
            capabilityDisplayName: null,
          },
        ],
      }),
      "contract",
    );
    for (const c of result.candidates) {
      expect(c.cta === null || c.cta === "mcp_scan_apply").toBe(true);
      expect(String(c.cta)).not.toMatch(/grant|upsert|auto/i);
    }
  });

  it("shows a server-only row without an apply CTA", () => {
    const result = rankOrFilterMcpDiscoveryForDaibaiRole(
      snapshot({
        items: [
          {
            serverName: "hubspot-crm",
            toolName: "",
            status: "mapped_pending_grant",
            capabilityId: "cap-crm",
            capabilityKey: "hubspot",
            capabilityDisplayName: "CRM",
          },
        ],
      }),
      "crm",
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      serverName: "hubspot-crm",
      toolName: "",
      cta: null,
      ctaLabel: null,
    });
    expect(result.candidates[0]?.note).toContain("没有工具名");
  });

  it("keeps rows the server already prefiltered for the same template", () => {
    const result = rankOrFilterMcpDiscoveryForDaibaiRole(
      snapshot({
        filterApplied: true,
        templateId: "sales_assistant",
        catalogId: "crm",
        emptyReason: null,
        matchedHints: ["crm"],
        items: [
          {
            serverName: "billing-gateway",
            toolName: "list_invoices",
            status: "unmapped",
            capabilityId: null,
            capabilityKey: null,
            capabilityDisplayName: null,
          },
        ],
      }),
      "crm",
    );
    expect(result.candidates.map((candidate) => candidate.serverName)).toEqual(["billing-gateway"]);
    expect(result.emptyReason).toBeNull();
  });

  it("does not reuse a snapshot prefiltered for a different template", () => {
    const result = rankOrFilterMcpDiscoveryForDaibaiRole(
      snapshot({
        filterApplied: true,
        templateId: "personal_mail_assistant",
        items: [
          {
            serverName: "gmail",
            toolName: "list_messages",
            status: "unmapped",
            capabilityId: null,
            capabilityKey: null,
            capabilityDisplayName: null,
          },
        ],
      }),
      "crm",
    );
    expect(result.candidates).toEqual([]);
    expect(result.emptyReason).toBe("no_match");
  });

  it("treats seat and tenant failures as permission errors, not empty discovery", () => {
    expect(
      isDaibaiMcpDiscoveryPermissionFailure(
        Object.assign(new Error("当前会话没有可用席位，无法查看 MCP 能力。"), {
          details: { code: "NO_CURRENT_SEAT" },
        }),
      ),
    ).toBe(true);
    expect(
      isDaibaiMcpDiscoveryPermissionFailure(new Error("tenantId 必须与当前企业会话一致。")),
    ).toBe(true);
    expect(isDaibaiMcpDiscoveryPermissionFailure(new Error("未连接网关，无法扫描企业 MCP"))).toBe(
      false,
    );
  });
});
