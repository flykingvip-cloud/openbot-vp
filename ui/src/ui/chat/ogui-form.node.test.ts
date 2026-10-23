// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shouldUseChatDeliveryComponent } from "./chat-delivery.ts";
import { clearOguiFormDraftState, getOguiFormDraft, renderOguiFormView } from "./ogui-form-view.ts";
import {
  buildOguiAnswerSubmitMessage,
  extractOguiFormFenceBody,
  hasRenderableOguiForm,
  oguiFormDraftComplete,
  parseOguiFormDefinition,
  parseOguiFormFromText,
  stripOguiFormFences,
  type OguiFormDefinition,
} from "./ogui-form.ts";

const SUBMISSION_ID = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

const VALID_FORM_JSON = {
  schema_version: "ogui/v1",
  component_id: "biz-model-form-1",
  title: "商业模式拍板",
  fields: [
    {
      id: "channel",
      label: "获客模式",
      type: "single_select",
      options: [
        { value: "direct", label: "直销" },
        { value: "hybrid", label: "混合" },
      ],
    },
    {
      id: "billing",
      label: "计费",
      type: "single_select",
      options: [
        { value: "seat", label: "按席" },
        { value: "device", label: "按设备" },
      ],
    },
  ],
  submit_label: "确认拍板",
};

function formFence(payload: unknown = VALID_FORM_JSON): string {
  return ["请拍板以下口径：", "", "```ogui-form", JSON.stringify(payload, null, 2), "```"].join(
    "\n",
  );
}

describe("parseOguiFormDefinition / parseOguiFormFromText", () => {
  it("parses a legal ogui/v1 single_select form", () => {
    const form = parseOguiFormFromText(formFence());
    expect(form).not.toBeNull();
    expect(form?.component_id).toBe("biz-model-form-1");
    expect(form?.fields).toHaveLength(2);
    expect(form?.fields[0]?.options.map((o) => o.value)).toEqual(["direct", "hybrid"]);
    expect(form?.submit_label).toBe("确认拍板");
    expect(hasRenderableOguiForm(formFence())).toBe(true);
  });

  it("accepts version/form_id handoff aliases and id/submit.label", () => {
    const fromHandoff = parseOguiFormDefinition({
      version: 1,
      form_id: "handoff-form",
      title: "拍板",
      fields: [
        {
          id: "q1",
          type: "single_select",
          label: "问题",
          required: true,
          options: [
            { value: "a", label: "选项 A" },
            { value: "b", label: "选项 B" },
          ],
        },
      ],
    });
    expect(fromHandoff?.component_id).toBe("handoff-form");
    expect(fromHandoff?.fields[0]?.id).toBe("q1");

    const form = parseOguiFormDefinition({
      schema_version: "ogui/v1",
      type: "form",
      id: "alias-form",
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
    });
    expect(form?.component_id).toBe("alias-form");
    expect(form?.submit_label).toBe("生成");
  });

  it("rejects illegal / incomplete envelopes (safe degrade)", () => {
    expect(parseOguiFormDefinition(null)).toBeNull();
    expect(parseOguiFormDefinition({ schema_version: "ogui/v0" })).toBeNull();
    expect(
      parseOguiFormDefinition({
        schema_version: "ogui/v1",
        component_id: "x",
        fields: [{ id: "a", label: "A", type: "multi_select", options: [] }],
      }),
    ).toBeNull();
    expect(parseOguiFormFromText("```ogui-form\n{not json}\n```")).toBeNull();
    expect(parseOguiFormFromText("```json\n{}\n```")).toBeNull();
    expect(extractOguiFormFenceBody("```json\n{}\n```")).toBeNull();
  });

  it("does not flip Interactive Choice delivery gate (fenced replies stay plain)", () => {
    const text = formFence();
    // Existing gate: fenced code → plain markdown path (Form renders beside it).
    expect(shouldUseChatDeliveryComponent(text)).toBe(false);
    expect(hasRenderableOguiForm(text)).toBe(true);
  });

  it("strips ogui-form fences for display without dropping prose", () => {
    const stripped = stripOguiFormFences(formFence());
    expect(stripped).toBe("请拍板以下口径：");
    expect(stripped).not.toContain("ogui-form");
    expect(stripped).not.toContain("biz-model-form-1");
  });
});

