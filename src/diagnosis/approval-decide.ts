import type { AuthorizationGrantStatus } from "./authorization-grant-status.js";
/**
 * Platform diagnosis approval ledger.
 *
 * Parallel to `approval-ledger.ts` (`decideEnterpriseDiagnosisApproval`).
 * Recorded responses use the same envelope: approvalId, subjectKind, decision,
 * status recorded, grantId, and effect. This path adds platform-only
 * `report-export`. It does not call the enterprise method or its decide
 * function. Callers pass `domain: "enterprise"` only to exercise the sibling
 * rule that `report-export` is `subject_incomplete` and that an enterprise
 * tenant mismatch writes nothing.
 */
import { transitionRequestedAuthorizationGrant } from "./delegation.js";

export const DIAGNOSIS_APPROVAL_SCHEMA_VERSION = 1 as const;

export const DIAGNOSIS_APPROVAL_REFUSE_REASONS = [
  "grant_not_found",
  "grant_not_pending",
  "approver_role_mismatch",
  "tenant_mismatch",
  "idempotency_conflict",
  "conversation_not_found",
  "session_key_unavailable",
  "subject_incomplete",
  "report_not_found",
  "export_unavailable",
] as const;

export type DiagnosisApprovalRefuseReason = (typeof DIAGNOSIS_APPROVAL_REFUSE_REASONS)[number];

export type DiagnosisApprovalSubjectKind = "authorization" | "conversation" | "report-export";

export type DiagnosisApprovalTargetRef = {
  targetType: string;
  targetId: string;
  tenantId: string | null;
};

export type DiagnosisApprovalSubject =
  | { kind: "authorization"; grantId: string }
  | {
      kind: "conversation";
      signalId?: string;
      caseId?: string;
      targetRef?: DiagnosisApprovalTargetRef;
      tenantId?: string | null;
    }
  | { kind: "report-export"; reportId: string; redactionProfile: "administrator" | "user" };

export type DiagnosisApprovalEffect =
  | { type: "grant"; grantId: string; grantStatus: "APPROVED" | "DENIED" }
  | { type: "conversation"; opened: true; sessionKey: string }
  | { type: "export"; filename: string; mediaType: "application/json"; body: string }
  | { type: "none"; reason: string };

export type DiagnosisApprovalRecorded = {
  approvalId: string;
  subjectKind: DiagnosisApprovalSubjectKind;
  decision: "approve" | "deny";
  status: "recorded";
  grantId: string | null;
  effect: DiagnosisApprovalEffect;
};

export type DiagnosisApprovalRefused = {
  status: "refused";
  reason: DiagnosisApprovalRefuseReason;
  effect: { type: "none"; reason: DiagnosisApprovalRefuseReason };
};

export type DiagnosisApprovalResult = DiagnosisApprovalRecorded | DiagnosisApprovalRefused;

export type DiagnosisApprovalActor = {
  principalId: string;
  sessionKind: string;
  domain: "platform" | "enterprise";
};

export type DiagnosisApprovalGrant = {
  grantId: string;
  status: AuthorizationGrantStatus;
  approverRole: "platform" | "enterprise" | "employee";
  targetTenant: string | null;
};

export type DiagnosisApprovalRow = {
  approvalId: string;
  subjectKind: DiagnosisApprovalSubjectKind;
  subject: DiagnosisApprovalSubject;
  decision: "approve" | "deny";
  actor: DiagnosisApprovalActor;
  recordedAt: string;
  reason: string | null;
  status: "recorded";
  grantId: string | null;
  effect: DiagnosisApprovalEffect;
};

type InFlightRow = Omit<DiagnosisApprovalRow, "status" | "effect"> & { status: "writing" };

type IdempotencyHit = { body: string; result: DiagnosisApprovalResult };

export type DiagnosisApprovalLedger = {
  lookup(key: string): IdempotencyHit | undefined;
  insert(row: InFlightRow): void;
  remove(approvalId: string): void;
  finish(
    row: InFlightRow,
    result: DiagnosisApprovalRecorded,
    idempotencyKey: string,
    body: string,
  ): void;
  remember(key: string, body: string, result: DiagnosisApprovalRefused): void;
  hasAny(approvalId: string): boolean;
  finishedCount(): number;
};

