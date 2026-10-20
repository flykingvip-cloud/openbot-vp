import { afterEach, describe, expect, it } from "vitest";
import {
  listEvolutionLoopLogsForTests,
  logEvolutionLoop,
  resetEvolutionLoopLogsForTests,
  sanitizeEvolutionLoopFields,
} from "./evolution-loop-log.js";

afterEach(() => {
  resetEvolutionLoopLogsForTests();
});

describe("evolution loop log", () => {
  it("records required fields and drops secrets", () => {
    logEvolutionLoop("evolution.attribution.rejected", {
      runId: "run-1",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      surfaceId: "pattern-detection.sample",
      reason: "missing_proof",
    });
    expect(listEvolutionLoopLogsForTests()[0]).toEqual({
      event: "evolution.attribution.rejected",
      runId: "run-1",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      surfaceId: "pattern-detection.sample",
      reason: "missing_proof",
    });
    expect(
      sanitizeEvolutionLoopFields({
        reason: "ok",
        ownershipProof: "evop1.abc.def",
        cookie: "sid=1",
        token: "secret",
      }),
    ).toEqual({ reason: "ok" });
  });
});