describe("buildOguiAnswerSubmitMessage", () => {
  it("builds readable summary + legal ogui-answer fence", () => {
    const form = parseOguiFormDefinition(VALID_FORM_JSON) as OguiFormDefinition;
    const text = buildOguiAnswerSubmitMessage({
      form,
      answers: { channel: "hybrid", billing: "device" },
      submissionId: SUBMISSION_ID,
      submittedAt: "2026-10-13T01:00:00.000Z",
    });
    expect(text).toContain("请基于以下表单选择继续完成任务");
    expect(text).toContain("channel（获客模式）：混合");
    expect(text).toContain("billing（计费）：按设备");
    expect(text).toContain("```ogui-answer");
    expect(text).toContain(SUBMISSION_ID);
    expect(text).toContain('"schema_version": "ogui/v1"');
    expect(text).toContain('"component_id": "biz-model-form-1"');
    const body = text.split("```ogui-answer")[1]?.split("```")[0]?.trim() ?? "";
    const parsed = JSON.parse(body) as {
      answers: Record<string, string>;
      submission_id: string;
    };
    expect(parsed.submission_id).toBe(SUBMISSION_ID);
    expect(parsed.answers).toEqual({ channel: "hybrid", billing: "device" });
    expect(parsed).not.toHaveProperty("decision_id");
    expect(parsed).not.toHaveProperty("decision_version");
  });

  it("includes both decision fields when a lifecycle card is submitted", () => {
    const form = parseOguiFormDefinition({
      ...VALID_FORM_JSON,
      decision_id: "dec-9",
      decision_version: 3,
    }) as OguiFormDefinition;
    expect(form.decision_id).toBe("dec-9");
    expect(form.decision_version).toBe(3);
    const text = buildOguiAnswerSubmitMessage({
      form,
      answers: { channel: "hybrid", billing: "device" },
      submissionId: SUBMISSION_ID,
      decisionId: "dec-9",
      decisionVersion: 3,
    });
    const body = text.split("```ogui-answer")[1]?.split("```")[0]?.trim() ?? "";
    const parsed = JSON.parse(body) as {
      submission_id: string;
      decision_id?: string;
      decision_version?: number;
    };
    expect(parsed.submission_id).toBe(SUBMISSION_ID);
    expect(parsed.decision_id).toBe("dec-9");
    expect(parsed.decision_version).toBe(3);
  });

  it("rejects a lifecycle submit that is missing one decision field", () => {
    const form = parseOguiFormDefinition(VALID_FORM_JSON) as OguiFormDefinition;
    expect(() =>
      buildOguiAnswerSubmitMessage({
        form,
        answers: { channel: "hybrid", billing: "device" },
        submissionId: SUBMISSION_ID,
        decisionId: "dec-9",
      }),
    ).toThrow(/positive integer/);
    const partial = parseOguiFormDefinition({
      ...VALID_FORM_JSON,
      decision_id: "dec-9",
    });
    expect(partial?.component_id).toBe("biz-model-form-1");
    expect(partial?.decision_id).toBeUndefined();
  });

  it("rejects non-UUID submission_id and missing required answers", () => {
    const form = parseOguiFormDefinition(VALID_FORM_JSON) as OguiFormDefinition;
    expect(() =>
      buildOguiAnswerSubmitMessage({
        form,
        answers: { channel: "hybrid", billing: "device" },
        submissionId: "not-a-uuid",
      }),
    ).toThrow(/UUID/);
    expect(() =>
      buildOguiAnswerSubmitMessage({
        form,
        answers: { channel: "hybrid" },
        submissionId: SUBMISSION_ID,
      }),
    ).toThrow(/missing required/);
  });
});

