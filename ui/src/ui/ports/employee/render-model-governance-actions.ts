import type { AppPortState } from "../../app-port-state.ts";
import { closeCollaborationArtifactPreview } from "./collaboration-stage-panel-coordination.ts";
import {
  openEmployeeWorkbenchGovernanceObjectDetail,
  resetEmployeeWorkbenchGovernanceDetailState,
} from "./render-actions.ts";
import type { WorkbenchProps } from "./views/workbench-types.ts";

type GovernanceInteractionProps = Pick<
  WorkbenchProps,
  | "onGroupProfileViewChange"
  | "onOpenGovernanceObjectDetail"
  | "onDecisionOptionDraftChange"
  | "onDecisionRationaleDraftChange"
  | "onDecisionOptionTitleDraftChange"
  | "onAddDecisionOptionDraft"
  | "onRemoveDecisionOptionDraft"
  | "onSaveDecisionDraft"
  | "onTransitionGovernanceObject"
>;

type BuildEmployeeWorkbenchGovernanceInteractionPropsArgs = {
  state: AppPortState;
  initializeMemberGovernance: () => void;
  resetWorkbenchMemberGovernanceState: (state: AppPortState) => void;
  resolveActiveDecisionOptions: (state: AppPortState) => Array<{ optionId: string; title: string }>;
  createDraftDecisionOptionId: (options: Array<{ optionId: string; title: string }>) => string;
  requestWorkbenchRender: (state: AppPortState) => void;
};

export function buildEmployeeWorkbenchGovernanceInteractionProps({
  state,
  initializeMemberGovernance,
  resetWorkbenchMemberGovernanceState,
  resolveActiveDecisionOptions,
  createDraftDecisionOptionId,
  requestWorkbenchRender,
}: BuildEmployeeWorkbenchGovernanceInteractionPropsArgs): GovernanceInteractionProps {
  return {
    onGroupProfileViewChange: (view) => {
      if (view === "members") {
        closeCollaborationArtifactPreview(state);
        state.workbenchPrimaryModule = "collaboration";
        initializeMemberGovernance();
        state.workbenchGroupProfileView = "chat";
        state.workbenchMemberGovernanceDrawerOpen = true;
        requestWorkbenchRender(state);
        return;
      }
      state.workbenchGroupProfileView = view;
      if (view === "chat") {
        resetEmployeeWorkbenchGovernanceDetailState(state);
        state.resetCollaborationLearningSnapshot();
        state.resetCollaborationGovernanceActionState();
        state.workbenchMemberGovernanceDrawerOpen = false;
        resetWorkbenchMemberGovernanceState(state);
        requestWorkbenchRender(state);
        return;
      }
      if (
        view !== "task-detail" &&
        view !== "deliverable-detail" &&
        view !== "review-detail" &&
        view !== "decision-detail" &&
        view !== "capsule-detail"
      ) {
        resetEmployeeWorkbenchGovernanceDetailState(state);
      }
      state.resetCollaborationGovernanceActionState();
      requestWorkbenchRender(state);
      void state.loadCollaborationLearningSnapshot().then(() => requestWorkbenchRender(state));
      void state
        .loadCollaborationObservabilitySnapshot({
          force: true,
          // Capabilities / list views: group-level wake only. Task detail passes taskId.
          taskId: view === "task-detail" ? state.workbenchTaskDetailId : null,
        })
        .then(() => requestWorkbenchRender(state));
    },
    onOpenGovernanceObjectDetail: (kind, id) => {
      openEmployeeWorkbenchGovernanceObjectDetail(state, kind, id);
      state.resetCollaborationGovernanceActionState();
      void state.loadCollaborationLearningSnapshot();
      void state.loadCollaborationObservabilitySnapshot({
        force: true,
        taskId: kind === "task" ? id : undefined,
      });
    },
    onDecisionOptionDraftChange: (optionId) => {
      state.workbenchDecisionSelectedOptionDraft = optionId;
    },
    onDecisionRationaleDraftChange: (value) => {
      state.workbenchDecisionRationaleDraft = value;
    },
    onDecisionOptionTitleDraftChange: (optionId, value) => {
      const options = resolveActiveDecisionOptions(state);
      state.workbenchDecisionOptionsDraft = options.map((entry) =>
        entry.optionId === optionId ? { ...entry, title: value } : entry,
      );
    },
    onAddDecisionOptionDraft: () => {
      const options = resolveActiveDecisionOptions(state);
      state.workbenchDecisionOptionsDraft = [
        ...options,
        {
          optionId: createDraftDecisionOptionId(options),
          title: "New option",
        },
      ];
    },
    onRemoveDecisionOptionDraft: (optionId) => {
      const nextOptions = resolveActiveDecisionOptions(state).filter(
        (entry) => entry.optionId !== optionId,
      );
      if (nextOptions.length === 0) {
        return;
      }
      state.workbenchDecisionOptionsDraft = nextOptions;
      if (state.workbenchDecisionSelectedOptionDraft === optionId) {
        state.workbenchDecisionSelectedOptionDraft = null;
      }
    },
    onSaveDecisionDraft: (decisionId) => {
      void state.saveCollaborationDecisionDraft({
        id: decisionId,
        ...(state.workbenchDecisionRationaleDraft !== null
          ? { rationale: state.workbenchDecisionRationaleDraft }
          : {}),
        ...(state.workbenchDecisionSelectedOptionDraft !== null
          ? { selectedOption: state.workbenchDecisionSelectedOptionDraft }
          : {}),
        ...(state.workbenchDecisionOptionsDraft !== null
          ? { options: state.workbenchDecisionOptionsDraft }
          : {}),
      });
    },
    onTransitionGovernanceObject: (kind, id, toStatus, opts) => {
      void state.transitionCollaborationGovernanceObject({
        kind,
        id,
        toStatus,
        ...(opts?.selectedOption ? { selectedOption: opts.selectedOption } : {}),
        ...(opts?.handoff ? { handoff: opts.handoff } : {}),
      });
    },
  };
}
