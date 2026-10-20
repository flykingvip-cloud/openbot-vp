import { getEvolutionSurface } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import { createFailClosedAdapter } from "./adapters/fail-closed.js";
import { promotionGateFromEffect } from "./effect-verification-audit.js";
import {
  listEvolutionLoopLogsForTests,
  resetEvolutionLoopLogsForTests,
} from "./evolution-loop-log.js";

const UNSUPPORTED_SURFACES = [
  "knowledge.experience-capsule",
  "knowledge.managed-memory",
  "capability.skill-spec",
  "organization.task-routing",
  "organization.team-composition",
  "system.diagnosis-contract",
  "system.runtime-binding-governance",
] as const;

describe("promote / freeze gate", () => {
  it("rejects promote when the verifier is unavailable", () => {
    resetEvolutionLoopLogsForTests();
    const gate = promotionGateFromEffect({
      proposalStatus: "VERIFIED",
      verificationId: "ver-1",
      riskLevel: "medium",
      requireExternalEffect: true,
      externalEffectOutcome: "inconclusive",
      runId: "run-unavail",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      surfaceId: "agent.working-dna",
    });
    expect(gate).toMatchObject({ ok: false, code: "external_effect_required" });
    expect(
      listEvolutionLoopLogsForTests().some(
        (row) =>
          row.event === "evolution.promotion.rejected" && row.reason === "external_effect_required",
      ),
    ).toBe(true);
  });

  it("rejects promote when the verifier contradicted the external state", () => {
    const gate = promotionGateFromEffect({
      proposalStatus: "VERIFIED",
      verificationId: "ver-2",
      riskLevel: "medium",
      requireExternalEffect: true,
      externalEffectOutcome: "contradicted",
      runId: "run-contra",
      surfaceId: "agent.working-dna",
    });
    expect(gate).toMatchObject({ ok: false, code: "external_effect_contradicted" });
  });

  it("accepts promote only when every required gate is satisfied", () => {
    resetEvolutionLoopLogsForTests();
    const gate = promotionGateFromEffect({
      proposalStatus: "VERIFIED",
      verificationId: "ver-3",
      riskLevel: "medium",
      requireExternalEffect: true,
      externalEffectOutcome: "verified",
      runId: "run-ok",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      surfaceId: "agent.working-dna",
    });
    expect(gate).toEqual({ ok: true });
    expect(
      listEvolutionLoopLogsForTests().some((row) => row.event === "evolution.promotion.accepted"),
    ).toBe(true);
  });

  it("keeps unsupported surfaces fail-closed and ineligible", async () => {
    for (const surfaceId of UNSUPPORTED_SURFACES) {
      const surface = getEvolutionSurface(surfaceId);
      expect(surface, surfaceId).toBeTruthy();
      expect(surface?.externalVerificationPolicy, surfaceId).toBe("unsupported");
      expect(surface?.requiredVerifierId, surfaceId).toBeUndefined();
      const adapter = createFailClosedAdapter(surfaceId, surface?.domain ?? "system");
      await expect(adapter.validate(undefined as never, undefined as never)).resolves.toMatchObject(
        {
          ok: false,
        },
      );
      await expect(adapter.apply(undefined as never)).rejects.toThrow(/not enabled/);
      const gate = promotionGateFromEffect({
        proposalStatus: "VERIFIED",
        verificationId: "ver-unsupported",
        riskLevel: "medium",
        requireExternalEffect: true,
        externalEffectOutcome: null,
        surfaceId,
      });
      expect(gate.ok, surfaceId).toBe(false);
    }
  });
});
