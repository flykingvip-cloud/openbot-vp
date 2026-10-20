import type {
  AppViewAutomationState,
  AppViewOperationsState,
  AppViewWorkbenchState,
} from "../app-view-state-shell-slices.ts";
import type { AppViewState } from "../app-view-state.ts";
import type {
  AgentFilesCapabilityContentState,
  AgentFilesCapabilityListState,
  AgentFilesCapabilitySaveState,
} from "./agent-files/index.ts";
import type { AgentIdentityCapabilityLoadState } from "./agent-identity/index.ts";
import type { AgentRuntimeCapabilityOverviewState } from "./agent-runtime/index.ts";
import type { AgentSkillsCapabilityLoadState } from "./agent-skills/index.ts";
import type {
  AgentsCapabilityConfigSaveState,
  AgentsCapabilityLoadState,
  AgentsCapabilityToolsState,
} from "./agents/index.ts";
import type {
  AppViewCapabilityState,
  AppViewChannelsCapabilityState,
  AppViewChatCapabilityState,
  AppViewGatewayCapabilityState,
  AppViewSessionsCapabilityState,
} from "./app-view-state-slices.ts";
import type { AssistantIdentityCapabilityLoadState } from "./assistant-identity/index.ts";
import type {
  ChannelsCapabilityLoadState,
  ChannelsCapabilityWhatsAppAuthState,
} from "./channels/index.ts";
import type {
  ChatCapabilityAbortState,
  ChatCapabilityEventState,
  ChatCapabilityHistoryState,
  ChatCapabilitySendState,
} from "./chat/index.ts";
import type {
  ConfigCapabilityApplyState,
  ConfigCapabilityFormState,
  ConfigCapabilityLoadState,
  ConfigCapabilitySaveState,
  ConfigCapabilitySchemaState,
  ConfigCapabilityUpdateState,
} from "./config/index.ts";
import type {
  CronCapabilityFormState,
  CronCapabilityJobsState,
  CronCapabilityManageState,
  CronCapabilityModelSuggestionsState,
  CronCapabilityRunsState,
  CronCapabilityStatusState,
} from "./cron/index.ts";
import type { DebugCapabilityCallState, DebugCapabilityLoadState } from "./debug/index.ts";
import type { DevicesCapabilityLoadState, DevicesCapabilityManageState } from "./devices/index.ts";
import type { ExecApprovalCapabilityEventState } from "./exec-approval/index.ts";
import type {
  ExecApprovalsCapabilityFormState,
  ExecApprovalsCapabilityLoadState,
  ExecApprovalsCapabilitySaveState,
} from "./exec-approvals/index.ts";
import type { GatewayCapabilityHost } from "./gateway/index.ts";
import type { LocalFileApprovalCapabilityEventState } from "./local-file-approval/index.ts";
import type { LogsCapabilityLoadState } from "./logs/index.ts";
import type { NodesCapabilityLoadState } from "./nodes/index.ts";
import type { PresenceCapabilityLoadState } from "./presence/index.ts";
import type {
  SessionsCapabilityLoadState,
  SessionsCapabilityManageState,
} from "./sessions/index.ts";
import type { SkillsCapabilityLoadState, SkillsCapabilityManageState } from "./skills/index.ts";
import type { SpacesCapabilityLoadState, SpacesCapabilityManageState } from "./spaces/index.ts";

export type GatewayCapabilityViewState = AppViewGatewayCapabilityState;
export type AgentsCapabilityViewState = AgentsCapabilityLoadState &
  AgentsCapabilityToolsState &
  Pick<AppViewOperationsState, "agentsPanel"> &
  AgentsCapabilityConfigSaveState;
export type AgentRuntimeCapabilityViewState = AgentRuntimeCapabilityOverviewState;
export type AssistantIdentityCapabilityViewState = AssistantIdentityCapabilityLoadState;
export type ConfigCapabilityViewState = ConfigCapabilityLoadState &
  ConfigCapabilitySchemaState &
  ConfigCapabilityFormState &
  ConfigCapabilitySaveState &
  ConfigCapabilityApplyState &
  ConfigCapabilityUpdateState;
export type ChannelsCapabilityViewState = ChannelsCapabilityLoadState &
  ChannelsCapabilityWhatsAppAuthState &
  Pick<AppViewChannelsCapabilityState, "nostrProfileFormState" | "nostrProfileAccountId">;
export type ChatCapabilityViewState = AppViewChatCapabilityState;
export type SessionsCapabilityViewState = SessionsCapabilityLoadState &
  Pick<AppViewSessionsCapabilityState, "sessionsHideCron">;
export type SpacesCapabilityViewState = SpacesCapabilityLoadState;
export type PresenceCapabilityViewState = PresenceCapabilityLoadState;
export type ExecApprovalCapabilityViewState = ExecApprovalCapabilityEventState;
export type ExecApprovalsCapabilityViewState = ExecApprovalsCapabilityLoadState &
  ExecApprovalsCapabilitySaveState &
  ExecApprovalsCapabilityFormState;
