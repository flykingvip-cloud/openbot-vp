/**
 * Data Governance v2 P0 workspace ownership and catalog contracts.
 * See `.kiro/specs/data-governance-v2/cursor-execution-instruction.md`.
 */

export type OwnershipProof =
  | {
      source: "registry";
      ownerType: "user" | "membership";
      ownerId: string;
      agentAssetId: string;
    }
  | {
      source: "explicit_binding";
      ownerType: "user";
      ownerId: string;
      agentAssetId: string;
    };

/**
 * Ordinary Agent workspace ownership. Steward remains an explicit system
 * exception outside this union (documented separately).
 */
export type WorkspaceOwnerScope =
  | {
      kind: "user_owned";
      userId: string;
      agentAssetId: string;
      proof: OwnershipProof;
    }
  | {
      kind: "position_owned";
      seatId: string;
      agentAssetId: string;
    }
  | {
      kind: "group_owned";
      groupId: string;
    }
  | {
      kind: "unknown";
      reason: string;
    };

export type WorkspaceInventoryRecord = {
  candidateId: string;
  normalizedRootClass: string;
  tenantRef: string | null;
  ownerRef: string | null;
  agentId: string | null;
  agentAssetId: string | null;
  groupId: string | null;
  ownershipStatus: "proved" | "unknown" | "conflict";
  bindingRole: "writer" | "reader" | "duplicate" | "risk_candidate" | "unknown";
  fileCount: number;
  byteCount: number;
  contentDigest: string | null;
  truncated: boolean;
  errors: string[];
};

export type WorkspaceResourceRecord = {
  resourceId: string;
  resourceType: "workspace";
  tenantId: string | null;
  ownerScope: WorkspaceOwnerScope;
  /**
   * Includes governance Catalog lifecycles projected into the resolver.
   * Non-active states (except read_only reads) must fail closed.
   */
  lifecycleState:
    | "active"
    | "read_only"
    | "retired"
    | "pending"
    | "recovery_required"
    | "quarantined"
    | "archived";
  classification: string;
  governanceVersion: number;
};

export type WorkspaceBindingRecord = {
  bindingId: string;
  resourceId: string;
  role: "canonical" | "compatibility";
  locator: string;
  state: "active" | "read_only" | "retired";
  contentVersion: string;
};
