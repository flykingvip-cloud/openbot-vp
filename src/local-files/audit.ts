/**
 * Audit records for every authorization decision and every read (design 4.12).
 *
 * What is deliberately absent: file content, credential material, and the full
 * capability token. The path is recorded as a hash plus a heavily redacted display
 * form, so an operational log never carries a complete local path.
 */

import crypto from "node:crypto";
import type { CapabilityBinding, GrantSource, LocalFilesOperation } from "./types.js";

export type AuditDecision = "allowed" | "denied";

export type LocalFilesAuditRecord = {
  at: string;
  /** Milliseconds from request to outcome. */
  durationMs: number;
  tenantId: string;
  userId: string;
  agentId: string;
  sessionKey: string;
  turnId: string;
  /** Inbound message that opened this turn, when known. */
  inboundMessageId?: string;
  /** Stable node id (device id), never the display name. */
  nodeId: string;
  operation: LocalFilesOperation | "resolve";
  /** SHA-256 of the canonical path. Lets two records be correlated without the path. */
  pathHash: string;
  /** Redacted display form, e.g. `~/Desktop/…/p….zip`. */
  pathDisplay: string;
  grantSource?: GrantSource;
  decision: AuditDecision;
  /** Machine-readable reason. Present when denied. */
  denyReason?: string;
  bytesReturned?: number;
  /** SHA-256 of the returned content, when content was returned. */
  contentHash?: string;
  truncated?: boolean;
  errorCode?: string;
};

export function hashPath(canonicalPath: string): string {
  return crypto.createHash("sha256").update(canonicalPath, "utf8").digest("hex");
}

/**
 * Redact a path for display.
 *
 * Keeps the home-relative first segment and an abbreviated basename, and elides
 * everything between. Enough to recognise "something on the Desktop" in an audit
 * trail without reproducing the user's directory structure.
 */
export function redactPathForAudit(canonicalPath: string, homeDir?: string): string {
  const withTilde =
    homeDir && canonicalPath.startsWith(homeDir)
      ? `~${canonicalPath.slice(homeDir.length)}`
      : canonicalPath;
  const segments = withTilde.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "/";
  }
  const head = segments[0] === "~" ? `~/${segments[1] ?? ""}` : `/${segments[0]}`;
  const base = segments[segments.length - 1] ?? "";
  const abbreviated = base.length <= 2 ? base : `${base.slice(0, 1)}\u2026${base.slice(-4)}`;
  const middleElided = segments.length > (segments[0] === "~" ? 3 : 2) ? "/\u2026" : "";
  return `${head}${middleElided}/${abbreviated}`;
}

export type AuditSink = {
  write(record: LocalFilesAuditRecord): void;
};

/** In-memory sink for the prototype and for tests. */
export class InMemoryAuditSink implements AuditSink {
  private readonly records: LocalFilesAuditRecord[] = [];

  write(record: LocalFilesAuditRecord): void {
    this.records.push(record);
  }

  all(): readonly LocalFilesAuditRecord[] {
    return this.records;
  }

  clear(): void {
    this.records.length = 0;
  }
}

export function buildAuditRecord(params: {
  binding: CapabilityBinding;
  inboundMessageId?: string;
  operation: LocalFilesOperation | "resolve";
  canonicalPath: string;
  homeDir?: string;
  grantSource?: GrantSource;
  decision: AuditDecision;
  denyReason?: string;
  bytesReturned?: number;
  contentHash?: string;
  truncated?: boolean;
  errorCode?: string;
  startedAtMs: number;
  nowMs?: number;
}): LocalFilesAuditRecord {
  const now = params.nowMs ?? Date.now();
  const record: LocalFilesAuditRecord = {
    at: new Date(now).toISOString(),
    durationMs: Math.max(0, now - params.startedAtMs),
    tenantId: params.binding.tenantId,
    userId: params.binding.userId,
    agentId: params.binding.agentId,
    sessionKey: params.binding.sessionKey,
    turnId: params.binding.turnId,
    nodeId: params.binding.nodeId,
    operation: params.operation,
    pathHash: hashPath(params.canonicalPath),
    pathDisplay: redactPathForAudit(params.canonicalPath, params.homeDir),
    decision: params.decision,
  };
  if (params.inboundMessageId) {
    record.inboundMessageId = params.inboundMessageId;
  }
  if (params.grantSource) {
    record.grantSource = params.grantSource;
  }
  if (params.denyReason) {
    record.denyReason = params.denyReason;
  }
  if (params.bytesReturned !== undefined) {
    record.bytesReturned = params.bytesReturned;
  }
  if (params.contentHash) {
    record.contentHash = params.contentHash;
  }
  if (params.truncated !== undefined) {
    record.truncated = params.truncated;
  }
  if (params.errorCode) {
    record.errorCode = params.errorCode;
  }
  return record;
}

/**
 * Assert a record carries nothing it must not.
 *
 * Used by the acceptance test for design 4.12, and cheap enough to run in
 * production as a tripwire if an audit field is ever added carelessly.
 */
export function findForbiddenAuditFields(record: LocalFilesAuditRecord): string[] {
  const forbidden = [
    "text",
    "content",
    "body",
    "buffer",
    "capability",
    "claimsJSON",
    "signature",
    "nonce",
    "token",
    "canonicalPath",
    "rawPath",
  ];
  return forbidden.filter((field) => field in (record as unknown as Record<string, unknown>));
}
