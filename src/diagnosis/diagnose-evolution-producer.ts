/**
 * Diagnosis stays on the Evidence / Candidate boundary.
 * Path A purposes stay prescriptions. Path B emits preview DTOs only.
 * It does not apply, promote, write cron, or submit control-plane objects.
 */
import { createHash } from "node:crypto";
import type { EvolutionPrescription } from "./diagnose-evolution-prescription.js";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import {
  buildSkillInstallationCandidate,
  type SkillInstallationCandidate,
  type SkillInstallationPreviewFact,
} from "./skill-installation-candidate.js";
import {
  buildStructuralEvolutionCandidate,
  isPathAEvolutionPurpose,
  type StructuralEvolutionCandidate,
  type StructuralPreviewFact,
} from "./structural-evolution-candidate.js";

export const DIAGNOSIS_EVOLUTION_PRODUCER = "diagnosis.evidence-candidate" as const;

export type DiagnoseProducerEvidence = {
  evidenceRef: string;
  kind: "runtime_scan" | "identity_gap" | "memory_artifact" | "skill_inventory" | "session_roster";
  subject: string;
  summary: string;
  professionalReportId: string;
};

export type DiagnoseProducerCandidate = {
  candidateRef: string;
  status: "candidate";
  autoApplied: false;
  domain: "agent_working_dna" | "skill";
  purpose: "identity" | "memory" | "learn_capability" | "review_tasks" | "observe";
  subject: string;
  summary: string;
  evidenceRefs: string[];
  prescriptionId: string | null;
  professionalReportId: string;
};

export type DiagnoseEvolutionProducerOutput = {
  producer: typeof DIAGNOSIS_EVOLUTION_PRODUCER;
  evidence: DiagnoseProducerEvidence[];
  /** Legacy A-class report rows. Always empty after A0. */
  candidates: DiagnoseProducerCandidate[];
  structuralCandidates: StructuralEvolutionCandidate[];
  skillInstallationCandidates: SkillInstallationCandidate[];
};

export type DiagnoseProducerInput = {
  professionalReportId: string;
  subject: Array<{ displayName: string }>;
  runtimeAssessment: {
    completion: string;
    findingCount: number;
    scanned: number;
    skipped: number;
  };
  growthAssessment: DiagnoseGrowthAssessment[];
  prescriptions: EvolutionPrescription[];
  structuralFacts?: StructuralPreviewFact[];
  skillInstallationFacts?: SkillInstallationPreviewFact[];
};

export function produceDiagnoseEvolutionArtifacts(
  report: DiagnoseProducerInput,
): DiagnoseEvolutionProducerOutput {
  const evidence: DiagnoseProducerEvidence[] = [];
  const reportId = report.professionalReportId;
  evidence.push(
    sealEvidence({
      kind: "runtime_scan",
      subject: subjectLabel(report),
      summary: runtimeSummary(report),
      professionalReportId: reportId,
    }),
  );
  for (const growth of report.growthAssessment) {
    evidence.push(...evidenceForGrowth(growth, reportId));
  }
  return {
    producer: DIAGNOSIS_EVOLUTION_PRODUCER,
    evidence,
    candidates: [],
    structuralCandidates: structuralCandidatesFromFacts(report.structuralFacts ?? []),
    skillInstallationCandidates: skillInstallationCandidatesFromFacts(
      report.skillInstallationFacts ?? [],
    ),
  };
}

function skillInstallationCandidatesFromFacts(
  facts: SkillInstallationPreviewFact[],
): SkillInstallationCandidate[] {
  const out: SkillInstallationCandidate[] = [];
  for (const fact of facts) {
    if (isPathAEvolutionPurpose(fact.structuralIntent)) {
      continue;
    }
    const built = buildSkillInstallationCandidate(fact);
    if (built.ok) {
      out.push(built.candidate);
    }
  }
  return out;
}

function structuralCandidatesFromFacts(
  facts: StructuralPreviewFact[],
): StructuralEvolutionCandidate[] {
  const out: StructuralEvolutionCandidate[] = [];
  for (const fact of facts) {
    if (isPathAEvolutionPurpose(fact.structuralIntent)) {
      continue;
    }
    const built = buildStructuralEvolutionCandidate(fact);
    if (built.ok) {
      out.push(built.candidate);
    }
  }
  return out;
}

function evidenceForGrowth(
  growth: DiagnoseGrowthAssessment,
  professionalReportId: string,
): DiagnoseProducerEvidence[] {
  const rows: DiagnoseProducerEvidence[] = [];
  if (
    (growth.identityMissingFields ?? []).length > 0 ||
    (growth.userMissingFields ?? []).length > 0
  ) {
    rows.push(
      sealEvidence({
        kind: "identity_gap",
        subject: growth.objectLabel,
        summary: identityGapSummary(growth),
        professionalReportId,
      }),
    );
  }
  rows.push(
    sealEvidence({
      kind: "memory_artifact",
      subject: growth.objectLabel,
      summary: memorySummary(growth),
      professionalReportId,
    }),
  );
  rows.push(
    sealEvidence({
      kind: "skill_inventory",
      subject: growth.objectLabel,
      summary: skillSummary(growth),
      professionalReportId,
    }),
  );
  rows.push(
    sealEvidence({
      kind: "session_roster",
      subject: growth.objectLabel,
      summary: rosterSummary(growth),
      professionalReportId,
    }),
  );
  return rows;
}

function runtimeSummary(report: DiagnoseProducerInput): string {
  const runtime = report.runtimeAssessment;
  return `已扫 ${runtime.scanned} · 跳过 ${runtime.skipped} · 发现 ${runtime.findingCount} · 结论 ${runtime.completion}`;
}

function identityGapSummary(growth: DiagnoseGrowthAssessment): string {
  const bits = [
    growth.identityMissingFields.length > 0
      ? `IDENTITY 缺 ${growth.identityMissingFields.join("、")}`
      : "",
    growth.userMissingFields.length > 0 ? `USER 缺 ${growth.userMissingFields.join("、")}` : "",
  ].filter(Boolean);
  return bits.join("；") || "身份未齐";
}

function memorySummary(growth: DiagnoseGrowthAssessment): string {
  return `记忆文件 ${growth.memoryFileCount ?? 0} · 近窗产出 ${growth.freshArtifactCount ?? 0} · 报告文件 ${growth.reportFileCount ?? 0}`;
}

function skillSummary(growth: DiagnoseGrowthAssessment): string {
  return `已装 ${(growth.installedSkillIds ?? []).length} · 成功 ${growth.capable.length} · 不稳定 ${growth.unstable.length} · 未观察 ${growth.unused.length}`;
}

function rosterSummary(growth: DiagnoseGrowthAssessment): string {
  const roster = growth.sessionRoster ?? {
    main: 0,
    cron: 0,
    other: 0,
    freshCron: 0,
    freshMain: 0,
  };
  return `主会话 ${roster.main}（近窗 ${roster.freshMain}）· cron ${roster.cron}（近窗 ${roster.freshCron}）· 其他 ${roster.other}`;
}

function subjectLabel(report: DiagnoseProducerInput): string {
  return report.subject.map((row) => row.displayName).join("、") || "当前对象";
}

function sealEvidence(
  input: Omit<DiagnoseProducerEvidence, "evidenceRef">,
): DiagnoseProducerEvidence {
  const material = [input.kind, input.subject, input.summary, input.professionalReportId].join(
    "\n",
  );
  return {
    ...input,
    evidenceRef: `ev:diag:${createHash("sha256").update(material).digest("hex").slice(0, 16)}`,
  };
}
