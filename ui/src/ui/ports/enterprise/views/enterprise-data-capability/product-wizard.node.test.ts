import { describe, expect, it } from "vitest";
import { clampProductWizardStep, validateProductWizardStep } from "./product-wizard.ts";

describe("product-wizard", () => {
  const draft = {
    capabilityKey: "crm_sync",
    displayName: "客户同步",
    description: "",
    sourceIds: new Set(["s1"]),
    actionRefTokens: new Set(["c:a:1"]),
    outputMode: "direct" as const,
    projectionTemplateKey: "",
    openScopeReady: false,
  };

  it("validates step dependencies and missing jumps", () => {
    expect(
      validateProductWizardStep(2, draft, { sourceCount: 0, actionCount: 0, seatCount: 1 }),
    ).toMatchObject({ ok: false, missing: ["sources", "actions"] });
    expect(
      validateProductWizardStep(2, draft, { sourceCount: 1, actionCount: 1, seatCount: 1 }),
    ).toMatchObject({ ok: true });
    expect(
      validateProductWizardStep(4, draft, { sourceCount: 1, actionCount: 1, seatCount: 0 }),
    ).toMatchObject({ ok: false, missing: ["seats"] });
    expect(
      validateProductWizardStep(4, draft, { sourceCount: 1, actionCount: 1, seatCount: 1 }),
    ).toMatchObject({ ok: false, message: "请至少选择一个岗位或部门作为开放范围。" });
    expect(
      validateProductWizardStep(
        4,
        { ...draft, openScopeReady: true },
        { sourceCount: 1, actionCount: 1, seatCount: 1 },
      ),
    ).toMatchObject({ ok: true });
  });

  it("names the projection output mode as knowledge-universe supply", () => {
    expect(
      validateProductWizardStep(
        3,
        { ...draft, outputMode: "projection", projectionTemplateKey: "" },
        { sourceCount: 1, actionCount: 1, seatCount: 1 },
      ),
    ).toMatchObject({
      ok: false,
      message: "请选择投影模板。若只登记能力、不供给知识宇宙，请改用「仅登记能力」。",
    });
    expect(
      validateProductWizardStep(
        3,
        { ...draft, outputMode: "direct", projectionTemplateKey: "" },
        { sourceCount: 1, actionCount: 1, seatCount: 1 },
      ),
    ).toMatchObject({ ok: true });
  });

  it("clamps wizard steps", () => {
    expect(clampProductWizardStep(0)).toBe(1);
    expect(clampProductWizardStep(9)).toBe(4);
  });
});
