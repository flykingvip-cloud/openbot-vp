import { describe, expect, it } from "vitest";
import {
  DAIBAI_TEMPLATE_MCP_HINTS,
  DAIBAI_TEMPLATE_RECOMMENDED_OI,
  DAIBAI_TEMPLATE_REQUIRED_CAPABILITIES,
  listDaibaiActionableGaps,
  summarizeDaibaiPostCreateGaps,
  summarizeDaibaiPostCreateGapsForMembers,
} from "./daibai-capability-gaps.ts";

describe("daibai capability gaps (Stage B)", () => {
  it("mirrors Growth pilot requiredCapabilities for the three templates", () => {
    expect(DAIBAI_TEMPLATE_REQUIRED_CAPABILITIES.personal_mail_assistant.map((c) => c.key)).toEqual(
      ["personal_email"],
    );
    expect(DAIBAI_TEMPLATE_REQUIRED_CAPABILITIES.sales_assistant.map((c) => c.key)).toEqual([
      "crm",
      "crm_oauth",
    ]);
    expect(DAIBAI_TEMPLATE_REQUIRED_CAPABILITIES.contract_reviewer.map((c) => c.key)).toEqual([
      "contract_review",
      "contract_kb",
      "approval_system",
    ]);
    expect(DAIBAI_TEMPLATE_REQUIRED_CAPABILITIES.generic_worker).toEqual([]);
  });

  it("summarizes email pilot: oauth pending + personal OI + seat note; no auto grant CTAs beyond explicit flows", () => {
    const summary = summarizeDaibaiPostCreateGaps("email");
    expect(summary.templateId).toBe("personal_mail_assistant");
    expect(summary.hasRoleTemplate).toBe(true);

    const oauth = summary.items.find((i) => i.key === "personal_email");
    expect(oauth).toMatchObject({
      kind: "oauth",
      status: "pending",
      cta: "oauth_authorize",
    });

    const oi = summary.items.find((i) => i.key === "oi_personal_mail");
    expect(oi).toMatchObject({
      kind: "oi",
      status: "recommended",
      cta: "apply_personal_oi",
      ctaLabel: "提交企业审批",
    });
    expect(oi?.note).toContain("不会自动授权");

    const seat = summary.items.find((i) => i.key === "seat_entitlement");
    expect(seat).toMatchObject({
      kind: "seat",
      status: "check_unavailable",
      cta: "contact_admin_seat",
    });

    expect(summary.items.every((i) => i.kind !== "mcp" || i.cta === "mcp_admin_save")).toBe(true);
    expect(listDaibaiActionableGaps(summary).some((i) => i.cta === null)).toBe(false);
  });

  it("summarizes crm pilot: skill preloaded, oauth + MCP + dual OI", () => {
    const summary = summarizeDaibaiPostCreateGaps("crm");
    expect(summary.templateId).toBe("sales_assistant");

    const skill = summary.items.find((i) => i.key === "crm");
    expect(skill).toMatchObject({ kind: "skill", status: "preloaded", cta: null });

    expect(summary.items.find((i) => i.key === "crm_oauth")?.cta).toBe("oauth_authorize");
    expect(summary.items.find((i) => i.key === "mcp_crm")?.cta).toBe("mcp_admin_save");
    expect(summary.items.find((i) => i.key === "oi_personal_sales")?.cta).toBe("apply_personal_oi");
    expect(summary.items.find((i) => i.key === "oi_enterprise_crm")?.cta).toBe(
      "apply_enterprise_oi",
    );
  });

  it("summarizes contract pilot: skill preloaded, KB + oauth + MCP + enterprise OI", () => {
    const summary = summarizeDaibaiPostCreateGaps("contract");
    expect(summary.templateId).toBe("contract_reviewer");

    expect(summary.items.find((i) => i.key === "contract_review")).toMatchObject({
      status: "preloaded",
      cta: null,
    });
    expect(summary.items.find((i) => i.key === "contract_kb")?.cta).toBe("bind_knowledge");
    expect(summary.items.find((i) => i.key === "approval_system")?.cta).toBe("oauth_authorize");
    expect(summary.items.find((i) => i.key === "mcp_approval")?.cta).toBe("mcp_admin_save");
    expect(summary.items.find((i) => i.key === "oi_enterprise_legal")?.cta).toBe(
      "apply_enterprise_oi",
    );
  });

  it("returns empty items for unmapped / generic catalog ids", () => {
    expect(summarizeDaibaiPostCreateGaps("calendar").items).toEqual([]);
    expect(summarizeDaibaiPostCreateGaps("").hasRoleTemplate).toBe(false);
    expect(summarizeDaibaiPostCreateGaps(null).templateId).toBe("generic_worker");
  });

  it("batches member summaries and keeps static OI/MCP tables keyed by template", () => {
    const batch = summarizeDaibaiPostCreateGapsForMembers([
      { catalogId: "email", name: "邮件助理" },
      { catalogId: "calendar", name: "日程秘书" },
    ]);
    expect(batch).toHaveLength(2);
    expect(batch[0]?.hasRoleTemplate).toBe(true);
    expect(batch[1]?.items).toEqual([]);
    expect(DAIBAI_TEMPLATE_RECOMMENDED_OI.sales_assistant.length).toBeGreaterThan(0);
    expect(DAIBAI_TEMPLATE_MCP_HINTS.contract_reviewer.length).toBeGreaterThan(0);
  });
});
