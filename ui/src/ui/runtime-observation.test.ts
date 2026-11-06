import { expect, it } from "vitest";
import { projectRuntimeObservation } from "./runtime-observation.ts";
it("projects metadata without copying tool secrets or inventing task success", () => {
  const row = projectRuntimeObservation(
    {
      runId: "a",
      seq: 2,
      ts: 10,
      stream: "tool",
      data: { phase: "end", toolCallId: "c", args: { token: "secret" }, result: "private" },
    },
    20,
  );
  expect(row).toMatchObject({
    coverage: "execution_only",
    capabilityCallId: "c",
    occurredAt: 10,
    receivedAt: 20,
  });
  expect(JSON.stringify(row)).not.toMatch(/secret|private/);
  expect(projectRuntimeObservation({ runId: "a", seq: -1, ts: 10, stream: "tool" }, 20)).toBeNull();
});

it("bounds observations and rejects foreign sessions while recording gaps", async () => {
  const { recordRuntimeObservation, readRuntimeObservations, clearRuntimeObservations } =
    await import("./runtime-observation.ts");
  const host = {};
  const event = (seq: number, sessionKey = "own") => ({
    runId: "run",
    seq,
    ts: seq,
    stream: "tool",
    sessionKey,
    data: { phase: "end" },
  });
  recordRuntimeObservation(host, "own", event(1, "other"), 1);
  expect(readRuntimeObservations(host, "own").events).toHaveLength(0);
  recordRuntimeObservation(host, "own", event(1), 1);
  recordRuntimeObservation(host, "own", event(1), 2);
  recordRuntimeObservation(host, "own", event(3), 3);
  expect(readRuntimeObservations(host, "own").events).toHaveLength(2);
  expect(readRuntimeObservations(host, "own").reasons).toContain("sequence_gap_or_reorder");
  for (let seq = 4; seq < 210; seq++) {
    recordRuntimeObservation(host, "own", event(seq), seq);
  }
  expect(readRuntimeObservations(host, "own").events).toHaveLength(200);
  expect(readRuntimeObservations(host, "own").reasons).toContain("retention_limit");
  expect(readRuntimeObservations(host, "other").events).toHaveLength(0);
  clearRuntimeObservations(host);
  expect(readRuntimeObservations(host, "own").reasons).toEqual(["not_observed"]);
});
