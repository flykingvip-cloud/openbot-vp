import { describe, expect, it } from "vitest";
import {
  assertEvolutionSubmissionRef,
  assertEvolutionVerificationRef,
  type EvolutionSubmissionRef,
} from "./evaluation-refs.js";

describe("evaluation refs", () => {
  it("accepts the frozen submission identity without recovery fields", () => {
    const ref = assertEvolutionSubmissionRef({
      schemaVersion: 1,
      commandId: "cmd-1",
      proposalId: "prop-1",
      candidateRef: "cand-1",
      surfaceId: "agent.working-dna",
      contentHash: "hash-1",
    });
    expect(ref.commandId).toBe("cmd-1");
    expect("recoveryState" in ref).toBe(false);
    expect("status" in ref).toBe(false);
  });

  it("rejects a submission ref that smuggles WAL recovery state", () => {
    const dirty = {
      schemaVersion: 1 as const,
      commandId: "cmd-1",
      proposalId: "prop-1",
      candidateRef: "cand-1",
      surfaceId: "agent.working-dna",
      contentHash: "hash-1",
      recoveryState: "pending",
    };
    expect(() => assertEvolutionSubmissionRef(dirty as EvolutionSubmissionRef)).toThrow(
      /recoveryState or status/,
    );
  });

  it("requires the verification identity tuple", () => {
    const ref = assertEvolutionVerificationRef({
      schemaVersion: 1,
      proposalId: "prop-1",
      experimentId: "exp-1",
      applicationId: "app-1",
      verificationId: "ver-1",
      rollbackRef: "rb-1",
      externalEffectRef: "eef-1",
    });
    expect(ref.verificationId).toBe("ver-1");
    expect(() =>
      assertEvolutionVerificationRef({
        schemaVersion: 1,
        proposalId: "prop-1",
        experimentId: "",
        applicationId: "app-1",
        verificationId: "ver-1",
      }),
    ).toThrow(/experimentId/);
  });
});
