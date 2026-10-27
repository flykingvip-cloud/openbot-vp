import { afterEach, describe, expect, it } from "vitest";
import {
  EVOLUTION_LOOP_LOG_CAPTURE_MAX,
  getEvolutionLoopLogCaptureStatsForTests,
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

  it("bounds in-process captured[] by dropping oldest (W5)", () => {
    const overflow = 37;
    for (let i = 0; i < EVOLUTION_LOOP_LOG_CAPTURE_MAX + overflow; i += 1) {
      logEvolutionLoop("evolution.observation.created", {
        runId: `run-${i}`,
        reason: `bound-${i}`,
      });
    }
    const listed = listEvolutionLoopLogsForTests();
    const stats = getEvolutionLoopLogCaptureStatsForTests();
    expect(listed).toHaveLength(EVOLUTION_LOOP_LOG_CAPTURE_MAX);
    expect(stats).toEqual({
      retained: EVOLUTION_LOOP_LOG_CAPTURE_MAX,
      dropped: overflow,
      max: EVOLUTION_LOOP_LOG_CAPTURE_MAX,
    });
    expect(listed[0]?.runId).toBe(`run-${overflow}`);
    expect(listed[listed.length - 1]?.runId).toBe(
      `run-${EVOLUTION_LOOP_LOG_CAPTURE_MAX + overflow - 1}`,
    );
  });
});
