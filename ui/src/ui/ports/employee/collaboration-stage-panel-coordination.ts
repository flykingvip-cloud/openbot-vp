import type { AppPortState } from "../../app-port-state.ts";
import { resetWorkbenchMemberGovernanceState } from "./workbench-member-governance-state.ts";

export function isCollaborationArtifactPreviewOpen(state: AppPortState): boolean {
  return (
    Boolean(state.sidebarOpen) &&
    (state.sidebarPreviewMode === "artifact" || state.sidebarArtifactWorkspace != null)
  );
}

export function closeCollaborationArtifactPreview(state: AppPortState): void {
  if (isCollaborationArtifactPreviewOpen(state)) {
    state.handleCloseSidebar();
  }
}

export function closeCollaborationMemberGovernanceDrawer(state: AppPortState): void {
  if (!state.workbenchMemberGovernanceDrawerOpen) {
    return;
  }
  state.workbenchGroupProfileView = "chat";
  resetWorkbenchMemberGovernanceState(state);
}
