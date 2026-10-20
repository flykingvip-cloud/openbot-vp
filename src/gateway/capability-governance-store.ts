// Capability Governance Store
//
// Persists proposals and registry entries as JSON files under
// ~/.openclaw/governance/. This is a minimal file-based store
// suitable for single-operator deployments. A future phase can
// swap this for a PostgreSQL-backed store without changing the
// handler interface.

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";

const GOVERNANCE_DIR = path.join(CONFIG_DIR, "governance");
const PROPOSALS_FILE = path.join(GOVERNANCE_DIR, "proposals.json");
const REGISTRY_FILE = path.join(GOVERNANCE_DIR, "registry.json");

// --- Types (mirror the UI types but kept independent for decoupling) ---

export type GovernanceProposalStatus =
  | "proposed"
  | "under_review"
  | "approved"
  | "rejected"
  | "withdrawn";

export type GovernanceSecurityFinding = {
  id: string;
  category: string;
  severity: string;
  message: string;
  evidence?: string;
};

export type GovernanceManifestSource = {
  kind: string;
  origin: string;
  trustTier: string;
};

export type GovernanceManifest = {
  id: string;
  kind: string;
  version: string;
  skillKey: string;
  name: string;
  description: string;
  descriptionZh?: string;
  source: GovernanceManifestSource;
  risk: {
    level: string;
    network: boolean;
    filesystem: boolean;
    subprocess: boolean;
    secrets: boolean;
  };
  [key: string]: unknown; // allow extra fields from the UI manifest
};

export type GovernanceProposal = {
  proposalId: string;
  submittedAt: string;
  submittedBy?: string;
  enterpriseId?: string;
  status: GovernanceProposalStatus;
  manifest: GovernanceManifest;
  findings: GovernanceSecurityFinding[];
  reviewer?: { id: string; at: string; note?: string };
  resolvedManifestId?: string;
};

export type GovernanceLifecycleState =
  | "draft"
  | "review"
  | "approved"
  | "active"
  | "deprecated"
  | "retired";

export type GovernanceDistributionScope = {
  tenantIds?: string[];
  channelIds?: string[];
  agentIds?: string[];
  departmentIds?: string[];
  groupIds?: string[];
  roleIds?: string[];
};

export type GovernanceDistributionPolicy = {
  capabilityId: string;
  scope: GovernanceDistributionScope;
  defaultEnabled: boolean;
  employeeVisibilityMode:
    | "enterprise_review_required"
    | "direct_employee_visible"
    | "enterprise_only";
  updatedAt: string;
  updatedBy?: string;
};

export type GovernanceRegistryEntry = {
  manifest: GovernanceManifest;
  lifecycleState: GovernanceLifecycleState;
  distribution: GovernanceDistributionPolicy;
  // Admin-granted enterprise maturity (e.g. "企业认证" / "企业标准"). Acts as a
  // floor over the usage-computed maturity. Set by enterprise-capability.certify
  // and enterprise-capability.promote-to-standard.
  manualMaturityGrant?: string;
  maturityGrantedBy?: string;
  maturityGrantedAt?: string;
  proposalId?: string;
  createdAt: string;
  updatedAt: string;
};

// --- File I/O helpers ---

