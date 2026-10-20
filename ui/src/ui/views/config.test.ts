// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderConfig } from "./config.ts";

function createConfigProps(
  overrides: Partial<Parameters<typeof renderConfig>[0]> = {},
): Parameters<typeof renderConfig>[0] {
  return {
    raw: "{ test: true }",
    originalRaw: "{}",
    valid: true,
    issues: [],
    loading: false,
    saving: false,
    applying: false,
    updating: false,
    connected: true,
    schema: { type: "object", properties: {} },
    schemaLoading: false,
    uiHints: {},
    formMode: "raw",
    formValue: {},
    originalValue: {},
    searchQuery: "",
    activeSection: null,
    activeSubsection: null,
    canManage: true,
    canUpdate: true,
    readOnlyReason: null,
    onRawChange: () => undefined,
    onFormModeChange: () => undefined,
    onFormPatch: () => undefined,
    onSearchChange: () => undefined,
    onSectionChange: () => undefined,
    onSubsectionChange: () => undefined,
    onReload: () => undefined,
    onSave: () => undefined,
    onApply: () => undefined,
    onUpdate: () => undefined,
    ...overrides,
  };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  ) as HTMLButtonElement | null;
}

describe("config page permissions (browser)", () => {
  it("disables write actions and raw editor in read-only mode", async () => {
    const container = document.createElement("div");
    render(
      renderConfig(
        createConfigProps({
          canManage: false,
          canUpdate: false,
          readOnlyReason: "Read-only for the current role.",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent ?? "").toContain("Read-only for the current role.");
    expect(findButton(container, "Save")?.disabled).toBe(true);
    expect(findButton(container, "Apply")?.disabled).toBe(true);
    expect(findButton(container, "Update")?.disabled).toBe(true);
    expect(container.querySelector("textarea")?.hasAttribute("disabled")).toBe(true);
  });
});
