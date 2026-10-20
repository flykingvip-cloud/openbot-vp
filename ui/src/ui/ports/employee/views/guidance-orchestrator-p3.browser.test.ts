// @vitest-environment jsdom
/**
 * P3.4: Growth Prelude + Daibai onboarding + Steward + team stale must not
 * render competing primary CTAs. Ack/defer isolation, Gateway resume, high-risk confirm.
 */
import { html, render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrowthStatusView, NextGrowthActionView } from "../../../controllers/agent-growth.ts";
import {
  acknowledgeGuidanceSnapshot,
  deferGuidanceSnapshot,
  readGuidanceProgressFromGateway,
  requestGuidanceHighRiskConfirm,
  resetGuidanceUiControlStateForTests,
  getGuidanceUiControlState,
} from "../../../controllers/guidance-orchestrator.ts";
import {
  buildRobotUiSnapshotFromGrowth,
  buildTeamUiSnapshot,
  buildUserUiSnapshotFromDaibai,
  stewardSuggestionAsOptional,
} from "../guidance/build-ui-snapshot.ts";
import type { GuidanceOrchestratorClient } from "../guidance/metrics-client.ts";
import {
  pickOrchestratedPrimary,
  resolveCompetingSurfaceVisibility,
} from "../guidance/orchestrate-surface.ts";
import {
  countGuidancePrimaryCtaMarkers,
  renderOrchestratedGuidanceSurface,
} from "../guidance/render-orchestrated-cta.ts";
import { renderDaibaiThreadPrelude } from "./workbench-stage-assistant.ts";
import { renderRobotGrowthPrelude } from "./workbench-stage-growth-prelude.ts";

function recommendation(kind: NextGrowthActionView["kind"] = "start_work"): NextGrowthActionView {
  return {
    kind,
    reason: "growth.recommend.start_work",
    priority: 20,
    gaps: [],
    canSkip: true,
    target: { focusComposer: true },
  };
}

function growthView(): GrowthStatusView {
  return {
    lifecycleState: "birth",
    dimensions: { identity: 10, capability: 0, knowledge: 0, habits: 0 },
    activationScore: 5,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    templateId: "contract_reviewer",
    capabilityGaps: [],
    funnel: {
      hasSessionOpened: true,
      hasIdentityCompleted: false,
      hasFirstSkillInstalled: false,
      hasFirstMissionSent: false,
      hasFirstMissionSuccess: false,
      preludeDismissed: false,
    },
    recommendation: recommendation(),
  };
}

