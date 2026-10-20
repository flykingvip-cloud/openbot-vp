export type CapabilityInstallPreflight = {
  capabilityId: string;
  status: string;
  nextStep: string;
  canInstall: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function normalizeCapabilityInstallPreflight(
  value: unknown,
): CapabilityInstallPreflight | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const nextStep = typeof record.nextStep === "string" ? record.nextStep.trim() : "";
  if (!nextStep) {
    return null;
  }
  return {
    capabilityId: typeof record.capabilityId === "string" ? record.capabilityId.trim() : "",
    status: typeof record.status === "string" ? record.status.trim() : "",
    nextStep,
    canInstall: record.canInstall !== false,
  };
}

export async function requestCapabilityInstallPreflight(
  client: { request: (method: string, params?: unknown) => Promise<unknown> },
  params: { agentId: string; capabilityId: string },
): Promise<CapabilityInstallPreflight | null> {
  try {
    const raw = await client.request("employee-capability.preflight", {
      agentId: params.agentId,
      capabilityId: params.capabilityId,
    });
    return normalizeCapabilityInstallPreflight(raw);
  } catch {
    // Backend install gate remains the source of truth if preflight is unavailable.
    return null;
  }
}
