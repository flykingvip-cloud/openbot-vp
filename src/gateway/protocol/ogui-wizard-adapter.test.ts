import { describe, expect, it } from "vitest";
import {
  OGUI_TO_WIZARD_FIELD_TYPE,
  WIZARD_TO_OGUI_FIELD_TYPE,
  oguiChoiceToWizardStep,
  oguiFieldToWizardStep,
  oguiFormToWizardSteps,
  wizardStepToOguiField,
} from "./ogui-wizard-adapter.js";

describe("OGUI ↔ Wizard mapping table", () => {
  it("maps single_select ↔ select only", () => {
    expect(OGUI_TO_WIZARD_FIELD_TYPE.single_select).toBe("select");
    expect(WIZARD_TO_OGUI_FIELD_TYPE.select).toBe("single_select");
    expect(WIZARD_TO_OGUI_FIELD_TYPE.multiselect).toBeNull();
    expect(WIZARD_TO_OGUI_FIELD_TYPE.confirm).toBeNull();
  });
});

describe("oguiFormToWizardSteps", () => {
  it("converts form fields to Wizard select steps without merging runtimes", () => {
    const steps = oguiFormToWizardSteps({
      schema_version: "ogui/v1",
      component_id: "f1",
      fields: [
        {
          id: "channel",
          type: "single_select",
          label: "获客模式",
          options: [
            { value: "direct", label: "直销" },
            { value: "hybrid", label: "混合" },
          ],
        },
      ],
    });
    expect(steps).toEqual([
      {
        id: "channel",
        type: "select",
        title: "获客模式",
        options: [
          { value: "direct", label: "直销" },
          { value: "hybrid", label: "混合" },
        ],
      },
    ]);
  });
});

describe("oguiChoiceToWizardStep", () => {
  it("maps choice → one select step", () => {
    expect(
      oguiChoiceToWizardStep({
        schema_version: "ogui/v1",
        type: "choice",
        component_id: "c1",
        label: "继续？",
        options: [
          { value: "yes", label: "是" },
          { value: "no", label: "否" },
        ],
      }),
    ).toEqual({
      id: "c1",
      type: "select",
      title: "继续？",
      options: [
        { value: "yes", label: "是" },
        { value: "no", label: "否" },
      ],
    });
  });
});

describe("wizardStepToOguiField", () => {
  it("maps select → single_select when values are string-coercible", () => {
    expect(
      wizardStepToOguiField({
        id: "mode",
        type: "select",
        title: "模式",
        options: [
          { value: "a", label: "A" },
          { value: 2, label: "Two" },
        ],
      }),
    ).toEqual({
      id: "mode",
      label: "模式",
      type: "single_select",
      options: [
        { value: "a", label: "A" },
        { value: "2", label: "Two" },
      ],
    });
  });

  it("returns null for confirm / note (no invent)", () => {
    expect(wizardStepToOguiField({ id: "n1", type: "note", message: "hi" })).toBeNull();
    expect(wizardStepToOguiField({ id: "c1", type: "confirm", title: "OK?" })).toBeNull();
  });

  it("returns null when an option value cannot be stringified safely", () => {
    expect(
      wizardStepToOguiField({
        id: "x",
        type: "select",
        title: "X",
        options: [{ value: { nested: true }, label: "obj" }],
      }),
    ).toBeNull();
  });
});

describe("oguiFieldToWizardStep", () => {
  it("maps single_select field", () => {
    const step = oguiFieldToWizardStep({
      id: "q1",
      type: "single_select",
      label: "Q",
      options: [{ value: "a", label: "A" }],
    });
    expect(step?.type).toBe("select");
    expect(step?.id).toBe("q1");
  });
});
