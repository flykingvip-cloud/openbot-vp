import type { AppPortState } from "../../app-port-state.ts";
import { resetEmployeeWorkbenchGovernanceDetailState } from "./render-actions.ts";
import type { WorkbenchAuthorizationIdentityTab } from "./views/workbench-types.ts";

export type OpenPersonalOperationalIdentityOptions = {
  openEditor?: boolean;
  agentId?: string;
  provider?: string;
  scroll?: boolean;
  authorizationIdentityTab?: WorkbenchAuthorizationIdentityTab;
};

export const OPERATIONAL_IDENTITY_SECTION_ID = "operational-identity";
export const ENTERPRISE_OPERATIONAL_IDENTITY_SECTION_ID = "enterprise-operational-identity";

function queueSectionScrollIntoView(sectionId: string) {
  if (typeof window === "undefined") {
    return;
  }
  const attempt = (retriesLeft: number) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (retriesLeft > 0) {
      window.setTimeout(() => attempt(retriesLeft - 1), 50);
    }
  };
  window.requestAnimationFrame(() => attempt(10));
}

function queueOperationalIdentityScrollIntoView(tab: WorkbenchAuthorizationIdentityTab) {
  queueSectionScrollIntoView(
    tab === "enterprise"
      ? ENTERPRISE_OPERATIONAL_IDENTITY_SECTION_ID
      : OPERATIONAL_IDENTITY_SECTION_ID,
  );
}

export function openPersonalOperationalIdentitySection(
  state: AppPortState,
  options?: OpenPersonalOperationalIdentityOptions,
  requestRender?: (state: AppPortState) => void,
) {
  state.workbenchPrimaryModule = "settings";
  state.workbenchSettingsView = "personal";
  state.workbenchPersonalSettingsTab = "authorization";
  state.workbenchGroupProfileView = "chat";
  resetEmployeeWorkbenchGovernanceDetailState(state);
  state.resetCollaborationLearningSnapshot();
  state.resetCollaborationGovernanceActionState();

  const agentId = options?.agentId?.trim() || "";
  state.userOperationalIdentityReturnAgentId = agentId || null;

  if (options?.authorizationIdentityTab) {
    state.workbenchPersonalAuthorizationIdentityTab = options.authorizationIdentityTab;
  }

  if (options?.openEditor) {
    state.openUserOperationalIdentityEditor(options?.provider);
  }

  void state.loadUserOperationalIdentities();
  if (agentId) {
    void state.syncEmployeeEnterpriseIdentityAccess([agentId]);
  } else {
    const ownedAgentIds = (state.agentsList?.agents ?? [])
      .map((entry) => entry.id.trim())
      .filter(Boolean);
    if (ownedAgentIds.length > 0) {
      void state.syncEmployeeEnterpriseIdentityAccess(ownedAgentIds);
    }
  }
  requestRender?.(state);

  if (options?.scroll !== false) {
    queueOperationalIdentityScrollIntoView(
      options?.authorizationIdentityTab ??
        state.workbenchPersonalAuthorizationIdentityTab ??
        "personal",
    );
  }
}

export function returnToRobotOperationalIdentityGrant(
  state: AppPortState,
  requestRender?: (state: AppPortState) => void,
) {
  const agentId = state.userOperationalIdentityReturnAgentId?.trim() || "";
  if (!agentId) {
    return false;
  }
  state.userOperationalIdentityReturnAgentId = null;
  state.workbenchPrimaryModule = "settings";
  state.workbenchSettingsView = "system";
  state.workbenchSystemSettingsTab = "robots";
  state.workbenchRobotIdentityGrantFocusAgentId = agentId;
  requestRender?.(state);
  return true;
}
