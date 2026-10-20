/**
 * Agent Growth OS — thread prelude + 唯一主建议接线（P0 onboarding）。
 */

import { nothing, type TemplateResult } from "lit";
import { parseAgentSessionKey } from "../../../../../src/sessions/session-key-utils.ts";
import { t } from "../../../i18n/index.ts";
import type { AppPortState } from "../../app-port-state.ts";
import {
  EMPTY_NEXT_GROWTH_ACTION,
  loadGrowthStatus,
  recordGrowthMilestone,
  resolveGrowthRecommendation,
  type AgentGrowthClientState,
  type GrowthEntityRef,
  type GrowthPendingTaskContextView,
  type GrowthStatusView,
  type NextGrowthActionView,
} from "../../controllers/agent-growth.ts";
import {
  beginInstallCapabilitiesFlow,
  resumeGrowthPendingTask,
  showGrowthContinueBanner,
  skipEnhanceAndShowContinue,
} from "./growth-pending-task-wire.ts";
import { resolveGrowthEntityFromSessionKey } from "./growth-session-sync.ts";
import { buildRobotUiSnapshotFromGrowth } from "./guidance/build-ui-snapshot.ts";
import {
  readGuidanceProgressFromGateway,
  recordGuidanceMetricClient,
  recordGuidanceShownOnce,
  type GuidanceOrchestratorClient,
} from "./guidance/metrics-client.ts";
import { guidanceScopeAckKey } from "./guidance/orchestrate-surface.ts";
import {
  renderOrchestratedGuidanceSurface,
  type OrchestratedGuidanceHandlers,
} from "./guidance/render-orchestrated-cta.ts";
import {
  acknowledgeGuidanceSnapshot,
  clearGuidanceHighRiskConfirm,
  deferGuidanceSnapshot,
  getGuidanceUiControlState,
  requestGuidanceHighRiskConfirm,
} from "./guidance/ui-control-state.ts";
import {
  renderRobotGrowthPrelude,
  renderTeamAwakeningPrelude,
} from "./views/workbench-stage-growth-prelude.ts";
import type {
  GroupProfileView,
  WorkbenchPrimaryModule,
  WorkbenchRobotWorkbenchTab,
} from "./views/workbench-types.ts";

export type GrowthPreludeWireHost = AgentGrowthClientState &
  Pick<
    AppPortState,
    "sessionKey" | "agentsList" | "collaborationSpacesResult" | "workbenchTeamSelectedKey"
  > & {
    workbenchActiveGrowthStatus: GrowthStatusView | null;
    chatMessage: string;
    workbenchPrimaryModule: WorkbenchPrimaryModule;
    workbenchRobotWorkbenchTab: WorkbenchRobotWorkbenchTab;
    workbenchGroupProfileView: GroupProfileView;
    workbenchGrowthBirthAwakening?: boolean;
    workbenchGrowthPreferCultivate?: boolean;
    workbenchRecommendedSkillKeys?: string[] | null;
    workbenchGrowthPendingTask?: GrowthPendingTaskContextView | null;
    workbenchGrowthContinueBannerVisible?: boolean;
    workbenchGrowthContinueSkippedEnhance?: boolean;
    onGroupProfileViewChange?: (view: GroupProfileView) => void;
    requestUpdate?: () => void;
  };

export function shouldShowGrowthPrelude(view: GrowthStatusView | null | undefined): boolean {
  if (!view) {
    return false;
  }
  if (typeof view.preludeDismissedAtMs === "number" && view.preludeDismissedAtMs > 0) {
    return false;
  }
  return view.lifecycleState === "birth" || view.lifecycleState === "growing";
}

export function withPreludeDismissed(view: GrowthStatusView, atMs = Date.now()): GrowthStatusView {
  return {
    ...view,
    preludeDismissedAtMs: atMs,
    funnel: {
      hasSessionOpened: view.funnel?.hasSessionOpened ?? false,
      hasIdentityCompleted: view.funnel?.hasIdentityCompleted ?? false,
      hasFirstSkillInstalled: view.funnel?.hasFirstSkillInstalled ?? false,
      hasFirstMissionSent: view.funnel?.hasFirstMissionSent ?? false,
      hasFirstMissionSuccess: view.funnel?.hasFirstMissionSuccess ?? false,
      preludeDismissed: true,
    },
    recommendation: EMPTY_NEXT_GROWTH_ACTION,
  };
}

