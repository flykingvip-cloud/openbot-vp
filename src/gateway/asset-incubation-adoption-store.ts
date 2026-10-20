import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";
import { getPersonalSkillAssetDetail, listPersonalSkillAssets } from "./skill-lifecycle-store.js";

const BASE_DIR = path.join(CONFIG_DIR, "asset-incubation");
const ADOPTION_SIGNALS_FILE = path.join(BASE_DIR, "adoption-signals.json");
const CONTEXT_CAPABILITY_LINKS_FILE = path.join(BASE_DIR, "context-capability-links.json");
const USER_INITIATED_SAVES_FILE = path.join(BASE_DIR, "user-initiated-saves.json");

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type AdoptionSignalKind =
  | "share_to_group"
  | "enterprise_submit"
  | "member_use"
  | "admin_recommend";

export type AdoptionSignalRecord = {
  id: string;
  ownerKey: string;
  capabilityId: string;
  kind: AdoptionSignalKind;
  memberId: string | null;
  occurredAt: number;
};

export type ContextCapabilityLinkRecord = {
  ownerKey: string;
  contextId: string;
  capabilityId: string;
  linkedAt: number;
};

export type UserInitiatedSaveRecord = {
  id: string;
  ownerKey: string;
  contextId: string | null;
  capabilityId: string | null;
  occurredAt: number;
};

export type AssetAdoptionEvidenceSummary = {
  distinctMemberCount: number;
  sharedToGroup: boolean;
  adminRecommended: boolean;
  enterpriseSubmitted: boolean;
};

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function normalizeOwnerKey(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : "local";
}

function adoptionFromSkillDetail(capabilityId: string): AssetAdoptionEvidenceSummary | null {
  try {
    const detail = getPersonalSkillAssetDetail(capabilityId);
    const sharedGroupCount = detail.dependencyGraph.sharedGroups.length;
    const sharedToGroup = sharedGroupCount > 0 || detail.profile.visibility === "group";
    const enterpriseSubmitted =
      detail.profile.visibility === "enterprise" ||
      detail.lifecycle === "reviewing" ||
      detail.lifecycle === "published";
    const distinctMemberCount = Math.max(
      detail.dependencyGraph.installedRobots.length,
      sharedGroupCount,
    );
    if (!sharedToGroup && !enterpriseSubmitted && distinctMemberCount === 0) {
      return null;
    }
    return {
      distinctMemberCount,
      sharedToGroup,
      adminRecommended: false,
      enterpriseSubmitted,
    };
  } catch {
    return null;
  }
}

export function recordAdoptionSignal(params: {
  ownerKey: string;
  capabilityId: string;
  kind: AdoptionSignalKind;
  memberId?: string | null;
  occurredAt?: number;
}): AdoptionSignalRecord {
  const owner = normalizeOwnerKey(params.ownerKey);
  const capabilityId = params.capabilityId.trim();
  const occurredAt = params.occurredAt ?? Date.now();
  const record: AdoptionSignalRecord = {
    id: `${owner}:${capabilityId}:${params.kind}:${occurredAt}:${Math.random().toString(36).slice(2, 8)}`,
    ownerKey: owner,
    capabilityId,
    kind: params.kind,
    memberId: params.memberId?.trim() || null,
    occurredAt,
  };
  const all = readJsonFile<AdoptionSignalRecord[]>(ADOPTION_SIGNALS_FILE, []);
  atomicWriteJson(ADOPTION_SIGNALS_FILE, [...all, record].slice(-2000));
  return record;
}

export function linkContextToCapability(params: {
  ownerKey: string;
  contextId: string;
  capabilityId: string;
  linkedAt?: number;
}): ContextCapabilityLinkRecord {
  const owner = normalizeOwnerKey(params.ownerKey);
  const contextId = params.contextId.trim();
  const capabilityId = params.capabilityId.trim();
  const linkedAt = params.linkedAt ?? Date.now();
  const all = readJsonFile<ContextCapabilityLinkRecord[]>(CONTEXT_CAPABILITY_LINKS_FILE, []);
  const withoutCurrent = all.filter(
    (entry) => !(entry.ownerKey === owner && entry.contextId === contextId),
  );
  const record: ContextCapabilityLinkRecord = {
    ownerKey: owner,
    contextId,
    capabilityId,
    linkedAt,
  };
  atomicWriteJson(CONTEXT_CAPABILITY_LINKS_FILE, [...withoutCurrent, record].slice(-1000));
  return record;
}

