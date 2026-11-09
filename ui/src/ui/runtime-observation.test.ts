import { expect, it } from "vitest";
import { projectRuntimeObservation } from "./runtime-observation.ts";
it("isolates retained evidence from consumer mutations", async () => {
  const { recordRuntimeObservation, readRuntimeObservations } =
    await import("./runtime-observation.ts");
  const host = {};
  recordRuntimeObservation(
    host,
    "own",
    {
      runId: "run",
      seq: 1,
      ts: 1,
      stream: "lifecycle",
      sessionKey: "own",
    },
    2,
  );
  const snapshot = readRuntimeObservations(host, "own");
  snapshot.events[0].runId = "changed";
  (snapshot.events[0].missing as string[]).push("invented");
  (snapshot.reasons as string[]).push("invented");
  const retained = readRuntimeObservations(host, "own");
  expect(retained.events[0].runId).toBe("run");
  expect(retained.events[0].missing).not.toContain("invented");
  expect(retained.reasons).not.toContain("invented");
});
it("normalizes missing source identities consistently", () => {
  const base = { runId: "client", seq: 1, ts: 1, stream: "lifecycle" };
  const missing = projectRuntimeObservation(base, 2);
  for (const sourceRunId of ["", "   ", null]) {
    expect(projectRuntimeObservation({ ...base, sourceRunId }, 2)).toEqual(missing);
  }
});
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

it("keeps engine runs distinct when Gateway maps them to the same client run", async () => {
  const { recordRuntimeObservation, readRuntimeObservations } =
    await import("./runtime-observation.ts");
  const host = {};
  for (const sourceRunId of ["engine-a", "engine-b"]) {
    recordRuntimeObservation(
      host,
      "own",
      {
        runId: "client",
        sourceRunId,
        seq: 1,
        ts: 1,
        stream: "lifecycle",
        sessionKey: "own",
        data: { phase: "start" },
      },
      2,
    );
  }
  expect(readRuntimeObservations(host, "own").events).toHaveLength(2);
});
