import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeRecoveryReceiptToken,
  readGovernanceRecoveryReceipt,
  writeGovernanceRecoveryReceipt,
} from "./recovery-receipt.js";
import {
  getSharedDataGovernanceCatalog,
  projectDurableWorkspaceToResolver,
  resetSharedDataGovernanceCatalogForTests,
  transitionCatalogLifecycle,
  upsertWorkspaceGovernanceRecord,
} from "./runtime-catalog.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("upsertWorkspaceGovernanceRecord lifecycle preservation", () => {
  it("does not reactivate recovery_required / quarantined / archived on re-upsert", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-upsert-life-"));
    tempDirs.push(stateDir);
    const ownerScope = {
      kind: "user_owned" as const,
      userId: "u1",
      agentAssetId: "asset-1",
      proof: {
        source: "explicit_binding" as const,
        ownerType: "user" as const,
        ownerId: "u1",
        agentAssetId: "asset-1",
      },
    };
    const resourceId = "ws-life-1";
    await upsertWorkspaceGovernanceRecord({
      stateDir,
      resourceId,
      tenantId: "t1",
      ownerScope,
      locator: path.join(stateDir, "ws"),
      classification: "internal",
    });

    for (const lifecycleState of ["recovery_required", "quarantined", "archived"] as const) {
      await transitionCatalogLifecycle({
        stateDir,
        resourceId,
        lifecycleState,
      });
      const before = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
      expect(before?.envelope.lifecycleState).toBe(lifecycleState);

      const afterUpsert = await upsertWorkspaceGovernanceRecord({
        stateDir,
        resourceId,
        tenantId: "t1",
        ownerScope,
        locator: path.join(stateDir, "ws"),
        classification: "internal",
        lifecycleState: "active",
      });
      expect(afterUpsert.envelope.lifecycleState).toBe(lifecycleState);

      const projected = projectDurableWorkspaceToResolver({
        record: afterUpsert,
        fallbackOwnerScope: ownerScope,
      });
      expect(projected.resource.lifecycleState).toBe(
        lifecycleState === "archived" ? "archived" : lifecycleState,
      );
      expect(projected.resource.governanceVersion).toBe(afterUpsert.envelope.governanceVersion);
    }
  });
});

describe("recovery receipt path safety", () => {
  it("rejects path traversal tokens", () => {
    expect(() => assertSafeRecoveryReceiptToken("../etc", "operationId")).toThrow(
      /invalid_recovery_operationId/,
    );
    expect(() => assertSafeRecoveryReceiptToken("op/../../x", "operationId")).toThrow(
      /invalid_recovery_operationId/,
    );
    expect(() => assertSafeRecoveryReceiptToken("stage/../passwd", "stage")).toThrow(
      /invalid_recovery_stage/,
    );
  });

  it("readGovernanceRecoveryReceipt throws on traversal and does not escape root", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-receipt-trav-"));
    tempDirs.push(stateDir);
    expect(() =>
      readGovernanceRecoveryReceipt({
        stateDir,
        operationId: "../secrets",
        stage: "config_restore",
      }),
    ).toThrow(/invalid_recovery/);

    writeGovernanceRecoveryReceipt({
      stateDir,
      operationId: "op-safe-1",
      stage: "config_restore",
      reason: "test",
      haltCompensation: true,
    });
    const got = readGovernanceRecoveryReceipt({
      stateDir,
      operationId: "op-safe-1",
      stage: "config_restore",
    });
    expect(got?.operationId).toBe("op-safe-1");
  });
});