export type DiagnosisApprovalPorts = {
  now: () => string;
  newId: () => string;
  ledger: DiagnosisApprovalLedger;
  grants: {
    get: (grantId: string) => Promise<DiagnosisApprovalGrant | undefined>;
    applyStatus: (grantId: string, status: "APPROVED" | "DENIED") => Promise<void>;
  };
  conversations: {
    find: (input: { signalId?: string; caseId?: string }) => Promise<boolean>;
    openSession: (input: {
      signalId?: string;
      caseId?: string;
      targetRef?: DiagnosisApprovalTargetRef;
    }) => Promise<string>;
  };
  reports: {
    load: (reportId: string) => Promise<unknown>;
    serialize: (report: unknown, redactionProfile: "administrator" | "user") => string;
  };
};

export class DiagnosisApprovalInvalidRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagnosisApprovalInvalidRequest";
  }
}

export function createMemoryDiagnosisApprovalLedger(): DiagnosisApprovalLedger {
  const inflight = new Map<string, InFlightRow>();
  const finished = new Map<string, DiagnosisApprovalRow>();
  const byKey = new Map<string, IdempotencyHit>();
  return {
    lookup: (key) => byKey.get(key),
    insert(row) {
      inflight.set(row.approvalId, row);
    },
    remove(approvalId) {
      inflight.delete(approvalId);
      finished.delete(approvalId);
    },
    finish(row, result, idempotencyKey, body) {
      inflight.delete(row.approvalId);
      finished.set(row.approvalId, {
        ...row,
        status: "recorded",
        grantId: result.grantId,
        effect: result.effect,
      });
      byKey.set(idempotencyKey, { body, result });
    },
    remember(key, body, result) {
      byKey.set(key, { body, result });
    },
    hasAny: (approvalId) => inflight.has(approvalId) || finished.has(approvalId),
    finishedCount: () => finished.size,
  };
}

export async function decideDiagnosisApproval(
  input: {
    domain: "platform" | "enterprise";
    membershipTenantId?: string | null;
    actor: DiagnosisApprovalActor;
    params: unknown;
  },
  ports: DiagnosisApprovalPorts,
): Promise<DiagnosisApprovalResult> {
  const parsed = parseDecideParams(input.params);
  const canonical = canonicalBody(parsed);
  const existing = ports.ledger.lookup(parsed.idempotencyKey);
  if (existing) {
    if (existing.body !== canonical) {
      return refuse("idempotency_conflict");
    }
    return existing.result;
  }

  const incomplete = incompleteSubject(parsed.subject, input.domain);
  if (incomplete) {
    return bindRefusal(ports, parsed.idempotencyKey, canonical, incomplete);
  }

  if (parsed.subject.kind === "authorization") {
    const precondition = await authorizationPrecondition(
      parsed.subject,
      parsed.decision,
      input.domain,
      input.membershipTenantId ?? null,
      ports,
    );
    if (precondition) {
      return bindRefusal(ports, parsed.idempotencyKey, canonical, precondition);
    }
  }
  if (
    parsed.subject.kind === "conversation" &&
    input.domain === "enterprise" &&
    conversationTenantMismatch(parsed.subject, input.membershipTenantId ?? null)
  ) {
    return bindRefusal(ports, parsed.idempotencyKey, canonical, "tenant_mismatch");
  }

  const approvalId = ports.newId();
  const inflight: InFlightRow = {
    approvalId,
    subjectKind: parsed.subject.kind,
    subject: parsed.subject,
    decision: parsed.decision,
    actor: input.actor,
    recordedAt: ports.now(),
    reason: parsed.reason,
    status: "writing",
    grantId: parsed.subject.kind === "authorization" ? parsed.subject.grantId : null,
  };
  ports.ledger.insert(inflight);
  try {
    const effect = await applyEffect(parsed, ports);
    if (!effect.ok) {
      ports.ledger.remove(approvalId);
      return bindRefusal(ports, parsed.idempotencyKey, canonical, effect.reason);
    }
    const recorded: DiagnosisApprovalRecorded = {
      approvalId,
      subjectKind: parsed.subject.kind,
      decision: parsed.decision,
      status: "recorded",
      grantId: inflight.grantId,
      effect: effect.effect,
    };
    ports.ledger.finish(inflight, recorded, parsed.idempotencyKey, canonical);
    return recorded;
  } catch (err) {
    ports.ledger.remove(approvalId);
    throw err;
  }
}

