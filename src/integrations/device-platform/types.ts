/**
 * Shared device-platform management records.
 * Personal settings and the digital-human detail page use this one model.
 * Field names here are management records, not the frozen integrations v1 contract.
 */

export const DEVICE_PLATFORM_SCHEMA_VERSION = 1;
export const DEVICE_PLATFORM_API_PREFIX = "/api/device-platform/v1";
export const DEVICE_PLATFORM_CONTROL_CONTRACT = "openbot.device-platform.control.v1";

export const DEVICE_PLATFORM_ENVIRONMENTS = ["production", "staging", "development"] as const;
export type DevicePlatformEnvironment = (typeof DEVICE_PLATFORM_ENVIRONMENTS)[number];

/** Disable blocks new grants and executions. Existing bindings stay until the user revokes them. */
export const DEVICE_PLATFORM_DISABLED_DISPOSITION = "block_new_keep_existing" as const;

export const BINDING_STATUSES = [
  "pending_pair",
  "pending_auth",
  "applying",
  "active",
  "error",
  "revoking",
  "revoked",
] as const;

export type BindingStatus = (typeof BINDING_STATUSES)[number];

/** Foreground lifecycle. Revoked rows are history and do not occupy the device. */
export const FOREGROUND_BINDING_STATUSES: ReadonlySet<BindingStatus> = new Set([
  "pending_pair",
  "pending_auth",
  "applying",
  "active",
  "error",
  "revoking",
]);

export type OperationKind = "add" | "rebind" | "revoke";

export type OperationStatus = "reserved" | "in_progress" | "succeeded" | "failed" | "interrupted";

export type DevicePlatformConnection = {
  platformId: string;
  /** Operator-facing name. The stable id stays `platformId`. */
  displayName: string;
  environment: DevicePlatformEnvironment;
  serviceBaseUrl: string;
  contractVersion: string;
  /** Vault or config reference. Never a raw secret. */
  credentialRef: string;
  /** Service Basic username. Not a secret. */
  clientIdentity: string;
  /** Notes for OpenBot capability-API registration. Must not contain a secret. */
  registrationNotes: string;
  callbackAllowlist: string[];
  serviceClientIds: string[];
  enabled: boolean;
  disabledDisposition: typeof DEVICE_PLATFORM_DISABLED_DISPOSITION;
  /** True when a service Basic secret is stored outside this record. */
  credentialPresent: boolean;
  credentialRotatedAt?: string;
  health: "unknown" | "ok" | "down";
  healthCheckedAt?: string;
  healthCode?: string;
  /** Redacted probe error. Never a secret or raw diagnostics. */
  healthError?: string;
  updatedAt: string;
};

export type DevicePresence = "online" | "offline" | "unknown";

