import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureShadowRecordForTest,
  observeShadowSkillCatalogBestEffort,
  observeShadowToolCatalogBestEffort,
  pendingShadowSkillCatalogSize,
  recordShadowRouteBestEffort,
  resetShadowRecordForTest,
} from "./shadow-record.js";
import { digestName } from "./shadow/digest.js";
import { TASK_ENVELOPE_SCHEMA, PHASE1_FLAGS, type CatalogEntry } from "./shadow/types.js";

const skillName = "clock-kind-lookup";
const toolName = "read_clock_kind";
const clock = digestName("skill", skillName);
const clockTool = digestName("tool", toolName);
const tagRead = digestName("tag", "readonly");

const envelope = {
  schema: TASK_ENVELOPE_SCHEMA,
  taskClass: "skill_dense_readonly",
  riskClass: "read_only",
  channelKind: "internal",
  textDigest: digestName("text", "i2 record"),
  tagDigests: [tagRead],
};

const skills: CatalogEntry[] = [{ nameDigest: clock, tagDigests: [tagRead], sideEffect: false }];
const tools: CatalogEntry[] = [{ nameDigest: clockTool, tagDigests: [tagRead], sideEffect: false }];

afterEach(() => {
  resetShadowRecordForTest();
});

describe("Phase 1 I2 shadow-record", () => {
  it("no-ops when the compile-time record flag is false", () => {
    expect(PHASE1_FLAGS.SHADOW_ROUTER_RECORD).toBe(false);
    const sink = vi.fn();
    const result = recordShadowRouteBestEffort({
      envelope,
      eligibleSkills: skills,
      constructedTools: tools,
      runIdDigest: digestName("run", "i2-off"),
      sink,
    });
    expect(result).toEqual({ recorded: false, reason: "flag_off" });
    expect(sink).not.toHaveBeenCalled();
  });

  it("records apply:false digest-only events when a test override is on", () => {
    const sink = vi.fn();
    const result = recordShadowRouteBestEffort({
      envelope,
      eligibleSkills: skills,
      constructedTools: tools,
      runIdDigest: digestName("run", "i2-on"),
      sink,
      recordEnabled: true,
    });
    expect(result.recorded).toBe(true);
    if (!result.recorded) {
      throw new Error("expected a recorded event");
    }
    expect(result.event.apply).toBe(false);
    expect(result.event.flags.SHADOW_ROUTER_RECORD).toBe(false);
    expect(result.event.flags.SHADOW_ROUTER_APPLY).toBe(false);
    const serialized = JSON.stringify(result.event);
    expect(serialized).not.toContain(skillName);
    expect(serialized).not.toContain(toolName);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(result.event);
  });

  it("swallows invalid envelopes and sink failures", () => {
    expect(
      recordShadowRouteBestEffort({
        envelope: { schema: "nope" },
        eligibleSkills: skills,
        constructedTools: tools,
        runIdDigest: digestName("run", "i2-bad"),
        recordEnabled: true,
      }),
    ).toEqual({ recorded: false, reason: "swallowed" });

    const sink = vi.fn(() => {
      throw new Error("sink down");
    });
    expect(
      recordShadowRouteBestEffort({
        envelope,
        eligibleSkills: skills,
        constructedTools: tools,
        runIdDigest: digestName("run", "i2-sink"),
        sink,
        recordEnabled: true,
      }),
    ).toEqual({ recorded: false, reason: "swallowed" });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("live helpers stay off and never read names", () => {
    const readSkillNames = vi.fn(() => [skillName]);
    const readToolNames = vi.fn(() => [toolName]);
    observeShadowSkillCatalogBestEffort({ runId: "run-off", readSkillNames });
    expect(observeShadowToolCatalogBestEffort({ runId: "run-off", readToolNames })).toEqual({
      recorded: false,
      reason: "flag_off",
    });
    expect(readSkillNames).not.toHaveBeenCalled();
    expect(readToolNames).not.toHaveBeenCalled();
    expect(pendingShadowSkillCatalogSize()).toBe(0);
  });

  it("live helpers record digest-only events under a test override", () => {
    const sink = vi.fn();
    configureShadowRecordForTest({ recordEnabled: true, sink });
    observeShadowSkillCatalogBestEffort({
      runId: "run-on",
      sessionKey: "session-secret",
      readSkillNames: () => [skillName],
    });
    const result = observeShadowToolCatalogBestEffort({
      runId: "run-on",
      sessionKey: "session-secret",
      readToolNames: () => [toolName],
    });
    expect(result.recorded).toBe(true);
    if (!result.recorded) {
      throw new Error("expected a recorded event");
    }
    expect(result.event.apply).toBe(false);
    const serialized = JSON.stringify(result.event);
    expect(serialized).not.toContain(skillName);
    expect(serialized).not.toContain(toolName);
    expect(serialized).not.toContain("session-secret");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(pendingShadowSkillCatalogSize()).toBe(0);
  });
});
