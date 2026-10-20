export type ModelPolicy = {
  policyId: string;
  subject: "platform" | "agent" | "tool";
  model: string;
  scope: {
    tenantIds?: string[];
    agentIds?: string[];
  };
};

export type AccessPolicy = {
  policyId: string;
  subjectType: "tenant" | "user" | "group" | "agent";
  subjectId: string;
  rules: string[];
};
