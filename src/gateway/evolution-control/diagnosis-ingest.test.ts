import { describe, expect, it, vi } from "vitest";
import { buildSkillInstallationCandidate } from "../../diagnosis/skill-installation-candidate.js";
import { buildStructuralEvolutionCandidate } from "../../diagnosis/structural-evolution-candidate.js";
import { previewDiagnosisCandidate } from "./diagnosis-ingest.js";

function fact() {
  const built = buildStructuralEvolutionCandidate({
    structuralIntent: "adjust_reporting_cadence",
    proposedChange: { field: "reportingCadence", value: "milestone" },
    surfaceId: "agent.working-dna",
    targetHint: "agent:bot-2",
    baselineHash: "style:structured:on_completion:confirm_first:balanced:neutral",
    observationRef: "obs:pattern:reporting-cadence-1",
    evidenceRefs: ["evidence:task-result-1"],
    snapshotRef: "a".repeat(64),
    reportRef: "cdr-persisted-1",
    findingRef: "finding-1",
    observedWindow: {
      startedAt: "2026-09-18T00:00:00.000Z",
      endedAt: "2026-09-19T00:00:00.000Z",
    },
  });
  if (!built.ok) {
    throw new Error(built.reason);
  }
  return built.candidate;
}

describe("previewDiagnosisCandidate", () => {
  it("validates a structural candidate without writing WAL, proposal, candidate, or ledger", () => {
    const writes = { wal: vi.fn(), proposal: vi.fn(), candidate: vi.fn(), ledger: vi.fn() };
    const result = previewDiagnosisCandidate(fact());
    expect(result).toEqual({ ok: true, candidate: fact(), writes: [] });
    expect(writes.wal).not.toHaveBeenCalled();
    expect(writes.proposal).not.toHaveBeenCalled();
    expect(writes.candidate).not.toHaveBeenCalled();
    expect(writes.ledger).not.toHaveBeenCalled();
  });

  it("rejects an invalid candidate and still writes nothing", () => {
    const result = previewDiagnosisCandidate({
      ...fact(),
      proposedChange: { field: "reportingCadence", value: "daily" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("proposed_change");
    }
    expect(result.writes).toEqual([]);
  });

  it("validates an existing-skill installation candidate without writing", () => {
    const writes = { wal: vi.fn(), proposal: vi.fn(), candidate: vi.fn(), ledger: vi.fn() };
    const built = buildSkillInstallationCandidate({
      structuralIntent: "install_existing_skill",
      proposedChange: { field: "skillId", operation: "install", skillId: "briefing" },
      surfaceId: "capability.skill-installation",
      targetHint: "bot-2",
      baselineHash: "skill-install-baseline-aaa",
      observationRef: "obs:explicit-install:briefing",
      evidenceRefs: ["evidence:task-result-1"],
      snapshotRef: "b".repeat(64),
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
    const result = previewDiagnosisCandidate(built.candidate);
    expect(result).toEqual({ ok: true, candidate: built.candidate, writes: [] });
    expect(writes.wal).not.toHaveBeenCalled();
  });
});
