// Capability Governance types.
//
// Schema draws from AI-First's `CapabilitySpec` (contracts + behavior +
// lifecycle) and the SKILL_PACK_STANDARD (lifecycle states, risk levels),
// but is pure TypeScript and tenant-aware. OpenBot's existing
// `SkillStatusEntry` is normalized into this model (see `normalizer.ts`).
//
// Design notes:
// - A `CapabilityManifest` is the platform-registered contract of a
//   capability. It is *not* the executable skill — it describes what the
//   platform admin has approved for distribution.
// - A `CapabilityProposal` is a candidate seen by the platform but not
//   yet approved. External sources (npm, GitHub topic, clawhub, etc.)
//   always land here first — never directly in the registry.
// - Distribution is a 3D matrix: capability × tenant × channel/agent.

export type CapabilityKind = "skill" | "pack" | "mcp" | "channel-action";

export type CapabilityCategoryId =
  | "chat"
  | "vision"
  | "rag"
  | "ocr"
  | "search"
  | "workflow"
  | "automation"
  | "browser"
  | "code"
  | "integration"
  | "media"
  | "other";

export type CapabilitySourceKind =
  | "bundled" // openbot first-party bundled skill
  | "workspace" // user workspace skill
  | "managed" // ~/.openbot/skills managed dir (legacy ~/.openclaw still accepted)
  | "plugin" // skill shipped by a plugin/extension
  | "extra" // extra dir via config
  | "personal" // ~/.agents/skills personal dir
  | "upload" // uploaded through platform UI
  | "npm" // fetched from npm registry (external)
  | "github" // fetched from GitHub topic (external)
  | "clawhub" // fetched from Clawhub marketplace (external)
  | "mcp-registry"; // fetched from MCP registry (external)

export type CapabilitySideEffect =
  | "read_only"
  | "filesystem_read"
  | "filesystem_write"
  | "network_read"
  | "network_write"
  | "subprocess"
  | "secrets_read"
  | "secrets_write";

export type CapabilityCostModel =
  | "free"
  | "network_io"
  | "per_call"
  | "per_token"
  | "filesystem_io"
  | "subprocess";

export type CapabilityRiskLevel = "low" | "medium" | "high" | "critical";

export type CapabilityRiskProfile = {
  level: CapabilityRiskLevel;
  network: boolean;
  filesystem: boolean;
  subprocess: boolean;
  secrets: boolean;
  notes?: string;
};

export type CapabilityInstallSpec = {
  id: string;
  kind: "brew" | "node" | "go" | "uv" | "apt" | "download";
  label: string;
  bins: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
};

export type CapabilityIOField = {
  name: string;
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  description?: string;
  required?: boolean;
};

export type CapabilityContracts = {
  // Side effects; empty implies read_only.
  sideEffects: readonly CapabilitySideEffect[];
  idempotent: boolean;
  requiresConfirmation: boolean;
  timeoutSeconds?: number;
};

export type CapabilityBehavior = {
  undoStrategy?: string;
  costModel: CapabilityCostModel;
};

export type CapabilityRequirements = {
  bins: readonly string[];
  env: readonly string[];
  configPaths: readonly string[];
  operatingSystems: readonly string[];
  // Models the capability depends on (by role).
  models?: ReadonlyArray<{ role: "primary" | "fallback"; caps?: readonly string[] }>;
};

// Normalized capability source reference.
export type CapabilitySourceRef = {
  kind: CapabilitySourceKind;
  origin: string; // raw source path/URL/package name
  trustTier: "first-party" | "workspace" | "user" | "third-party" | "external";
};

export type CapabilityManifest = {
  // Stable platform URN-like id, e.g. "urn:openbot:skill:github@1.0.0".
  id: string;
  kind: CapabilityKind;
  version: string;
  // The canonical skill key this manifest tracks (matches SkillStatusEntry.skillKey).
  skillKey: string;
  name: string;
  description: string;
  descriptionZh?: string;
  categoryId?: CapabilityCategoryId;
  emoji?: string;
  homepage?: string;
  author?: string;
  source: CapabilitySourceRef;
  interface: {
    inputs: readonly CapabilityIOField[];
    outputs: readonly CapabilityIOField[];
  };
  contracts: CapabilityContracts;
  behavior: CapabilityBehavior;
  requirements: CapabilityRequirements;
  install: readonly CapabilityInstallSpec[];
  risk: CapabilityRiskProfile;
  signature?: { algo: string; value: string; issuer: string };
};

