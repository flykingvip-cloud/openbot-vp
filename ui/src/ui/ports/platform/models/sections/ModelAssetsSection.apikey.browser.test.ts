// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildBootstrapModelInput, buildBootstrapModelInputs } from "./ModelAssetsSection.ts";

/**
 * Phase 1 (P1-2): the add-provider dialog keeps one panel per provider in a
 * single form and toggles them with `display:none`. `buildBootstrapModelInput`
 * must read `apiKey`/`baseUrl` from the visible (active) panel, not the first
 * matching input in the form.
 */
function buildDialogForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = `
    <div class="platform-model-add__provider-panel" data-provider="alpha" style="display:none">
      <input type="password" name="apiKey" value="sk-hidden-alpha" />
      <input name="baseUrl" value="https://alpha.example/v1" />
    </div>
    <div class="platform-model-add__provider-panel" data-provider="beta" style="">
      <input type="password" name="apiKey" value="sk-visible-beta" />
      <input name="baseUrl" value="https://beta.example/v1" />
    </div>
    <input type="hidden" name="providerId" value="beta" />
    <input type="hidden" name="modelId" value="m1" />
    <input type="hidden" name="name" value="M1" />
    <input type="hidden" name="api" value="openai-completions" />
    <input type="hidden" name="inputModes" value="text" />
    <input type="hidden" name="contextWindow" value="128000" />
    <input type="hidden" name="maxTokens" value="8192" />
    <input type="hidden" name="reasoning" value="" />
  `;
  document.body.appendChild(form);
  return form;
}

describe("buildBootstrapModelInput active-panel reading", () => {
  it("reads apiKey/baseUrl from the visible panel, not the first hidden one", () => {
    const form = buildDialogForm();
    try {
      const input = buildBootstrapModelInput(form);
      expect(input).not.toBeNull();
      expect(input?.providerId).toBe("beta");
      expect(input?.apiKey).toBe("sk-visible-beta");
      expect(input?.baseUrl).toBe("https://beta.example/v1");
    } finally {
      form.remove();
    }
  });

  it("falls back to the first panel when none is explicitly visible", () => {
    const form = buildDialogForm();
    // Hide every panel; helper should fall back to the first panel.
    form
      .querySelectorAll<HTMLElement>(".platform-model-add__provider-panel")
      .forEach((panel) => (panel.style.display = "none"));
    try {
      const input = buildBootstrapModelInput(form);
      expect(input?.apiKey).toBe("sk-hidden-alpha");
      expect(input?.baseUrl).toBe("https://alpha.example/v1");
    } finally {
      form.remove();
    }
  });
});

describe("buildBootstrapModelInputs multi-row selection", () => {
  it("returns every checked model row in the active provider panel", () => {
    const form = document.createElement("form");
    form.innerHTML = `
      <div class="platform-model-add__provider-panel" data-provider="阶跃星辰" style="">
        <input type="password" name="apiKey" value="sk-step" />
        <input name="baseUrl" value="https://api.stepfun.com/step_plan/v1" />
        <div class="platform-model-add__models-list">
          <div class="platform-model-add__model-row">
            <span class="platform-model-add__model-id">阶跃星辰/step-3.5-flash</span>
            <label class="platform-model-add__toggle"><input type="checkbox" checked /><span></span></label>
          </div>
          <div class="platform-model-add__model-row">
            <span class="platform-model-add__model-id">阶跃星辰/step-3.7-flash</span>
            <label class="platform-model-add__toggle"><input type="checkbox" checked /><span></span></label>
          </div>
          <div class="platform-model-add__model-row">
            <span class="platform-model-add__model-id">阶跃星辰/step-router-v1</span>
            <label class="platform-model-add__toggle"><input type="checkbox" /><span></span></label>
          </div>
        </div>
      </div>
      <input type="hidden" name="providerId" value="阶跃星辰" />
      <input type="hidden" name="modelId" value="step-3.5-flash" />
      <input type="hidden" name="name" value="step-3.5-flash" />
      <input type="hidden" name="api" value="openai-completions" />
      <input type="hidden" name="inputModes" value="text" />
      <input type="hidden" name="contextWindow" value="128000" />
      <input type="hidden" name="maxTokens" value="8192" />
      <input type="hidden" name="reasoning" value="" />
    `;
    document.body.appendChild(form);
    try {
      const inputs = buildBootstrapModelInputs(form);
      expect(inputs.map((entry) => entry.modelId)).toEqual(["step-3.5-flash", "step-3.7-flash"]);
      expect(inputs.every((entry) => entry.providerId === "阶跃星辰")).toBe(true);
      expect(inputs.every((entry) => entry.apiKey === "sk-step")).toBe(true);
    } finally {
      form.remove();
    }
  });
});