export type DeviceAssociation = {
  deviceId: string;
  platformId: string;
  externalDeviceId: string;
  tenantId: string;
  claimingUserId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type DeviceBinding = {
  bindingId: string;
  deviceId: string;
  platformId: string;
  externalDeviceId: string;
  tenantId: string;
  userId: string;
  digitalHumanId: string;
  scopes: string[];
  /** Points at a grant record. The grant blob is not copied onto the binding. */
  authorizationRef?: string;
  expectedBindingVersion: number;
  appliedBindingVersion: number;
  status: BindingStatus;
  /** OpenBot authorization exists for the current expected version. */
  authorizationEstablished: boolean;
  /** Device platform has applied expectedBindingVersion. */
  platformApplied: boolean;
  /**
   * Hardware confirmed the apply. Absent means unconfirmed.
   * Management writes must not set this to true.
   */
  deviceEffect?: boolean;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type BindingHistoryEntry = {
  historyId: string;
  bindingId: string;
  deviceId: string;
  digitalHumanId: string;
  authorizationRef?: string;
  expectedBindingVersion: number;
  appliedBindingVersion: number;
  status: BindingStatus;
  recordedAt: string;
};

export type ManagementOperation = {
  operationId: string;
  kind: OperationKind;
  tenantId: string;
  userId: string;
  bodyHash: string;
  status: OperationStatus;
  progress: string;
  deviceId?: string;
  bindingId?: string;
  retryable: boolean;
  failure?: { code: string; message: string };
  /** Sanitized replay material. No connector secrets. */
  request: OperationMaterial;
  /** User-safe success payload for idempotent replay. */
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OperationMaterial = {
  kind: OperationKind;
  platformId?: string;
  externalDeviceId?: string;
  deviceId?: string;
  digitalHumanId?: string;
  scopes?: string[];
  displayName?: string;
  challenge?: string;
  proof?: string;
};

export type StatusProjection = {
  deviceId: string;
  online: boolean;
  lastSeen?: string;
  capabilities: string[];
  firmware?: string;
  /** Coarse label only. Raw platform diagnostics are never stored. */
  anomalySummary?: string;
  /** Unknown when the device platform did not report presence. */
  presence?: DevicePresence;
  /** User-visible model name. Not a vendor key or diagnostic dump. */
  model?: string;
  updatedAt: string;
};

export type GrantReference = {
  authorizationRef: string;
  credentialHash: string;
  serviceClientId: string;
  digitalHumanId: string;
  deviceId: string;
  userId: string;
  tenantId: string;
  scopes: string[];
  bindingVersion: number;
  status: "active" | "revoked";
  issuedAt: string;
  revokedAt?: string;
};

export type IntegrationRunStatus =
  | "accepted"
  | "queued"
  | "running"
  | "waiting_tool"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type IntegrationRunRecord = {
  runId: string;
  tenantId: string;
  authorizationRef?: string;
  deviceId?: string;
  status: IntegrationRunStatus;
  retryable: boolean;
  errorCode?: string;
  createdAt: string;
  finishedAt?: string;
};

export type IntegrationEvent = {
  eventId: string;
  tenantId: string;
  type: string;
  authorizationRef?: string;
  deviceId?: string;
  bindingVersion?: number;
  at: string;
};

export type IntegrationToolRequest = {
  requestId: string;
  tenantId: string;
  authorizationRef?: string;
  deviceId?: string;
  state: "pending" | "fulfilled" | "cancelled" | "expired" | "closed";
  updatedAt: string;
};

/**
 * Durable copy of tool-result idempotency.
 * Semantics match the in-memory integrations path: reserve before pending exit,
 * duplicate while in flight, conflict on a different body, drop on cancel paths.
 */
export type IntegrationIdempotencyRecord = {
  key: string;
  hash: string;
  inflight: boolean;
  authorizationRef?: string;
  response?: Record<string, unknown>;
  createdAt: string;
};

export type DeviceClaim = {
  platformId: string;
  externalDeviceId: string;
  tenantId: string;
  deviceId: string;
  claimingUserId: string;
};

export type ConnectionsFile = {
  schemaVersion: number;
  connections: Record<string, DevicePlatformConnection>;
};

export type ClaimsFile = {
  schemaVersion: number;
  claims: Record<string, DeviceClaim>;
};

export type TenantShard = {
  schemaVersion: number;
  associations: Record<string, DeviceAssociation>;
  bindings: Record<string, DeviceBinding>;
  bindingHistory: BindingHistoryEntry[];
  operations: Record<string, ManagementOperation>;
  projections: Record<string, StatusProjection>;
  grants: Record<string, GrantReference>;
  runs: Record<string, IntegrationRunRecord>;
  events: IntegrationEvent[];
  toolRequests: Record<string, IntegrationToolRequest>;
  idempotency: Record<string, IntegrationIdempotencyRecord>;
};

export const DEVICE_PLATFORM_ERROR_HTTP = {
  UNAUTHENTICATED: 401,
  AUTH_INVALID: 401,
  FORBIDDEN: 403,
  USE_DENIED: 403,
  MEMBERSHIP_REQUIRED: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  IDENTITY_OVERRIDE: 400,
  DEBUG_OVERRIDE: 400,
  SECRET_REJECTED: 400,
  CONFLICT: 409,
  DEVICE_CLAIMED: 409,
  BINDING_BUSY: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PLATFORM_DISABLED: 409,
  PLATFORM_UNAVAILABLE: 409,
  PAIRING_WRONG: 400,
  PAIRING_EXPIRED: 400,
  PAIRING_REPLAY: 400,
  PAIRING_MISMATCH: 400,
  PAIRING_PENDING: 400,
} as const;

export type DevicePlatformErrorCode = keyof typeof DEVICE_PLATFORM_ERROR_HTTP;

export class DevicePlatformError extends Error {
  readonly code: DevicePlatformErrorCode;

  constructor(code: DevicePlatformErrorCode, message: string) {
    super(message);
    this.name = "DevicePlatformError";
    this.code = code;
  }
}
