import { describe, expect, it, vi } from "vitest";
import {
  ENTERPRISE_OPERATIONAL_IDENTITY_SECTION_ID,
  OPERATIONAL_IDENTITY_SECTION_ID,
  openPersonalOperationalIdentitySection,
  returnToRobotOperationalIdentityGrant,
} from "./operational-identity-navigation.ts";

type OperationalIdentityNavigationState = Parameters<
  typeof openPersonalOperationalIdentitySection
>[0];

function createState(): OperationalIdentityNavigationState {
  return {
    workbenchPrimaryModule: "assistant",
    workbenchSettingsView: "system",
    workbenchGroupProfileView: "chat",
    workbenchSystemSettingsTab: "security",
    workbenchPersonalSettingsTab: "account",
    workbenchPersonalAuthorizationIdentityTab: "personal",
    userOperationalIdentityReturnAgentId: null,
    workbenchRobotIdentityGrantFocusAgentId: null,
    userOperationalIdentityEditorOpen: false,
    openUserOperationalIdentityEditor: vi.fn(
      function (this: { userOperationalIdentityEditorOpen: boolean }) {
        this.userOperationalIdentityEditorOpen = true;
      },
    ),
    syncEmployeeEnterpriseIdentityAccess: vi.fn(async () => undefined),
    loadUserOperationalIdentities: vi.fn(async () => null),
    resetCollaborationLearningSnapshot: vi.fn(),
    resetCollaborationGovernanceActionState: vi.fn(),
    requestUpdate: vi.fn(),
  } as unknown as OperationalIdentityNavigationState;
}

describe("operational-identity-navigation", () => {
  it("opens personal settings and optional editor for identity binding", () => {
    const state = createState();
    const requestRender = vi.fn();

    openPersonalOperationalIdentitySection(
      state,
      { openEditor: true, agentId: "main", provider: "personal-email", scroll: false },
      requestRender,
    );

    expect(state.workbenchPrimaryModule).toBe("settings");
    expect(state.workbenchSettingsView).toBe("personal");
    expect(state.workbenchPersonalSettingsTab).toBe("authorization");
    expect(state.userOperationalIdentityReturnAgentId).toBe("main");
    expect(state.openUserOperationalIdentityEditor).toHaveBeenCalledTimes(1);
    expect(state.openUserOperationalIdentityEditor).toHaveBeenCalledWith("personal-email");
    expect(state.loadUserOperationalIdentities).toHaveBeenCalledTimes(1);
    expect(state.syncEmployeeEnterpriseIdentityAccess).toHaveBeenCalledWith(["main"]);
    expect(requestRender).toHaveBeenCalledWith(state);
  });

  it("returns to robots tab when agent context is set", () => {
    const state = createState();
    state.userOperationalIdentityReturnAgentId = "main";
    const requestRender = vi.fn();

    const returned = returnToRobotOperationalIdentityGrant(state, requestRender);

    expect(returned).toBe(true);
    expect(state.workbenchSettingsView).toBe("system");
    expect(state.workbenchSystemSettingsTab).toBe("robots");
    expect(state.workbenchRobotIdentityGrantFocusAgentId).toBe("main");
    expect(state.userOperationalIdentityReturnAgentId).toBeNull();
    expect(requestRender).toHaveBeenCalledWith(state);
  });

  it("opens enterprise authorization tab when requested", () => {
    const state = createState();
    const requestRender = vi.fn();

    openPersonalOperationalIdentitySection(
      state,
      { agentId: "main", authorizationIdentityTab: "enterprise", scroll: false },
      requestRender,
    );

    expect(state.workbenchPersonalAuthorizationIdentityTab).toBe("enterprise");
    expect(state.workbenchPersonalSettingsTab).toBe("authorization");
    expect(state.syncEmployeeEnterpriseIdentityAccess).toHaveBeenCalledWith(["main"]);
  });

  it("exports stable section anchor ids", () => {
    expect(OPERATIONAL_IDENTITY_SECTION_ID).toBe("operational-identity");
    expect(ENTERPRISE_OPERATIONAL_IDENTITY_SECTION_ID).toBe("enterprise-operational-identity");
  });
});
