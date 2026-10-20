import {
  DEVICE_PLATFORM_DISABLED_DISPOSITION,
  type DeviceAssociation,
  type DeviceBinding,
  type DevicePlatformConnection,
  type DevicePlatformEnvironment,
  type ManagementOperation,
  type StatusProjection,
} from "./types.js";

export type UserBindingDto = {
  bindingId: string;
  digitalHumanId: string;
  scopes: string[];
  authorizationRef?: string;
  expectedBindingVersion: number;
  appliedBindingVersion: number;
  status: DeviceBinding["status"];
  authorizationEstablished: boolean;
  platformApplied: boolean;
};

export type UserDeviceDto = {
  deviceId: string;
  displayName: string;
  platformId: string;
  externalDeviceId: string;
  binding: UserBindingDto | null;
  status: {
    online: boolean;
    lastSeen?: string;
    capabilities: string[];
    firmware?: string;
    anomalySummary?: string;
  };
};

export type UserOperationDto = {
  operationId: string;
  kind: ManagementOperation["kind"];
  status: ManagementOperation["status"];
  progress: string;
  deviceId?: string;
  bindingId?: string;
  retryable: boolean;
  failure?: { code: string; message: string };
  disposition?: "accepted" | "duplicate";
  inflight?: boolean;
};

export type AdminConnectionDto = {
  platformId: string;
  displayName: string;
  environment: DevicePlatformEnvironment;
  serviceBaseUrl: string;
  contractVersion: string;
  credentialRef: string;
  clientIdentity: string;
  registrationNotes: string;
  callbackAllowlist: string[];
  serviceClientIds: string[];
  enabled: boolean;
  disabledDisposition: typeof DEVICE_PLATFORM_DISABLED_DISPOSITION;
  credentialPresent: boolean;
  credentialRotatedAt?: string;
  health: DevicePlatformConnection["health"];
  healthCheckedAt?: string;
  healthCode?: string;
  healthError?: string;
};

const USER_FORBIDDEN_KEYS = [
  "serviceBaseUrl",
  "credentialRef",
  "clientSecret",
  "serviceSecret",
  "devicePrivateKey",
  "vendorKey",
  "rawDiagnostics",
  "credentialHash",
  "authorizationCredential",
  "secret",
  "proof",
] as const;

export function toUserBindingDto(binding: DeviceBinding | undefined): UserBindingDto | null {
  if (!binding || binding.status === "revoked") {
    return null;
  }
  return {
    bindingId: binding.bindingId,
    digitalHumanId: binding.digitalHumanId,
    scopes: [...binding.scopes],
    ...(binding.authorizationRef ? { authorizationRef: binding.authorizationRef } : {}),
    expectedBindingVersion: binding.expectedBindingVersion,
    appliedBindingVersion: binding.appliedBindingVersion,
    status: binding.status,
    authorizationEstablished: binding.authorizationEstablished,
    platformApplied: binding.platformApplied,
  };
}

export function toUserDeviceDto(
  association: DeviceAssociation,
  binding: DeviceBinding | undefined,
  projection: StatusProjection | undefined,
): UserDeviceDto {
  return {
    deviceId: association.deviceId,
    displayName: association.displayName,
    platformId: association.platformId,
    externalDeviceId: association.externalDeviceId,
    binding: toUserBindingDto(binding),
    status: {
      online: projection?.online ?? false,
      ...(projection?.lastSeen ? { lastSeen: projection.lastSeen } : {}),
      capabilities: projection?.capabilities ? [...projection.capabilities] : [],
      ...(projection?.firmware ? { firmware: projection.firmware } : {}),
      ...(projection?.anomalySummary ? { anomalySummary: projection.anomalySummary } : {}),
    },
  };
}

export function toUserOperationDto(
  operation: ManagementOperation,
  extra?: { disposition?: "accepted" | "duplicate"; inflight?: boolean },
): UserOperationDto {
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    status: operation.status,
    progress: operation.progress,
    ...(operation.deviceId ? { deviceId: operation.deviceId } : {}),
    ...(operation.bindingId ? { bindingId: operation.bindingId } : {}),
    retryable: operation.retryable,
    ...(operation.failure ? { failure: { ...operation.failure } } : {}),
    ...(extra?.disposition ? { disposition: extra.disposition } : {}),
    ...(extra?.inflight ? { inflight: true } : {}),
  };
}

export function normalizeDevicePlatformConnection(
  connection: DevicePlatformConnection,
): DevicePlatformConnection {
  const environment = isEnvironment(connection.environment) ? connection.environment : "production";
  return {
    ...connection,
    displayName: connection.displayName?.trim() || connection.platformId,
    environment,
    clientIdentity: connection.clientIdentity?.trim() || connection.serviceClientIds[0] || "",
    registrationNotes: connection.registrationNotes ?? "",
    callbackAllowlist: Array.isArray(connection.callbackAllowlist)
      ? connection.callbackAllowlist.filter((item) => typeof item === "string")
      : [],
    disabledDisposition: DEVICE_PLATFORM_DISABLED_DISPOSITION,
    credentialPresent: Boolean(connection.credentialPresent),
  };
}

export function toAdminConnectionDto(connection: DevicePlatformConnection): AdminConnectionDto {
  const normalized = normalizeDevicePlatformConnection(connection);
  return {
    platformId: normalized.platformId,
    displayName: normalized.displayName,
    environment: normalized.environment,
    serviceBaseUrl: normalized.serviceBaseUrl,
    contractVersion: normalized.contractVersion,
    credentialRef: normalized.credentialRef,
    clientIdentity: normalized.clientIdentity,
    registrationNotes: normalized.registrationNotes,
    callbackAllowlist: [...normalized.callbackAllowlist],
    serviceClientIds: [...normalized.serviceClientIds],
    enabled: normalized.enabled,
    disabledDisposition: normalized.disabledDisposition,
    credentialPresent: normalized.credentialPresent,
    ...(normalized.credentialRotatedAt
      ? { credentialRotatedAt: normalized.credentialRotatedAt }
      : {}),
    health: normalized.health,
    ...(normalized.healthCheckedAt ? { healthCheckedAt: normalized.healthCheckedAt } : {}),
    ...(normalized.healthCode ? { healthCode: normalized.healthCode } : {}),
    ...(normalized.healthError ? { healthError: normalized.healthError } : {}),
  };
}

function isEnvironment(value: unknown): value is DevicePlatformEnvironment {
  return value === "production" || value === "staging" || value === "development";
}

export function assertNoForbiddenUserKeys(value: unknown): void {
  const found = collectKeys(value);
  for (const key of USER_FORBIDDEN_KEYS) {
    if (found.has(key)) {
      throw new Error(`User payload leaked ${key}`);
    }
  }
}

function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, found);
    }
    return found;
  }
  if (!value || typeof value !== "object") {
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    collectKeys(child, found);
  }
  return found;
}