// Lifecycle states borrowed from SKILL_PACK_STANDARD.
// Draft and Review are pre-registry (still a proposal).
// Approved / Active mean the manifest is in the platform registry.
// Deprecated / Retired are post-active.
export type CapabilityLifecycleState =
  | "draft"
  | "review"
  | "approved"
  | "active"
  | "deprecated"
  | "retired";

export type CapabilityLifecycleEvent = {
  capabilityId: string;
  fromState: CapabilityLifecycleState | null; // null = initial
  toState: CapabilityLifecycleState;
  at: string; // ISO timestamp
  actor?: string;
  notes?: string;
};

// A proposal is what lands from external/unknown sources *before* the
// platform admin approves it. Proposals may come in bulk, but each
// capability is an independent proposal.
export type CapabilityProposalStatus =
  | "proposed" // just ingested
  | "under_review" // platform admin is actively reviewing
  | "approved" // approved → registered as manifest
  | "rejected" // rejected (kept for audit)
  | "withdrawn"; // source/author withdrew

export type SecurityFindingSeverity = "info" | "low" | "medium" | "high" | "critical";
export type SecurityFindingCategory =
  | "typosquat" // name is suspiciously similar to a trusted package
  | "missing_signature"
  | "cve" // known vulnerability in a declared dep
  | "license" // incompatible/unclear license
  | "suspicious_install" // install command uses curl|bash or similar
  | "ssrf"
  | "overbroad_scope"; // requires_confirmation=false + write side effect

export type SecurityFinding = {
  id: string;
  category: SecurityFindingCategory;
  severity: SecurityFindingSeverity;
  message: string;
  evidence?: string;
};

export type CapabilityProposal = {
  proposalId: string;
  submittedAt: string;
  submittedBy?: string;
  status: CapabilityProposalStatus;
  manifest: CapabilityManifest;
  findings: readonly SecurityFinding[];
  reviewer?: { id: string; at: string; note?: string };
  // Populated when status === "approved" and a registry entry was created.
  resolvedManifestId?: string;
};

// Distribution scopes describe where an active manifest is available.
// All three are optional; missing = no scoping (global within its dimension).
export type CapabilityDistributionScope = {
  tenantIds?: readonly string[]; // undefined = all tenants
  channelIds?: readonly string[]; // undefined = all channels
  agentIds?: readonly string[]; // undefined = all agents
};

export type CapabilityEmployeeVisibilityMode =
  | "enterprise_review_required"
  | "direct_employee_visible";

export type CapabilityDistributionPolicy = {
  capabilityId: string;
  scope: CapabilityDistributionScope;
  defaultEnabled: boolean; // pushes active on matching tenants by default
  employeeVisibilityMode: CapabilityEmployeeVisibilityMode;
  updatedAt: string;
  updatedBy?: string;
};

export type CapabilityRegistryEntry = {
  manifest: CapabilityManifest;
  lifecycleState: CapabilityLifecycleState;
  lastLifecycleEvent: CapabilityLifecycleEvent;
  distribution: CapabilityDistributionPolicy;
  // Pointer back to whichever proposal spawned it (for audit).
  proposalId?: string;
};

// Lightweight invocation metric (placeholder until real telemetry lands).
export type CapabilityInvocationMetric = {
  capabilityId: string;
  invocationCount: number;
  errorCount: number;
  p95LatencyMs: number | null;
  costTotal: number | null; // in platform currency units
  periodStart: string;
  periodEnd: string;
};

// Governance snapshot used by the platform UI.
export type CapabilityGovernanceSnapshot = {
  proposals: readonly CapabilityProposal[];
  registry: readonly CapabilityRegistryEntry[];
  metrics: readonly CapabilityInvocationMetric[];
};
