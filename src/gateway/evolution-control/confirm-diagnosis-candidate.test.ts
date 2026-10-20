import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistProducedEvolutionPreviews } from "../../diagnosis/diagnose-evolution-preview-store.js";
import type { DiagnoseGrowthAssessment } from "../../diagnosis/diagnose-growth-assessment.js";
import { persistGrowthAssessmentSnapshot } from "../../diagnosis/diagnose-growth-snapshot.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import {
  buildSkillInstallationCandidate,
  skillInstallationBaselineHash,
} from "../../diagnosis/skill-installation-candidate.js";
import { buildStructuralEvolutionCandidate } from "../../diagnosis/structural-evolution-candidate.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { createFailClosedAdapter } from "./adapters/fail-closed.js";
import { confirmDiagnosisCandidatePreview } from "./confirm-diagnosis-candidate.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { createFailClosedObservationProvider } from "./observation.js";
import {
  alignDiagnosisExperimentFreeze,
  createControlPlaneDiagnosisSubmitPorts,
  createMemoryDiagnosisSubmitPorts,
  defaultSnapshotReader,
  workingDnaBaselineHash,
  type DiagnosisGrantView,
  type DiagnosisSubmitDeps,
} from "./submit-diagnosis-candidate.js";

const dirs: string[] = [];
const NOW = "2026-09-19T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const TENANT = "tenant-a";
const AGENT = "bot-2";
const BASELINE_HASH = workingDnaBaselineHash(DEFAULT_WORKING_STYLE);

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a2-confirm-"));
  dirs.push(dir);
  return dir;
}

function assessment(): DiagnoseGrowthAssessment {
  return {
    agentId: AGENT,
    tenantId: TENANT,
    agentAssetId: "asset-1",
    targetOwnerId: "owner-1",
    groupId: null,
    objectLabel: "市场助手",
    displayName: "市场助手",
    identity: {
      readable: true,
      bootstrapPending: false,
      identityInitialized: false,
      userInitialized: false,
    },
    memory: { present: true, fresh: true },
    hadTaskActivity: true,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: ["name"],
    userMissingFields: [],
    installedSkillIds: [],
    memoryFileCount: 2,
    reportFileCount: 1,
    freshArtifactCount: 2,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 1 },
    activitySources: ["memory_file"],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
  };
}

function planeInspector(): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: "grant-1",
      status: "APPROVED",
      tenantScope: TENANT,
      allowedEvidence: ["obs:pattern:reporting-cadence-1", "evidence:task-result-1"],
      allowedActions: ["suggest", "experiment", "inspect"],
      confidentialityCeiling: "enterprise",
    }),
  };
}

function approvedGrant(): DiagnosisGrantView {
  return {
    grantId: "grant-1",
    status: "APPROVED",
    tenantScope: TENANT,
    agentId: AGENT,
    allowedEvidence: ["obs:pattern:reporting-cadence-1", "evidence:task-result-1"],
    allowedActions: ["suggest", "experiment", "inspect"],
    confidentialityCeiling: "enterprise",
  };
}

