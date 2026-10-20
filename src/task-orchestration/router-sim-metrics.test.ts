import { describe, expect, it } from "vitest";
import {
  CONVERSATION_TASK_SAMPLES,
  type ConversationTaskSample,
} from "../conversation-task/dataset.js";
import {
  buildRouterSimProbes,
  evaluateRouterSim,
  listLongRunningCandidateSamples,
  offlineRouterFlags,
  scoreRouterDecision,
  sideEffectRouteIntent,
} from "./router-sim-metrics.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

const LRC_IDS = [
  "ct-lr-01",
  "ct-lr-02",
  "ct-lr-03",
  "ct-lr-04",
  "ct-lr-05",
  "ct-lr-06",
  "ct-lr-07",
  "ct-lr-08",
  "ct-fuzzy-01",
] as const;

const LADDER_PROBE_IDS = [
  "web_read_selected",
  "read_web_skip_ahead",
  "interact_web_selected",
  "interact_web_skip_ahead",
  "zero_nodes_human_gate",
  "outbound_human_gate",
  "broadcast_human_gate",
  "external_write_human_gate",
] as const;

describe("offline router-sim metrics", () => {
  it("selects CTR LRC samples (ct-lr-01..08 + ct-fuzzy-01) as detect/qualify gold", () => {
    const lrc = listLongRunningCandidateSamples();
    expect(lrc.map((sample) => sample.id)).toEqual([...LRC_IDS]);
    expect(lrc.every((sample) => sample.goldQualification === "long_running_candidate")).toBe(true);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("emits ladder probes, not invented business surfaces", () => {
    const probes = buildRouterSimProbes();
    expect(probes.length).toBe(LRC_IDS.length * LADDER_PROBE_IDS.length);
    for (const id of LRC_IDS) {
      const ids = probes.filter((probe) => probe.sampleId === id).map((probe) => probe.id);
      expect(ids).toEqual([...LADDER_PROBE_IDS]);
    }
    expect(probes.every((probe) => !probe.input.flags.dispatchEnabled)).toBe(true);
    expect(probes.every((probe) => probe.input.flags.shadowEnabled)).toBe(true);
  });

  it("scores wrong surface / skip-ahead / missed human gate", () => {
    expect(
      scoreRouterDecision(
        { kind: "selected", surface: "web_read" },
        { kind: "selected", surface: "browser", reasonCodes: [], enqueue: false, invoke: false },
      ),
    ).toBe("wrong_surface");
    expect(
      scoreRouterDecision(
        { kind: "blocked_policy" },
        { kind: "selected", surface: "browser", reasonCodes: [], enqueue: false, invoke: false },
      ),
    ).toBe("skip_ahead");
    expect(
      scoreRouterDecision(
        { kind: "human_gate" },
        {
          kind: "selected",
          surface: "node_fs_read",
          reasonCodes: [],
          enqueue: false,
          invoke: false,
        },
      ),
    ).toBe("missed_human_gate");
  });

  it("routes LRC ladder probes with zero score errors under shadow flags", () => {
    const report = evaluateRouterSim();
    expect(report.sampleCount).toBe(LRC_IDS.length);
    expect(report.probeCount).toBe(LRC_IDS.length * LADDER_PROBE_IDS.length);
    expect(report.wrongSurface).toBe(0);
    expect(report.skipAhead).toBe(0);
    expect(report.missedHumanGate).toBe(0);
    expect(report.failures).toEqual([]);

    for (const row of report.results) {
      expect(row.decision.enqueue).toBe(false);
      expect(row.decision.invoke).toBe(false);
      expect(row.probe.input.flags.dispatchEnabled).toBe(false);
      expect(row.probe.input.flags.shadowEnabled).toBe(true);
    }

    const byId = (id: (typeof LADDER_PROBE_IDS)[number]) =>
      report.results.find((row) => row.probe.sampleId === "ct-lr-01" && row.probe.id === id);

    expect(byId("web_read_selected")?.decision).toMatchObject({
      kind: "selected",
      surface: "web_read",
    });
    expect(byId("read_web_skip_ahead")?.decision.kind).toBe("blocked_policy");
    expect(byId("interact_web_selected")?.decision).toMatchObject({
      kind: "selected",
      surface: "browser",
    });
    expect(byId("interact_web_selected")?.decision.invoke).toBe(false);
    expect(byId("interact_web_skip_ahead")?.decision.kind).toBe("blocked_policy");
    expect(byId("zero_nodes_human_gate")?.decision.kind).toBe("human_gate");
    expect(byId("outbound_human_gate")?.decision.kind).toBe("human_gate");
    expect(byId("broadcast_human_gate")?.decision.kind).toBe("human_gate");
    expect(byId("external_write_human_gate")?.decision.kind).toBe("human_gate");
  });

  it("human-gates goldSideEffect outbound / broadcast / external_write", () => {
    const injected: ConversationTaskSample = {
      ...CONVERSATION_TASK_SAMPLES.find((sample) => sample.id === "ct-lr-01")!,
      id: "ct-lr-auth-sim",
      goldSideEffect: "broadcast",
    };
    const report = evaluateRouterSim([injected]);
    const gold = report.results.find((row) => row.probe.id === "gold_side_effect_human_gate");
    expect(sideEffectRouteIntent("broadcast")).toBe("broadcast");
    expect(gold?.decision.kind).toBe("human_gate");
    expect(gold?.score).toBeNull();
    expect(report.missedHumanGate).toBe(0);
  });

  it("keeps offline flags shadow-on / dispatch-off", () => {
    const flags = offlineRouterFlags({ dispatchEnabled: true, nodeEnabled: true });
    expect(flags.shadowEnabled).toBe(true);
    expect(flags.dispatchEnabled).toBe(false);
    expect(flags.nodeEnabled).toBe(true);
  });
});
