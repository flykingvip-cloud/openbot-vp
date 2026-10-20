/**
 * Capability Installation Governance Store
 *
 * Shared persistent stores for:
 * 1. Enterprise sanitization sessions — track per-capability sanitization state
 * 2. Platform submissions — shared between enterprise and platform review lanes
 * 3. Governance events — durable audit trail
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STORE_DIR = path.join(os.homedir(), ".config", "openbot", "stores");
const STORE_FILE = path.join(STORE_DIR, "capability-install-governance.json");

let loadAttempted = false;

interface SerializedStore {
  sanitizationSessions: Array<[string, SanitizationSession]>;
  enterpriseSubmissions: Array<[string, EnterpriseSubmission]>;
  governanceEvents: GovernanceEvent[];
  sanitizedPackages: Array<[string, SanitizedPackage]>;
}

function ensureLoaded(): void {
  if (loadAttempted) {
    return;
  }
  loadAttempted = true;
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return;
    }
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    if (!raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as SerializedStore;
    if (parsed.sanitizationSessions) {
      for (const [key, value] of parsed.sanitizationSessions) {
        sanitizationSessions.set(key, value);
      }
    }
    if (parsed.enterpriseSubmissions) {
      for (const [key, value] of parsed.enterpriseSubmissions) {
        enterpriseSubmissions.set(key, value);
      }
    }
    if (parsed.governanceEvents) {
      governanceEvents.push(...parsed.governanceEvents);
    }
    if (parsed.sanitizedPackages) {
      for (const [key, value] of parsed.sanitizedPackages) {
        sanitizedPackages.set(key, value);
      }
    }
  } catch (err) {
    console.warn("[capability-install-governance-store] load failed:", err);
  }
}

function persist(): void {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    const payload: SerializedStore = {
      sanitizationSessions: Array.from(sanitizationSessions.entries()),
      enterpriseSubmissions: Array.from(enterpriseSubmissions.entries()),
      governanceEvents: governanceEvents.slice(),
      sanitizedPackages: Array.from(sanitizedPackages.entries()),
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch (err) {
    console.warn("[capability-install-governance-store] persist failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sanitization Session Store (P0-5)
// ─────────────────────────────────────────────────────────────────────────

export type SanitizationFinding = {
  id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  count: number;
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: string;
  // P0-5 完整脱敏：replacement 记录（原字段/替换值）
  originalValue?: string;
  replacement?: string;
  replacementType?: "redact" | "tokenize" | "hash" | "substitute";
};

export type SanitizationSession = {
  capabilityId: string;
  enterpriseId: string;
  status: "not-started" | "in-progress" | "complete" | "failed";
  findings: SanitizationFinding[];
  overallCompleteness: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  confirmedBy: string | null;
  sanitizedPackageId?: string | null;
};

// P0-5 完整脱敏：sanitized package provenance 追踪
export type SanitizedPackage = {
  packageId: string;
  capabilityId: string;
  enterpriseId: string;
  createdAt: number;
  createdBy: string;
  // 完整 resolution 记录（逐项处理）
  resolutions: Array<{
    findingId: string;
    category: string;
    severity: "low" | "medium" | "high" | "critical";
    originalValue?: string;
    replacement: string;
    replacementType: "redact" | "tokenize" | "hash" | "substitute";
    operator: string;
    time: number;
  }>;
  // 脱敏产物元数据
  artifact: {
    contentHash: string; // SHA256 of sanitized content
    sizeBytes: number;
    manifestHash: string; // SHA256 of resolutions manifest
  };
  // 审计字段
  reviewedBy?: string;
  reviewedAt?: number;
};

const sanitizationSessions = new Map<string, SanitizationSession>();
const sanitizedPackages = new Map<string, SanitizedPackage>();

// SanitizedPackage CRUD
export function getSanitizedPackage(packageId: string): SanitizedPackage | null {
  ensureLoaded();
  return sanitizedPackages.get(packageId) ?? null;
}

export function createSanitizedPackage(pkg: Omit<SanitizedPackage, "packageId">): SanitizedPackage {
  ensureLoaded();
  const packageId = `spkg-${randomUUID()}`;
  const newPkg: SanitizedPackage = { ...pkg, packageId };
  sanitizedPackages.set(packageId, newPkg);
  persist();
  return newPkg;
}

export function canSubmitToPlatform(capabilityId: string): {
  allowed: boolean;
  reason?: string;
  sanitizedPackageId?: string | null;
} {
  ensureLoaded();
  const session = sanitizationSessions.get(capabilityId);
  if (!session) {
    return { allowed: false, reason: "sanitization-not-started" };
  }
  if (session.status !== "complete") {
    return { allowed: false, reason: `sanitization-status-${session.status}` };
  }
  const unresolved = session.findings.filter((f) => !f.resolved);
  if (unresolved.length > 0) {
    return { allowed: false, reason: `unresolved-findings-${unresolved.length}` };
  }
  // P0-5 完整脱敏：必须有关联的 sanitized package
  if (!session.sanitizedPackageId || !sanitizedPackages.has(session.sanitizedPackageId)) {
    return { allowed: false, reason: "sanitized-package-provenance-missing" };
  }
  return { allowed: true, sanitizedPackageId: session.sanitizedPackageId };
}

export function getSanitizationSession(capabilityId: string): SanitizationSession | null {
  ensureLoaded();
  return sanitizationSessions.get(capabilityId) ?? null;
}

export function ensureSanitizationSession(
  capabilityId: string,
  enterpriseId: string,
): SanitizationSession {
  ensureLoaded();
  const existing = sanitizationSessions.get(capabilityId);
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const session: SanitizationSession = {
    capabilityId,
    enterpriseId,
    status: "not-started",
    findings: [],
    overallCompleteness: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    confirmedBy: null,
  };
  sanitizationSessions.set(capabilityId, session);
  persist();
  return session;
}

export function updateSanitizationSession(
  capabilityId: string,
  patch: Partial<Omit<SanitizationSession, "capabilityId" | "enterpriseId" | "createdAt">>,
): SanitizationSession | null {
  ensureLoaded();
  const session = sanitizationSessions.get(capabilityId);
  if (!session) {
    return null;
  }
  const next: SanitizationSession = {
    ...session,
    ...patch,
    updatedAt: Date.now(),
  };
  sanitizationSessions.set(capabilityId, next);
  persist();
  return next;
}

// ─────────────────────────────────────────────────────────────────────────
// Platform Submission Store (P0-6)
// ─────────────────────────────────────────────────────────────────────────

export type EnterpriseSubmissionStatus =
  | "pending-review"
  | "reviewing"
  | "published"
  | "rejected"
  | "returned-for-modification"
  | "enterprise-only";

export type EnterpriseSubmission = {
  submissionId: string;
  capabilityId: string;
  capabilityName: string;
  enterpriseId: string;
  enterpriseName: string;
  submittedAt: number;
  status: EnterpriseSubmissionStatus;
  sanitized: boolean;
  sanitizationFindings: number;
  sourceProvenance: string;
  reviewerId: string | null;
  reviewedAt: number | null;
  rejectionReason: string | null;
  returnNotes: string | null;
  publishedAt: number | null;
  // P0-5 完整脱敏：关联 sanitized package provenance
  sanitizedPackageId?: string | null;
};

const enterpriseSubmissions = new Map<string, EnterpriseSubmission>();

export function getEnterpriseSubmission(submissionId: string): EnterpriseSubmission | null {
  ensureLoaded();
  return enterpriseSubmissions.get(submissionId) ?? null;
}

export function listEnterpriseSubmissions(filter?: {
  status?: EnterpriseSubmissionStatus;
  enterpriseId?: string;
}): EnterpriseSubmission[] {
  ensureLoaded();
  const all = Array.from(enterpriseSubmissions.values());
  if (!filter) {
    return all;
  }
  return all.filter((s) => {
    if (filter.status && s.status !== filter.status) {
      return false;
    }
    if (filter.enterpriseId && s.enterpriseId !== filter.enterpriseId) {
      return false;
    }
    return true;
  });
}

export function createEnterpriseSubmission(
  input: Omit<
    EnterpriseSubmission,
    | "submittedAt"
    | "status"
    | "reviewerId"
    | "reviewedAt"
    | "rejectionReason"
    | "returnNotes"
    | "publishedAt"
  >,
): EnterpriseSubmission {
  ensureLoaded();
  const now = Date.now();
  const submission: EnterpriseSubmission = {
    ...input,
    submittedAt: now,
    status: "pending-review",
    reviewerId: null,
    reviewedAt: null,
    rejectionReason: null,
    returnNotes: null,
    publishedAt: null,
  };
  enterpriseSubmissions.set(input.submissionId, submission);
  persist();
  return submission;
}

export function updateEnterpriseSubmission(
  submissionId: string,
  patch: Partial<Omit<EnterpriseSubmission, "submissionId">>,
): EnterpriseSubmission | null {
  ensureLoaded();
  const existing = enterpriseSubmissions.get(submissionId);
  if (!existing) {
    return null;
  }
  const next: EnterpriseSubmission = { ...existing, ...patch };
  enterpriseSubmissions.set(submissionId, next);
  persist();
  return next;
}

// ─────────────────────────────────────────────────────────────────────────
// Governance Event Store (P1-3)
// ─────────────────────────────────────────────────────────────────────────

export type GovernanceEventType =
  | "install"
  | "uninstall"
  | "restrict"
  | "disable"
  | "review-escalation"
  | "external-filing";

export type GovernanceEvent = {
  eventId: string;
  timestamp: number;
  type: GovernanceEventType;
  capabilityId: string;
  capabilityName: string;
  actorId: string;
  actorType: "employee" | "admin" | "system" | "robot";
  targetRobotId?: string;
  detail: string;
  severity: "low" | "medium" | "high" | "critical";
  enterpriseId?: string;
  installRequestId?: string;
  bindingId?: string;
};

const governanceEvents: GovernanceEvent[] = [];

export function recordGovernanceEvent(
  event: Omit<GovernanceEvent, "eventId" | "timestamp">,
): GovernanceEvent {
  ensureLoaded();
  const fullEvent: GovernanceEvent = {
    ...event,
    eventId: `evt-${randomUUID()}`,
    timestamp: Date.now(),
  };
  governanceEvents.push(fullEvent);
  persist();
  return fullEvent;
}

export function listGovernanceEvents(filter?: {
  enterpriseId?: string;
  type?: GovernanceEventType;
  capabilityId?: string;
  targetRobotId?: string;
}): GovernanceEvent[] {
  ensureLoaded();
  let result = governanceEvents.slice();
  if (!filter) {
    return result;
  }
  if (filter.enterpriseId) {
    result = result.filter((e) => e.enterpriseId === filter.enterpriseId);
  }
  if (filter.type) {
    result = result.filter((e) => e.type === filter.type);
  }
  if (filter.capabilityId) {
    result = result.filter((e) => e.capabilityId === filter.capabilityId);
  }
  if (filter.targetRobotId) {
    result = result.filter((e) => e.targetRobotId === filter.targetRobotId);
  }
  return result;
}

// 导出测试辅助以便集成测试可以重置 store
export const __capabilityInstallGovernanceStoreInternals = {
  reset: () => {
    loadAttempted = false;
    sanitizationSessions.clear();
    enterpriseSubmissions.clear();
    governanceEvents.length = 0;
    sanitizedPackages.clear();
    try {
      if (fs.existsSync(STORE_FILE)) {
        fs.unlinkSync(STORE_FILE);
      }
    } catch {
      // ignore
    }
  },
};
