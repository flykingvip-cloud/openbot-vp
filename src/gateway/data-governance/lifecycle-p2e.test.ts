/**
 * P2-e adapter contracts + auth matrix for the four non-vertical types.
 */

import { describe, expect, it } from "vitest";
import {
  authorizeLifecycleCommand,
  getLifecycleAdapterContract,
  LIFECYCLE_ADAPTER_CONTRACTS,
  P2E_ADAPTER_CONTRACT_TYPES,
} from "./lifecycle-adapter-matrix.js";
import { resolvePurgeDestructiveAdapter } from "./lifecycle-purge-adapters.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";

describe("P2-e adapter contract matrix", () => {
  it("covers exactly four adapter-contract types", () => {
    expect([...P2E_ADAPTER_CONTRACT_TYPES].toSorted()).toEqual(
      ["agent", "knowledge", "operational_identity", "workspace"].toSorted(),
    );
    for (const t of P2E_ADAPTER_CONTRACT_TYPES) {
      expect(getLifecycleAdapterContract(t).scope).toBe("adapter_contract");
    }
  });

  it("keeps conversation_archive full and memory forget_slice", () => {
    expect(LIFECYCLE_ADAPTER_CONTRACTS.conversation_archive.scope).toBe("full");
    expect(LIFECYCLE_ADAPTER_CONTRACTS.conversation_archive.commands.archive).toBe("full");
    expect(LIFECYCLE_ADAPTER_CONTRACTS.conversation_archive.commands.forget).toBe("deny");
    expect(LIFECYCLE_ADAPTER_CONTRACTS.memory.scope).toBe("forget_slice");
    expect(LIFECYCLE_ADAPTER_CONTRACTS.memory.commands.forget).toBe("full");
    expect(LIFECYCLE_ADAPTER_CONTRACTS.memory.commands.archive).toBe("deny");
  });

  it("A7: owner may requestPurge; user may not resumePurge; worker may", () => {
    const owner = authorizeLifecycleCommand({
      resourceType: "workspace",
      command: "requestPurge",
      actor: { kind: "user", userId: "u1" },
    });
    expect(owner.ok).toBe(true);

    const userResume = authorizeLifecycleCommand({
      resourceType: "workspace",
      command: "resumePurge",
      actor: { kind: "user", userId: "u1" },
    });
    expect(userResume.ok).toBe(false);
    if (!userResume.ok) {
      expect(userResume.reason).toBe("actor_not_authorized");
    }

    const workerResume = authorizeLifecycleCommand({
      resourceType: "agent",
      command: "resumePurge",
      actor: { kind: "worker", workerId: "w1" },
    });
    expect(workerResume.ok).toBe(true);

    const userHold = authorizeLifecycleCommand({
      resourceType: "knowledge",
      command: "applyLegalHold",
      actor: { kind: "user", userId: "u1" },
    });
    expect(userHold.ok).toBe(false);

    const opHold = authorizeLifecycleCommand({
      resourceType: "operational_identity",
      command: "applyLegalHold",
      actor: { kind: "operator", operatorId: "op1" },
    });
    expect(opHold.ok).toBe(true);
  });

  it("denies forget on the four adapter-contract types", () => {
    for (const t of P2E_ADAPTER_CONTRACT_TYPES) {
      const d = authorizeLifecycleCommand({
        resourceType: t,
        command: "forget",
        actor: { kind: "user", userId: "u1" },
      });
      expect(d.ok).toBe(false);
      if (!d.ok) {
        expect(d.reason).toBe("command_denied_for_type");
      }
    }
  });

  it("resolves FS purge adapter for each of the four types", () => {
    for (const resourceType of P2E_ADAPTER_CONTRACT_TYPES) {
      const record: CatalogRecord = {
        envelope: {
          resourceId: `${resourceType}-1`,
          resourceType,
          schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
          tenantId: "t1",
          owner: { kind: "user", userId: "u1" },
          scope: { kind: "tenant", tenantId: "t1" },
          lifecycleState: "deletion_pending",
          classification: "internal",
          governanceVersion: 1,
          canonicalBindingId: "b1",
          createdAt: "2026-08-12T00:00:00Z",
          updatedAt: "2026-08-12T00:00:00Z",
        },
        bindings: [
          {
            bindingId: "b1",
            resourceId: `${resourceType}-1`,
            role: "canonical",
            storageKind: "filesystem",
            locator: `/tmp/${resourceType}-1`,
            state: "active",
            contentVersion: "1",
          },
        ],
      };
      const adapter = resolvePurgeDestructiveAdapter(record);
      expect(typeof adapter).toBe("function");
      expect(getLifecycleAdapterContract(resourceType).purgeDestructive).toBe("filesystem");
    }
  });
});