describe("guidance orchestrator P3.4 browser", () => {
  let host: HTMLElement;

  beforeEach(() => {
    resetGuidanceUiControlStateForTests();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    resetGuidanceUiControlStateForTests();
  });

  it("renders a single primary CTA when Growth and Daibai candidates compete", () => {
    const robot = buildRobotUiSnapshotFromGrowth({
      entityId: "bot-1",
      lifecycleState: "birth",
      recommendation: recommendation(),
      optionalActions: [stewardSuggestionAsOptional({ kind: "steward.tip", label: "Steward tip" })],
    });
    const user = buildUserUiSnapshotFromDaibai({
      userId: "user-1",
      needsOnboardingGuide: true,
      stewardSuggestion: stewardSuggestionAsOptional({ kind: "steward.tip", label: "Steward tip" }),
    });
    const team = buildTeamUiSnapshot({ entityId: "team-1", hasStaleMission: true });
    const primary = pickOrchestratedPrimary([robot, user, team]);
    expect(primary?.scope).toBe("robot");

    const visibility = resolveCompetingSurfaceVisibility({
      primary,
      showGrowthPrelude: true,
      showDaibaiOnboarding: true,
      hasStewardSuggestion: true,
      hasTeamStaleMission: true,
    });
    expect(visibility.daibaiOnboardingVisible).toBe(false);
    expect(visibility.stewardSuggestionAsPrimary).toBe(false);
    expect(visibility.teamStaleMissionAsPrimary).toBe(false);

    const controls = getGuidanceUiControlState();
    const orchestrated = renderOrchestratedGuidanceSurface(primary, {
      acknowledgedKeys: controls.acknowledgedKeys,
      deferredUntilMsByKey: controls.deferredUntilMsByKey,
      showResume: true,
      showFailureRecover: true,
      onPrimary: () => undefined,
      onOptional: () => undefined,
      onAcknowledge: () => undefined,
      onDefer: () => undefined,
      onResume: () => undefined,
      onFailureRecover: () => undefined,
      onRequestHighRiskConfirm: () => undefined,
      onHighRiskConfirm: () => undefined,
    });

    render(
      html`
        ${
          visibility.growthPreludeVisible
            ? renderRobotGrowthPrelude({
                view: growthView(),
                recommendation: recommendation(),
                onPrimaryAction: () => undefined,
                orchestratedPrimary: orchestrated,
              })
            : null
        }
        ${
          visibility.daibaiOnboardingVisible
            ? renderDaibaiThreadPrelude(
                {
                  daibaiLoading: false,
                  daibaiAskResult: null,
                  daibaiExecuteResult: null,
                  daibaiActionLoading: false,
                  daibaiActionPendingId: null,
                  daibaiActionError: null,
                  daibaiPendingConfirmation: null,
                  onAskDaibai: async () => undefined,
                },
                { guideAcknowledged: false },
              )
            : null
        }
        <button data-steward-suggestion="true" data-guidance-optional-cta="steward.tip">Steward tip</button>
        <button data-guidance-team-hint="true" data-guidance-optional-cta="advance_team_mission">
          升级群使命
        </button>
      `,
      host,
    );

    expect(countGuidancePrimaryCtaMarkers(host)).toBe(1);
    expect(host.querySelector("[data-growth-primary-cta]")).toBeNull();
    expect(host.querySelector("[data-daibai-primary-cta]")).toBeNull();
    expect(host.querySelector("[data-guidance-optional]")).toBeTruthy();
    expect(host.querySelectorAll("[data-guidance-optional-cta]").length).toBeGreaterThanOrEqual(1);
    expect(host.querySelector("[data-guidance-team-hint]")).toBeTruthy();
  });

  it("hides primary after acknowledge and does not immediately reappear after defer", () => {
    const robot = buildRobotUiSnapshotFromGrowth({
      entityId: "bot-ack",
      lifecycleState: "birth",
      recommendation: recommendation(),
    });
    acknowledgeGuidanceSnapshot(robot);
    const afterAck = renderOrchestratedGuidanceSurface(robot, {
      acknowledgedKeys: getGuidanceUiControlState().acknowledgedKeys,
      deferredUntilMsByKey: getGuidanceUiControlState().deferredUntilMsByKey,
      onPrimary: () => undefined,
      onOptional: () => undefined,
      onAcknowledge: () => undefined,
      onDefer: () => undefined,
      onResume: () => undefined,
      onFailureRecover: () => undefined,
      onRequestHighRiskConfirm: () => undefined,
      onHighRiskConfirm: () => undefined,
    });
    render(html`${afterAck}`, host);
    expect(countGuidancePrimaryCtaMarkers(host)).toBe(0);

    resetGuidanceUiControlStateForTests();
    const deferred = buildRobotUiSnapshotFromGrowth({
      entityId: "bot-defer",
      lifecycleState: "birth",
      recommendation: recommendation(),
    });
    deferGuidanceSnapshot(deferred, 60_000, Date.now());
    render(
      html`${renderOrchestratedGuidanceSurface(deferred, {
        acknowledgedKeys: getGuidanceUiControlState().acknowledgedKeys,
        deferredUntilMsByKey: getGuidanceUiControlState().deferredUntilMsByKey,
        nowMs: Date.now(),
        onPrimary: () => undefined,
        onOptional: () => undefined,
        onAcknowledge: () => undefined,
        onDefer: () => undefined,
        onResume: () => undefined,
        onFailureRecover: () => undefined,
        onRequestHighRiskConfirm: () => undefined,
        onHighRiskConfirm: () => undefined,
      })}`,
      host,
    );
    expect(countGuidancePrimaryCtaMarkers(host)).toBe(0);
  });

  it("keeps user/robot/team ack state isolated", () => {
    const robot = buildRobotUiSnapshotFromGrowth({
      entityId: "shared-id",
      lifecycleState: "birth",
      recommendation: recommendation(),
    });
    const user = buildUserUiSnapshotFromDaibai({
      userId: "shared-id",
      needsOnboardingGuide: true,
    });
    acknowledgeGuidanceSnapshot(robot);
    expect(
      renderOrchestratedGuidanceSurface(robot, {
        acknowledgedKeys: getGuidanceUiControlState().acknowledgedKeys,
        deferredUntilMsByKey: getGuidanceUiControlState().deferredUntilMsByKey,
        onPrimary: () => undefined,
        onOptional: () => undefined,
        onAcknowledge: () => undefined,
        onDefer: () => undefined,
        onResume: () => undefined,
        onFailureRecover: () => undefined,
        onRequestHighRiskConfirm: () => undefined,
        onHighRiskConfirm: () => undefined,
      }),
    ).toBeTruthy();
    render(
      html`${renderOrchestratedGuidanceSurface(user, {
        acknowledgedKeys: getGuidanceUiControlState().acknowledgedKeys,
        deferredUntilMsByKey: getGuidanceUiControlState().deferredUntilMsByKey,
        onPrimary: () => undefined,
        onOptional: () => undefined,
        onAcknowledge: () => undefined,
        onDefer: () => undefined,
        onResume: () => undefined,
        onFailureRecover: () => undefined,
        onRequestHighRiskConfirm: () => undefined,
        onHighRiskConfirm: () => undefined,
      })}`,
      host,
    );
    expect(countGuidancePrimaryCtaMarkers(host)).toBe(1);
    expect(host.querySelector("[data-guidance-scope='user']")).toBeTruthy();
  });

  it("requires a second confirm click for high-risk actions", () => {
    const highRisk = buildRobotUiSnapshotFromGrowth({
      entityId: "bot-risk",
      lifecycleState: "birth",
      recommendation: {
        ...recommendation("install_capabilities"),
        kind: "install_capabilities",
      },
    });
    highRisk.nextAction = {
      ...highRisk.nextAction,
      kind: "revoke_access",
      label: "撤销访问",
      risk: "high",
    };
    const onPrimary = vi.fn();
    const onHighRiskConfirm = vi.fn(() => {
      requestGuidanceHighRiskConfirm(highRisk);
    });

    const remount = () => {
      const controls = getGuidanceUiControlState();
      render(
        html`${renderOrchestratedGuidanceSurface(highRisk, {
          acknowledgedKeys: controls.acknowledgedKeys,
          deferredUntilMsByKey: controls.deferredUntilMsByKey,
          highRiskPending: controls.highRiskPendingKey === "robot::bot-risk",
          onPrimary,
          onOptional: () => undefined,
          onAcknowledge: () => undefined,
          onDefer: () => undefined,
          onResume: () => undefined,
          onFailureRecover: () => undefined,
          onRequestHighRiskConfirm: () => {
            requestGuidanceHighRiskConfirm(highRisk);
            remount();
          },
          onHighRiskConfirm: () => {
            onHighRiskConfirm();
            onPrimary();
          },
        })}`,
        host,
      );
    };
    remount();
    const first = host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta='true']");
    expect(first?.getAttribute("data-guidance-requires-confirm")).toBe("true");
    first?.click();
    expect(onPrimary).not.toHaveBeenCalled();
    const confirm = host.querySelector<HTMLButtonElement>(
      "[data-guidance-high-risk-confirm='true']",
    );
    expect(confirm).toBeTruthy();
    confirm?.click();
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("first-run daibai onboarding hides resume, recover, native toolbar, and leaked keys", async () => {
    render(
      html`${renderDaibaiThreadPrelude(
        {
          daibaiLoading: false,
          daibaiAskResult: null,
          daibaiExecuteResult: null,
          daibaiActionLoading: false,
          daibaiActionPendingId: null,
          daibaiActionError: null,
          daibaiPendingConfirmation: null,
          onAskDaibai: async () => undefined,
        },
        { guideAcknowledged: false },
      )}`,
      host,
    );
    expect(countGuidancePrimaryCtaMarkers(host)).toBe(1);
    expect(host.querySelector("[data-daibai-primary-cta]")).toBeNull();
    expect(host.querySelector("[data-guidance-resume]")).toBeNull();
    expect(host.querySelector("[data-guidance-failure-recover]")).toBeNull();
    expect(host.textContent).toContain("开始引导");
    expect(host.textContent).not.toContain("从进度恢复");
    expect(host.textContent).not.toContain("失败恢复");
    expect(host.textContent).not.toContain("guidance.recommend");
    expect(host.textContent?.match(/我知道了/g)?.length).toBe(1);
  });

  it("resume reads Gateway progress.progress.get — not localStorage", async () => {
    const snapshot = buildRobotUiSnapshotFromGrowth({
      entityId: "bot-resume",
      lifecycleState: "growing",
      recommendation: recommendation(),
    });
    localStorage.setItem("guidance-progress-bot-resume", JSON.stringify({ fake: true }));
    let requestCalls = 0;
    const request: NonNullable<GuidanceOrchestratorClient["request"]> = async (method) => {
      requestCalls += 1;
      expect(method).toBe("guidance.progress.get");
      return { record: { nextAction: { kind: "start_work" }, source: "gateway" } } as never;
    };
    const record = await readGuidanceProgressFromGateway({ request }, snapshot);
    expect(requestCalls).toBe(1);
    expect(record).toEqual({ nextAction: { kind: "start_work" }, source: "gateway" });
    expect(localStorage.getItem("guidance-progress-bot-resume")).toBeTruthy();
  });
});
