import { describe, expect, test } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import {
  enrichProposeContextWithOguiAnswer,
  extractOguiAnswerFenceBody,
  extractOguiFormFenceBody,
  formatOguiAnswersAsHandoffBrief,
  isCollabTaskOguiHandoffProjectionEnabled,
  oguiFormUiPresentOnMain,
  parseOguiAnswerEnvelope,
  projectOguiAnswerToHandoffContext,
} from "./ogui-handoff-projection.js";

const SUBMISSION_ID = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

function cfg(on: boolean): OpenBotConfig {
  return {
    collaboration: {
      task: {
        oguiHandoffProjection: on,
      },
    },
  } as OpenBotConfig;
}

function answerFence(overrides?: {
  schema_version?: string;
  component_id?: string;
  submission_id?: string;
  answers?: Record<string, string>;
  submitted_at?: string;
  extra?: string;
}): string {
  const payload = {
    schema_version: overrides?.schema_version ?? "ogui/v1",
    component_id: overrides?.component_id ?? "biz-model-form-1",
    submission_id: overrides?.submission_id ?? SUBMISSION_ID,
    answers: overrides?.answers ?? { channel: "hybrid", billing: "device" },
    submitted_at: overrides?.submitted_at ?? "2026-10-13T01:00:00+08:00",
  };
  return [
    "已确认商业模式口径。",
    "",
    "```ogui-answer",
    JSON.stringify(payload, null, 2),
    "```",
    overrides?.extra ?? "",
  ].join("\n");
}

