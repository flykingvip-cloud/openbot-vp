// @vitest-environment jsdom
import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { GrowthStatusView, NextGrowthActionView } from "../../../controllers/agent-growth.ts";
import {
  renderGrowthStepper,
  renderRobotGrowthPrelude,
  renderTeamAwakeningPrelude,
  type GrowthCapabilityGap,
} from "./workbench-stage-growth-prelude.ts";

function view(partial: Partial<GrowthStatusView>): GrowthStatusView {
  return {
    lifecycleState: "growing",
    dimensions: { identity: 80, capability: 40, knowledge: 20, habits: 0 },
    activationScore: 35,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    templateId: "contract_reviewer",
    ...partial,
  };
}

function mount(tpl: ReturnType<typeof renderRobotGrowthPrelude>): HTMLElement {
  const host = document.createElement("div");
  render(tpl, host);
  return host;
}

beforeEach(async () => {
  await i18n.setLocale("zh-CN");
});

describe("renderGrowthStepper", () => {
  it("renders robot dimensions and hides alignment when absent", () => {
    const host = mount(renderGrowthStepper(view({})));
    const dims = host.querySelectorAll(".workbench-growth-prelude__dim");
    expect(dims.length).toBe(4); // identity/capability/knowledge/habits, no alignment
    expect(host.textContent).toContain("激活进度 35%");
  });

  it("includes alignment for groups", () => {
    const host = mount(
      renderGrowthStepper(
        view({
          dimensions: { identity: 0, capability: 0, knowledge: 0, habits: 0, alignment: 50 },
        }),
      ),
    );
    expect(host.querySelectorAll(".workbench-growth-prelude__dim").length).toBe(5);
  });
});

describe("renderRobotGrowthPrelude", () => {
  const gaps: GrowthCapabilityGap[] = [
    { key: "contract_review", label: "合同审查技能", kind: "skill", satisfied: false },
    {
      key: "approval_system",
      label: "审批系统授权",
      kind: "oauth",
      satisfied: false,
      pendingIntegration: true,
    },
    { key: "contract_kb", label: "合同知识库", kind: "knowledge_binding", satisfied: true },
  ];

  it("renders onboarding narrative, primary CTA, and unmet gaps", () => {
    const host = mount(
      renderRobotGrowthPrelude({
        view: view({}),
        roleName: "合同审查机器人",
        audience: "法务团队",
        gaps,
        recommendation: {
          kind: "start_work",
          reason: "growth.recommend.start_work",
          priority: 20,
          gaps: [],
          canSkip: true,
          target: { focusComposer: true },
        },
        onPrimaryAction: () => undefined,
      }),
    );
    expect(host.querySelector('[data-growth-prelude="robot"]')).toBeTruthy();
    expect(host.textContent).toContain("我是【合同审查机器人】· 上岗培养");
    expect(host.textContent).toContain("法务团队");
    expect(host.textContent).toContain("建议安装的技能（2）");
    expect(host.querySelector("[data-growth-primary-cta]")?.textContent).toContain("直接开始工作");
    expect(host.querySelector("details.workbench-growth-prelude__details")).toBeTruthy();
  });

  it("fires primary CTA and dismiss; detail keeps install action", () => {
    const onPrimaryAction = vi.fn();
    const onInstallCapability = vi.fn();
    const onDismiss = vi.fn();
    const host = mount(
      renderRobotGrowthPrelude({
        view: view({}),
        recommendation: {
          kind: "install_capabilities",
          reason: "growth.recommend.install_capabilities",
          priority: 30,
          gaps: [],
          canSkip: true,
          target: { module: "assistant", tab: "skills" },
        },
        onPrimaryAction,
        onInstallCapability,
        onDismiss,
      }),
    );
    host.querySelector<HTMLButtonElement>("[data-growth-primary-cta]")?.click();
    host.querySelector<HTMLDetailsElement>("details")?.setAttribute("open", "");
    const buttons = [...host.querySelectorAll("button")];
    buttons.find((b) => b.textContent?.includes("安装技能"))?.click();
    buttons.find((b) => b.textContent?.includes("稍后再说"))?.click();
    expect(onPrimaryAction).toHaveBeenCalledOnce();
    expect(onInstallCapability).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("renders when the recommendation omits gaps", () => {
    const host = mount(
      renderRobotGrowthPrelude({
        view: view({}),
        recommendation: {
          kind: "install_capabilities",
          reason: "growth.recommend.install_capabilities",
          priority: 30,
          canSkip: true,
          target: { module: "assistant", tab: "skills" },
        } as NextGrowthActionView,
      }),
    );
    expect(host.querySelector('[data-growth-prelude="robot"]')).toBeTruthy();
    expect(host.textContent).toContain("建议安装");
  });
});

describe("renderTeamAwakeningPrelude", () => {
  it("shows team welcome copy without setup checklist or org CTAs", () => {
    const host = mount(
      renderTeamAwakeningPrelude({
        teamName: "市场研究组",
        onStartCollaboration: () => undefined,
      }),
    );
    expect(host.textContent).toContain("我们【市场研究组】组建完成了");
    expect(host.textContent).toContain("协作群已就绪");
    expect(host.querySelector(".workbench-growth-prelude__stepper")).toBeNull();
    expect(host.querySelector('[data-gap-key="roles"]')).toBeNull();
    expect(host.textContent).toContain("开始协作");
  });
});
