import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isDiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, TrustedTenantContext } from "./types.js";
import {
  createAuthorizationDecisionRefresh,
  createDiagnosisConversationEntry,
  projectDiagnosisVisualization,
} from "./visualization.js";
import type {
  DiagnosisVisualizationAudience,
  DiagnosisVisualizationCatalog,
  VisualizationCaseRef,
  VisualizationFindingRef,
  VisualizationGrantRef,
  VisualizationSignalRef,
} from "./visualization.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };
const TRUSTED_B: TrustedTenantContext = { tenantId: TENANT_B };
const TRUSTED_PLATFORM: TrustedTenantContext = { tenantId: null };

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (err) {
    expect(isDiagnosisContractError(err)).toBe(true);
    if (isDiagnosisContractError(err)) {
      expect(err.code).toBe(code);
    }
  }
}

function audience(
  role: DiagnosisVisualizationAudience["role"],
  trusted: TrustedTenantContext,
  id: string,
  over: Partial<DiagnosisVisualizationAudience> = {},
): DiagnosisVisualizationAudience {
  return {
    role,
    trusted,
    principal: principal(id, trusted.tenantId),
    redactionProfile: role === "employee" ? "user" : "administrator",
    ...over,
  };
}

function signal(
  over: Partial<VisualizationSignalRef> & Pick<VisualizationSignalRef, "signalId" | "tenantId">,
): VisualizationSignalRef {
  return {
    status: "open",
    target: {
      targetType: "session",
      targetId: "session-a",
      tenantId: over.tenantId,
      agentId: "agent-a",
      skillId: "skill-a",
      toolId: "tool-a",
    },
    evidenceIds: ["ev-a"],
    findingIds: ["find-a"],
    caseId: "case-a",
    completion: "CONFIRMED",
    observedAt: "2026-09-03T01:00:00.000Z",
    lastSeenAt: "2026-09-03T01:10:00.000Z",
    expiresAt: "2026-09-03T02:00:00.000Z",
    targetPrincipal: "user-a",
    ...over,
  };
}

function finding(
  over: Partial<VisualizationFindingRef> & Pick<VisualizationFindingRef, "findingId" | "tenantId">,
): VisualizationFindingRef {
  return {
    status: "open",
    severity: "P0",
    evidenceIds: ["ev-a"],
    caseId: "case-a",
    observedAt: "2026-09-03T01:05:00.000Z",
    targetPrincipal: "user-a",
    ...over,
  };
}

function caseRef(
  over: Partial<VisualizationCaseRef> & Pick<VisualizationCaseRef, "caseId" | "tenantId">,
): VisualizationCaseRef {
  return {
    status: "open",
    findingIds: ["find-a"],
    signalId: "sig-a",
    observedAt: "2026-09-03T01:08:00.000Z",
    target: {
      targetType: "session",
      targetId: "session-a",
      tenantId: over.tenantId,
      agentId: "agent-a",
      skillId: "skill-a",
      toolId: "tool-a",
    },
    targetPrincipal: "user-a",
    severity: "P0",
    ...over,
  };
}

function grant(
  over: Partial<VisualizationGrantRef> & Pick<VisualizationGrantRef, "grantId">,
): VisualizationGrantRef {
  return {
    status: "APPROVED",
    targetTenant: TENANT_A,
    targetPrincipal: "user-a",
    dataScope: ["finding_ref", "report_summary"],
    actions: ["inspect"],
    expiresAt: "2026-09-04T00:00:00.000Z",
    risk: "medium",
    missionId: "mission-a",
    observedAt: "2026-09-03T01:12:00.000Z",
    approverRole: "enterprise",
    ...over,
  };
}

