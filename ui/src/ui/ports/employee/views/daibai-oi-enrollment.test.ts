import { describe, expect, it } from "vitest";
import {
  buildOptimisticDaibaiOiApplication,
  mergeDaibaiMyApplications,
} from "./daibai-my-applications.ts";
import {
  DAIBAI_OI_AGENT_MISSING,
  DAIBAI_OI_IDENTITY_AMBIGUOUS,
  DAIBAI_OI_IDENTITY_MISSING,
  buildDaibaiOiEnrollmentCreateParams,
  resolveDaibaiOiEnrollmentIdentity,
} from "./daibai-oi-enrollment.ts";

describe("daibai oi enrollment subject", () => {
  it("uses the only personal identity and never a gap key", () => {
    const resolved = resolveDaibaiOiEnrollmentIdentity({
      identityScope: "personal",
      targetAgentId: "agent-email",
      context: {
        personalIdentities: [
          { identityId: "id-mail", status: "active" },
          { identityId: "id-revoked", status: "revoked" },
        ],
      },
    });
    expect(resolved).toEqual({ ok: true, identityId: "id-mail" });
    if (resolved.ok) {
      expect(resolved.identityId).not.toBe("oi_personal_mail");
    }
  });

  it("prefers the single personal grant for the created agent when several identities exist", () => {
    const resolved = resolveDaibaiOiEnrollmentIdentity({
      identityScope: "personal",
      targetAgentId: "agent-email",
      context: {
        personalIdentities: [
          { identityId: "id-mail", status: "active" },
          { identityId: "id-wechat", status: "active" },
        ],
        personalGrants: [
          { identityId: "id-mail", agentId: "agent-email", status: "active" },
          { identityId: "id-wechat", agentId: "agent-other", status: "active" },
        ],
      },
    });
    expect(resolved).toEqual({ ok: true, identityId: "id-mail" });
  });

  it("refuses to invent an identity id when none is loaded", () => {
    expect(
      resolveDaibaiOiEnrollmentIdentity({
        identityScope: "personal",
        targetAgentId: "agent-email",
        context: null,
      }),
    ).toEqual({ ok: false, message: DAIBAI_OI_IDENTITY_MISSING });
    expect(
      resolveDaibaiOiEnrollmentIdentity({
        identityScope: "enterprise",
        targetAgentId: "agent-crm",
        context: { enterpriseSeatIdentities: [] },
      }).ok,
    ).toBe(false);
  });

  it("refuses to guess among multiple enterprise identities", () => {
    const resolved = resolveDaibaiOiEnrollmentIdentity({
      identityScope: "enterprise",
      targetAgentId: "agent-crm",
      context: {
        enterpriseSeatIdentities: [
          { identityId: "ent-crm", status: "active" },
          { identityId: "ent-legal", status: "active" },
        ],
      },
    });
    expect(resolved).toEqual({ ok: false, message: DAIBAI_OI_IDENTITY_AMBIGUOUS });
  });

  it("uses the single enterprise identity already visible for the created agent", () => {
    const resolved = resolveDaibaiOiEnrollmentIdentity({
      identityScope: "enterprise",
      targetAgentId: "agent-crm",
      context: {
        enterpriseIdentitiesByAgent: {
          "agent-crm": [{ identityId: "ent-crm", status: "active" }],
        },
        enterpriseSeatIdentities: [
          { identityId: "ent-crm", status: "active" },
          { identityId: "ent-other", status: "active" },
        ],
      },
    });
    expect(resolved).toEqual({ ok: true, identityId: "ent-crm" });
  });

  it("requires a created agent id", () => {
    expect(
      resolveDaibaiOiEnrollmentIdentity({
        identityScope: "personal",
        targetAgentId: "  ",
        context: { personalIdentities: [{ identityId: "id-mail" }] },
      }),
    ).toEqual({ ok: false, message: DAIBAI_OI_AGENT_MISSING });
  });

  it("builds an oi_enrollment create body and omits grant or authorize fields", () => {
    const built = buildDaibaiOiEnrollmentCreateParams({
      identityScope: "enterprise",
      identityId: "ent-crm",
      targetAgentId: "agent-crm",
      catalogId: "crm",
      templateId: "sales_assistant",
      clientRequestId: "daibai-oi:enterprise:crm:ent-crm:agent-crm",
      reason: "大白岗位运营身份申请",
      tenantId: "tenant-1",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.params.category).toBe("oi_enrollment");
    expect(built.params).toMatchObject({
      identityScope: "enterprise",
      identityId: "ent-crm",
      targetAgentId: "agent-crm",
      catalogId: "crm",
      templateId: "sales_assistant",
      tenantId: "tenant-1",
    });
    expect(built.params).not.toHaveProperty("grantMode");
    expect(built.params).not.toHaveProperty("fulfillmentMode");
    expect(JSON.stringify(built.params)).not.toContain("upsert");
    expect(JSON.stringify(built.params)).not.toContain("authorize");

    expect(
      buildDaibaiOiEnrollmentCreateParams({
        identityScope: "personal",
        identityId: " ",
        targetAgentId: "agent-email",
        catalogId: "email",
        templateId: "personal_mail_assistant",
        clientRequestId: "x",
      }),
    ).toEqual({ ok: false, message: DAIBAI_OI_IDENTITY_MISSING });
  });

  it("projects a submitted oi_enrollment row into 我的申请 until list refresh replaces it", () => {
    const optimistic = buildOptimisticDaibaiOiApplication({
      approvalId: "apr-oi-1",
      identityScope: "personal",
      identityId: "id-mail",
      targetAgentId: "agent-email",
      catalogId: "email",
      displayName: "个人运营身份（邮箱/渠道）",
    });
    expect(optimistic).toMatchObject({
      category: "oi_enrollment",
      status: "pending",
      reviewState: "submitted",
      displayName: "个人运营身份（邮箱/渠道）",
    });
    const merged = mergeDaibaiMyApplications(
      [
        {
          approvalId: "apr-oi-1",
          category: "oi_enrollment",
          displayName: "个人 OI id-mail",
          status: "pending",
          reviewState: "in_review",
          requestedAt: "2026-10-16T03:00:00.000Z",
        },
      ],
      [optimistic],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.reviewState).toBe("in_review");
    expect(merged[0]?.displayName).toBe("个人 OI id-mail");
  });
});
