// @vitest-environment jsdom
import { html, render } from "lit";
import { describe, expect, it } from "vitest";
import { resetGuidanceUiControlStateForTests } from "../../../controllers/guidance-orchestrator.ts";
import { buildUserUiSnapshotFromDaibai } from "./build-ui-snapshot.ts";
import { renderOrchestratedGuidanceSurface } from "./render-orchestrated-cta.ts";

const noopHandlers = {
  onPrimary: () => undefined,
  onOptional: () => undefined,
  onAcknowledge: () => undefined,
  onDefer: () => undefined,
  onResume: () => undefined,
  onFailureRecover: () => undefined,
  onRequestHighRiskConfirm: () => undefined,
  onHighRiskConfirm: () => undefined,
};

describe("renderOrchestratedGuidanceSurface", () => {
  it("first-run onboarding keeps one primary CTA and hides resume/recover plus leaked keys", async () => {
    resetGuidanceUiControlStateForTests();
    const snapshot = buildUserUiSnapshotFromDaibai({
      userId: "user-1",
      needsOnboardingGuide: true,
    });
    const host = document.createElement("div");
    render(html`${renderOrchestratedGuidanceSurface(snapshot, noopHandlers)}`, host);
    await Promise.resolve();

    expect(host.querySelectorAll("[data-guidance-primary-cta]").length).toBe(1);
    expect(host.textContent).toContain("开始引导");
    expect(host.textContent).toContain("稍后处理");
    expect(host.textContent).toContain("我知道了");
    expect(host.textContent).not.toContain("从进度恢复");
    expect(host.textContent).not.toContain("失败恢复");
    expect(host.textContent).not.toContain("guidance.recommend");
    expect(host.querySelector(".workbench-guidance-orchestrator__lead")).toBeNull();
  });
});
