import { describe, expect, it } from "vitest";
import { recordRuntimeObservation, readRuntimeObservations } from "../runtime-observation.ts";
import { emptyObservation } from "./model.ts";
import { observationSamples } from "./samples.ts";

describe("observation read adapters", () => {
  it("retains both source runs without promoting tool completion to task acceptance", () => {
    const host = {};
    for (const sourceRunId of ["engine_A", "engine_B"]) {
      recordRuntimeObservation(
        host,
        "agent:one:main",
        {
          runId: "client_01",
          sourceRunId,
          sessionKey: "agent:one:main",
          seq: 1,
          ts: 1,
          stream: "tool",
          data: { phase: "end", toolCallId: "tool_01", args: { secret: "not-collected" } },
        },
        2,
      );
    }
    recordRuntimeObservation(
      host,
      "agent:two:main",
      { runId: "foreign", sessionKey: "agent:two:main", seq: 1, ts: 2, stream: "tool", data: {} },
      2,
    );
    const view = emptyObservation(
      true,
      readRuntimeObservations(host, "agent:one:main"),
      "agent:one:main",
    );
    expect(view.runs).toHaveLength(0);
    const nextView = emptyObservation(
      true,
      readRuntimeObservations(host, "agent:two:main"),
      "agent:two:main",
    );
    expect(nextView.runs.map((row) => row.clientRunId)).toEqual(["foreign"]);
    expect(
      nextView.runs.every(
        (row) => row.outcomeState === "unavailable" && row.attributedCost === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(view)).not.toContain("foreign");
    expect(JSON.stringify(view)).not.toContain("not-collected");
    expect(emptyObservation(false, null).reasons).toContain("disconnected");
  });

  it("covers personal, shared and partial samples with no fabricated task identity", () => {
    const platform = observationSamples("platform");
    const enterprise = observationSamples("enterprise");
    expect(platform.runs.every((row) => row.sample)).toBe(true);
    expect(platform.runs.every((row) => row.outcomeRevision === null)).toBe(true);
    expect(
      platform.runs
        .filter((row) => row.id !== "sample-partial")
        .every((row) => row.outcomeState === "unavailable"),
    ).toBe(true);
    expect(platform.runs.map((row) => row.scope)).toEqual([
      "personal",
      "collaboration",
      "personal",
    ]);
    expect(
      enterprise.runs.find((row) => row.id === "sample-collaboration")?.stages.at(-1)?.detail,
    ).toContain("某成员 TaskOutcome 未替它关闭");
    const partial = enterprise.runs.find((row) => row.id === "sample-partial")!;
    expect(partial.scenarioTaskRef).toBeNull();
    expect(partial.outcomeState).toBe("pending");
    expect(partial.attributedCost).toBeNull();
    expect(partial.reasons).toContain("sequence_gap_or_reorder");
    expect(JSON.stringify(platform)).not.toContain('"fully_linked"');
  });
});
