export const WORKSPACE_INVENTORY_RAW_SCHEMA = "workspace-inventory/v1" as const;
export const WORKSPACE_INVENTORY_SUMMARY_SCHEMA = "workspace-inventory-summary/v1" as const;

export type WorkspaceOwnershipStatus = "proved" | "unknown" | "conflict";
export type WorkspaceBindingRole = "writer" | "reader" | "duplicate" | "risk_candidate" | "unknown";

/** v4.1 §4 durability. Supplements root class; it is not a second state machine. */
export type WorkspaceDurabilityClass =
  | "PERSISTENT"
  | "SECRET"
  | "SHARED_READONLY"
  | "EPHEMERAL"
  | "LEGACY"
  | "UNKNOWN";

export type WorkspaceInventoryRecord = {
  candidateId: string;
  normalizedRootClass: string;
  durabilityClass: WorkspaceDurabilityClass;
  tenantRef: string | null;
  ownerRef: string | null;
  agentId: string | null;
  agentAssetId: string | null;
  groupId: string | null;
  ownershipStatus: WorkspaceOwnershipStatus;
  bindingRole: WorkspaceBindingRole;
  fileCount: number;
  byteCount: number;
  contentDigest: string | null;
  truncated: boolean;
  errors: string[];
};

export type WorkspaceInventoryLimits = {
  maxCandidates: number;
  maxFiles: number;
  maxDepth: number;
  maxBytesRead: number;
  maxFullHashBytes: number;
};

export type WorkspaceInventoryStats = {
  candidateCount: number;
  bytesRead: number;
  errorCount: number;
  truncated: boolean;
  truncationReasons: string[];
};

export type WorkspaceInventoryReport = {
  schema: typeof WORKSPACE_INVENTORY_RAW_SCHEMA;
  mode: "inventory-raw";
  inventoryUtc: string;
  containmentRoot: string;
  limits: WorkspaceInventoryLimits;
  stats: WorkspaceInventoryStats;
  records: WorkspaceInventoryRecord[];
  quarantine: {
    unknownOwnershipCandidateIds: string[];
    duplicateContentGroups: Array<{ contentDigest: string; candidateIds: string[] }>;
  };
  notes: string[];
};

export type WorkspaceInventorySummary = {
  schema: typeof WORKSPACE_INVENTORY_SUMMARY_SCHEMA;
  evidenceId: string;
  inventoryUtc: string;
  classification: "controlled-audit-desensitized";
  limits: WorkspaceInventoryLimits;
  stats: WorkspaceInventoryStats;
  records: Array<
    Omit<
      WorkspaceInventoryRecord,
      "tenantRef" | "ownerRef" | "agentId" | "agentAssetId" | "groupId"
    > & {
      tenantRef: string | null;
      ownerRef: string | null;
      agentId: string | null;
      agentAssetId: string | null;
      groupId: string | null;
    }
  >;
  quarantine: WorkspaceInventoryReport["quarantine"];
  summarySha256Algorithm: string;
  summarySha256: string;
};

export type DiscoverCandidateDescriptor = {
  candidateId: string;
  normalizedRootClass: string;
  durabilityClass: WorkspaceDurabilityClass;
  absRoot: string;
  tenantRef: string | null;
  ownerRef: string | null;
  agentId: string | null;
  agentAssetId: string | null;
  groupId: string | null;
  bindingRole: WorkspaceBindingRole;
};