function chainCatalog(
  over: Partial<DiagnosisVisualizationCatalog> = {},
): DiagnosisVisualizationCatalog {
  return {
    now: Date.parse("2026-09-03T04:00:00.000Z"),
    trendWindow: {
      from: "2026-09-03T00:00:00.000Z",
      to: "2026-09-03T04:00:00.000Z",
      bucketMs: 60 * 60 * 1000,
    },
    signals: [signal({ signalId: "sig-a", tenantId: TENANT_A })],
    cases: [caseRef({ caseId: "case-a", tenantId: TENANT_A })],
    findings: [finding({ findingId: "find-a", tenantId: TENANT_A })],
    evidenceRefs: [
      {
        evidenceId: "ev-a",
        tenantId: TENANT_A,
        observedAt: "2026-09-03T01:02:00.000Z",
        targetPrincipal: "user-a",
      },
    ],
    grants: [grant({ grantId: "grant-a" })],
    shareGrants: [
      grant({
        grantId: "share-a",
        kind: "evidence_share",
        evidenceIds: ["ev-a"],
        dataScope: ["evidence_ref"],
      }),
    ],
    missions: [
      {
        missionId: "mission-a",
        status: "APPROVED",
        targetTenant: TENANT_A,
        grantId: "grant-a",
        parentCaseId: "case-a",
        targetPrincipal: "user-a",
        observedAt: "2026-09-03T01:15:00.000Z",
      },
    ],
    proposals: [
      {
        proposalId: "prop-a",
        status: "APPROVED",
        tenantScope: TENANT_A,
        grantId: "grant-a",
        sourceCaseId: "case-a",
        observedAt: "2026-09-03T01:20:00.000Z",
      },
    ],
    remediations: [
      {
        remediationId: "rem-a",
        status: "VERIFIED",
        targetTenant: TENANT_A,
        sourceProposalId: "prop-a",
        grantId: "grant-a",
        observedAt: "2026-09-03T01:25:00.000Z",
      },
    ],
    verifications: [
      {
        verificationId: "ver-a",
        verdict: "improved",
        remediationId: "rem-a",
        observedAt: "2026-09-03T01:30:00.000Z",
      },
    ],
    graphEdges: [{ fromId: "sig-a", toId: "case-a", relation: "derived_from" }],
    ...over,
  };
}