export type SkillsCapabilityViewState = SkillsCapabilityLoadState & SkillsCapabilityManageState;
export type CronCapabilityViewState = CronCapabilityStatusState &
  CronCapabilityModelSuggestionsState &
  CronCapabilityJobsState &
  CronCapabilityRunsState &
  CronCapabilityManageState &
  CronCapabilityFormState;

export type WorkbenchCapabilityViewState = Pick<
  AppViewCapabilityState,
  "settings" | "connected" | "sessionKey" | "channelsSnapshot"
> &
  Pick<AppViewOperationsState, "agentsList" | "presenceEntries"> &
  Pick<AppViewAutomationState, "cronStatus"> &
  AppViewWorkbenchState;

/**
 * Transitional descriptor for the state seams we want to preserve while
 * breaking `AppViewState` apart.
 *
 * This file intentionally describes slices only. It does not move runtime
 * ownership yet.
 */
export type AppCapabilitySlices = {
  gateway: GatewayCapabilityViewState;
  agents: AgentsCapabilityViewState;
  assistantIdentity: AssistantIdentityCapabilityViewState;
  config: ConfigCapabilityViewState;
  channels: ChannelsCapabilityViewState;
  chat: ChatCapabilityViewState;
  sessions: SessionsCapabilityViewState;
  spaces: SpacesCapabilityViewState;
  presence: PresenceCapabilityViewState;
  execApproval: ExecApprovalCapabilityViewState;
  execApprovals: ExecApprovalsCapabilityViewState;
  skills: SkillsCapabilityViewState;
  cron: CronCapabilityViewState;
  workbench: WorkbenchCapabilityViewState;
};

/**
 * Transitional runtime adapters for capability-facing state.
 *
 * These helpers intentionally centralize the current structural casts so the
 * migration away from `AppViewState` does not leave ad-hoc `as unknown as ...`
 * assertions scattered through the render and lifecycle layers.
 */
export function adaptGatewayCapabilityHost(value: object): GatewayCapabilityHost {
  return value as GatewayCapabilityHost;
}

export function adaptAgentsLoadCapabilityState(value: object): AgentsCapabilityLoadState {
  return value as AgentsCapabilityLoadState;
}

export function adaptAgentsToolsCapabilityState(value: object): AgentsCapabilityToolsState {
  return value as AgentsCapabilityToolsState;
}

export function adaptAgentsConfigSaveCapabilityState(
  value: object,
): AgentsCapabilityConfigSaveState {
  return value as AgentsCapabilityConfigSaveState;
}

export function adaptAgentRuntimeOverviewCapabilityState(
  value: object,
): AgentRuntimeCapabilityOverviewState {
  return value as AgentRuntimeCapabilityOverviewState;
}

export function adaptAgentIdentityLoadCapabilityState(
  value: object,
): AgentIdentityCapabilityLoadState {
  return value as AgentIdentityCapabilityLoadState;
}

export function adaptAssistantIdentityLoadCapabilityState(
  value: object,
): AssistantIdentityCapabilityLoadState {
  return value as AssistantIdentityCapabilityLoadState;
}

export function adaptAgentSkillsLoadCapabilityState(value: object): AgentSkillsCapabilityLoadState {
  return value as AgentSkillsCapabilityLoadState;
}

export function adaptAgentFilesListCapabilityState(value: object): AgentFilesCapabilityListState {
  return value as AgentFilesCapabilityListState;
}

export function adaptAgentFilesContentCapabilityState(
  value: object,
): AgentFilesCapabilityContentState {
  return value as AgentFilesCapabilityContentState;
}

export function adaptAgentFilesSaveCapabilityState(value: object): AgentFilesCapabilitySaveState {
  return value as AgentFilesCapabilitySaveState;
}

export function adaptDebugLoadCapabilityState(value: object): DebugCapabilityLoadState {
  return value as DebugCapabilityLoadState;
}

export function adaptDebugCallCapabilityState(value: object): DebugCapabilityCallState {
  return value as DebugCapabilityCallState;
}

export function adaptLogsLoadCapabilityState(value: object): LogsCapabilityLoadState {
  return value as LogsCapabilityLoadState;
}

export function adaptNodesLoadCapabilityState(value: object): NodesCapabilityLoadState {
  return value as NodesCapabilityLoadState;
}

export function adaptPresenceLoadCapabilityState(value: object): PresenceCapabilityLoadState {
  return value as PresenceCapabilityLoadState;
}

export function adaptExecApprovalEventCapabilityState(
  value: object,
): ExecApprovalCapabilityEventState {
  return value as ExecApprovalCapabilityEventState;
}

export function adaptLocalFileApprovalEventCapabilityState(
  value: object,
): LocalFileApprovalCapabilityEventState {
  return value as LocalFileApprovalCapabilityEventState;
}

export function adaptDevicesLoadCapabilityState(value: object): DevicesCapabilityLoadState {
  return value as DevicesCapabilityLoadState;
}

export function adaptDevicesManageCapabilityState(value: object): DevicesCapabilityManageState {
  return value as DevicesCapabilityManageState;
}

export function adaptExecApprovalsLoadCapabilityState(
  value: object,
): ExecApprovalsCapabilityLoadState {
  return value as ExecApprovalsCapabilityLoadState;
}

