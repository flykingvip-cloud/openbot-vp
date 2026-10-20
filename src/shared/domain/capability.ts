export type CapabilityType = "skill" | "tool" | "integration";

export type CapabilityStatus = "available" | "installed" | "misconfigured";

export type Capability = {
  capabilityId: string;
  name: string;
  type: CapabilityType;
  status: CapabilityStatus;
  version: string;
};

export type CapabilityBinding = {
  agentId: string;
  capabilityId: string;
  enabled: boolean;
};
