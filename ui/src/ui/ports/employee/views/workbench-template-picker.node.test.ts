// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { normalizeTemplateOptions, renderTemplatePicker } from "./workbench-template-picker.ts";

const LIST = {
  templates: [
    {
      templateId: "contract_reviewer",
      displayName: "合同审查机器人",
      requiredCapabilities: [
        { key: "contract_review", required: true },
        { key: "approval_system", required: true },
      ],
    },
    { templateId: "generic_worker", displayName: "通用助手", requiredCapabilities: [] },
  ],
};

function mount(tpl: ReturnType<typeof renderTemplatePicker>): HTMLElement {
  const host = document.createElement("div");
  render(tpl, host);
  return host;
}

describe("normalizeTemplateOptions", () => {
  it("parses templates, counts required caps, and pins generic_worker first", () => {
    const opts = normalizeTemplateOptions(LIST);
    expect(opts[0].templateId).toBe("generic_worker");
    const contract = opts.find((o) => o.templateId === "contract_reviewer");
    expect(contract?.requiredCount).toBe(2);
  });

  it("returns empty for malformed input", () => {
    expect(normalizeTemplateOptions(null)).toEqual([]);
    expect(normalizeTemplateOptions({ templates: [{ noId: true }] })).toEqual([]);
  });
});

describe("renderTemplatePicker", () => {
  it("renders nothing with no options", () => {
    const host = mount(renderTemplatePicker({ options: [] }));
    expect(host.querySelector("[data-template-picker]")).toBeNull();
  });

  it("marks selected option and fires onSelect", () => {
    const opts = normalizeTemplateOptions(LIST);
    const onSelect = vi.fn();
    const host = mount(
      renderTemplatePicker({ options: opts, selectedTemplateId: "generic_worker", onSelect }),
    );
    const generic = host.querySelector<HTMLButtonElement>('[data-template-id="generic_worker"]');
    expect(generic?.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("需 2 项能力"); // contract_reviewer req count
    host.querySelector<HTMLButtonElement>('[data-template-id="contract_reviewer"]')?.click();
    expect(onSelect).toHaveBeenCalledWith("contract_reviewer");
  });

  it("defaults selection to generic_worker when unset", () => {
    const opts = normalizeTemplateOptions(LIST);
    const host = mount(renderTemplatePicker({ options: opts }));
    const generic = host.querySelector('[data-template-id="generic_worker"]');
    expect(generic?.getAttribute("aria-pressed")).toBe("true");
  });
});
