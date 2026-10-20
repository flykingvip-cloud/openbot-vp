import { describe, expect, it } from "vitest";
import type { WorkingStyle } from "../gateway/agent-growth/genome.js";
import {
  FORBIDDEN_CRON_REPORTING_CADENCE_VALUES,
  STRUCTURAL_REPORTING_CADENCE_VALUES,
  STRUCTURAL_WORKING_DNA_SURFACE_ID,
  buildStructuralEvolutionCandidate,
  validateStructuralEvolutionCandidate,
  workingStyleDeltaFromProposedChange,
  type StructuralPreviewFact,
  type StructuralReportingCadence,
} from "./structural-evolution-candidate.js";

function fact(patch: Partial<StructuralPreviewFact> = {}): StructuralPreviewFact {
  return {
    structuralIntent: "adjust_reporting_cadence",
    proposedChange: { field: "reportingCadence", value: "on_completion" },
    surfaceId: STRUCTURAL_WORKING_DNA_SURFACE_ID,
    targetHint: "agent:bot-2",
    baselineHash: "wdna-baseline-aaa",
    observationRef: "obs:pattern:reporting-cadence-1",
    evidenceRefs: ["evidence:task-result-1"],
    snapshotRef: "a".repeat(64),
    reportRef: "cdr-persisted-1",
    findingRef: "finding-1",
    observedWindow: {
      startedAt: "2026-09-18T00:00:00.000Z",
      endedAt: "2026-09-19T00:00:00.000Z",
    },
    ...patch,
  };
}

function workingStyleDelta(value: StructuralReportingCadence): Partial<WorkingStyle> {
  const proposedChange = { field: "reportingCadence" as const, value };
  const delta: Partial<WorkingStyle> = {
    reportingCadence: proposedChange.value,
  };
  return delta;
}