function ensureDir(): void {
  if (!fs.existsSync(GOVERNANCE_DIR)) {
    fs.mkdirSync(GOVERNANCE_DIR, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function normalizeEmployeeVisibilityMode(
  value: unknown,
): GovernanceDistributionPolicy["employeeVisibilityMode"] {
  if (value === "direct_employee_visible") {
    return "direct_employee_visible";
  }
  if (value === "enterprise_only") {
    return "enterprise_only";
  }
  return "enterprise_review_required";
}

function normalizeDistributionPolicy(
  policy:
    | GovernanceDistributionPolicy
    | (Partial<GovernanceDistributionPolicy> & { capabilityId: string }),
): GovernanceDistributionPolicy {
  return {
    capabilityId: policy.capabilityId,
    scope: policy.scope ?? {},
    defaultEnabled: policy.defaultEnabled ?? false,
    employeeVisibilityMode: normalizeEmployeeVisibilityMode(policy.employeeVisibilityMode),
    updatedAt: policy.updatedAt ?? new Date().toISOString(),
    ...(policy.updatedBy ? { updatedBy: policy.updatedBy } : {}),
  };
}

// --- Public API ---

export function listProposals(): GovernanceProposal[] {
  return readJsonFile<GovernanceProposal[]>(PROPOSALS_FILE, []);
}

export function getProposal(proposalId: string): GovernanceProposal | null {
  const proposals = listProposals();
  return proposals.find((p) => p.proposalId === proposalId) ?? null;
}

export function submitProposal(proposal: GovernanceProposal): GovernanceProposal {
  const proposals = listProposals();
  // Dedup by proposalId
  const existing = proposals.findIndex((p) => p.proposalId === proposal.proposalId);
  if (existing >= 0) {
    proposals[existing] = proposal;
  } else {
    proposals.push(proposal);
  }
  writeJsonFile(PROPOSALS_FILE, proposals);
  return proposal;
}

export function submitProposalBatch(batch: GovernanceProposal[]): GovernanceProposal[] {
  const proposals = listProposals();
  const byId = new Map(proposals.map((p) => [p.proposalId, p]));
  for (const proposal of batch) {
    byId.set(proposal.proposalId, proposal);
  }
  const merged = [...byId.values()];
  writeJsonFile(PROPOSALS_FILE, merged);
  return batch;
}

export function updateProposalStatus(
  proposalId: string,
  status: GovernanceProposalStatus,
  reviewer?: { id: string; note?: string },
): GovernanceProposal | null {
  const proposals = listProposals();
  const idx = proposals.findIndex((p) => p.proposalId === proposalId);
  if (idx < 0) {
    return null;
  }
  const now = new Date().toISOString();
  proposals[idx] = {
    ...proposals[idx],
    status,
    reviewer: reviewer
      ? { id: reviewer.id, at: now, note: reviewer.note }
      : proposals[idx].reviewer,
  };
  writeJsonFile(PROPOSALS_FILE, proposals);
  return proposals[idx];
}

export function listRegistry(): GovernanceRegistryEntry[] {
  return readJsonFile<GovernanceRegistryEntry[]>(REGISTRY_FILE, []).map((entry) => ({
    ...entry,
    distribution: normalizeDistributionPolicy(entry.distribution),
  }));
}

export function getRegistryEntry(manifestId: string): GovernanceRegistryEntry | null {
  const registry = listRegistry();
  return registry.find((e) => e.manifest.id === manifestId) ?? null;
}

export function findRegistryEntryBySkillKey(skillKey: string): GovernanceRegistryEntry | null {
  const normalized = skillKey.trim();
  if (!normalized) {
    return null;
  }
  const registry = listRegistry();
  return registry.find((entry) => entry.manifest.skillKey === normalized) ?? null;
}

export function findProposalBySkillKey(skillKey: string): GovernanceProposal | null {
  const normalized = skillKey.trim();
  if (!normalized) {
    return null;
  }
  const proposals = listProposals();
  return (
    proposals
      .map((proposal, index) => ({ proposal, index }))
      .filter((entry) => entry.proposal.manifest.skillKey === normalized)
      .toSorted((left, right) => {
        const timestampDelta =
          Date.parse(right.proposal.submittedAt) - Date.parse(left.proposal.submittedAt);
        return timestampDelta === 0 ? right.index - left.index : timestampDelta;
      })[0]?.proposal ?? null
  );
}

export function registerCapability(
  manifest: GovernanceManifest,
  proposalId?: string,
  opts?: {
    distributionScope?: GovernanceDistributionScope;
    defaultEnabled?: boolean;
    employeeVisibilityMode?: GovernanceDistributionPolicy["employeeVisibilityMode"];
    updatedBy?: string;
  },
): GovernanceRegistryEntry {
  const registry = listRegistry();
  const now = new Date().toISOString();
  const existing = registry.findIndex((e) => e.manifest.id === manifest.id);
  const entry: GovernanceRegistryEntry = {
    manifest,
    lifecycleState: "active",
    distribution: {
      capabilityId: manifest.id,
      scope: opts?.distributionScope ?? {},
      defaultEnabled: opts?.defaultEnabled ?? manifest.source.trustTier === "first-party",
      employeeVisibilityMode: opts?.employeeVisibilityMode ?? "enterprise_review_required",
      updatedAt: now,
      ...(opts?.updatedBy ? { updatedBy: opts.updatedBy } : {}),
    },
    proposalId,
    createdAt: existing >= 0 ? registry[existing].createdAt : now,
    updatedAt: now,
  };
  if (existing >= 0) {
    registry[existing] = entry;
  } else {
    registry.push(entry);
  }
  writeJsonFile(REGISTRY_FILE, registry);
  return entry;
}

export function syncRegistryBatch(
  manifests: GovernanceManifest[],
  opts?: {
    keepExisting?: boolean;
  },
): GovernanceRegistryEntry[] {
  const existing = listRegistry();
  const existingById = new Map(existing.map((entry) => [entry.manifest.id, entry] as const));
  const now = new Date().toISOString();
  const next: GovernanceRegistryEntry[] = opts?.keepExisting === false ? [] : [...existing];
  const nextById = new Map(next.map((entry) => [entry.manifest.id, entry] as const));

  for (const manifest of manifests) {
    const prev = existingById.get(manifest.id) ?? nextById.get(manifest.id);
    const entry: GovernanceRegistryEntry = {
      manifest: {
        ...manifest,
        ...(prev?.manifest.descriptionZh ? { descriptionZh: prev.manifest.descriptionZh } : {}),
        ...(prev?.manifest.categoryId ? { categoryId: prev.manifest.categoryId } : {}),
      },
      lifecycleState: prev?.lifecycleState ?? "active",
      distribution: prev?.distribution ?? {
        capabilityId: manifest.id,
        scope: {},
        defaultEnabled: manifest.source.trustTier === "first-party",
        employeeVisibilityMode: "enterprise_review_required",
        updatedAt: now,
      },
      ...(prev?.proposalId ? { proposalId: prev.proposalId } : {}),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    const index = next.findIndex((candidate) => candidate.manifest.id === manifest.id);
    if (index >= 0) {
      next[index] = entry;
    } else {
      next.push(entry);
    }
    nextById.set(manifest.id, entry);
  }

  writeJsonFile(REGISTRY_FILE, next);
  return next;
}

export function updateRegistryLifecycle(
  manifestId: string,
  state: GovernanceLifecycleState,
): GovernanceRegistryEntry | null {
  const registry = listRegistry();
  const idx = registry.findIndex((e) => e.manifest.id === manifestId);
  if (idx < 0) {
    return null;
  }
  registry[idx] = {
    ...registry[idx],
    lifecycleState: state,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(REGISTRY_FILE, registry);
  return registry[idx];
}

export function updateRegistryDistribution(
  manifestId: string,
  scope: GovernanceDistributionScope,
  defaultEnabled: boolean,
  employeeVisibilityMode: GovernanceDistributionPolicy["employeeVisibilityMode"] = "enterprise_review_required",
  updatedBy?: string,
): GovernanceRegistryEntry | null {
  const registry = listRegistry();
  const idx = registry.findIndex((e) => e.manifest.id === manifestId);
  if (idx < 0) {
    return null;
  }
  const now = new Date().toISOString();
  registry[idx] = {
    ...registry[idx],
    distribution: {
      capabilityId: manifestId,
      scope,
      defaultEnabled,
      employeeVisibilityMode,
      updatedAt: now,
      updatedBy,
    },
    updatedAt: now,
  };
  writeJsonFile(REGISTRY_FILE, registry);
  return registry[idx];
}

/**
 * Set the admin-granted enterprise maturity on a registry entry. This is the
 * durable landing point for enterprise-capability.certify ("企业认证") and
 * promote-to-standard ("企业标准"); consumers floor the usage-computed maturity
 * with this grant.
 */
export function updateRegistryMaturityGrant(
  manifestId: string,
  maturityGrant: string,
  grantedBy?: string,
): GovernanceRegistryEntry | null {
  const registry = listRegistry();
  const idx = registry.findIndex((e) => e.manifest.id === manifestId);
  if (idx < 0) {
    return null;
  }
  const now = new Date().toISOString();
  registry[idx] = {
    ...registry[idx],
    manualMaturityGrant: maturityGrant,
    ...(grantedBy ? { maturityGrantedBy: grantedBy } : {}),
    maturityGrantedAt: now,
    updatedAt: now,
  };
  writeJsonFile(REGISTRY_FILE, registry);
  return registry[idx];
}

export function updateRegistryManifest(
  manifestId: string,
  patch: Partial<Pick<GovernanceManifest, "description" | "descriptionZh" | "name" | "categoryId">>,
): GovernanceRegistryEntry | null {
  const registry = listRegistry();
  const idx = registry.findIndex((entry) => entry.manifest.id === manifestId);
  if (idx < 0) {
    return null;
  }
  registry[idx] = {
    ...registry[idx],
    manifest: {
      ...registry[idx].manifest,
      ...patch,
    },
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(REGISTRY_FILE, registry);
  return registry[idx];
}

/**
 * Approve a proposal: transition status to "approved" and register
 * the manifest into the registry. Returns both the updated proposal
 * and the new registry entry.
 */
export function approveAndRegister(
  proposalId: string,
  reviewerId: string,
  note?: string,
  opts?: {
    manifestPatch?: Record<string, unknown>;
    distributionScope?: GovernanceDistributionScope;
    defaultEnabled?: boolean;
    employeeVisibilityMode?: GovernanceDistributionPolicy["employeeVisibilityMode"];
  },
): { proposal: GovernanceProposal; entry: GovernanceRegistryEntry } | null {
  const proposal = updateProposalStatus(proposalId, "approved", { id: reviewerId, note });
  if (!proposal) {
    return null;
  }
  const manifest = opts?.manifestPatch
    ? { ...proposal.manifest, ...opts.manifestPatch }
    : proposal.manifest;
  const entry = registerCapability(manifest, proposalId, {
    distributionScope: opts?.distributionScope,
    defaultEnabled: opts?.defaultEnabled,
    employeeVisibilityMode: opts?.employeeVisibilityMode,
    updatedBy: reviewerId,
  });
  // Update proposal with resolved manifest id
  const proposals = listProposals();
  const idx = proposals.findIndex((p) => p.proposalId === proposalId);
  if (idx >= 0) {
    proposals[idx].resolvedManifestId = entry.manifest.id;
    proposals[idx].manifest = manifest;
    writeJsonFile(PROPOSALS_FILE, proposals);
  }
  return { proposal: { ...proposal, manifest, resolvedManifestId: entry.manifest.id }, entry };
}
