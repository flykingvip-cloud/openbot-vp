import type { AppPortState } from "../../app-port-state.ts";
import { resetWorkbenchMemberGovernanceState } from "./workbench-member-governance-state.ts";

/**
 * True when the collaboration stage preview sidebar is showing any surface
 * (成果 artifact / 电脑 computer / markdown preview with workspace).
 * Used for mutual exclusion with the docked member-governance drawer.
 */
export function isCollaborationArtifactPreviewOpen(state: AppPortState): boolean {
  if (!state.sidebarOpen) {
    return false;
  }
  // Computer tab is a preview surface even when previewMode is not "artifact".
  if (state.sidebarSurface === "computer") {
    return true;
  }
  return state.sidebarPreviewMode === "artifact" || state.sidebarArtifactWorkspace != null;
}

/** Close any open collaboration preview sidebar (成果 / 电脑 / artifact workspace). */
export function closeCollaborationArtifactPreview(state: AppPortState): void {
  if (isCollaborationArtifactPreviewOpen(state) || Boolean(state.sidebarOpen)) {
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
