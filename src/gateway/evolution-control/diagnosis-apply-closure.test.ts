import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { persistProducedEvolutionPreviews } from "../../diagnosis/diagnose-evolution-preview-store.js";
import type { DiagnoseGrowthAssessment } from "../../diagnosis/diagnose-growth-assessment.js";
import { persistGrowthAssessmentSnapshot } from "../../diagnosis/diagnose-growth-snapshot.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import { buildStructuralEvolutionCandidate } from "../../diagnosis/structural-evolution-candidate.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { readRobotWorkingStyleOrDefault } from "../agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { confirmDiagnosisCandidatePreview } from "./confirm-diagnosis-candidate.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import {
  alignDiagnosisExperimentFreeze,
  createControlPlaneDiagnosisSubmitPorts,
  defaultSnapshotReader,
  workingDnaBaselineHash,
  type DiagnosisGrantView,
  type DiagnosisSubmitDeps,
} from "./submit-diagnosis-candidate.js";
import { createPassingObservationProvider, withWorkingDnaExternal } from "./test-support.js";

const dirs: string[] = [];
const NOW = "2026-09-19T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const TENANT = "tenant-a";
const AGENT = "bot-2";
const BASELINE_HASH = workingDnaBaselineHash(DEFAULT_WORKING_STYLE);
const EVIDENCE = ["obs:pattern:reporting-cadence-1", "evidence:task-result-1"] as const;

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-apply-"));
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

function operatorInspector(): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: "grant-1",
      status: "APPROVED",
      tenantScope: TENANT,
      allowedEvidence: [...EVIDENCE],
      allowedActions: ["suggest", "experiment", "inspect", "apply", "verify"],
      confidentialityCeiling: "enterprise",
    }),
  };
}

function confirmGrant(): DiagnosisGrantView {
  return {
    grantId: "grant-1",
    status: "APPROVED",
    tenantScope: TENANT,
    agentId: AGENT,
    allowedEvidence: [...EVIDENCE],
    allowedActions: ["suggest", "experiment", "inspect"],
    confidentialityCeiling: "enterprise",
  };
}

describe("diagnosis experiment apply closure", () => {
  it("writes Working DNA only after an improved experiment and an operator apply", async () => {
    const configDir = tempDir();
    const agentDir = tempDir();
    const persistDir = tempDir();
    const cfg = {
      agents: { list: [{ id: AGENT, agentDir }] },
    } as unknown as OpenBotConfig;
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
      observationRef: EVIDENCE[0],
      evidenceRefs: [EVIDENCE[1]],
      snapshotRef: snapshot!.snapshotId,
      reportRef: "cdr-apply-1",
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
      inspector: operatorInspector(),
      workingDnaAdapter: createWorkingDnaAdapter(cfg, {
        persistDir: path.join(persistDir, "adapter"),
      }),
      observationProvider: createPassingObservationProvider(),
      persistDir,
      now: () => NOW,
      ...withWorkingDnaExternal(cfg),
    });
    const deps: DiagnosisSubmitDeps = {
      ports: createControlPlaneDiagnosisSubmitPorts(
        plane,
        path.join(persistDir, "diagnosis-ingest-wal.json"),
      ),
      inspectGrant: () => confirmGrant(),
      readSnapshot: defaultSnapshotReader(configDir, NOW_MS),
      readBaseline: (agentId) =>
        agentId === AGENT ? { style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH } : null,
      now: () => NOW,
    };
    const confirmed = await confirmDiagnosisCandidatePreview({
      commandId: "cmd-apply-1",
      grantId: "grant-1",
      candidateVersion: built.candidate.candidateVersion,
      tenantId: TENANT,
      principalRef: "user-1",
      confirmedByUser: true,
      configDir,
      nowMs: NOW_MS,
      deps,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    expect(plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );

    const proposal = plane.getProposal(confirmed.receipt.proposalId);
    const stored = plane.getCandidate(confirmed.receipt.candidateRef);
    const freeze = alignDiagnosisExperimentFreeze(proposal!, stored, null);
    const experiment = await plane.startExperiment({
      commandId: "exp-apply-1",
      proposalId: confirmed.receipt.proposalId,
      now: NOW,
      freeze: freeze!,
    });
    expect(plane.listApplications()).toEqual([]);

    await expect(
      plane.applyWorkingDna({
        commandId: "apply-before-eval",
        proposalId: confirmed.receipt.proposalId,
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
        scope: "active",
      }),
    ).rejects.toThrow(/improved experiment/);
    expect((await readRobotWorkingStyleOrDefault(cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );

    await expect(
      plane.applyWorkingDna({
        commandId: "apply-shadow",
        proposalId: confirmed.receipt.proposalId,
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
        scope: "shadow",
      }),
    ).rejects.toThrow(/awaiting operator approval/);
    expect(plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );

    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.result).toBe("improved");
    expect(evaluated.experiment.applyApproval).toBe("pending_apply_approval");
    expect(plane.listApplications()).toEqual([]);

    const applied = await plane.applyWorkingDna({
      commandId: "apply-active",
      proposalId: confirmed.receipt.proposalId,
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "active",
    });
    expect(applied.appliedToRuntime).toBe(true);
    expect(applied.scope).toBe("active");
    const written = await readRobotWorkingStyleOrDefault(cfg, AGENT);
    expect(written.reportingCadence).toBe("milestone");
    expect(plane.getProposal(confirmed.receipt.proposalId)?.status).toBe("ACTIVE");

    const verification = await plane.verifyApplication({
      commandId: "ver-apply-1",
      applicationId: applied.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      now: "2026-09-19T12:10:00.000Z",
    });
    expect(verification.outcome).toBe("improved");
    expect(plane.getProposal(confirmed.receipt.proposalId)?.status).toBe("VERIFIED");
    expect((await readRobotWorkingStyleOrDefault(cfg, AGENT)).reportingCadence).toBe("milestone");
  });
});