describe("confirmDiagnosisCandidatePreview", () => {
  it("submits a persisted preview after user confirm and does not start an experiment", async () => {
    const configDir = tempDir();
    const snapshot = persistGrowthAssessmentSnapshot({
      assessment: assessment(),
      observationWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
      configDir,
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    const built = buildStructuralEvolutionCandidate({
      structuralIntent: "adjust_reporting_cadence",
      proposedChange: { field: "reportingCadence", value: "milestone" },
      surfaceId: "agent.working-dna",
      targetHint: "agent:other-hint",
      baselineHash: BASELINE_HASH,
      observationRef: "obs:pattern:reporting-cadence-1",
      evidenceRefs: ["evidence:task-result-1"],
      snapshotRef: snapshot!.snapshotId,
      reportRef: "cdr-persisted-1",
      findingRef: "finding-1",
      observedWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    persistProducedEvolutionPreviews({
      report: {
        producer: {
          structuralCandidates: [built.candidate],
          skillInstallationCandidates: [],
        },
      },
      tenantId: TENANT,
      configDir,
      nowMs: NOW_MS,
    });
    const ports = createMemoryDiagnosisSubmitPorts();
    const deps: DiagnosisSubmitDeps = {
      ports,
      inspectGrant: () => approvedGrant(),
      readSnapshot: defaultSnapshotReader(configDir, NOW_MS),
      readBaseline: (agentId) =>
        agentId === AGENT ? { style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH } : null,
      now: () => NOW,
    };
    const result = await confirmDiagnosisCandidatePreview({
      commandId: "cmd-confirm-1",
      grantId: "grant-1",
      candidateVersion: built.candidate.candidateVersion,
      tenantId: TENANT,
      principalRef: "user-1",
      confirmedByUser: true,
      configDir,
      nowMs: NOW_MS,
      deps,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.proposalId).toMatch(/^evo:diag:/);
      expect(ports.getProposal(result.receipt.proposalId)?.status).toBe("APPROVED_FOR_EXPERIMENT");
    }
    expect(ports.getWal("cmd-confirm-1")?.state).toBe("committed");
  });

  it("submits a persisted skill-installation preview without starting an experiment", async () => {
    const configDir = tempDir();
    const snapshot = persistGrowthAssessmentSnapshot({
      assessment: assessment(),
      observationWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
      configDir,
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    const skillHash = skillInstallationBaselineHash("briefing", false);
    const built = buildSkillInstallationCandidate({
      structuralIntent: "install_existing_skill",
      proposedChange: { field: "skillId", operation: "install", skillId: "briefing" },
      surfaceId: "capability.skill-installation",
      targetHint: AGENT,
      baselineHash: skillHash,
      observationRef: "obs:explicit-install:briefing",
      evidenceRefs: ["evidence:task-result-1"],
      snapshotRef: snapshot!.snapshotId,
      reportRef: "cdr-persisted-1",
      findingRef: "finding-1",
      observedWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
      installed: false,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    persistProducedEvolutionPreviews({
      report: {
        producer: {
          structuralCandidates: [],
          skillInstallationCandidates: [built.candidate],
        },
      },
      tenantId: TENANT,
      configDir,
      nowMs: NOW_MS,
    });
    const ports = createMemoryDiagnosisSubmitPorts();
    const deps: DiagnosisSubmitDeps = {
      ports,
      inspectGrant: () => ({
        ...approvedGrant(),
        allowedEvidence: ["obs:explicit-install:briefing", "evidence:task-result-1"],
      }),
      readSnapshot: defaultSnapshotReader(configDir, NOW_MS),
      readBaseline: () => ({ style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH }),
      readSkillTarget: ({ skillId }) =>
        skillId === "briefing"
          ? { known: true, installed: false, hash: skillHash }
          : { known: false, installed: false, hash: "" },
      now: () => NOW,
    };
    const result = await confirmDiagnosisCandidatePreview({
      commandId: "cmd-skill-confirm-1",
      grantId: "grant-1",
      candidateVersion: built.candidate.candidateVersion,
      tenantId: TENANT,
      principalRef: "user-1",
      confirmedByUser: true,
      configDir,
      nowMs: NOW_MS,
      deps,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(ports.getProposal(result.receipt.proposalId)?.surfaceId).toBe(
        "capability.skill-installation",
      );
      expect(ports.getProposal(result.receipt.proposalId)?.status).toBe("APPROVED_FOR_EXPERIMENT");
      expect(ports.getProposal(result.receipt.proposalId)?.experimentId).toBeUndefined();
    }
  });

  it("rejects client candidate payloads and unconfirmed calls with zero writes", async () => {
    const configDir = tempDir();
    const ports = createMemoryDiagnosisSubmitPorts();
    const deps: DiagnosisSubmitDeps = {
      ports,
      inspectGrant: () => approvedGrant(),
      readSnapshot: defaultSnapshotReader(configDir, NOW_MS),
      readBaseline: () => ({ style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH }),
      now: () => NOW,
    };
    expect(
      await confirmDiagnosisCandidatePreview({
        commandId: "cmd-client",
        grantId: "grant-1",
        candidateVersion: "a".repeat(64),
        tenantId: TENANT,
        principalRef: "user-1",
        confirmedByUser: true,
        configDir,
        nowMs: NOW_MS,
        clientParams: { candidate: { surfaceId: "agent.working-dna" } },
        deps,
      }),
    ).toEqual({ ok: false, code: "client_candidate_forbidden", writes: [] });
    expect(
      await confirmDiagnosisCandidatePreview({
        commandId: "cmd-unconfirmed",
        grantId: "grant-1",
        candidateVersion: "a".repeat(64),
        tenantId: TENANT,
        principalRef: "user-1",
        confirmedByUser: false,
        configDir,
        nowMs: NOW_MS,
        deps,
      }),
    ).toEqual({ ok: false, code: "confirm_required", writes: [] });
    expect(ports.listProposals()).toEqual([]);
  });

  it("lands the confirmed proposal on the control plane and reloads it into an experiment", async () => {
    const configDir = tempDir();
    const persistDir = tempDir();
    const snapshot = persistGrowthAssessmentSnapshot({
      assessment: assessment(),
      observationWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
      configDir,
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    const built = buildStructuralEvolutionCandidate({
      structuralIntent: "adjust_reporting_cadence",
      proposedChange: { field: "reportingCadence", value: "milestone" },
      surfaceId: "agent.working-dna",
      targetHint: "agent:other-hint",
      baselineHash: BASELINE_HASH,
      observationRef: "obs:pattern:reporting-cadence-1",
      evidenceRefs: ["evidence:task-result-1"],
      snapshotRef: snapshot!.snapshotId,
      reportRef: "cdr-persisted-1",
      findingRef: "finding-1",
      observedWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    persistProducedEvolutionPreviews({
      report: {
        producer: {
          structuralCandidates: [built.candidate],
          skillInstallationCandidates: [],
        },
      },
      tenantId: TENANT,
      configDir,
      nowMs: NOW_MS,
    });
    const plane = createEvolutionControlPlane({
      inspector: planeInspector(),
      workingDnaAdapter: createFailClosedAdapter("working-dna", "agent"),
      observationProvider: createFailClosedObservationProvider(),
      persistDir,
      now: () => NOW,
    });
    const deps: DiagnosisSubmitDeps = {
      ports: createControlPlaneDiagnosisSubmitPorts(
        plane,
        `${persistDir}/diagnosis-ingest-wal.json`,
      ),
      inspectGrant: () => approvedGrant(),
      readSnapshot: defaultSnapshotReader(configDir, NOW_MS),
      readBaseline: (agentId) =>
        agentId === AGENT ? { style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH } : null,
      now: () => NOW,
    };
    const result = await confirmDiagnosisCandidatePreview({
      commandId: "cmd-plane-1",
      grantId: "grant-1",
      candidateVersion: built.candidate.candidateVersion,
      tenantId: TENANT,
      principalRef: "user-1",
      confirmedByUser: true,
      configDir,
      nowMs: NOW_MS,
      deps,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const staged = plane.getProposal(result.receipt.proposalId);
    expect(staged?.status).toBe("APPROVED_FOR_EXPERIMENT");
    expect(staged?.experimentId).toBeUndefined();
    expect(plane.listApplications()).toEqual([]);
    expect(plane.getCandidate(result.receipt.candidateRef)?.candidateRef).toBe(
      result.receipt.candidateRef,
    );

    const reloaded = createEvolutionControlPlane({
      inspector: planeInspector(),
      workingDnaAdapter: createFailClosedAdapter("working-dna", "agent"),
      observationProvider: createFailClosedObservationProvider(),
      persistDir,
      now: () => NOW,
    });
    const restored = reloaded.getProposal(result.receipt.proposalId);
    expect(restored?.status).toBe("APPROVED_FOR_EXPERIMENT");
    const stored = reloaded.getCandidate(result.receipt.candidateRef);
    const fromContentHash = alignDiagnosisExperimentFreeze(restored!, stored, {
      baselineVersion: BASELINE_HASH,
      candidateVersion: built.candidate.candidateVersion,
      codeSha: "client",
      modelRef: "client-model",
      providerVersion: "client",
      configSnapshotRef: "client-cfg",
      datasetOrCohortRef: "client-cohort",
      tenantScope: TENANT,
      confidentialityScope: "enterprise",
      expiresAt: "2026-09-26T00:00:00.000Z",
      maxResourceBudget: 1,
    });
    expect(fromContentHash?.candidateVersion).toBe(result.receipt.candidateRef);
    const fromStore = alignDiagnosisExperimentFreeze(restored!, stored, null);
    expect(fromStore?.candidateVersion).toBe(result.receipt.candidateRef);
    const experiment = await reloaded.startExperiment({
      commandId: "exp-plane-1",
      proposalId: result.receipt.proposalId,
      now: NOW,
      freeze: fromStore!,
    });
    expect(experiment.proposalId).toBe(result.receipt.proposalId);
    expect(experiment.candidateRef).toBe(result.receipt.candidateRef);
    expect(reloaded.listApplications()).toEqual([]);
    expect(reloaded.getProposal(result.receipt.proposalId)?.status).toBe("EXPERIMENTING");
  });
});