type ParsedDecide = {
  idempotencyKey: string;
  subject: DiagnosisApprovalSubject;
  decision: "approve" | "deny";
  reason: string | null;
};

function bindRefusal(
  ports: DiagnosisApprovalPorts,
  key: string,
  body: string,
  reason: DiagnosisApprovalRefuseReason,
): DiagnosisApprovalRefused {
  const result = refuse(reason);
  ports.ledger.remember(key, body, result);
  return result;
}

function refuse(reason: DiagnosisApprovalRefuseReason): DiagnosisApprovalRefused {
  return { status: "refused", reason, effect: { type: "none", reason } };
}

function incompleteSubject(
  subject: DiagnosisApprovalSubject,
  domain: "platform" | "enterprise",
): DiagnosisApprovalRefuseReason | null {
  if (subject.kind === "report-export" && domain === "enterprise") {
    return "subject_incomplete";
  }
  if (subject.kind === "conversation" && !subject.signalId && !subject.caseId) {
    return "subject_incomplete";
  }
  return null;
}

async function authorizationPrecondition(
  subject: Extract<DiagnosisApprovalSubject, { kind: "authorization" }>,
  decision: "approve" | "deny",
  domain: "platform" | "enterprise",
  membershipTenantId: string | null,
  ports: DiagnosisApprovalPorts,
): Promise<DiagnosisApprovalRefuseReason | null> {
  const grant = await ports.grants.get(subject.grantId);
  if (!grant) {
    return "grant_not_found";
  }
  const expectedRole = domain === "platform" ? "platform" : "enterprise";
  if (grant.approverRole !== expectedRole) {
    return "approver_role_mismatch";
  }
  if (domain === "enterprise" && grant.targetTenant !== membershipTenantId) {
    return "tenant_mismatch";
  }
  const next = transitionRequestedAuthorizationGrant(grant.status, decision);
  if (!next) {
    return "grant_not_pending";
  }
  return null;
}

async function applyEffect(
  parsed: ParsedDecide,
  ports: DiagnosisApprovalPorts,
): Promise<
  | { ok: true; effect: DiagnosisApprovalEffect }
  | { ok: false; reason: DiagnosisApprovalRefuseReason }
> {
  const subject = parsed.subject;
  if (subject.kind === "authorization") {
    const next = parsed.decision === "approve" ? "APPROVED" : "DENIED";
    try {
      await ports.grants.applyStatus(subject.grantId, next);
    } catch {
      return { ok: false, reason: "grant_not_pending" };
    }
    return { ok: true, effect: { type: "grant", grantId: subject.grantId, grantStatus: next } };
  }
  if (subject.kind === "conversation") {
    if (parsed.decision === "deny") {
      return { ok: true, effect: { type: "none", reason: "denied" } };
    }
    const found = await ports.conversations.find({
      signalId: subject.signalId,
      caseId: subject.caseId,
    });
    if (!found) {
      return { ok: false, reason: "conversation_not_found" };
    }
    try {
      const sessionKey = (await ports.conversations.openSession(subject)).trim();
      if (!sessionKey) {
        return { ok: false, reason: "session_key_unavailable" };
      }
      return { ok: true, effect: { type: "conversation", opened: true, sessionKey } };
    } catch {
      return { ok: false, reason: "session_key_unavailable" };
    }
  }
  if (parsed.decision === "deny") {
    return { ok: true, effect: { type: "none", reason: "denied" } };
  }
  let raw: unknown;
  try {
    raw = await ports.reports.load(subject.reportId);
  } catch {
    return { ok: false, reason: "report_not_found" };
  }
  if (raw == null) {
    return { ok: false, reason: "report_not_found" };
  }
  try {
    const body = ports.reports.serialize(raw, subject.redactionProfile);
    if (!body.trim()) {
      return { ok: false, reason: "export_unavailable" };
    }
    return {
      ok: true,
      effect: {
        type: "export",
        filename: exportFilename(subject.reportId),
        mediaType: "application/json",
        body,
      },
    };
  } catch {
    return { ok: false, reason: "export_unavailable" };
  }
}

