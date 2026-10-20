import { describe, expect, it } from "vitest";
import {
  classifyEvolutionEffectProof,
  projectEvolutionLineageView,
  projectExcludedObservation,
  resolveEvolutionHoldAction,
} from "./evolution-lineage.ts";

describe("evolution lineage view", () => {
  it("never upgrades a receipt or linked v1 verification into effect proof", () => {
    expect(
      classifyEvolutionEffectProof({
        status: "ACTIVE",
        legacy: { linkedVerificationOnly: true },
      }),
    ).toBe("linked-only");
    const view = projectEvolutionLineageView(
      {
        proposalId: "evo:1",
        surfaceId: "organization.task-routing",
        status: "CANARY",
        tenantScope: "tenant-a",
        applicationId: "app:1",
      },
      [
        { eventId: "1", type: "application.applied", proposalId: "evo:1" },
        { eventId: "2", type: "verification.completed", proposalId: "evo:1" },
      ],
    );
    expect(view.effectProof).toBe("none");
    expect(view.effectProofLabel).toMatch(/尚未验证/);
    expect(view.steps[0]).toEqual({
      type: "application.applied",
      receiptOnly: true,
      label: "已应用回执",
    });
    expect(view.steps[1]?.receiptOnly).toBe(false);
    expect(
      projectEvolutionLineageView(
        {
          proposalId: "evo:1",
          surfaceId: "agent.working-dna",
          status: "HELD",
          tenantScope: "tenant-a",
        },
        [{ eventId: "3", type: "experiment.held", proposalId: "evo:1" }],
      ).steps[0],
    ).toEqual({
      type: "experiment.held",
      receiptOnly: false,
      label: "实验暂停",
    });
  });

  it("offers hold only while experimenting, and resume only while held", () => {
    expect(resolveEvolutionHoldAction("EXPERIMENTING")).toEqual({
      command: "hold",
      label: "暂停实验",
    });
    expect(resolveEvolutionHoldAction("HELD")).toEqual({
      command: "resume",
      label: "恢复实验",
    });
    expect(resolveEvolutionHoldAction("CANARY")).toBeNull();
    expect(resolveEvolutionHoldAction("VERIFIED")).toBeNull();
    const experimenting = projectEvolutionLineageView(
      {
        proposalId: "evo:hold",
        surfaceId: "agent.working-dna",
        status: "EXPERIMENTING",
        tenantScope: "tenant-a",
      },
      [],
    );
    expect(experimenting.statusLabel).toBe("实验中");
    expect(experimenting.holdAction?.command).toBe("hold");
    const canary = projectEvolutionLineageView(
      {
        proposalId: "evo:canary",
        surfaceId: "agent.working-dna",
        status: "CANARY",
        tenantScope: "tenant-a",
      },
      [],
    );
    expect(canary.holdAction).toBeNull();
  });

  it("projects legacy Capsule exclusion as observation unavailable, not 0% or failed", () => {
    const events = [
      {
        eventId: "ex-1",
        type: "observation.excluded",
        proposalId: "evo:legacy",
        exclusionReason: "legacy_missing_failure_cluster",
      },
    ];
    const observation = projectExcludedObservation(events, "evo:legacy");
    expect(observation?.availability).toBe("unavailable");
    expect(observation?.label).toContain("observation unavailable");
    expect(observation?.reason).toBe("legacy_missing_failure_cluster");
    expect(observation?.recurrenceRate).toBeNull();
    expect(observation?.recurrenceRate).not.toBe(0);
    const view = projectEvolutionLineageView(
      {
        proposalId: "evo:legacy",
        surfaceId: "knowledge.experience-capsule",
        status: "HELD",
        tenantScope: "tenant-a",
      },
      events,
    );
    expect(view.observation?.availability).toBe("unavailable");
    expect(view.statusLabel).toBe("已暂停");
    expect(view.statusLabel).not.toMatch(/失败|failed/i);
    expect(view.steps[0]).toEqual({
      type: "observation.excluded",
      receiptOnly: true,
      label: "观察不可用（非 0% 复发）",
    });
  });
});
