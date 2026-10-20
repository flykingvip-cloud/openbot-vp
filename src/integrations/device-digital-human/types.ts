/** Frozen v1 names. Do not rename these fields. */

export const API_PREFIX = "/api/integrations/v1";
export const API_VERSION = "v1";
export const PROTOCOL_VERSION = "1";
export const SCHEMA_VERSION = 1;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type ClientRole = "consent" | "service";

export type AssistantProfile = {
  digitalHumanId: string;
  displayName: string;
  avatar?: string;
  animationManifestUrl?: string;
  locale?: string;
  voiceHint?: string;
  status: "active" | "disabled";
};

export type RunStatus =
  | "accepted"
  | "queued"
  | "running"
  | "waiting_tool"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type CancelReason = "barge_in" | "user" | "timeout" | "unbind" | "revoked";

export type ClientCancelReason = "barge_in" | "user" | "timeout" | "unbind";

export type ToolResultStatus =
  | "ok"
  | "failed"
  | "unknown"
  | "cancelled"
  | "busy"
  | "timeout"
  | "denied"
  | "unsupported";

export type RunEventType =
  | "run.accepted"
  | "run.started"
  | "assistant.delta"
  | "assistant.visible"
  | "assistant.final"
  | "approval.required"
  | "tool.request"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

export type DeviceEventType =
  | "tool.request"
  | "authorization.revoked"
  | "binding.updated"
  | "run.cancelled";

export type EventEnvelope = {
  schemaVersion: number;
  apiVersion: string;
  protocolVersion: string;
  eventId: string;
  sequence: number;
  seq: number;
  cursor: string;
  runId?: string;
  turnId?: string;
  conversationId?: string;
  authorizationRef?: string;
  bindingVersion: number;
  type: string;
  payload: Record<string, unknown>;
  data: Record<string, unknown>;
  createdAt: string;
  traceId?: string;
  messageId?: string;
};

export type AuditRecord = {
  auditId: string;
  at: string;
  action: string;
  outcome: "ok" | "denied" | "error";
  traceId?: string;
  clientId?: string;
  authorizationRef?: string;
  deviceId?: string;
  userSubject?: string;
  tenantId?: string;
  digitalHumanId?: string;
  runId?: string;
  requestId?: string;
  conversationId?: string;
  code?: string;
};