function notifyHost(host: GrowthPreludeWireHost) {
  host.requestUpdate?.();
}

export function openGroupProfileView(host: GrowthPreludeWireHost, view: GroupProfileView) {
  host.workbenchPrimaryModule = "collaboration";
  if (host.onGroupProfileViewChange) {
    host.onGroupProfileViewChange(view);
    return;
  }
  host.workbenchGroupProfileView = view;
  notifyHost(host);
}

export async function dismissGrowthPrelude(host: GrowthPreludeWireHost): Promise<void> {
  const ref = resolveGrowthEntityFromSessionKey(host.sessionKey);
  if (!ref || !host.workbenchActiveGrowthStatus) {
    return;
  }
  const atMs = Date.now();
  host.workbenchActiveGrowthStatus = withPreludeDismissed(host.workbenchActiveGrowthStatus, atMs);
  notifyHost(host);
  const next = await recordGrowthMilestone(host, ref, "preludeDismissedAtMs", atMs);
  if (next) {
    host.workbenchActiveGrowthStatus =
      typeof next.preludeDismissedAtMs === "number" && next.preludeDismissedAtMs > 0
        ? next
        : withPreludeDismissed(next, atMs);
    notifyHost(host);
  }
}

function resolveRobotRoleName(host: GrowthPreludeWireHost, agentId: string): string {
  const agents = host.agentsList?.agents ?? [];
  const match = agents.find((entry) => entry.id === agentId);
  const identityName = typeof match?.identity?.name === "string" ? match.identity.name.trim() : "";
  const displayName = typeof match?.name === "string" ? match.name.trim() : "";
  return identityName || displayName || agentId;
}

function resolveGroupTitle(host: GrowthPreludeWireHost, groupId: string): string {
  const spaces = host.collaborationSpacesResult?.spaces ?? [];
  const match = spaces.find((space) => space.id === groupId || space.groupId === groupId);
  const title = typeof match?.title === "string" ? match.title.trim() : "";
  return title || groupId;
}

function focusComposer(host: GrowthPreludeWireHost, prefill?: string) {
  if (typeof prefill === "string" && prefill.trim()) {
    host.chatMessage = prefill.trim();
  }
  notifyHost(host);
  queueMicrotask(() => {
    const el = document.querySelector<HTMLElement>(
      "textarea, [contenteditable='true'], .chat-compose textarea, .composer textarea",
    );
    el?.focus?.();
  });
}

async function markPrimaryCta(host: GrowthPreludeWireHost, ref: GrowthEntityRef) {
  const next = await recordGrowthMilestone(host, ref, "firstCtaClickedAtMs");
  if (next) {
    host.workbenchActiveGrowthStatus = next;
  }
}

function applyPrimaryAction(
  host: GrowthPreludeWireHost,
  ref: GrowthEntityRef,
  action: NextGrowthActionView,
) {
  void markPrimaryCta(host, ref);
  switch (action.kind) {
    case "start_work":
      focusComposer(
        host,
        action.target.prefill ?? t("frontstage.workbench.growth.cta.firstTaskPrefill"),
      );
      return;
    case "verify_with_task":
      if (action.target.resumePendingTask === true) {
        showGrowthContinueBanner(host);
        return;
      }
      focusComposer(
        host,
        action.target.prefill ?? t("frontstage.workbench.growth.cta.firstTaskPrefill"),
      );
      return;
    case "confirm_identity":
      focusComposer(
        host,
        action.target.prefill ?? t("frontstage.workbench.growth.cta.identityPrefill"),
      );
      return;
    case "install_capabilities":
      void beginInstallCapabilitiesFlow(host, action.target.recommendedSkillKeys ?? []);
      return;
    default:
      return;
  }
}