describe("P10 diagnosis visualization projections", () => {
  it("isolates platform and enterprise tenants", () => {
    const catalog = chainCatalog({
      signals: [
        signal({ signalId: "sig-a", tenantId: TENANT_A }),
        signal({
          signalId: "sig-b",
          tenantId: TENANT_B,
          targetPrincipal: "user-b",
          caseId: "case-b",
          lastSeenAt: "2026-09-03T02:10:00.000Z",
        }),
      ],
      cases: [
        caseRef({ caseId: "case-a", tenantId: TENANT_A }),
        caseRef({
          caseId: "case-b",
          tenantId: TENANT_B,
          targetPrincipal: "user-b",
          signalId: "sig-b",
        }),
      ],
    });

    const platform = projectDiagnosisVisualization(
      audience("platform", TRUSTED_PLATFORM, "plat-admin"),
      catalog,
    );
    expect(platform.tenantScope).toBeNull();
    expect(platform.cases.map((row) => row.caseId).toSorted()).toEqual(["case-a", "case-b"]);
    expect(platform.timeline.events.some((event) => event.kind === "evidence_ref")).toBe(false);
    expect(platform.conversationEntries.every((entry) => !("evidenceIds" in entry))).toBe(true);

    const enterpriseA = projectDiagnosisVisualization(
      audience("enterprise", TRUSTED_A, "ent-admin", { authorizedEmployeeIds: ["user-a"] }),
      catalog,
    );
    expect(enterpriseA.tenantScope).toBe(TENANT_A);
    expect(enterpriseA.cases.map((row) => row.caseId)).toEqual(["case-a"]);
    expect(enterpriseA.timeline.events.some((event) => event.tenantId === TENANT_B)).toBe(false);

    const enterpriseB = projectDiagnosisVisualization(
      audience("enterprise", TRUSTED_B, "ent-b", { authorizedEmployeeIds: ["user-b"] }),
      catalog,
    );
    expect(enterpriseB.cases.map((row) => row.caseId)).toEqual(["case-b"]);
  });

  it("limits employee views to authorized principal scope", () => {
    const catalog = chainCatalog({
      signals: [
        signal({ signalId: "sig-a", tenantId: TENANT_A, targetPrincipal: "user-a" }),
        signal({
          signalId: "sig-other",
          tenantId: TENANT_A,
          targetPrincipal: "user-other",
          caseId: "case-other",
        }),
      ],
      cases: [
        caseRef({ caseId: "case-a", tenantId: TENANT_A, targetPrincipal: "user-a" }),
        caseRef({
          caseId: "case-other",
          tenantId: TENANT_A,
          targetPrincipal: "user-other",
          signalId: "sig-other",
        }),
      ],
    });

    const employee = projectDiagnosisVisualization(
      audience("employee", TRUSTED_A, "user-a"),
      catalog,
    );
    expect(employee.cases.map((row) => row.caseId)).toEqual(["case-a"]);
    expect(employee.conversationEntries.map((entry) => entry.signalId)).toEqual(["sig-a"]);

    const enterprise = projectDiagnosisVisualization(
      audience("enterprise", TRUSTED_A, "ent-admin", { authorizedEmployeeIds: ["user-a"] }),
      catalog,
    );
    expect(enterprise.cases.map((row) => row.caseId)).toEqual(["case-a"]);
  });

  it("projects the Signal to Verification chain in timestamp order", () => {
    const bundle = projectDiagnosisVisualization(
      audience("enterprise", TRUSTED_A, "ent-admin", { authorizedEmployeeIds: ["user-a"] }),
      chainCatalog(),
    );
    const kinds = bundle.timeline.events.map((event) => event.kind);
    expect(kinds).toEqual([
      "signal",
      "evidence_ref",
      "finding",
      "case",
      "grant",
      "mission",
      "proposal",
      "remediation",
      "verification",
    ]);
    const timestamps = bundle.timeline.events.map((event) => event.timestamp);
    expect(timestamps).toEqual([...timestamps].toSorted((left, right) => (left < right ? -1 : 1)));

    const byKind = Object.fromEntries(
      bundle.timeline.events.map((event) => [event.kind, event.parentRefs.map((ref) => ref.type)]),
    );
    expect(byKind.evidence_ref).toEqual(["signal"]);
    expect(byKind.finding).toEqual(["evidence_ref"]);
    expect(byKind.case).toContain("signal");
    expect(byKind.case).toContain("finding");
    expect(byKind.mission).toEqual(["case", "grant"]);
    expect(byKind.proposal).toEqual(["case", "grant"]);
    expect(byKind.remediation).toEqual(["proposal"]);
    expect(byKind.verification).toEqual(["remediation"]);
  });

  it("keeps P0/P1, INCONCLUSIVE, expired, empty, and load errors explicit", () => {
    const p0 = projectDiagnosisVisualization(
      audience("enterprise", TRUSTED_A, "ent-admin", { authorizedEmployeeIds: ["user-a"] }),
      chainCatalog(),
    );
    expect(p0.health.tone).toBe("degraded");
    expect(p0.health.openP0).toBe(1);
    expect(p0.cases[0]?.severity).toBe("P0");

    const inconclusive = projectDiagnosisVisualization(
      audience("enterprise", TRUSTED_A, "ent-admin", { authorizedEmployeeIds: ["user-a"] }),
      chainCatalog({
        findings: [finding({ findingId: "find-a", tenantId: TENANT_A, severity: "P2" })],
        cases: [caseRef({ caseId: "case-a", tenantId: TENANT_A, severity: "P2" })],
        signals: [
          signal({
            signalId: "sig-a",
            tenantId: TENANT_A,
            status: "inconclusive",
            completion: "INCONCLUSIVE",
          }),
        ],
      }),
    );
    expect(inconclusive.health.tone).toBe("inconclusive");
    expect(inconclusive.health.label).not.toMatch(/健康|已解决/);

    const expired = projectDiagnosisVisualization(
      audience("enterprise", TRUSTED_A, "ent-admin", { authorizedEmployeeIds: ["user-a"] }),
      {
        signals: [
          signal({
            signalId: "sig-exp",
            tenantId: TENANT_A,
            status: "expired",
            caseId: undefined,
            findingIds: [],
          }),
        ],
      },
    );
    expect(expired.health.tone).toBe("expired");
    expect(expired.health.label).not.toMatch(/健康|已解决/);

    const empty = projectDiagnosisVisualization(audience("enterprise", TRUSTED_A, "ent-admin"), {});
    expect(empty.permissionState).toBe("empty");
    expect(empty.health.tone).toBe("empty");
    expect(empty.health.label).toBe("暂无数据");

    const failed = projectDiagnosisVisualization(
      audience("platform", TRUSTED_PLATFORM, "plat-admin"),
      { loadError: "reader_unavailable" },
    );
    expect(failed.permissionState).toBe("unavailable");
    expect(failed.health.tone).toBe("error");
    expect(failed.loadError).toBe("reader_unavailable");
    expect(failed.health.label).not.toMatch(/健康|已解决/);
  });

  it("declares trend windows and does not treat missing buckets as healthy", () => {
    const bundle = projectDiagnosisVisualization(
      audience("enterprise", TRUSTED_A, "ent-admin", { authorizedEmployeeIds: ["user-a"] }),
      chainCatalog(),
    );
    expect(bundle.trend.window).toEqual({
      from: "2026-09-03T00:00:00.000Z",
      to: "2026-09-03T04:00:00.000Z",
    });
    expect(bundle.trend.sampleRange).toEqual({
      from: "2026-09-03T01:10:00.000Z",
      to: "2026-09-03T01:10:00.000Z",
    });
    expect(bundle.trend.completeness).toBe("partial");
    expect(bundle.trend.missingBuckets.length).toBeGreaterThan(0);
    expect(
      bundle.trend.buckets
        .filter((bucket) => !bucket.present)
        .every((bucket) => bucket.sampleCount === 0),
    ).toBe(true);
    expect(bundle.health.tone).not.toBe("ok");
  });

  it("redacts evidence, prompt, and tool output from projections", () => {
    const platform = projectDiagnosisVisualization(
      audience("platform", TRUSTED_PLATFORM, "plat-admin"),
      chainCatalog(),
    );
    expect(JSON.stringify(platform)).not.toMatch(/prompt|toolResult|messageBody|payload/);
    expect(platform.timeline.events.some((event) => event.kind === "evidence_ref")).toBe(false);

    const enterprise = projectDiagnosisVisualization(
      audience("enterprise", TRUSTED_A, "ent-admin", { authorizedEmployeeIds: ["user-a"] }),
      chainCatalog({
        shareGrants: [
          grant({
            grantId: "share-a",
            kind: "evidence_share",
            evidenceIds: ["ev-a"],
            dataScope: ["evidence_ref"],
          }),
        ],
      }),
    );
    expect(enterprise.timeline.events.some((event) => event.kind === "evidence_ref")).toBe(true);
    expect(enterprise.timeline.events.find((event) => event.kind === "evidence_ref")?.ref.id).toBe(
      "ev-a",
    );
  });

  it("hides expired, revoked, suspended, or consumed authorization content immediately", () => {
    for (const status of ["EXPIRED", "REVOKED", "SUSPENDED", "CONSUMED"] as const) {
      const bundle = projectDiagnosisVisualization(
        audience("enterprise", TRUSTED_A, "ent-admin", { authorizedEmployeeIds: ["user-a"] }),
        chainCatalog({
          grants: [grant({ grantId: "grant-a", status })],
        }),
      );
      expect(bundle.authorizations.rows).toEqual([]);
      expect(bundle.timeline.events.some((event) => event.kind === "grant")).toBe(false);
      expect(bundle.timeline.events.some((event) => event.kind === "mission")).toBe(false);
      expect(bundle.timeline.events.some((event) => event.kind === "proposal")).toBe(false);
      expect(bundle.timeline.events.some((event) => event.kind === "remediation")).toBe(false);
      expect(bundle.remediations.rows).toEqual([]);
    }
  });

  it("keeps conversation entries as references only", () => {
    const entry = createDiagnosisConversationEntry({
      signalId: "sig-a",
      caseId: "case-a",
      targetRef: { targetType: "session", targetId: "session-a", tenantId: TENANT_A },
      tenantId: TENANT_A,
    });
    expect(entry).toEqual({
      signalId: "sig-a",
      caseId: "case-a",
      targetRef: { targetType: "session", targetId: "session-a", tenantId: TENANT_A },
      tenantId: TENANT_A,
    });
    expectCode(
      () =>
        createDiagnosisConversationEntry({
          signalId: "sig-a",
          tenantId: TENANT_A,
          evidenceIds: ["ev-a"],
        } as never),
      "conversation_ref_only",
    );

    const refresh = createAuthorizationDecisionRefresh({ grantId: "grant-a", decision: "approve" });
    expect(refresh).toEqual({ grantId: "grant-a", decision: "approve", refresh: "p6_p7" });
  });

  it("fails closed on tenant, principal, role, and sessionTenant mismatches", () => {
    expectCode(
      () =>
        projectDiagnosisVisualization(
          audience("enterprise", TRUSTED_A, "ent-admin", { claimedTenantId: TENANT_B }),
          chainCatalog(),
        ),
      "tenant_mismatch",
    );
    expectCode(
      () =>
        projectDiagnosisVisualization(
          audience("platform", TRUSTED_A, "plat-admin"),
          chainCatalog(),
        ),
      "role_mismatch",
    );
    expectCode(
      () =>
        projectDiagnosisVisualization(
          audience("enterprise", TRUSTED_A, "ent-admin", { sessionTenantId: TENANT_A } as never),
          chainCatalog(),
        ),
      "session_tenant_untrusted",
    );
    expectCode(
      () =>
        projectDiagnosisVisualization(
          {
            role: "enterprise",
            trusted: TRUSTED_A,
            principal: principal("ent-admin", TENANT_B),
            redactionProfile: "administrator",
          },
          chainCatalog(),
        ),
      "tenant_mismatch",
    );
  });

  it("lists platform pending approvals without widening employee evidence", () => {
    const bundle = projectDiagnosisVisualization(
      audience("platform", TRUSTED_PLATFORM, "plat-admin"),
      chainCatalog({
        grants: [
          grant({
            grantId: "grant-pending",
            status: "REQUESTED",
            approverRole: "platform",
            targetPrincipal: "user-a",
          }),
        ],
      }),
    );
    expect(bundle.authorizations.pendingApprovals.map((row) => row.grantId)).toEqual([
      "grant-pending",
    ]);
    expect(bundle.authorizations.pendingApprovals[0]?.dataScope).toEqual([
      "finding_ref",
      "report_summary",
    ]);
    expect(bundle.authorizations.pendingApprovals[0]?.actions).toEqual(["inspect"]);
    expect(bundle.authorizations.pendingApprovals[0]?.expiresAt).toBe("2026-09-04T00:00:00.000Z");
    expect(bundle.authorizations.pendingApprovals[0]?.risk).toBe("medium");
    expect(bundle.reportExport.exporter).toBe("exportCompositeDiagnosisReportJson");
    expect(bundle.timeline.events.some((event) => event.kind === "evidence_ref")).toBe(false);
  });

  it("statically forbids a second fact store, live repair, and message-chain writes", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "visualization.ts"),
      "utf8",
    );
    expect(source).toContain(
      "Does not create a second Signal, Case, Finding, health, or audit store",
    );
    expect(source).toContain(
      "Does not call live chat, RPC, Doctor, Channel, or remediation executor",
    );
    expect(source).toContain("Does not write the message main chain");
    expect(source).not.toContain("createReportDatabase");
    expect(source).not.toContain("SkillHealthDB");
    expect(source).not.toContain("appendSkillInvocationEvent");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("runDoctorChecks");
    expect(source).not.toContain("doctor --fix");
    expect(source).not.toContain("restartChannel");
    expect(source).not.toContain("writeConfigFile");
    expect(source).not.toContain("coreGatewayHandlers");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS");
    // Control UI statically imports this file. Fat server barrels pull
    // diagnose → snapshot persist / child_process into Vite.
    expect(source).not.toMatch(/from ["']\.\/delegation\.js["']/);
    expect(source).not.toMatch(/from ["']\.\/diagnose\.js["']/);
    expect(source).not.toMatch(/from ["']\.\/report-query-production\.js["']/);
    expect(source).not.toMatch(/from ["']\.\/report-query-projection-snapshot\.js["']/);
    expect(source).not.toContain("child_process");
    expect(source).not.toContain("agent-runtime-store");
  });
});
