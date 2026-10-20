import type { AppPortState } from "../../app-port-state.ts";

export function resetWorkbenchMemberGovernanceState(state: AppPortState) {
  state.workbenchMemberGovernanceDrawerOpen = false;
  state.workbenchMemberGovernanceGroupKey = null;
  state.workbenchMemberGovernanceTitle = "";
  state.workbenchMemberGovernancePrompt = "";
  state.workbenchMemberGovernanceBusy = false;
  state.workbenchMemberGovernanceInvitingHumanId = null;
  state.workbenchMemberGovernanceInvitingBotId = null;
  state.workbenchMemberGovernanceError = null;
  state.workbenchMemberGovernanceResult = null;
  state.workbenchMemberGovernanceCurrentHumans = [];
  state.workbenchMemberGovernanceCurrentBots = [];
  state.workbenchMemberGovernancePendingInvites = [];
  state.workbenchMemberGovernancePendingBotInvites = [];
  state.workbenchMemberGovernanceCandidateHumans = [];
  state.workbenchMemberGovernanceCandidateBots = [];
  state.workbenchMemberGovernanceSelectorKind = null;
  state.workbenchMemberGovernanceSearch = "";
  state.workbenchMemberGovernanceSelectedHumanIds = [];
  state.workbenchMemberGovernanceSelectedBotIds = [];
  state.workbenchCollaborationOrgBotDirectory = [];
}
