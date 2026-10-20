import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  persistProducedEvolutionPreviews,
  readDiagnosisEvolutionPreview,
} from "./diagnose-evolution-preview-store.js";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import { persistGrowthAssessmentSnapshot } from "./diagnose-growth-snapshot.js";
import { buildStructuralEvolutionCandidate } from "./structural-evolution-candidate.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-preview-store-"));
  dirs.push(dir);
  return dir;
}

function assessment(): DiagnoseGrowthAssessment {
  return {
    agentId: "bot-2",
    tenantId: "tenant-a",
    agentAssetId: "asset-1",
    targetOwnerId: "owner-1",
    groupId: null,
    objectLabel: "市场助手",
    displayName: "市场助手",
    identity: {
      readable: true,
      bootstrapPending: false,
      identityInitialized: true,
      userInitialized: true,
    },
    memory: { present: true, fresh: true },
    hadTaskActivity: true,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: [],
    userMissingFields: [],
    installedSkillIds: [],
    memoryFileCount: 1,
    reportFileCount: 1,
    freshArtifactCount: 1,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 1 },
    activitySources: ["memory_file"],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
  };
}

describe("diagnosis evolution preview store", () => {
  it("persists a sealed preview without proposalId and reads it back", () => {
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
    expect(snapshot).not.toBeNull();
    const built = buildStructuralEvolutionCandidate({
      structuralIntent: "adjust_reporting_cadence",
      proposedChange: { field: "reportingCadence", value: "milestone" },
      surfaceId: "agent.working-dna",
      targetHint: "bot-2",
      baselineHash: "wdna-style-on_completion",
      observationRef: "obs:pattern:1",
      evidenceRefs: ["evidence:task-result-1"],
      snapshotRef: snapshot!.snapshotId,
      reportRef: "cdr-1",
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
    const stored = persistProducedEvolutionPreviews({
      report: {
        producer: {
          structuralCandidates: [built.candidate],
          skillInstallationCandidates: [],
        },
      },
      tenantId: "tenant-a",
      configDir,
      nowMs: Date.parse("2026-09-19T12:00:00.000Z"),
    });
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored[0])).not.toContain("proposalId");
    const read = readDiagnosisEvolutionPreview({
      tenantId: "tenant-a",
      candidateVersion: built.candidate.candidateVersion,
      configDir,
      nowMs: Date.parse("2026-09-19T12:00:00.000Z"),
    });
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.record.candidate.candidateVersion).toBe(built.candidate.candidateVersion);
    }
  });

  it("rejects a cross-tenant preview read", () => {
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
      proposedChange: { field: "reportingCadence", value: "on_request" },
      surfaceId: "agent.working-dna",
      targetHint: "bot-2",
      baselineHash: "wdna-style",
      observationRef: "obs:pattern:2",
      evidenceRefs: ["evidence:ops-1"],
      snapshotRef: snapshot!.snapshotId,
      reportRef: "cdr-2",
      findingRef: "finding-2",
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
      tenantId: "tenant-a",
      configDir,
      nowMs: Date.parse("2026-09-19T12:00:00.000Z"),
    });
    expect(
      readDiagnosisEvolutionPreview({
        tenantId: "tenant-b",
        candidateVersion: built.candidate.candidateVersion,
        configDir,
        nowMs: Date.parse("2026-09-19T12:00:00.000Z"),
      }).ok,
    ).toBe(false);
  });
});
