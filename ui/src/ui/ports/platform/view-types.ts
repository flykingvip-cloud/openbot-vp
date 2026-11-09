import type { renderChannels } from "../../views/channels.ts";
import type { renderConsoleSubnav } from "../../views/console-subnav.ts";
import type { InstancesProps } from "../../views/instances.ts";
import type { renderLogs } from "../../views/logs.ts";
import type { NodesProps } from "../../views/nodes.ts";
import type { OperationalIdentityGovernancePanelProps } from "../../views/operational-identity-governance-panel.ts";
import type { PlatformAuthPanelProps } from "../../views/platform-auth-panel.ts";
import type { renderSessions } from "../../views/sessions.ts";
import type { SkillsProps } from "../../views/skills.ts";
import type { PlatformPortState } from "./port-state.ts";
import type { PlatformPortActions } from "./render-actions.ts";
import type { PlatformPortReadModel } from "./semantic/platform-read-model.ts";
import type { PlatformPageViewModels } from "./view-models/types.ts";

export type PlatformPortTenantsActions = PlatformPortActions["tenants"] & {
  onApproveTrialApplication: (input: {
    applicationId: string;
    trialDays?: number;
    seatCount?: number;
    reviewNote?: string;
  }) => Promise<void>;
  onRejectTrialApplication: (input: {
    applicationId: string;
    rejectionReason: string;
    reviewNote?: string;
  }) => Promise<void>;
  onUpdateTrialInstance: (input: {
    enterpriseId: string;
    trialDays?: number;
    seatCount?: number;
  }) => Promise<boolean>;
  onUpdateEnterpriseAdmin: (input: {
    enterpriseId: string;
    adminName: string;
    adminEmail: string;
    resendActivation?: boolean;
  }) => Promise<boolean>;
  onResendEnterpriseAdminActivation: (input: { enterpriseId: string }) => Promise<boolean>;
};

export type PlatformPortRenderModel = {
  state: PlatformPortState;
  subnavProps: Parameters<typeof renderConsoleSubnav>[0];
  readModel: PlatformPortReadModel;
  observationHost?: object | null;
  channelsProps: Parameters<typeof renderChannels>[0];
  skillsProps: SkillsProps | null;
  instancesProps: InstancesProps | null;
  nodesProps: NodesProps | null;
  sessionsProps: Parameters<typeof renderSessions>[0] | null;
  logsProps: Parameters<typeof renderLogs>[0] | null;
  authPanelProps?: PlatformAuthPanelProps | null;
  operationalIdentityGovernancePanel: OperationalIdentityGovernancePanelProps;
  pageViewModels: PlatformPageViewModels;
  surfaceActions: Pick<
    PlatformPortActions,
    | "dashboard"
    | "capabilities"
    | "models"
    | "platformAgents"
    | "advanced"
    | "systemSettings"
    | "skills"
    | "instances"
  > & {
    tenants: PlatformPortTenantsActions;
  };
};
