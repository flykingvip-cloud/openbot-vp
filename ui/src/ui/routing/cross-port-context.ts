export type ControlPort = "platform" | "enterprise" | "ops";

export type FrontendPort = ControlPort | "employee";

export type CrossPortContext = {
  tenantId?: string;
  handoverCaseId?: string;
  agentId?: string;
  capabilityId?: string;
  enterpriseCapabilityRoute?: string;
  usageManagementRoute?: string;
  runtimeId?: string;
  executionId?: string;
  incidentId?: string;
  userId?: string;
  groupId?: string;
  sourcePort?: ControlPort;
  sourcePage?: string;
};

function trimContextValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeCrossPortContext(
  context: CrossPortContext | null | undefined,
): CrossPortContext | null {
  if (!context) {
    return null;
  }
  const normalized: CrossPortContext = {
    tenantId: trimContextValue(context.tenantId),
    handoverCaseId: trimContextValue(context.handoverCaseId),
    agentId: trimContextValue(context.agentId),
    capabilityId: trimContextValue(context.capabilityId),
    enterpriseCapabilityRoute: trimContextValue(context.enterpriseCapabilityRoute),
    usageManagementRoute: trimContextValue(context.usageManagementRoute),
    runtimeId: trimContextValue(context.runtimeId),
    executionId: trimContextValue(context.executionId),
    incidentId: trimContextValue(context.incidentId),
    userId: trimContextValue(context.userId),
    groupId: trimContextValue(context.groupId),
    sourcePort:
      context.sourcePort === "platform" ||
      context.sourcePort === "enterprise" ||
      context.sourcePort === "ops"
        ? context.sourcePort
        : undefined,
    sourcePage: trimContextValue(context.sourcePage),
  };
  return Object.values(normalized).some(Boolean) ? normalized : null;
}
