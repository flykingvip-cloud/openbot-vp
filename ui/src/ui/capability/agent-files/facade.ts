import {
  loadAgentFileContent,
  loadAgentFiles,
  saveAgentFile,
  type AgentFilesContentState,
  type AgentFilesListState,
  type AgentFilesSaveState,
} from "../../controllers/agent-files.ts";

export type AgentFilesCapabilityListState = AgentFilesListState;
export type AgentFilesCapabilityContentState = AgentFilesContentState;
export type AgentFilesCapabilitySaveState = AgentFilesSaveState;

export const agentFilesCapability = {
  load: loadAgentFiles,
  loadContent: loadAgentFileContent,
  save: saveAgentFile,
} as const;