describe("structural evolution candidate contract", () => {
  it("builds a preview DTO without tenant, proposal, grant, or apply fields", () => {
    const built = buildStructuralEvolutionCandidate(fact());
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const encoded = JSON.stringify(built.candidate);
    expect(encoded).not.toContain("tenantId");
    expect(encoded).not.toContain("proposalId");
    expect(encoded).not.toContain("candidateRef");
    expect(encoded).not.toContain("grant");
    expect(encoded).not.toContain("0 8 * * *");
    expect(encoded).not.toContain("wakeText");
    expect(built.candidate.mechanismRef).toBe("diagnosis.behavior.reporting_cadence_gap");
    expect(built.candidate.mechanismRef.includes("pdr-")).toBe(false);
    expect(built.candidate.surfaceId).toBe(STRUCTURAL_WORKING_DNA_SURFACE_ID);
    expect(built.candidate.proposedChange).toEqual({
      field: "reportingCadence",
      value: "on_completion",
    });
    expect(built.candidate.candidateVersion).toBe(built.candidate.candidatePayloadHash);
    expect(validateStructuralEvolutionCandidate(built.candidate).ok).toBe(true);
  });

  it("maps every legal reportingCadence onto Partial<WorkingStyle>", () => {
    expect(STRUCTURAL_REPORTING_CADENCE_VALUES).toEqual([
      "on_completion",
      "milestone",
      "periodic",
      "on_request",
    ]);
    for (const value of STRUCTURAL_REPORTING_CADENCE_VALUES) {
      const proposedChange = { field: "reportingCadence" as const, value };
      const delta: Partial<WorkingStyle> = {
        reportingCadence: proposedChange.value,
      };
      expect(workingStyleDeltaFromProposedChange(proposedChange)).toEqual(delta);
      expect(delta).toEqual({ reportingCadence: value });
      const built = buildStructuralEvolutionCandidate(fact({ proposedChange }));
      expect(built.ok).toBe(true);
      if (built.ok) {
        const fromCandidate: Partial<WorkingStyle> = {
          reportingCadence: built.candidate.proposedChange.value,
        };
        expect(fromCandidate).toEqual(workingStyleDelta(value));
      }
    }
  });

  it("rejects cron schedule values that are not Working DNA fields", () => {
    expect(FORBIDDEN_CRON_REPORTING_CADENCE_VALUES).toEqual(["daily", "weekday_daily", "weekly"]);
    for (const value of FORBIDDEN_CRON_REPORTING_CADENCE_VALUES) {
      expect(
        buildStructuralEvolutionCandidate(
          fact({
            proposedChange: {
              field: "reportingCadence",
              value,
            } as unknown as StructuralPreviewFact["proposedChange"],
          }),
        ),
      ).toMatchObject({ ok: false, reason: "proposed_change" });
    }
    expect(
      buildStructuralEvolutionCandidate(
        fact({
          proposedChange: {
            field: "wakeText",
            value: "on_completion",
          } as unknown as StructuralPreviewFact["proposedChange"],
        }),
      ),
    ).toMatchObject({ ok: false, reason: "proposed_change" });
    const sealed = buildStructuralEvolutionCandidate(fact());
    expect(sealed.ok).toBe(true);
    if (sealed.ok) {
      expect(
        validateStructuralEvolutionCandidate({
          ...sealed.candidate,
          proposedChange: { field: "reportingCadence", value: "daily" },
        }),
      ).toMatchObject({ ok: false, reason: "proposed_change" });
    }
  });

  it("keeps candidateVersion stable across provenance and adjacent windows", () => {
    const first = buildStructuralEvolutionCandidate(fact());
    const sameChange = buildStructuralEvolutionCandidate(
      fact({
        reportRef: "cdr-other-report",
        findingRef: "finding-other",
        evidenceRefs: ["evidence:other-ops"],
        observationRef: "obs:pattern:other-window",
        snapshotRef: "b".repeat(64),
        observedWindow: {
          startedAt: "2026-09-19T00:00:00.000Z",
          endedAt: "2026-09-20T00:00:00.000Z",
        },
      }),
    );
    expect(first.ok && sameChange.ok).toBe(true);
    if (first.ok && sameChange.ok) {
      expect(sameChange.candidate.candidateVersion).toBe(first.candidate.candidateVersion);
      expect(sameChange.candidate.cooldownKey).toBe(first.candidate.cooldownKey);
      expect(sameChange.candidate.reportRef).not.toBe(first.candidate.reportRef);
      expect(sameChange.candidate.observedWindow.startedAt).not.toBe(
        first.candidate.observedWindow.startedAt,
      );
    }
  });

  it("changes candidateVersion when the proposed change or baseline changes", () => {
    const first = buildStructuralEvolutionCandidate(fact());
    const milestone = buildStructuralEvolutionCandidate(
      fact({ proposedChange: { field: "reportingCadence", value: "milestone" } }),
    );
    const baseline = buildStructuralEvolutionCandidate(fact({ baselineHash: "wdna-baseline-bbb" }));
    expect(first.ok && milestone.ok && baseline.ok).toBe(true);
    if (first.ok && milestone.ok && baseline.ok) {
      expect(milestone.candidate.candidateVersion).not.toBe(first.candidate.candidateVersion);
      expect(baseline.candidate.candidateVersion).not.toBe(first.candidate.candidateVersion);
    }
  });

  it("rejects Path A purposes, prose evidence, and display report ids", () => {
    expect(
      buildStructuralEvolutionCandidate(
        fact({ structuralIntent: "identity" as StructuralPreviewFact["structuralIntent"] }),
      ).ok,
    ).toBe(false);
    expect(buildStructuralEvolutionCandidate(fact({ observationRef: "ev:diag:abc" })).ok).toBe(
      false,
    );
    expect(buildStructuralEvolutionCandidate(fact({ reportRef: "pdr-display" })).ok).toBe(false);
    expect(buildStructuralEvolutionCandidate(fact({ targetHint: "not a hint!!" })).ok).toBe(false);
    expect(
      buildStructuralEvolutionCandidate(fact({ surfaceId: "capability.skill-installation" })),
    ).toMatchObject({ ok: false, reason: "surface_id" });
    const sealed = buildStructuralEvolutionCandidate(fact());
    expect(sealed.ok).toBe(true);
    expect(
      validateStructuralEvolutionCandidate({
        ...(sealed.ok ? sealed.candidate : {}),
        tenantId: "001",
      }),
    ).toMatchObject({ ok: false, reason: "authority_field_forbidden" });
  });

  it("keeps the payload hash stable for the same sealed fields", () => {
    const first = buildStructuralEvolutionCandidate(fact());
    const second = buildStructuralEvolutionCandidate(fact());
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.candidate.candidatePayloadHash).toBe(second.candidate.candidatePayloadHash);
    }
  });
});