function buildRobotPreludeHandlers(host: GrowthPreludeWireHost, ref: GrowthEntityRef) {
  return {
    onPrimaryAction: () => {
      const action = resolveGrowthRecommendation(host.workbenchActiveGrowthStatus);
      applyPrimaryAction(host, ref, action);
    },
    onStartCultivate: () => {
      host.workbenchGrowthPreferCultivate = true;
      void (async () => {
        const next = await loadGrowthStatus(host, ref, { preferCultivate: true });
        if (next) {
          host.workbenchActiveGrowthStatus = next;
          notifyHost(host);
        }
      })();
      notifyHost(host);
    },
    onDefineIdentity: () => {
      focusComposer(host, t("frontstage.workbench.growth.cta.identityPrefill"));
    },
    onInstallCapability: () => {
      const action = resolveGrowthRecommendation(host.workbenchActiveGrowthStatus);
      void beginInstallCapabilitiesFlow(host, action.target.recommendedSkillKeys ?? []);
    },
    onUploadKnowledge: () => {
      host.workbenchPrimaryModule = "knowledge";
      notifyHost(host);
    },
    onSetHabits: () => {
      host.workbenchPrimaryModule = "settings";
      notifyHost(host);
    },
    onDismiss: () => {
      const action = resolveGrowthRecommendation(host.workbenchActiveGrowthStatus);
      const hasDraft =
        Boolean(host.chatMessage.trim()) ||
        Boolean(host.workbenchGrowthPendingTask?.draftText?.trim()) ||
        Boolean(host.workbenchActiveGrowthStatus?.pendingTaskContext?.draftText?.trim());
      if (action.kind === "install_capabilities" && hasDraft) {
        skipEnhanceAndShowContinue(host);
      }
      void dismissGrowthPrelude(host);
    },
  };
}

/** 供续跑条 / 技能安装后回调使用。 */
export { resumeGrowthPendingTask, showGrowthContinueBanner, skipEnhanceAndShowContinue };

function buildTeamPreludeHandlers(host: GrowthPreludeWireHost) {
  const dismiss = () => {
    void dismissGrowthPrelude(host);
  };
  return {
    onStartCollaboration: dismiss,
    onDismiss: dismiss,
  };
}

function resolveGuidanceClient(host: GrowthPreludeWireHost): GuidanceOrchestratorClient {
  return host.client ?? {};
}

function buildRobotOrchestratedHandlers(
  host: GrowthPreludeWireHost,
  ref: GrowthEntityRef,
): OrchestratedGuidanceHandlers {
  const client = resolveGuidanceClient(host);
  const controls = getGuidanceUiControlState();
  const lifecycle = host.workbenchActiveGrowthStatus?.lifecycleState;
  const funnel = host.workbenchActiveGrowthStatus?.funnel;
  const canResume =
    Boolean(host.workbenchGrowthPendingTask) ||
    Boolean(funnel?.hasFirstMissionSent) ||
    (lifecycle != null && lifecycle !== "birth");
  return {
    acknowledgedKeys: controls.acknowledgedKeys,
    deferredUntilMsByKey: controls.deferredUntilMsByKey,
    highRiskPending: controls.highRiskPendingKey === guidanceScopeAckKey("robot", ref.entityId),
    showResume: canResume,
    showFailureRecover: canResume,
    onPrimary: (snapshot) => {
      void recordGuidanceMetricClient(client, snapshot, "guidance_primary_clicked");
      const action = resolveGrowthRecommendation(host.workbenchActiveGrowthStatus);
      applyPrimaryAction(host, ref, action);
    },
    onOptional: (snapshot, action) => {
      void recordGuidanceMetricClient(client, snapshot, "guidance_optional_clicked", {
        actionKind: action.kind,
      });
      if (action.kind === "start_cultivate") {
        host.workbenchGrowthPreferCultivate = true;
        void loadGrowthStatus(host, ref, { preferCultivate: true }).then((next) => {
          if (next) {
            host.workbenchActiveGrowthStatus = next;
            notifyHost(host);
          }
        });
        notifyHost(host);
        return;
      }
      if (action.kind === "steward_suggestion" || action.kind.startsWith("steward.")) {
        return;
      }
    },
    onAcknowledge: (snapshot) => {
      acknowledgeGuidanceSnapshot(snapshot);
      void recordGuidanceMetricClient(client, snapshot, "guidance_acknowledged");
      void dismissGrowthPrelude(host);
      notifyHost(host);
    },
    onDefer: (snapshot) => {
      deferGuidanceSnapshot(snapshot);
      void recordGuidanceMetricClient(client, snapshot, "guidance_deferred");
      void dismissGrowthPrelude(host);
      notifyHost(host);
    },
    onResume: (snapshot) => {
      void (async () => {
        const record = await readGuidanceProgressFromGateway(client, snapshot);
        void recordGuidanceMetricClient(client, snapshot, "guidance_resumed", {
          metadata: { fromGateway: true, hasRecord: Boolean(record) },
        });
        if (record && typeof record === "object") {
          const nextAction = (record as { nextAction?: { kind?: string } }).nextAction;
          if (nextAction?.kind && nextAction.kind !== "none") {
            applyPrimaryAction(
              host,
              ref,
              resolveGrowthRecommendation(host.workbenchActiveGrowthStatus),
            );
          }
        }
        notifyHost(host);
      })();
    },
    onFailureRecover: (snapshot) => {
      void recordGuidanceMetricClient(client, snapshot, "guidance_step_failed", {
        metadata: { recovered: true },
      });
      applyPrimaryAction(host, ref, resolveGrowthRecommendation(host.workbenchActiveGrowthStatus));
      notifyHost(host);
    },
    onRequestHighRiskConfirm: (snapshot) => {
      requestGuidanceHighRiskConfirm(snapshot);
      notifyHost(host);
    },
    onHighRiskConfirm: (snapshot) => {
      clearGuidanceHighRiskConfirm(snapshot);
      void recordGuidanceMetricClient(client, snapshot, "guidance_high_risk_confirmed");
      void recordGuidanceMetricClient(client, snapshot, "guidance_primary_clicked");
      applyPrimaryAction(host, ref, resolveGrowthRecommendation(host.workbenchActiveGrowthStatus));
      notifyHost(host);
    },
  };
}

