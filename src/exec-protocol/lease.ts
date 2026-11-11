import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ExecProtocolConfig } from "./config.js";
import { ExecProtocolError } from "./errors.js";
import type { ExecLeaseRecord } from "./types.js";

export const LEASE_PREFIX = "exec1_";
const LEASE_HEX_RE = /^exec1_[a-f0-9]{64}$/;

export function hashLeaseToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isLeaseTokenFormat(token: string): boolean {
  return LEASE_HEX_RE.test(token);
}

export function mintLease(params: {
  subject: string;
  nowMs: number;
  ttlMs: number;
  tenantId?: string;
  roles?: string[];
}): { token: string; record: ExecLeaseRecord } {
  if (!params.subject || typeof params.subject !== "string") {
    throw new ExecProtocolError("EXEC_INTERNAL", "lease subject is required");
  }
  if (!Number.isInteger(params.ttlMs) || params.ttlMs <= 0) {
    throw new ExecProtocolError("EXEC_INTERNAL", "lease ttl must be a positive integer");
  }
  const token = `${LEASE_PREFIX}${randomBytes(32).toString("hex")}`;
  const iatMs = params.nowMs;
  const expMs = params.nowMs + params.ttlMs;
  const record: ExecLeaseRecord = {
    hash: hashLeaseToken(token),
    subject: params.subject,
    tenantId: params.tenantId,
    iat: new Date(iatMs).toISOString(),
    exp: new Date(expMs).toISOString(),
    iatMs,
    expMs,
    roles: params.roles,
  };
  return { token, record };
}

export function validateLease(params: {
  token: string | undefined;
  record: ExecLeaseRecord | undefined;
  nowMs: number;
  config: Pick<ExecProtocolConfig, "maxClockSkewMs">;
  requestTenantId?: string;
  requestSubject?: string;
}): ExecLeaseRecord {
  const token = params.token;
  if (!token || !isLeaseTokenFormat(token)) {
    throw new ExecProtocolError("EXEC_UNAUTHORIZED", "missing or invalid execution lease");
  }
  const record = params.record;
  if (!record) {
    throw new ExecProtocolError("EXEC_UNAUTHORIZED", "missing or invalid execution lease");
  }
  const actualHash = Buffer.from(hashLeaseToken(token), "hex");
  const expectedHash = Buffer.from(record.hash, "hex");
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new ExecProtocolError("EXEC_UNAUTHORIZED", "missing or invalid execution lease");
  }
  const skew = params.config.maxClockSkewMs;
  if (params.nowMs > record.expMs + skew) {
    throw new ExecProtocolError("EXEC_UNAUTHORIZED", "execution lease is expired or skewed");
  }
  if (record.iatMs > params.nowMs + skew) {
    throw new ExecProtocolError("EXEC_UNAUTHORIZED", "execution lease is expired or skewed");
  }
  if (record.tenantId && params.requestTenantId && record.tenantId !== params.requestTenantId) {
    throw new ExecProtocolError("EXEC_UNAUTHORIZED", "execution lease does not match tenant scope");
  }
  if (params.requestSubject && record.subject !== params.requestSubject) {
    throw new ExecProtocolError("EXEC_UNAUTHORIZED", "execution lease does not match subject");
  }
  return record;
}

export function assertReconcileRole(lease: ExecLeaseRecord): void {
  if (!lease.roles?.includes("reconcile")) {
    throw new ExecProtocolError(
      "EXEC_UNAUTHORIZED",
      "execution lease is missing the reconcile role",
    );
  }
}

export function parseBearerToken(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return match?.[1];
}