function conversationTenantMismatch(
  subject: Extract<DiagnosisApprovalSubject, { kind: "conversation" }>,
  membershipTenantId: string | null,
): boolean {
  if (subject.tenantId != null && subject.tenantId !== membershipTenantId) {
    return true;
  }
  if (subject.targetRef && subject.targetRef.tenantId !== membershipTenantId) {
    return true;
  }
  return false;
}

function exportFilename(reportId: string): string {
  const safe = reportId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safe || "diagnosis-report"}.json`;
}

function parseDecideParams(params: unknown): ParsedDecide {
  if (!isRecord(params)) {
    throw new DiagnosisApprovalInvalidRequest("params must be an object");
  }
  if (params.schemaVersion !== DIAGNOSIS_APPROVAL_SCHEMA_VERSION) {
    throw new DiagnosisApprovalInvalidRequest("schemaVersion must be 1");
  }
  const idempotencyKey = requiredString(params.idempotencyKey, "idempotencyKey");
  const decision = params.decision;
  if (decision !== "approve" && decision !== "deny") {
    throw new DiagnosisApprovalInvalidRequest("decision must be approve or deny");
  }
  if (params.reason != null && typeof params.reason !== "string") {
    throw new DiagnosisApprovalInvalidRequest("reason must be a string or null");
  }
  return {
    idempotencyKey,
    subject: parseSubject(params.subject),
    decision,
    reason: typeof params.reason === "string" ? params.reason : null,
  };
}

function parseSubject(value: unknown): DiagnosisApprovalSubject {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new DiagnosisApprovalInvalidRequest("subject.kind is required");
  }
  if (value.kind === "authorization") {
    return { kind: "authorization", grantId: requiredString(value.grantId, "subject.grantId") };
  }
  if (value.kind === "conversation") {
    const signalId = optionalString(value.signalId, "subject.signalId");
    const caseId = optionalString(value.caseId, "subject.caseId");
    const tenantId = optionalTenant(value.tenantId, "subject.tenantId");
    const targetRef = parseTargetRef(value.targetRef);
    return {
      kind: "conversation",
      ...(signalId ? { signalId } : {}),
      ...(caseId ? { caseId } : {}),
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(targetRef ? { targetRef } : {}),
    };
  }
  if (value.kind === "report-export") {
    const redactionProfile = value.redactionProfile;
    if (redactionProfile !== "administrator" && redactionProfile !== "user") {
      throw new DiagnosisApprovalInvalidRequest("subject.redactionProfile is invalid");
    }
    return {
      kind: "report-export",
      reportId: requiredString(value.reportId, "subject.reportId"),
      redactionProfile,
    };
  }
  throw new DiagnosisApprovalInvalidRequest("subject.kind is invalid");
}

function parseTargetRef(value: unknown): DiagnosisApprovalTargetRef | undefined {
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new DiagnosisApprovalInvalidRequest("subject.targetRef must be an object");
  }
  const tenantId = value.tenantId;
  if (tenantId !== null && typeof tenantId !== "string") {
    throw new DiagnosisApprovalInvalidRequest(
      "subject.targetRef.tenantId must be a string or null",
    );
  }
  return {
    targetType: requiredString(value.targetType, "subject.targetRef.targetType"),
    targetId: requiredString(value.targetId, "subject.targetRef.targetId"),
    tenantId,
  };
}

function canonicalBody(parsed: ParsedDecide): string {
  return stableStringify({
    schemaVersion: DIAGNOSIS_APPROVAL_SCHEMA_VERSION,
    subject: parsed.subject,
    decision: parsed.decision,
    reason: parsed.reason,
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).toSorted();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DiagnosisApprovalInvalidRequest(`${path} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DiagnosisApprovalInvalidRequest(`${path} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalTenant(value: unknown, path: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new DiagnosisApprovalInvalidRequest(`${path} must be a string or null`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
