import type {
  CapabilityPreflightResponse,
  HealthLabelSubscribeResponse,
  InstallToRobotResponse,
  MyAccumulationResponse,
  QuickSaveResponse,
  RecommendationsResponse,
  UpdateRecapResponse,
  UsageBriefResponse,
} from "./endpoints.ts";

export type EmployeeCapabilityGateway = {
  quickSave: (req: {
    name: string;
    summary: string;
    sourceAgentId: string;
    sourceContextId: string;
    patternHint?: {
      sampleTaskDescription: string;
      firstFormedScenario: string;
    } | null;
  }) => Promise<QuickSaveResponse>;
  myAccumulation: (req: {
    searchQuery?: string;
    filterTag?: string | null;
    filterCategory?: string | null;
    filterSource?: string | null;
    filterShareVisibility?: string | null;
  }) => Promise<MyAccumulationResponse>;
  recommendations: (req: { agentId: string }) => Promise<RecommendationsResponse>;
  preflight: (req: {
    agentId: string;
    capabilityId: string;
  }) => Promise<CapabilityPreflightResponse>;
  installToRobot: (req: {
    capabilityId: string;
    agentId: string;
  }) => Promise<InstallToRobotResponse>;
  removeFromRobot: (req: {
    capabilityId: string;
    agentId: string;
  }) => Promise<{ capabilityId: string; agentId: string }>;
  usageBrief: (req: { capabilityId: string }) => Promise<UsageBriefResponse>;
  healthLabelSubscribe: (req: { capabilityIds: string[] }) => Promise<HealthLabelSubscribeResponse>;
  updateRecap: (req: { capabilityId: string }) => Promise<UpdateRecapResponse>;
};