export function resolveCapabilityIdForContext(
  ownerKey: string,
  contextId: string | null | undefined,
): string | null {
  const owner = normalizeOwnerKey(ownerKey);
  const normalizedContextId = contextId?.trim();
  if (!normalizedContextId) {
    return null;
  }
  const all = readJsonFile<ContextCapabilityLinkRecord[]>(CONTEXT_CAPABILITY_LINKS_FILE, []);
  const match = all.find(
    (entry) => entry.ownerKey === owner && entry.contextId === normalizedContextId,
  );
  return match?.capabilityId ?? null;
}

export function recordUserInitiatedSave(params: {
  ownerKey: string;
  contextId?: string | null;
  capabilityId?: string | null;
  occurredAt?: number;
}): UserInitiatedSaveRecord {
  const owner = normalizeOwnerKey(params.ownerKey);
  const occurredAt = params.occurredAt ?? Date.now();
  const contextId = params.contextId?.trim() || null;
  const capabilityId = params.capabilityId?.trim() || null;
  const record: UserInitiatedSaveRecord = {
    id: `${owner}:${contextId ?? capabilityId ?? "unknown"}:${occurredAt}`,
    ownerKey: owner,
    contextId,
    capabilityId,
    occurredAt,
  };
  const cutoff = occurredAt - RETENTION_MS;
  const all = readJsonFile<UserInitiatedSaveRecord[]>(USER_INITIATED_SAVES_FILE, []);
  const retained = all.filter((entry) => entry.ownerKey !== owner || entry.occurredAt >= cutoff);
  atomicWriteJson(USER_INITIATED_SAVES_FILE, [...retained, record].slice(-1000));
  return record;
}

export function countUserInitiatedSaves(params: {
  ownerKey: string;
  contextId?: string | null;
  capabilityId?: string | null;
  now?: number;
}): number {
  const owner = normalizeOwnerKey(params.ownerKey);
  const now = params.now ?? Date.now();
  const cutoff = now - RETENTION_MS;
  const contextId = params.contextId?.trim() || null;
  const capabilityId = params.capabilityId?.trim() || null;
  const all = readJsonFile<UserInitiatedSaveRecord[]>(USER_INITIATED_SAVES_FILE, []);
  return all.filter((entry) => {
    if (entry.ownerKey !== owner || entry.occurredAt < cutoff) {
      return false;
    }
    if (contextId && entry.contextId === contextId) {
      return true;
    }
    if (capabilityId && entry.capabilityId === capabilityId) {
      return true;
    }
    return !contextId && !capabilityId;
  }).length;
}

function collectGlobalMemberIdsForCapability(capabilityId: string, cutoff: number): Set<string> {
  const memberIds = new Set<string>();
  for (const signal of readJsonFile<AdoptionSignalRecord[]>(ADOPTION_SIGNALS_FILE, [])) {
    if (
      signal.capabilityId === capabilityId &&
      signal.kind === "member_use" &&
      signal.occurredAt >= cutoff &&
      signal.memberId
    ) {
      memberIds.add(signal.memberId);
    }
  }
  return memberIds;
}

function hasGlobalAdminRecommend(capabilityId: string, cutoff: number): boolean {
  return readJsonFile<AdoptionSignalRecord[]>(ADOPTION_SIGNALS_FILE, []).some(
    (entry) =>
      entry.capabilityId === capabilityId &&
      entry.kind === "admin_recommend" &&
      entry.occurredAt >= cutoff,
  );
}

