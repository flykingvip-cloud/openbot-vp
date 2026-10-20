/**
 * Enterprise diagnosis approval ledger.
 * Same row shape as the platform draft: write the approval, then the effect.
 * A failed effect deletes the row. This store is not the evolution delegation machine.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ENTERPRISE_DIAGNOSIS_APPROVAL_DECIDE_METHOD =
  "enterprise.diagnosis.approval.decide" as const;

export const DIAGNOSIS_APPROVAL_REFUSE_REASONS = [
  "grant_not_found",
  "grant_not_pending",
  "approver_role_mismatch",
  "tenant_mismatch",
  "idempotency_conflict",
  "conversation_not_found",
  "session_key_unavailable",
  "subject_incomplete",
] as const;

export type DiagnosisApprovalRefuseReason = (typeof DIAGNOSIS_APPROVAL_REFUSE_REASONS)[number];

export type DiagnosisApprovalDecision = "approve" | "deny";

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
      tenantId?: string | null;
      targetRef?: DiagnosisApprovalTargetRef;
    };

export type DiagnosisConsultGrant = {
  grantId: string;
  status: "REQUESTED" | "APPROVED" | "DENIED";
  approverRole: "enterprise" | "platform" | "employee";
  targetTenant: string | null;
};

export type DiagnosisApprovalEffect =
  | { type: "grant"; grantId: string; grantStatus: "APPROVED" | "DENIED" }
  | { type: "conversation"; opened: true; sessionKey: string }
  | { type: "none"; reason: string };

export type DiagnosisApprovalRecorded = {
  approvalId: string;
  subjectKind: "authorization" | "conversation";
  decision: DiagnosisApprovalDecision;
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

export type DiagnosisConversationResolution =
  | { ok: true; sessionKey: string }
  | {
      ok: false;
      reason: "conversation_not_found" | "session_key_unavailable" | "tenant_mismatch";
    };

export type DiagnosisApprovalRecord = {
  approvalId: string;
  tenantId: string;
  subject: DiagnosisApprovalSubject;
  decision: DiagnosisApprovalDecision;
  actorId: string;
  reason: string | null;
  recordedAt: string;
  effect: DiagnosisApprovalEffect;
};

export type DiagnosisConversationBinding = {
  signalId?: string;
  caseId?: string;
  sessionKey: string;
};

export type DiagnosisApprovalStore = {
  getGrant: (tenantId: string, grantId: string) => DiagnosisConsultGrant | null;
  putGrant: (tenantId: string, grant: DiagnosisConsultGrant) => void;
  listApprovals: (tenantId: string) => DiagnosisApprovalRecord[];
  putApproval: (tenantId: string, row: DiagnosisApprovalRecord) => void;
  deleteApproval: (tenantId: string, approvalId: string) => void;
  getIdempotency: (
    tenantId: string,
    key: string,
  ) => { bodyHash: string; result: DiagnosisApprovalRecorded } | null;
  putIdempotency: (
    tenantId: string,
    key: string,
    bodyHash: string,
    result: DiagnosisApprovalRecorded,
  ) => void;
  findConversation: (
    tenantId: string,
    query: { signalId?: string; caseId?: string },
  ) => DiagnosisConversationBinding | null;
  putConversation: (tenantId: string, binding: DiagnosisConversationBinding) => void;
};

export type DiagnosisApprovalRequest = {
  schemaVersion: 1;
  idempotencyKey: string;
  subject: DiagnosisApprovalSubject;
  decision: DiagnosisApprovalDecision;
  reason: string | null;
};

function refused(reason: DiagnosisApprovalRefuseReason): DiagnosisApprovalRefused {
  return { status: "refused", reason, effect: { type: "none", reason } };
}

export function canonicalDiagnosisApprovalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalDiagnosisApprovalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .toSorted();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalDiagnosisApprovalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function diagnosisApprovalBodyHash(request: DiagnosisApprovalRequest): string {
  return createHash("sha256").update(canonicalDiagnosisApprovalJson(request)).digest("hex");
}

function subjectTenantMismatch(tenantId: string, subject: DiagnosisApprovalSubject): boolean {
  if (subject.kind !== "conversation") {
    return false;
  }
  if (subject.tenantId && subject.tenantId !== tenantId) {
    return true;
  }
  const targetTenant = subject.targetRef?.tenantId;
  return Boolean(targetTenant && targetTenant !== tenantId);
}

function grantStatusFor(decision: DiagnosisApprovalDecision): "APPROVED" | "DENIED" {
  return decision === "approve" ? "APPROVED" : "DENIED";
}

export async function decideEnterpriseDiagnosisApproval(input: {
  tenantId: string;
  actorId: string;
  now: string;
  request: DiagnosisApprovalRequest;
  store: DiagnosisApprovalStore;
  resolveConversation: (
    subject: Extract<DiagnosisApprovalSubject, { kind: "conversation" }>,
  ) => Promise<DiagnosisConversationResolution> | DiagnosisConversationResolution;
  createApprovalId?: () => string;
}): Promise<DiagnosisApprovalResult> {
  const bodyHash = diagnosisApprovalBodyHash(input.request);
  const existing = input.store.getIdempotency(input.tenantId, input.request.idempotencyKey);
  if (existing) {
    if (existing.bodyHash !== bodyHash) {
      return refused("idempotency_conflict");
    }
    return existing.result;
  }

  const approvalId = input.createApprovalId?.() ?? `dap-${randomUUID()}`;
  const base = {
    approvalId,
    tenantId: input.tenantId,
    subject: input.request.subject,
    decision: input.request.decision,
    actorId: input.actorId,
    reason: input.request.reason,
    recordedAt: input.now,
  };

  if (input.request.subject.kind === "authorization") {
    const grant = input.store.getGrant(input.tenantId, input.request.subject.grantId);
    if (!grant) {
      return refused("grant_not_found");
    }
    if (grant.targetTenant !== input.tenantId) {
      return refused("tenant_mismatch");
    }
    if (grant.approverRole !== "enterprise") {
      return refused("approver_role_mismatch");
    }
    if (grant.status !== "REQUESTED") {
      return refused("grant_not_pending");
    }
    const grantStatus = grantStatusFor(input.request.decision);
    const effect: DiagnosisApprovalEffect = {
      type: "grant",
      grantId: grant.grantId,
      grantStatus,
    };
    input.store.putApproval(input.tenantId, { ...base, effect });
    try {
      input.store.putGrant(input.tenantId, { ...grant, status: grantStatus });
    } catch (error) {
      input.store.deleteApproval(input.tenantId, approvalId);
      throw error;
    }
    const result: DiagnosisApprovalRecorded = {
      approvalId,
      subjectKind: "authorization",
      decision: input.request.decision,
      status: "recorded",
      grantId: grant.grantId,
      effect,
    };
    input.store.putIdempotency(input.tenantId, input.request.idempotencyKey, bodyHash, result);
    return result;
  }

  if (!input.request.subject.signalId && !input.request.subject.caseId) {
    return refused("subject_incomplete");
  }
  if (subjectTenantMismatch(input.tenantId, input.request.subject)) {
    return refused("tenant_mismatch");
  }

  if (input.request.decision === "deny") {
    const resolved = await input.resolveConversation(input.request.subject);
    if (!resolved.ok && resolved.reason === "conversation_not_found") {
      return refused("conversation_not_found");
    }
    if (!resolved.ok && resolved.reason === "tenant_mismatch") {
      return refused("tenant_mismatch");
    }
    const effect: DiagnosisApprovalEffect = { type: "none", reason: "denied" };
    const result: DiagnosisApprovalRecorded = {
      approvalId,
      subjectKind: "conversation",
      decision: "deny",
      status: "recorded",
      grantId: null,
      effect,
    };
    input.store.putApproval(input.tenantId, { ...base, effect });
    input.store.putIdempotency(input.tenantId, input.request.idempotencyKey, bodyHash, result);
    return result;
  }

  const effectHolder: { effect: DiagnosisApprovalEffect } = {
    effect: { type: "none", reason: "pending" },
  };
  input.store.putApproval(input.tenantId, { ...base, effect: effectHolder.effect });
  try {
    const resolved = await input.resolveConversation(input.request.subject);
    if (!resolved.ok) {
      input.store.deleteApproval(input.tenantId, approvalId);
      return refused(resolved.reason);
    }
    const effect: DiagnosisApprovalEffect = {
      type: "conversation",
      opened: true,
      sessionKey: resolved.sessionKey,
    };
    input.store.putApproval(input.tenantId, { ...base, effect });
    const result: DiagnosisApprovalRecorded = {
      approvalId,
      subjectKind: "conversation",
      decision: "approve",
      status: "recorded",
      grantId: null,
      effect,
    };
    input.store.putIdempotency(input.tenantId, input.request.idempotencyKey, bodyHash, result);
    return result;
  } catch (error) {
    input.store.deleteApproval(input.tenantId, approvalId);
    throw error;
  }
}

type FileSnapshot = {
  grants: Record<string, DiagnosisConsultGrant>;
  approvals: Record<string, DiagnosisApprovalRecord>;
  idempotency: Record<string, { bodyHash: string; result: DiagnosisApprovalRecorded }>;
  conversations: DiagnosisConversationBinding[];
};

function emptySnapshot(): FileSnapshot {
  return { grants: {}, approvals: {}, idempotency: {}, conversations: [] };
}

function snapshotPath(rootDir: string, tenantId: string): string {
  const safe = tenantId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(rootDir, `${safe}.json`);
}

function readSnapshot(filePath: string): FileSnapshot {
  try {
    if (!fs.existsSync(filePath)) {
      return emptySnapshot();
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FileSnapshot>;
    return {
      grants: parsed.grants ?? {},
      approvals: parsed.approvals ?? {},
      idempotency: parsed.idempotency ?? {},
      conversations: parsed.conversations ?? [],
    };
  } catch {
    return emptySnapshot();
  }
}

function writeSnapshot(filePath: string, snapshot: FileSnapshot): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function createFileDiagnosisApprovalStore(rootDir: string): DiagnosisApprovalStore {
  const load = (tenantId: string) => readSnapshot(snapshotPath(rootDir, tenantId));
  const save = (tenantId: string, snapshot: FileSnapshot) => {
    writeSnapshot(snapshotPath(rootDir, tenantId), snapshot);
  };
  return {
    getGrant: (tenantId, grantId) => load(tenantId).grants[grantId] ?? null,
    putGrant: (tenantId, grant) => {
      const snapshot = load(tenantId);
      snapshot.grants[grant.grantId] = grant;
      save(tenantId, snapshot);
    },
    listApprovals: (tenantId) => Object.values(load(tenantId).approvals),
    putApproval: (tenantId, row) => {
      const snapshot = load(tenantId);
      snapshot.approvals[row.approvalId] = row;
      save(tenantId, snapshot);
    },
    deleteApproval: (tenantId, approvalId) => {
      const snapshot = load(tenantId);
      delete snapshot.approvals[approvalId];
      save(tenantId, snapshot);
    },
    getIdempotency: (tenantId, key) => load(tenantId).idempotency[key] ?? null,
    putIdempotency: (tenantId, key, bodyHash, result) => {
      const snapshot = load(tenantId);
      snapshot.idempotency[key] = { bodyHash, result };
      save(tenantId, snapshot);
    },
    findConversation: (tenantId, query) => {
      const rows = load(tenantId).conversations;
      return (
        rows.find((row) => {
          if (query.signalId && row.signalId && row.signalId !== query.signalId) {
            return false;
          }
          if (query.caseId && row.caseId && row.caseId !== query.caseId) {
            return false;
          }
          const signalHit = Boolean(query.signalId && row.signalId === query.signalId);
          const caseHit = Boolean(query.caseId && row.caseId === query.caseId);
          return signalHit || caseHit;
        }) ?? null
      );
    },
    putConversation: (tenantId, binding) => {
      const snapshot = load(tenantId);
      snapshot.conversations.push(binding);
      save(tenantId, snapshot);
    },
  };
}

export function createMemoryDiagnosisApprovalStore(): DiagnosisApprovalStore {
  const byTenant = new Map<string, FileSnapshot>();
  const load = (tenantId: string) => {
    const current = byTenant.get(tenantId);
    if (current) {
      return current;
    }
    const created = emptySnapshot();
    byTenant.set(tenantId, created);
    return created;
  };
  return {
    getGrant: (tenantId, grantId) => load(tenantId).grants[grantId] ?? null,
    putGrant: (tenantId, grant) => {
      load(tenantId).grants[grant.grantId] = grant;
    },
    listApprovals: (tenantId) => Object.values(load(tenantId).approvals),
    putApproval: (tenantId, row) => {
      load(tenantId).approvals[row.approvalId] = row;
    },
    deleteApproval: (tenantId, approvalId) => {
      delete load(tenantId).approvals[approvalId];
    },
    getIdempotency: (tenantId, key) => load(tenantId).idempotency[key] ?? null,
    putIdempotency: (tenantId, key, bodyHash, result) => {
      load(tenantId).idempotency[key] = { bodyHash, result };
    },
    findConversation: (tenantId, query) => {
      return (
        load(tenantId).conversations.find((row) => {
          if (query.signalId && row.signalId && row.signalId !== query.signalId) {
            return false;
          }
          if (query.caseId && row.caseId && row.caseId !== query.caseId) {
            return false;
          }
          return Boolean(
            (query.signalId && row.signalId === query.signalId) ||
            (query.caseId && row.caseId === query.caseId),
          );
        }) ?? null
      );
    },
    putConversation: (tenantId, binding) => {
      load(tenantId).conversations.push(binding);
    },
  };
}