describe("ogui form confirm wiring", () => {
  it("option click only updates draft; submit invokes onSubmitForm with fence", () => {
    clearOguiFormDraftState();
    const form = parseOguiFormDefinition(VALID_FORM_JSON) as OguiFormDefinition;
    const submitted: string[] = [];
    const submissionIds: string[] = [];
    const filled: string[] = [];

    const first = renderOguiFormView(form, {
      onFillComposer: (text) => filled.push(text),
      onSubmitForm: (text, meta) => {
        submitted.push(text);
        submissionIds.push(meta.submissionId);
      },
    });

    function findHandlers(tpl: unknown, needle: string): Array<() => void> {
      const found: Array<() => void> = [];
      function walk(node: unknown): void {
        if (!node || typeof node !== "object") {
          return;
        }
        if (Array.isArray(node)) {
          for (const item of node) {
            walk(item);
          }
          return;
        }
        const t = node as { strings?: TemplateStringsArray; values?: unknown[] };
        if (!t.strings || !t.values) {
          return;
        }
        const joined = t.strings.join("");
        if (joined.includes(needle)) {
          for (const v of t.values) {
            if (typeof v === "function") {
              found.push(v as () => void);
            }
          }
        }
        for (const v of t.values) {
          walk(v);
        }
      }
      walk(tpl);
      return found;
    }

    // Click first option of field channel (direct) via data-option-value handler walk.
    // Prefer handlers near data-option-value= in template.
    const optionHandlers = findHandlers(first, "data-option-value=");
    expect(optionHandlers.length).toBeGreaterThanOrEqual(4);
    // Click hybrid (2nd of channel) and device (2nd of billing) — order follows fields×options.
    optionHandlers[1](); // hybrid
    optionHandlers[3](); // device
    expect(getOguiFormDraft(form)).toEqual({ channel: "hybrid", billing: "device" });
    expect(oguiFormDraftComplete(form, getOguiFormDraft(form))).toBe(true);
    expect(filled.at(-1)).toContain("混合");
    expect(submitted).toHaveLength(0);

    // Re-render so submit button is enabled with current draft, then click.
    const second = renderOguiFormView(form, {
      onFillComposer: (text) => filled.push(text),
      onSubmitForm: (text, meta) => {
        submitted.push(text);
        submissionIds.push(meta.submissionId);
      },
    });
    const submitHandlers = findHandlers(second, 'data-testid="ogui-form-submit"');
    // fallback: class ogui-form__submit
    const submit =
      submitHandlers[0] ??
      findHandlers(second, "ogui-form__submit").find((fn) => typeof fn === "function");
    expect(submit).toBeTypeOf("function");
    submit();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toContain("```ogui-answer");
    expect(submitted[0]).toContain('"channel": "hybrid"');
    expect(submitted[0]).toContain('"billing": "device"');
    expect(submissionIds).toHaveLength(1);
    expect(submissionIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(submitted[0]).toContain(submissionIds[0]);
    expect(getOguiFormDraft(form)).toEqual({});
  });

  it("does not offer a form submit when the server gate removed the fence (Ev8)", () => {
    for (const text of ["该决策已结束，不能重新操作。", "未签发"]) {
      expect(parseOguiFormFromText(text)).toBeNull();
      expect(hasRenderableOguiForm(text)).toBe(false);
    }
  });

  it("omits submit button when onSubmitForm is not wired", () => {
    clearOguiFormDraftState();
    const form = parseOguiFormDefinition(VALID_FORM_JSON) as OguiFormDefinition;
    const tpl = renderOguiFormView(form, {});
    const joined = JSON.stringify(tpl);
    expect(joined).not.toContain("ogui-form-submit");
  });
});
