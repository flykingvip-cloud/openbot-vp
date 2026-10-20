import { createHash } from "node:crypto";
import type {
  DataPlaneArtifacts,
  DataPlaneCase,
  DataPlaneFinding,
  GrowthReadLocatorView,
} from "./diagnose-data-plane-cases.js";
/**
 * Track D / M1 — Evidence SLO as first-class findings (补观测).
 * Empty sampling / stale fresh output / missing skill events must not look healthy-ok.
 */
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";

export type EvidenceSloArtifacts = {
  findings: DataPlaneFinding[];
  cases: DataPlaneCase[];
  unhealthy: boolean;
};

function pair(
  code: string,
  growth: DiagnoseGrowthAssessment,
  tenantId: string | null,
  reportRef: string | undefined,
  createdAt: string,
): { finding: DataPlaneFinding; case: DataPlaneCase } {
  const key = `${code}|${growth.agentId}|${growth.groupId ?? ""}`;
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
  const findingId = `dp-${code}-${digest}`;
  const finding: DataPlaneFinding = {
    findingId,
    severity: "high",
    status: "open",
    code,
  };
  const caseRow: DataPlaneCase = {
    schemaVersion: 1,
    caseKind: "evidence_gap",
    status: "suggested",
    tenantId: growth.tenantId ?? tenantId,
    findingCode: code,
    source: {
      ...(reportRef ? { reportRef } : {}),
      growthAgentId: growth.agentId || null,
      growthGroupId: growth.groupId,
    },
    target: growth.groupId
      ? { kind: "group_parent", agentId: growth.agentId || null, sessionKey: null }
      : {
          kind: "agent_1to1",
          agentId: growth.agentId || null,
          sessionKey: growth.agentId ? `agent:${growth.agentId}:main` : null,
        },
    createdAt,
  };
  return { finding, case: caseRow };
}

/**
 * Emit evidence_slo_* findings. Skip rows already marked locator_failed
 * for sampling (locator covers unreadability).
 */
export function buildEvidenceSloArtifacts(input: {
  growths: readonly DiagnoseGrowthAssessment[];
  growthReads?: readonly GrowthReadLocatorView[];
  scanned: number;
  tenantId?: string | null;
  reportRef?: string;
  nowMs?: number;
}): EvidenceSloArtifacts {
  const createdAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const tenantId = input.tenantId?.trim() || null;
  const findings: DataPlaneFinding[] = [];
  const cases: DataPlaneCase[] = [];
  let unhealthy = false;

  const push = (code: string, growth: DiagnoseGrowthAssessment) => {
    const { finding, case: caseRow } = pair(code, growth, tenantId, input.reportRef, createdAt);
    if (findings.some((row) => row.findingId === finding.findingId)) {
      return;
    }
    findings.push(finding);
    cases.push(caseRow);
    unhealthy = true;
  };

  if (input.scanned <= 0) {
    // Target-level sampling SLO even when growth list is empty.
    const synthetic: DiagnoseGrowthAssessment = {
      agentId: "",
      tenantId,
      agentAssetId: null,
      targetOwnerId: null,
      groupId: null,
      objectLabel: "当前对象",
      displayName: null,
      identity: {
        readable: false,
        bootstrapPending: false,
        identityInitialized: false,
        userInitialized: false,
      },
      memory: { present: false, fresh: false },
      hadTaskActivity: false,
      memoryJudgedMissing: false,
      capable: [],
      unstable: [],
      unused: [],
      baselineGapCandidates: [],
      existingJobNames: [],
      identityMissingFields: [],
      userMissingFields: [],
      installedSkillIds: [],
      memoryFileCount: 0,
      reportFileCount: 0,
      freshArtifactCount: 0,
      sessionRoster: { main: 0, cron: 0, other: 0, freshCron: 0, freshMain: 0 },
      activitySources: [],
      roleBaselineInjected: false,
      skillLastSeenMs: {},
    };
    push("evidence_slo_sampling", synthetic);
  }

  for (const growth of input.growths) {
    const read = input.growthReads?.find((row) => row.agentId === growth.agentId);
    const locatorFailed = read?.locatorStatus === "locator_failed";

    if (!locatorFailed && !growth.identity.readable && input.scanned > 0) {
      // Readable=false without locator_failed still counts as sampling gap.
      push("evidence_slo_sampling", growth);
    }

    if (growth.hadTaskActivity && growth.freshArtifactCount === 0) {
      push("evidence_slo_fresh_output", growth);
    }

    const installed = growth.installedSkillIds?.length ?? 0;
    if (installed > 0 && !(growth.activitySources ?? []).includes("skill_invocation")) {
      push("evidence_slo_skill_events", growth);
    }
  }

  return { findings, cases, unhealthy };
}

/** Merge growth + evidence SLO artifacts (findings/cases). */
export function mergeDataPlaneArtifacts(
  left: DataPlaneArtifacts,
  right: Pick<EvidenceSloArtifacts, "findings" | "cases">,
): DataPlaneArtifacts {
  const findings = [...left.findings];
  const cases = [...left.cases];
  for (const finding of right.findings) {
    if (!findings.some((row) => row.findingId === finding.findingId)) {
      findings.push(finding);
    }
  }
  for (const caseRow of right.cases) {
    if (
      !cases.some(
        (row) =>
          row.findingCode === caseRow.findingCode &&
          row.source.growthAgentId === caseRow.source.growthAgentId &&
          row.source.growthGroupId === caseRow.source.growthGroupId,
      )
    ) {
      cases.push(caseRow);
    }
  }
  return {
    findings,
    cases,
    hasLocatorFailed: left.hasLocatorFailed,
  };
}

/** Re-export for callers that only need the growth builder alongside SLO. */
export { buildDataPlaneArtifactsFromGrowth } from "./diagnose-data-plane-cases.js";