export function recordAdminRecommendForCapability(params: {
  capabilityId: string;
  recommenderId?: string | null;
  ownerKey?: string | null;
  occurredAt?: number;
}): AdoptionSignalRecord {
  return recordAdoptionSignal({
    ownerKey: params.ownerKey?.trim() || "platform",
    capabilityId: params.capabilityId,
    kind: "admin_recommend",
    memberId: params.recommenderId ?? null,
    occurredAt: params.occurredAt,
  });
}

export function listAdminRecommendedCapabilities(params: {
  ownerKey: string;
  now?: number;
}): Array<{ capabilityId: string; capabilityName: string | null }> {
  const owner = normalizeOwnerKey(params.ownerKey);
  const now = params.now ?? Date.now();
  const cutoff = now - RETENTION_MS;
  const ownedSkillIds = new Set(listPersonalSkillAssets().map((skill) => skill.id));
  const seen = new Set<string>();
  const result: Array<{ capabilityId: string; capabilityName: string | null }> = [];

  for (const signal of readJsonFile<AdoptionSignalRecord[]>(ADOPTION_SIGNALS_FILE, [])) {
    if (signal.kind !== "admin_recommend" || signal.occurredAt < cutoff) {
      continue;
    }
    if (seen.has(signal.capabilityId)) {
      continue;
    }
    const ownedByOwner =
      signal.ownerKey === owner ||
      signal.ownerKey === "platform" ||
      ownedSkillIds.has(signal.capabilityId);
    if (!ownedByOwner) {
      continue;
    }
    seen.add(signal.capabilityId);
    let capabilityName: string | null = null;
    try {
      capabilityName = getPersonalSkillAssetDetail(signal.capabilityId).profile.name;
    } catch {
      capabilityName = null;
    }
    result.push({ capabilityId: signal.capabilityId, capabilityName });
  }

  return result;
}

export function summarizeAdoptionEvidence(params: {
  ownerKey: string;
  capabilityId?: string | null;
  contextId?: string | null;
  now?: number;
}): AssetAdoptionEvidenceSummary {
  const owner = normalizeOwnerKey(params.ownerKey);
  const now = params.now ?? Date.now();
  const cutoff = now - RETENTION_MS;
  const capabilityId =
    params.capabilityId?.trim() || resolveCapabilityIdForContext(owner, params.contextId) || null;

  const summary: AssetAdoptionEvidenceSummary = {
    distinctMemberCount: 0,
    sharedToGroup: false,
    adminRecommended: false,
    enterpriseSubmitted: false,
  };

  if (capabilityId) {
    const fromSkill = adoptionFromSkillDetail(capabilityId);
    if (fromSkill) {
      summary.distinctMemberCount = Math.max(
        summary.distinctMemberCount,
        fromSkill.distinctMemberCount,
      );
      summary.sharedToGroup = summary.sharedToGroup || fromSkill.sharedToGroup;
      summary.enterpriseSubmitted = summary.enterpriseSubmitted || fromSkill.enterpriseSubmitted;
    }
  }

  const signals = readJsonFile<AdoptionSignalRecord[]>(ADOPTION_SIGNALS_FILE, []).filter(
    (entry) =>
      entry.ownerKey === owner &&
      entry.occurredAt >= cutoff &&
      (!capabilityId || entry.capabilityId === capabilityId),
  );

  const memberIds = new Set<string>();
  for (const signal of signals) {
    if (signal.kind === "share_to_group") {
      summary.sharedToGroup = true;
    }
    if (signal.kind === "enterprise_submit") {
      summary.enterpriseSubmitted = true;
    }
    if (signal.kind === "admin_recommend") {
      summary.adminRecommended = true;
    }
    if (signal.kind === "member_use" && signal.memberId) {
      memberIds.add(signal.memberId);
    }
  }
  summary.distinctMemberCount = Math.max(summary.distinctMemberCount, memberIds.size);

  if (capabilityId) {
    const globalMembers = collectGlobalMemberIdsForCapability(capabilityId, cutoff);
    summary.distinctMemberCount = Math.max(summary.distinctMemberCount, globalMembers.size);
    if (hasGlobalAdminRecommend(capabilityId, cutoff)) {
      summary.adminRecommended = true;
    }
  }

  return summary;
}
