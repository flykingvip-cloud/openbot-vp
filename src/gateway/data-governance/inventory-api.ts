import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import {
  diagnoseBindingRoles,
  diagnoseDuplicateCanonicals,
  diagnoseOrphanLocators,
  diagnoseWrongOwnerScope,
  type AuthoritativeOwnershipProof,
} from "./diagnostics.js";
import type {
  CatalogRecord,
  DataGovernanceEnvelope,
  GovernedResourceType,
  LifecycleState,
} from "./types.js";

export type InventoryListItem = {
  resourceId: string;
  resourceType: GovernedResourceType;
  tenantId: string | null;
  lifecycleState: DataGovernanceEnvelope["lifecycleState"];
  classification: DataGovernanceEnvelope["classification"];
  canonicalLocator: string | null;
  governanceVersion: number;
  updatedAt: string;
};

export type InventoryGetResult = {
  record: CatalogRecord;
  bindingIssues: ReturnType<typeof diagnoseBindingRoles>;
};

export type InventoryDiagnosticsReport = {
  duplicateCanonicals: string[];
  orphans: ReturnType<typeof diagnoseOrphanLocators>;
  wrongOwnerScope: ReturnType<typeof diagnoseWrongOwnerScope>;
  bindingIssueCount: number;
};

/** Read-only inventory surface for governed catalog types (first + second wave). */
export function createDataGovernanceInventoryApi(params: { store: DataGovernanceCatalogStore }) {
  return {
    async list(filter?: {
      resourceType?: GovernedResourceType;
      tenantId?: string | null;
      lifecycleState?: LifecycleState;
    }): Promise<InventoryListItem[]> {
      const records = await params.store.list(filter?.resourceType);
      const items: InventoryListItem[] = [];
      for (const record of records) {
        if (filter?.tenantId !== undefined && record.envelope.tenantId !== filter.tenantId) {
          continue;
        }
        if (
          filter?.lifecycleState !== undefined &&
          record.envelope.lifecycleState !== filter.lifecycleState
        ) {
          continue;
        }
        const canonical =
          record.bindings.find(
            (b) =>
              b.bindingId === record.envelope.canonicalBindingId &&
              b.role === "canonical" &&
              b.state === "active",
          ) ?? null;
        items.push({
          resourceId: record.envelope.resourceId,
          resourceType: record.envelope.resourceType,
          tenantId: record.envelope.tenantId,
          lifecycleState: record.envelope.lifecycleState,
          classification: record.envelope.classification,
          canonicalLocator: canonical?.locator ?? null,
          governanceVersion: record.envelope.governanceVersion,
          updatedAt: record.envelope.updatedAt,
        });
      }
      return items.toSorted((a, b) => a.resourceId.localeCompare(b.resourceId));
    },

    /** Machine-checkable Gate A3: list recovery_required catalog rows. */
    async listRecoveryRequired(filter?: {
      tenantId?: string | null;
      resourceType?: GovernedResourceType;
    }): Promise<InventoryListItem[]> {
      return this.list({
        ...filter,
        lifecycleState: "recovery_required",
      });
    },

    async get(resourceId: string): Promise<InventoryGetResult | null> {
      const record = await params.store.get(resourceId);
      if (!record) {
        return null;
      }
      return {
        record,
        bindingIssues: diagnoseBindingRoles(record),
      };
    },

    async diagnose(paramsIn?: {
      observedLocators?: string[];
      resourceTypeHints?: Record<string, GovernedResourceType>;
      ownershipProofs?: AuthoritativeOwnershipProof[];
      requireProofForTypes?: GovernedResourceType[];
    }): Promise<InventoryDiagnosticsReport> {
      const records = await params.store.list();
      let bindingIssueCount = 0;
      for (const record of records) {
        bindingIssueCount += diagnoseBindingRoles(record).length;
      }
      return {
        duplicateCanonicals: diagnoseDuplicateCanonicals(records),
        orphans: diagnoseOrphanLocators({
          observedLocators: paramsIn?.observedLocators ?? [],
          records,
          resourceTypeHints: paramsIn?.resourceTypeHints,
        }),
        wrongOwnerScope: diagnoseWrongOwnerScope({
          records,
          proofs: paramsIn?.ownershipProofs ?? [],
          requireProofForTypes: paramsIn?.requireProofForTypes,
        }),
        bindingIssueCount,
      };
    },
  };
}

export type DataGovernanceInventoryApi = ReturnType<typeof createDataGovernanceInventoryApi>;
