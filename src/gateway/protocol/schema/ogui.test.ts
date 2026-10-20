import AjvPkg from "ajv";
import { describe, expect, it } from "vitest";
import { OguiAnswerSchema, OguiChoiceSchema, OguiFormSchema, OGUI_SCHEMA_VERSION } from "./ogui.js";

const ajv = new (AjvPkg as unknown as new (opts?: object) => import("ajv").default)({
  allErrors: true,
  strict: false,
});

const validateForm = ajv.compile(OguiFormSchema);
const validateChoice = ajv.compile(OguiChoiceSchema);
const validateAnswer = ajv.compile(OguiAnswerSchema);

const validForm = {
  schema_version: OGUI_SCHEMA_VERSION,
  component_id: "biz-model-form-1",
  title: "确定商业模式",
  fields: [
    {
      id: "channel",
      type: "single_select",
      label: "OEM 合作模式",
      required: true,
      options: [
        { value: "hybrid", label: "OEM 销售整机，OpenBot 控制授权与订阅" },
        { value: "direct", label: "OpenBot 直接向企业客户收费" },
      ],
    },
  ],
  submit_label: "生成商业方案",
  submit: { label: "生成商业方案", action: "continue_agent" },
  fallback: { type: "markdown" },
};

describe("OguiFormSchema", () => {
  it("accepts a canonical ogui/v1 form (P0 single_select)", () => {
    expect(validateForm(validForm)).toBe(true);
  });

  it("accepts form without optional type/title/submit", () => {
    expect(
      validateForm({
        schema_version: "ogui/v1",
        component_id: "f1",
        fields: [
          {
            id: "q1",
            type: "single_select",
            label: "Q",
            options: [{ value: "a", label: "A" }],
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects wrong schema_version", () => {
    expect(validateForm({ ...validForm, schema_version: "ogui/v0" })).toBe(false);
  });

  it("rejects multi_select field type (deferred)", () => {
    expect(
      validateForm({
        ...validForm,
        fields: [
          {
            id: "q1",
            type: "multi_select",
            label: "Q",
            options: [{ value: "a", label: "A" }],
          },
        ],
      }),
    ).toBe(false);
  });

  it("rejects empty fields", () => {
    expect(validateForm({ ...validForm, fields: [] })).toBe(false);
  });

  it("rejects additional properties on form root", () => {
    expect(validateForm({ ...validForm, evil_url: "https://example.com" })).toBe(false);
  });

  it("rejects submit.action other than continue_agent", () => {
    expect(
      validateForm({
        ...validForm,
        submit: { action: "shell" },
      }),
    ).toBe(false);
  });
});

describe("OguiChoiceSchema", () => {
  it("accepts a thin choice component", () => {
    expect(
      validateChoice({
        schema_version: "ogui/v1",
        type: "choice",
        component_id: "c1",
        label: "继续？",
        options: [
          { value: "yes", label: "是" },
          { value: "no", label: "否" },
        ],
      }),
    ).toBe(true);
  });

  it("requires type: choice", () => {
    expect(
      validateChoice({
        schema_version: "ogui/v1",
        type: "form",
        component_id: "c1",
        label: "继续？",
        options: [{ value: "yes", label: "是" }],
      }),
    ).toBe(false);
  });
});

describe("OguiAnswerSchema", () => {
  it("accepts a canonical ogui-answer", () => {
    expect(
      validateAnswer({
        schema_version: "ogui/v1",
        component_id: "biz-model-form-1",
        submission_id: "550e8400-e29b-41d4-a716-446655440000",
        answers: { channel: "hybrid" },
        submitted_at: "2026-10-13T05:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects missing submission_id", () => {
    expect(
      validateAnswer({
        schema_version: "ogui/v1",
        component_id: "biz-model-form-1",
        answers: { channel: "hybrid" },
      }),
    ).toBe(false);
  });

  it("rejects non-object answers", () => {
    expect(
      validateAnswer({
        schema_version: "ogui/v1",
        component_id: "biz-model-form-1",
        submission_id: "550e8400-e29b-41d4-a716-446655440000",
        answers: [{ field_id: "channel", value: "hybrid" }],
      }),
    ).toBe(false);
  });
});
