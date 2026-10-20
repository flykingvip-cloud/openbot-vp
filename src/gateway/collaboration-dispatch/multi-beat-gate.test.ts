import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { FIELD_HELP } from "../../config/schema.help.js";
import { FIELD_LABELS } from "../../config/schema.labels.js";
import { validateConfigObject } from "../../config/validation.js";
import { gateFacilitatorControl } from "./facilitator-control.js";
import { FLOOR_LIVE_CUTOVER_DEFAULT, floorLiveProductionRefusal } from "./floor-live-cutover.js";
import {
  clampMaxBeatsPerEpisode,
  facilitatorNextBeatOutcome,
  isCollabMultiBeatGateOpen,
  MULTI_BEAT_DEFAULT_MAX,
  MULTI_BEAT_HARD_CEILING,
  resolveMaxBeatsPerEpisode,
} from "./multi-beat-gate.js";
import { compileEffectiveCollaborationPolicy } from "./policy-compiler.js";

describe("P5 multi-Beat gate (collaboration.episode.maxBeats)", () => {
  it("defaults to single Beat (gate closed)", () => {
    expect(resolveMaxBeatsPerEpisode(undefined)).toBe(1);
    expect(resolveMaxBeatsPerEpisode({})).toBe(1);
    expect(resolveMaxBeatsPerEpisode({ collaboration: {} })).toBe(1);
    expect(resolveMaxBeatsPerEpisode({ collaboration: { episode: {} } })).toBe(1);
    expect(resolveMaxBeatsPerEpisode({ collaboration: { episode: { maxBeats: 1 } } })).toBe(1);
    expect(isCollabMultiBeatGateOpen({})).toBe(false);
    expect(MULTI_BEAT_DEFAULT_MAX).toBe(1);
    expect(MULTI_BEAT_HARD_CEILING).toBe(12);
  });

  it("raises only when config explicitly sets maxBeats > 1 (clamped)", () => {
    expect(resolveMaxBeatsPerEpisode({ collaboration: { episode: { maxBeats: 3 } } })).toBe(3);
    expect(isCollabMultiBeatGateOpen({ collaboration: { episode: { maxBeats: 3 } } })).toBe(true);
    expect(clampMaxBeatsPerEpisode(0)).toBe(1);
    expect(clampMaxBeatsPerEpisode(-2)).toBe(1);
    expect(clampMaxBeatsPerEpisode(99)).toBe(12);
    expect(clampMaxBeatsPerEpisode(2.9)).toBe(2);
    expect(clampMaxBeatsPerEpisode(Number.NaN)).toBe(1);
  });

  it("config schema accepts 1..12 and rejects out of range", () => {
    expect(FIELD_LABELS["collaboration.episode.maxBeats"]).toBeTruthy();
    expect(FIELD_HELP["collaboration.episode.maxBeats"]).toMatch(/default unset = 1/);
    expect(FIELD_HELP["collaboration.episode.maxBeats"]).toMatch(/Floor live/);
    expect(validateConfigObject({ collaboration: { episode: { maxBeats: 1 } } }).ok).toBe(true);
    expect(validateConfigObject({ collaboration: { episode: { maxBeats: 12 } } }).ok).toBe(true);
    expect(validateConfigObject({ collaboration: { episode: { maxBeats: 0 } } }).ok).toBe(false);
    expect(validateConfigObject({ collaboration: { episode: { maxBeats: 13 } } }).ok).toBe(false);
    expect(validateConfigObject({ collaboration: { episode: { maxBeats: "3" } } }).ok).toBe(false);
  });

  it("Facilitator next_beat denied by default; authorized only when gate open", () => {
    expect(facilitatorNextBeatOutcome(1)).toBe("denied");
    expect(facilitatorNextBeatOutcome(3)).toBe("authorized");
    const denied = gateFacilitatorControl({
      requests: [
        { actionId: "stop_loop", event: "stop_loop" },
        { actionId: "next_beat", event: "next_beat" },
      ],
      participantIds: ["a"],
    });
    expect(denied.facilitator).toEqual([
      { actionId: "stop_loop", outcome: "authorized" },
      { actionId: "next_beat", outcome: "denied" },
    ]);
    expect(denied.leaveEvent).toBe("stop_loop");

    const raised = gateFacilitatorControl({
      requests: [
        { actionId: "stop_loop", event: "stop_loop" },
        { actionId: "next_beat", event: "next_beat" },
      ],
      participantIds: ["a"],
      maxBeatsPerEpisode: 3,
    });
    expect(raised.facilitator).toEqual([
      { actionId: "stop_loop", outcome: "authorized" },
      { actionId: "next_beat", outcome: "authorized" },
    ]);
    // stop_loop still wins leave — observation authorize ≠ apply multi-beat
    expect(raised.leaveEvent).toBe("stop_loop");
  });

  it("EffectivePolicy records raised maxBeats; default stays 1", () => {
    const def = compileEffectiveCollaborationPolicy({});
    expect(def.dispatch.tuning.floor.beats.maxBeatsPerEpisode).toBe(1);
    const raised = compileEffectiveCollaborationPolicy({ maxBeatsPerEpisode: 4 });
    expect(raised.dispatch.tuning.floor.beats.maxBeatsPerEpisode).toBe(4);
    expect(raised.provenance.segments.dispatch.tuning.floor.beats.maxBeatsPerEpisode.source).toBe(
      "l2",
    );
  });

  it("raising maxBeats does not sign Floor live cutover; G2 still refuses next_beat apply", () => {
    expect(FLOOR_LIVE_CUTOVER_DEFAULT).toBe(false);
    const refusal = floorLiveProductionRefusal({ maxBeatsPerEpisode: 4, protocol: "floor" });
    expect(refusal).toMatch(/cutover default is off/);
    expect(refusal).toMatch(/maxBeatsPerEpisode=4/);
    expect(refusal).toMatch(/protocol=floor/);

    const runtime = fs.readFileSync(
      new URL("./episode-single-beat-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(runtime).toContain('if (event === "next_beat")');
    expect(runtime).toContain("refuses next_beat");
    expect(runtime).not.toContain("isCollabMultiBeatGateOpen");
  });

  it("does not invent a multi-beat controller module", () => {
    const dir = new URL("./", import.meta.url);
    const names = fs
      .readdirSync(dir)
      .filter((n) => n.includes("multi-beat") || n.includes("multibeat"));
    expect(names.toSorted()).toEqual(["multi-beat-gate.test.ts", "multi-beat-gate.ts"]);
  });
});