describe("C4 OGUI→handoff projection (wired seam)", () => {
  test("inventory: OGUI Form UI present on main (Form P0)", () => {
    expect(oguiFormUiPresentOnMain()).toBe(true);
  });

  test("flag defaults off", () => {
    expect(isCollabTaskOguiHandoffProjectionEnabled({} as OpenBotConfig)).toBe(false);
    expect(isCollabTaskOguiHandoffProjectionEnabled(cfg(false))).toBe(false);
    expect(isCollabTaskOguiHandoffProjectionEnabled(cfg(true))).toBe(true);
  });

  test("non-ogui fence is ignored by OGUI extractors", () => {
    const text = ["结论：继续。", "", "```json", '{"hello":"world"}', "```"].join("\n");
    expect(extractOguiAnswerFenceBody(text)).toBeNull();
    expect(extractOguiFormFenceBody(text)).toBeNull();
  });

  test("illegal / incomplete ogui-answer degrades (no throw)", () => {
    expect(parseOguiAnswerEnvelope(null)).toBeNull();
    expect(parseOguiAnswerEnvelope({ schema_version: "ogui/v0" })).toBeNull();
    expect(
      parseOguiAnswerEnvelope({
        schema_version: "ogui/v1",
        component_id: "x",
        submission_id: "not-a-uuid",
        answers: { a: "b" },
      }),
    ).toBeNull();
    const badJson = "```ogui-answer\n{not json}\n```";
    const result = projectOguiAnswerToHandoffContext(badJson, cfg(true));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_json");
    }
  });

  test("flag-off refuses even with valid fence", () => {
    const text = answerFence();
    const result = projectOguiAnswerToHandoffContext(text, cfg(false));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("flag_off");
    }
  });

  test("flag-on: valid ogui-answer projects into handoff brief", () => {
    const text = answerFence();
    const result = projectOguiAnswerToHandoffContext(text, cfg(true));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.envelope.submission_id).toBe(SUBMISSION_ID);
    expect(result.value.envelope.answers).toEqual({
      channel: "hybrid",
      billing: "device",
    });
    expect(result.value.handoffBrief).toContain("channel: hybrid");
    expect(result.value.handoffBrief).toContain("billing: device");
    expect(result.value.handoffBrief).toContain("非控制指令");
    expect(result.value.handoffBrief).toContain(SUBMISSION_ID);
  });

  test("legacy answer omits decision fields; a half-present lifecycle ref is rejected", () => {
    const legacy = parseOguiAnswerEnvelope({
      schema_version: "ogui/v1",
      component_id: "biz-model-form-1",
      submission_id: SUBMISSION_ID,
      answers: { channel: "direct" },
    });
    expect(legacy?.decision_id).toBeUndefined();
    expect(legacy?.decision_version).toBeUndefined();
    expect(
      parseOguiAnswerEnvelope({
        schema_version: "ogui/v1",
        component_id: "biz-model-form-1",
        submission_id: SUBMISSION_ID,
        decision_id: "dec-1",
        answers: { channel: "direct" },
      }),
    ).toBeNull();
    const paired = parseOguiAnswerEnvelope({
      schema_version: "ogui/v1",
      component_id: "biz-model-form-1",
      submission_id: SUBMISSION_ID,
      decision_id: "dec-1",
      decision_version: 2,
      answers: { channel: "direct" },
    });
    expect(paired?.decision_id).toBe("dec-1");
    expect(paired?.decision_version).toBe(2);
    expect(formatOguiAnswersAsHandoffBrief(paired!)).toContain("decision_id: dec-1");
  });

  test("format brief is projection-only (mentions no approval bypass)", () => {
    const envelope = parseOguiAnswerEnvelope({
      schema_version: "ogui/v1",
      component_id: "biz-model-form-1",
      submission_id: SUBMISSION_ID,
      answers: { channel: "direct" },
    });
    expect(envelope).not.toBeNull();
    const brief = formatOguiAnswersAsHandoffBrief(envelope!);
    expect(brief).toContain("不得旁路 Steward");
    expect(brief).not.toMatch(/ui\.(action|submit)/);
  });

  test("ogui-form fence detectable; projection still only consumes ogui-answer", () => {
    const text = [
      "请选择：",
      "```ogui-form",
      JSON.stringify({
        schema_version: "ogui/v1",
        type: "form",
        id: "biz-model-form-1",
        fields: [
          {
            id: "channel",
            type: "single_select",
            label: "模式",
            required: true,
            options: [{ value: "hybrid", label: "混合" }],
          },
        ],
        submit: { label: "生成", action: "continue_agent" },
      }),
      "```",
    ].join("\n");
    expect(extractOguiFormFenceBody(text)).toContain("biz-model-form-1");
    expect(oguiFormUiPresentOnMain()).toBe(true);
    // Projection only consumes ogui-answer, never ogui-form definitions.
    const projected = projectOguiAnswerToHandoffContext(text, cfg(true));
    expect(projected.ok).toBe(false);
    if (!projected.ok) {
      expect(projected.reason).toBe("fence_absent");
    }
  });

  test("enrichProposeContext: legal answer appends brief; illegal/flag-off degrade", () => {
    const text = answerFence();
    const off = enrichProposeContextWithOguiAnswer({
      assumptions: ["keep-me"],
      sourceChatText: text,
      cfg: cfg(false),
    });
    expect(off.projected).toBe(false);
    expect(off.reason).toBe("flag_off");
    expect(off.assumptions).toEqual(["keep-me"]);

    const bad = enrichProposeContextWithOguiAnswer({
      assumptions: ["keep-me"],
      sourceChatText: "```ogui-answer\n{not json}\n```",
      cfg: cfg(true),
    });
    expect(bad.projected).toBe(false);
    expect(bad.reason).toBe("invalid_json");
    expect(bad.assumptions).toEqual(["keep-me"]);

    const ok = enrichProposeContextWithOguiAnswer({
      assumptions: ["keep-me"],
      sourceChatText: text,
      cfg: cfg(true),
    });
    expect(ok.projected).toBe(true);
    expect(ok.assumptions[0]).toBe("keep-me");
    expect(ok.assumptions.some((a) => a.includes(SUBMISSION_ID))).toBe(true);
    expect(ok.assumptions.some((a) => a.includes("channel: hybrid"))).toBe(true);
  });
});
