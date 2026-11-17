// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";
import {
  renderRuleAdaptationAdviceButton,
  renderRuleAdaptationAdvicePanel,
  type EmployeeAdviceView,
} from "./rule-adaptation-advice-panel.ts";

function view(overrides: Partial<EmployeeAdviceView> = {}): EmployeeAdviceView {
  return {
    state: "adjustment_suggested",
    label: "建议调整",
    notEffective: true,
    notEffectiveLabel: "尚未生效",
    summary: "已生成规则适配建议，但尚未生效。",
    reasons: [],
    proposal: {
      kind: "policy_proposal",
      items: [{ field: "agents.defaults.contextTokens", proposedValue: 24000 }],
    },
    activationAllowed: false,
    requestId: "req-1",
    modelCalled: true,
    ...overrides,
  };
}

describe("rule-adaptation-advice-panel", () => {
  beforeAll(async () => {
    i18n.registerTranslation("zh-CN", zh_CN);
    await i18n.setLocale("zh-CN");
  });
  const containers: HTMLElement[] = [];
  afterEach(() => {
    for (const el of containers) {
      el.remove();
    }
    containers.length = 0;
  });

  function mount(template: unknown) {
    const el = document.createElement("div");
    document.body.append(el);
    containers.push(el);
    render(template as never, el);
    return el;
  }

  it("does not render a panel while idle, and keeps the entry explicitly labeled", () => {
    const idle = mount(
      renderRuleAdaptationAdvicePanel({ advice: { status: "idle", result: null, error: null } }),
    );
    expect(idle.querySelector('[data-testid="rule-adaptation-advice-panel"]')).toBeNull();
    const trigger = mount(
      renderRuleAdaptationAdviceButton({ connected: true, onRequest: () => undefined }),
    );
    const button = trigger.querySelector<HTMLButtonElement>(
      '[data-testid="rule-adaptation-advice-trigger"]',
    );
    expect(button?.textContent).toContain("规则适配建议");
    expect(button?.disabled).toBe(false);
  });

  it("shows each of the four advice states and always labels the result as not yet in effect", () => {
    const cases = [
      ["no_change", "无需调整"],
      ["needs_information", "需补信息"],
      ["blocked", "被阻止"],
      ["adjustment_suggested", "建议调整"],
      ["interpretation_pending", "规则解释／待核验"],
    ] as const;
    for (const [state, label] of cases) {
      const el = mount(
        renderRuleAdaptationAdvicePanel({
          advice: { status: "result", result: view({ state, label }), error: null },
        }),
      );
      expect(
        el.querySelector('[data-testid="rule-adaptation-advice-label"]')?.textContent,
      ).toContain(label);
      expect(
        el.querySelector('[data-testid="rule-adaptation-advice-not-effective"]')?.textContent,
      ).toContain("尚未生效");
      expect(el.querySelector("[data-testid='rule-adaptation-advice-activate']")).toBeNull();
      expect(el.querySelector("[data-testid='rule-adaptation-advice-publish']")).toBeNull();
      expect(el.textContent).toContain("尚未生效");
    }
  });

  it("isolates a soft failure to the advice panel", () => {
    const el = mount(
      renderRuleAdaptationAdvicePanel({
        advice: {
          status: "failed",
          result: view({
            state: "failed",
            label: "建议失败",
            summary: "本次建议请求失败，已有聊天与原任务未改动。",
          }),
          error: null,
        },
      }),
    );
    expect(el.textContent).toContain("已有聊天与原任务未改动");
    expect(el.textContent).toContain("尚未生效");
  });

  it("disables the trigger while a request is in flight and exposes cancel", () => {
    const onCancel = vi.fn();
    const el = mount(
      renderRuleAdaptationAdvicePanel({
        advice: { status: "loading", result: null, error: null },
        onCancel,
      }),
    );
    el.querySelector<HTMLButtonElement>('[data-testid="rule-adaptation-advice-cancel"]')?.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    const trigger = mount(
      renderRuleAdaptationAdviceButton({
        connected: true,
        advice: { status: "loading", result: null, error: null },
        onRequest: vi.fn(),
      }),
    );
    expect(
      trigger.querySelector<HTMLButtonElement>('[data-testid="rule-adaptation-advice-trigger"]')
        ?.disabled,
    ).toBe(true);
  });
});
