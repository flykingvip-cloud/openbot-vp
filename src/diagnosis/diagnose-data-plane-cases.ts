/**
 * Track D / M1 — structured data-plane findings + cases.
 * locator_failed / growth gaps must never live only in limitations prose.
 * Field names align with Track I InterventionCase (status, not state).
 */
import { createHash } from "node:crypto";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";

/** Minimal locator view — avoid importing diagnose-live-request (cycle). */
export type GrowthReadLocatorView = {
  agentId: string;
  tenantId: string;
  locatorStatus?: "located" | "locator_failed" | "not_applicable";
  locatorFailureCode?: string;
  displayName?: string;
};

export type DataPlaneCaseKind =
  | "locator_failed"
  | "evidence_gap"
  | "growth_identity_gap"
  | "growth_user_gap"
  | "growth_memory_gap";

/** Emitted into ProfessionalDiagnosisReport.dataPlaneCases for Track I. */
export type DataPlaneCase = {
  schemaVersion: 1;
  caseKind: DataPlaneCaseKind;
  /** Always "suggested" at emit time — same field as InterventionCase.status. */
  status: "suggested";
  tenantId: string | null;
  findingCode: string;
  source: {
    reportRef?: string;
    growthAgentId: string | null;
    growthGroupId: string | null;
  };
  target: {
    kind: "group_parent" | "agent_1to1";
    agentId: string | null;
    sessionKey: string | null;
  };
  locatorFailureCode?: string;
  createdAt: string;
};

export type DataPlaneFinding = {
  findingId: string;
  severity: string;
  status: "open";
  code: string;
};

export type DataPlaneArtifacts = {
  findings: DataPlaneFinding[];
  cases: DataPlaneCase[];
  /** True when any locator_failed case was emitted. */
  hasLocatorFailed: boolean;
};

function findingIdFor(code: string, key: string): string {
  const digest = createHash("sha256").update(`${code}\n${key}`).digest("hex").slice(0, 12);
  return `dp-${code}-${digest}`;
}

function targetFor(
  growth: DiagnoseGrowthAssessment | null,
  agentId: string,
): DataPlaneCase["target"] {
  if (growth?.groupId) {
    return { kind: "group_parent", agentId: agentId || null, sessionKey: null };
  }
  const id = (growth?.agentId || agentId || "").trim();
  return {
    kind: "agent_1to1",
    agentId: id || null,
    sessionKey: id ? `agent:${id}:main` : null,
  };
}

function pushPair(
  out: DataPlaneArtifacts,
  input: {
    caseKind: DataPlaneCaseKind;
    findingCode: string;
    severity: string;
    tenantId: string | null;
    reportRef?: string;
    growth: DiagnoseGrowthAssessment | null;
    agentId: string;
    groupId: string | null;
    locatorFailureCode?: string;
    createdAt: string;
  },
): void {
  const key = [
    input.findingCode,
    input.agentId,
    input.groupId ?? "",
    input.locatorFailureCode ?? "",
  ].join("|");
  const id = findingIdFor(input.findingCode, key);
  if (out.findings.some((row) => row.findingId === id)) {
    return;
  }
  out.findings.push({
    findingId: id,
    severity: input.severity,
    status: "open",
    code: input.findingCode,
  });
  const caseRow: DataPlaneCase = {
    schemaVersion: 1,
    caseKind: input.caseKind,
    status: "suggested",
    tenantId: input.tenantId,
    findingCode: input.findingCode,
    source: {
      ...(input.reportRef ? { reportRef: input.reportRef } : {}),
      growthAgentId: input.agentId || null,
      growthGroupId: input.groupId,
    },
    target: targetFor(input.growth, input.agentId),
    createdAt: input.createdAt,
  };
  if (input.locatorFailureCode) {
    caseRow.locatorFailureCode = input.locatorFailureCode;
  }
  out.cases.push(caseRow);
  if (input.caseKind === "locator_failed") {
    out.hasLocatorFailed = true;
  }
}

/**
 * Build structured findings + dataPlaneCases from growth reads and assessments.
 * Does not write limitations — callers must keep those separate.
 */
export function buildDataPlaneArtifactsFromGrowth(input: {
  growthReads?: readonly GrowthReadLocatorView[];
  growths?: readonly DiagnoseGrowthAssessment[];
  tenantId?: string | null;
  reportRef?: string;
  nowMs?: number;
}): DataPlaneArtifacts {
  const nowMs = input.nowMs ?? Date.now();
  const createdAt = new Date(nowMs).toISOString();
  const tenantId = input.tenantId?.trim() || null;
  const out: DataPlaneArtifacts = { findings: [], cases: [], hasLocatorFailed: false };
  const growths = input.growths ?? [];
  const reads = input.growthReads ?? [];

  for (const read of reads) {
    if (read.locatorStatus !== "locator_failed") {
      continue;
    }
    const growth =
      growths.find((row) => row.agentId === read.agentId) ??
      growths.find((row) => row.groupId && read.displayName?.includes(row.groupId)) ??
      null;
    const groupId = growth?.groupId ?? null;
    pushPair(out, {
      caseKind: "locator_failed",
      findingCode: "locator_failed",
      severity: "high",
      tenantId: read.tenantId?.trim() || tenantId,
      reportRef: input.reportRef,
      growth,
      agentId: read.agentId,
      groupId,
      locatorFailureCode: read.locatorFailureCode,
      createdAt,
    });
  }

  for (const growth of growths) {
    const read = reads.find((row) => row.agentId === growth.agentId);
    const locatorFailed = read?.locatorStatus === "locator_failed";
    // Identity/user/memory gaps: do not double-count unreadability already covered by locator_failed.
    if (!locatorFailed && growth.identity.readable) {
      if (!growth.identity.identityInitialized || (growth.identityMissingFields?.length ?? 0) > 0) {
        pushPair(out, {
          caseKind: "growth_identity_gap",
          findingCode: "growth_identity_gap",
          severity: "high",
          tenantId: growth.tenantId ?? tenantId,
          reportRef: input.reportRef,
          growth,
          agentId: growth.agentId,
          groupId: growth.groupId,
          createdAt,
        });
      }
      if (!growth.identity.userInitialized || (growth.userMissingFields?.length ?? 0) > 0) {
        pushPair(out, {
          caseKind: "growth_user_gap",
          findingCode: "growth_user_gap",
          severity: "high",
          tenantId: growth.tenantId ?? tenantId,
          reportRef: input.reportRef,
          growth,
          agentId: growth.agentId,
          groupId: growth.groupId,
          createdAt,
        });
      }
    }
    if (growth.memoryJudgedMissing) {
      pushPair(out, {
        caseKind: "growth_memory_gap",
        findingCode: "growth_memory_gap",
        severity: "high",
        tenantId: growth.tenantId ?? tenantId,
        reportRef: input.reportRef,
        growth,
        agentId: growth.agentId,
        groupId: growth.groupId,
        createdAt,
      });
    }
  }

  return out;
}