export function adaptExecApprovalsSaveCapabilityState(
  value: object,
): ExecApprovalsCapabilitySaveState {
  return value as ExecApprovalsCapabilitySaveState;
}

export function adaptExecApprovalsFormCapabilityState(
  value: object,
): ExecApprovalsCapabilityFormState {
  return value as ExecApprovalsCapabilityFormState;
}

export function adaptGatewayCapabilityViewState(value: object): GatewayCapabilityViewState {
  return value as GatewayCapabilityViewState;
}

export function adaptConfigLoadCapabilityState(value: object): ConfigCapabilityLoadState {
  return value as ConfigCapabilityLoadState;
}

export function adaptConfigSchemaCapabilityState(value: object): ConfigCapabilitySchemaState {
  return value as ConfigCapabilitySchemaState;
}

export function adaptConfigFormCapabilityState(value: object): ConfigCapabilityFormState {
  return value as ConfigCapabilityFormState;
}

export function adaptConfigSaveCapabilityState(value: object): ConfigCapabilitySaveState {
  return value as ConfigCapabilitySaveState;
}

export function adaptConfigApplyCapabilityState(value: object): ConfigCapabilityApplyState {
  return value as ConfigCapabilityApplyState;
}

export function adaptConfigUpdateCapabilityState(value: object): ConfigCapabilityUpdateState {
  return value as ConfigCapabilityUpdateState;
}

export function adaptCronStatusCapabilityState(value: object): CronCapabilityStatusState {
  return value as CronCapabilityStatusState;
}

export function adaptCronModelSuggestionsCapabilityState(
  value: object,
): CronCapabilityModelSuggestionsState {
  return value as CronCapabilityModelSuggestionsState;
}

export function adaptCronJobsCapabilityState(value: object): CronCapabilityJobsState {
  return value as CronCapabilityJobsState;
}

export function adaptCronRunsCapabilityState(value: object): CronCapabilityRunsState {
  return value as CronCapabilityRunsState;
}

export function adaptCronManageCapabilityState(value: object): CronCapabilityManageState {
  return value as CronCapabilityManageState;
}

export function adaptCronFormCapabilityState(value: object): CronCapabilityFormState {
  return value as CronCapabilityFormState;
}

export function adaptChannelsLoadCapabilityState(value: object): ChannelsCapabilityLoadState {
  return value as ChannelsCapabilityLoadState;
}

export function adaptChannelsWhatsAppAuthCapabilityState(
  value: object,
): ChannelsCapabilityWhatsAppAuthState {
  return value as ChannelsCapabilityWhatsAppAuthState;
}

export function adaptChatHistoryCapabilityState(value: object): ChatCapabilityHistoryState {
  return value as ChatCapabilityHistoryState;
}

export function adaptChatSendCapabilityState(value: object): ChatCapabilitySendState {
  return value as ChatCapabilitySendState;
}

export function adaptChatAbortCapabilityState(value: object): ChatCapabilityAbortState {
  return value as ChatCapabilityAbortState;
}

export function adaptChatEventCapabilityState(value: object): ChatCapabilityEventState {
  const host = value as ChatCapabilityEventState & {
    hello?: { snapshot?: { sessionDefaults?: { mainSessionKey?: string } } } | null;
  };
  const fromHello = host.hello?.snapshot?.sessionDefaults?.mainSessionKey?.trim();
  // Write onto the live Lit host. A shallow copy would make handleChatEvent
  // mutate a throwaway object, so the current window stays on waiting.
  if (fromHello && !host.stewardMainSessionKey?.trim()) {
    host.stewardMainSessionKey = fromHello;
  }
  return host;
}

export function adaptChatCapabilityViewState(value: object): ChatCapabilityViewState {
  return value as ChatCapabilityViewState;
}

export function adaptSessionsLoadCapabilityState(value: object): SessionsCapabilityLoadState {
  return value as SessionsCapabilityLoadState;
}

export function adaptSessionsManageCapabilityState(value: object): SessionsCapabilityManageState {
  return value as SessionsCapabilityManageState;
}

export function adaptSpacesLoadCapabilityState(value: object): SpacesCapabilityLoadState {
  return value as SpacesCapabilityLoadState;
}

export function adaptSpacesManageCapabilityState(value: object): SpacesCapabilityManageState {
  return value as SpacesCapabilityManageState;
}

export function adaptSkillsLoadCapabilityState(value: object): SkillsCapabilityLoadState {
  return value as SkillsCapabilityLoadState;
}

export function adaptSkillsManageCapabilityState(value: object): SkillsCapabilityManageState {
  return value as SkillsCapabilityManageState;
}

export function adaptAppCapabilitySlices(value: AppViewState): AppCapabilitySlices {
  return {
    gateway: adaptGatewayCapabilityViewState(value),
    agents: value,
    assistantIdentity: value,
    config: value,
    channels: value,
    chat: adaptChatCapabilityViewState(value),
    sessions: value,
    spaces: value,
    presence: value,
    execApproval: value,
    execApprovals: value,
    skills: value,
    cron: value,
    workbench: value,
  };
}