function renderRobotPrelude(
  host: GrowthPreludeWireHost,
  ref: GrowthEntityRef,
  view: GrowthStatusView,
): TemplateResult | typeof nothing {
  const recommendation = resolveGrowthRecommendation(view);
  const optionalActions = [];
  if (recommendation.kind === "start_work") {
    optionalActions.push({
      kind: "start_cultivate",
      label: t("frontstage.workbench.growth.recommend.ctaCultivate"),
      reason: "guidance.optional.cultivate",
      canSkip: true,
      risk: "low" as const,
    });
  }
  const snapshot = buildRobotUiSnapshotFromGrowth({
    entityId: ref.entityId,
    lifecycleState: view.lifecycleState,
    recommendation,
    optionalActions,
  });
  const handlers = buildRobotOrchestratedHandlers(host, ref);
  void recordGuidanceShownOnce(resolveGuidanceClient(host), snapshot);
  const orchestratedPrimary = renderOrchestratedGuidanceSurface(snapshot, handlers);
  return renderRobotGrowthPrelude({
    view,
    roleName: resolveRobotRoleName(host, ref.entityId),
    recommendation,
    awakening: host.workbenchGrowthBirthAwakening === true,
    orchestratedPrimary,
    ...buildRobotPreludeHandlers(host, ref),
  });
}

function renderTeamPrelude(
  host: GrowthPreludeWireHost,
  ref: GrowthEntityRef,
  _view: GrowthStatusView,
): TemplateResult | typeof nothing {
  return renderTeamAwakeningPrelude({
    teamName: resolveGroupTitle(host, ref.entityId),
    ...buildTeamPreludeHandlers(host),
  });
}

/** 非大白机器人/小组会话：birth/growing onboarding prelude only（evolution 报告不进会话线程）。 */
export function renderWorkbenchGrowthThreadPrelude(
  host: GrowthPreludeWireHost,
): TemplateResult | typeof nothing {
  const ref = resolveGrowthEntityFromSessionKey(host.sessionKey);
  const view = host.workbenchActiveGrowthStatus;
  if (!ref || !view) {
    return nothing;
  }
  if (ref.kind === "robot") {
    const parsed = parseAgentSessionKey(host.sessionKey);
    if (parsed?.rest.startsWith("space:")) {
      return nothing;
    }
    if (!shouldShowGrowthPrelude(view)) {
      return nothing;
    }
    return renderRobotPrelude(host, ref, view);
  }
  if (!shouldShowGrowthPrelude(view)) {
    return nothing;
  }
  return renderTeamPrelude(host, ref, view);
}
