/**
 * P2-c memory forget tests.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertWritableEnvelope } from "./envelope.js";
import {
  compensateMemoryForgetDomain,
  createMemoryForgetDomainVerifier,
  forgetMemoryWithGovernance,
  materializeMemoryForgetDomain,
  recoverMemoryForgetAfterRestart,
  restoreMemoryForgetAfterRestart,
} from "./lifecycle-memory-adapter.js";
import {
  fsyncDirectory,
  loadMemoryForgetStaging,
  mkdirDurableSync,
  resolveMemoryForgetStagingPaths,
  unlinkFileDurable,
  writeMemoryForgetStaging,
} from "./lifecycle-memory-staging.js";
import {
  beginMemoryForget,
  completeMemoryForget,
  runMemoryForgetTwoPhase,
} from "./lifecycle-memory.js";
import { getLifecycleReceipt } from "./lifecycle-receipt-store.js";
import { transitionCatalogLifecycleCommand } from "./lifecycle-transition.js";
import { readGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "./runtime-catalog.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const owner = { kind: "user" as const, userId: "u1" };
const scope = { kind: "tenant" as const, tenantId: "t1" };
const actor = { kind: "user" as const, userId: "u1" };
const operator = { kind: "operator" as const, operatorId: "op-hold" };

async function seedActiveMemory(
  stateDir: string,
  resourceId = "memory:t1:source:s1",
  locator = path.join(stateDir, "MEMORY.md"),
) {
  fs.mkdirSync(path.dirname(locator), { recursive: true });
  fs.writeFileSync(locator, "# mem\n");
  const now = "2026-08-12T00:00:00Z";
  const record: CatalogRecord = {
    envelope: {
      resourceId,
      resourceType: "memory",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: "t1",
      owner,
      scope,
      lifecycleState: "active",
      classification: "confidential",
      governanceVersion: 2,
      canonicalBindingId: "bind-m1",
      createdAt: now,
      updatedAt: now,
      projection: { canonicalKind: "markdown_root" },
    },
    bindings: [
      {
        bindingId: "bind-m1",
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator,
        state: "active",
        contentVersion: "1",
      },
    ],
  };
  await getSharedDataGovernanceCatalog({ stateDir }).put(record);
  return record;
}

describe("P2-c memory forget", () => {
  it("phase1 keeps lifecycle active and denies writes", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-p1-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-1",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.activeLifecycleOperation?.command).toBe("forget");
    expect(() => assertWritableEnvelope(record!.envelope)).toThrow(/active_lifecycle_operation/);
  });

  it("does not CAS to purged when domain forget fails", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-fail-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);

    const result = await runMemoryForgetTwoPhase({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-fail",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
      runDomainForget: async () => {
        throw new Error("cogniweave_forget_failed");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe("domain_failed");
    }
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(getLifecycleReceipt({ operationId: "op-forget-fail", stateDir })?.status).toBe("failed");
  });

  it("CAS to purged only after domain forget succeeds", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-ok-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    let domainRan = false;

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-ok",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const mid = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(mid?.envelope.lifecycleState).toBe("active");

    const done = await completeMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-ok",
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      runDomainForget: async () => {
        domainRan = true;
        const still = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
        expect(still?.envelope.lifecycleState).toBe("active");
      },
    });
    expect(domainRan).toBe(true);
    expect(done.ok).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("purged");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(getLifecycleReceipt({ operationId: "op-forget-ok", stateDir })?.status).toBe(
      "completed",
    );
  });

  it("legal hold blocks forget open", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-hold-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);

    const hold = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "memory:t1:source:s1",
      command: "applyLegalHold",
      expectedStates: ["active"],
      expectedGovernanceVersion: 2,
      operationId: "op-hold-m",
      requestedBy: operator,
      hold: { holdId: "hm1", reason: "litigation" },
    });
    expect(hold.ok).toBe(true);
    if (!hold.ok) {
      return;
    }

    const forget = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-blocked",
      expectedGovernanceVersion: hold.governanceVersion,
      requestedBy: actor,
    });
    expect(forget.ok).toBe(false);
    if (!forget.ok) {
      expect(forget.conflict).toBe("legal_hold_blocks");
    }
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.activeLifecycleOperation).toBeFalsy();
  });

  it("rejects forget on non-memory resource", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-type-"));
    tempDirs.push(stateDir);
    const locator = path.join(stateDir, "blob.json");
    fs.writeFileSync(locator, "{}");
    await getSharedDataGovernanceCatalog({ stateDir }).put({
      envelope: {
        resourceId: "ca-1",
        resourceType: "conversation_archive",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner,
        scope,
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "b1",
        createdAt: "2026-08-12T00:00:00Z",
        updatedAt: "2026-08-12T00:00:00Z",
      },
      bindings: [
        {
          bindingId: "b1",
          resourceId: "ca-1",
          role: "canonical",
          storageKind: "filesystem",
          locator,
          state: "active",
          contentVersion: "1",
        },
      ],
    });

    const result = await beginMemoryForget({
      stateDir,
      resourceId: "ca-1",
      operationId: "op-wrong-type",
      expectedGovernanceVersion: 1,
      requestedBy: actor,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe("command_not_allowed");
    }
  });

  it("domain failure writes recovery receipt and keep_prior restores active", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-keep-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");

    const keep = await runMemoryForgetTwoPhase({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-keep",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
      onDomainFailure: "keep_prior",
      runDomainForget: async () => {
        throw new Error("domain_soft_fail");
      },
    });
    expect(keep.ok).toBe(false);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(fs.existsSync(locator)).toBe(true);
    expect(
      readGovernanceRecoveryReceipt({
        operationId: "op-forget-keep",
        stage: "memory_forget_two_phase_abort",
        stateDir,
      }),
    ).toBeNull();

    const fail = await runMemoryForgetTwoPhase({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-recv",
      expectedGovernanceVersion: record!.envelope.governanceVersion,
      requestedBy: actor,
      runDomainForget: async () => {
        throw new Error("domain_hard_fail");
      },
    });
    expect(fail.ok).toBe(false);
    expect(
      readGovernanceRecoveryReceipt({
        operationId: "op-forget-recv",
        stage: "memory_forget_two_phase_abort",
        stateDir,
      }),
    ).not.toBeNull();
  });
});

describe("P2-c memory forget adapter + races", () => {
  it("forgetMemoryWithGovernance deletes canonical file then CAS to purged", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-adp-ok-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");

    const result = await forgetMemoryWithGovernance({
      plan: {
        resourceId: "memory:t1:source:s1",
        operationId: "op-forget-adp",
        stateDir,
      },
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(locator)).toBe(false);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("purged");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(getLifecycleReceipt({ operationId: "op-forget-adp", stateDir })?.status).toBe(
      "completed",
    );
    expect(
      loadMemoryForgetStaging({
        operationId: "op-forget-adp",
        resourceId: "memory:t1:source:s1",
        stateDir,
      }),
    ).toBeNull();
    const stagingDir = resolveMemoryForgetStagingPaths({
      operationId: "op-forget-adp",
      stateDir,
    }).dir;
    expect(fs.existsSync(stagingDir)).toBe(false);
  });

  it("formal adapter auto-restores file when Catalog CAS fails after domain", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-cas-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");
    const original = fs.readFileSync(locator, "utf8");

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const realCompare = catalog.compareAndPut.bind(catalog);
    catalog.compareAndPut = async (params) => {
      if (
        params.next.envelope.lifecycleState === "purged" &&
        params.next.envelope.activeLifecycleOperation === null
      ) {
        return { ok: false as const, conflict: "version_conflict" as const };
      }
      return realCompare(params);
    };

    const result = await forgetMemoryWithGovernance({
      plan: {
        resourceId: "memory:t1:source:s1",
        operationId: "op-forget-cas",
        stateDir,
      },
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("domain_ok_catalog_cas_failed_recovery_required");
    }
    expect(fs.existsSync(locator)).toBe(true);
    expect(fs.readFileSync(locator, "utf8")).toBe(original);
    const record = await catalog.get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
  });

  it("hold after domain restores bytes and aborts with latest version", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-hold-race-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");
    const original = fs.readFileSync(locator, "utf8");

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-hold",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const done = await completeMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-hold",
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      runDomainForget: async () => {
        const handle = await createMemoryForgetDomainVerifier({
          resourceId: "memory:t1:source:s1",
          operationId: "op-forget-hold",
          stateDir,
        })();
        const hold = await transitionCatalogLifecycleCommand({
          stateDir,
          resourceId: "memory:t1:source:s1",
          command: "applyLegalHold",
          expectedStates: ["active"],
          expectedGovernanceVersion: begun.governanceVersion,
          operationId: "op-hold-mid",
          requestedBy: operator,
          hold: { holdId: "hm-mid", reason: "litigation" },
        });
        expect(hold.ok).toBe(true);
        return handle;
      },
    });
    expect(done.ok).toBe(false);
    if (!done.ok) {
      expect(done.message).toBe("hold_after_domain");
    }
    expect(fs.existsSync(locator)).toBe(true);
    expect(fs.readFileSync(locator, "utf8")).toBe(original);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(record?.envelope.legalHold?.holdId).toBe("hm-mid");
  });

  it("canonical locator drift after domain fails closed and restores original file", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-loc-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");
    const original = fs.readFileSync(locator, "utf8");
    const catalog = getSharedDataGovernanceCatalog({ stateDir });

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-loc",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const done = await completeMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-loc",
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      runDomainForget: async () => {
        const handle = await createMemoryForgetDomainVerifier({
          resourceId: "memory:t1:source:s1",
          operationId: "op-forget-loc",
          stateDir,
        })();
        const cur = (await catalog.get("memory:t1:source:s1"))!;
        const drifted = path.join(stateDir, "drifted-MEMORY.md");
        fs.writeFileSync(drifted, "other\n", "utf8");
        await catalog.put({
          envelope: {
            ...cur.envelope,
            governanceVersion: cur.envelope.governanceVersion + 1,
            updatedAt: new Date().toISOString(),
          },
          bindings: cur.bindings.map((b) =>
            b.role === "canonical" ? { ...b, locator: drifted } : b,
          ),
        });
        return handle;
      },
    });
    expect(done.ok).toBe(false);
    if (!done.ok) {
      expect(done.message).toBe("domain_ok_snapshot_mismatch_recovery_required");
    }
    expect(fs.existsSync(locator)).toBe(true);
    expect(fs.readFileSync(locator, "utf8")).toBe(original);
    const record = await catalog.get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
  });

  it("classification/createdAt drift after domain fails closed and restores file", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-cls-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");
    const original = fs.readFileSync(locator, "utf8");
    const catalog = getSharedDataGovernanceCatalog({ stateDir });

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-cls",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const done = await completeMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-cls",
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      runDomainForget: async () => {
        const handle = await createMemoryForgetDomainVerifier({
          resourceId: "memory:t1:source:s1",
          operationId: "op-forget-cls",
          stateDir,
        })();
        const cur = (await catalog.get("memory:t1:source:s1"))!;
        await catalog.put({
          envelope: {
            ...cur.envelope,
            governanceVersion: cur.envelope.governanceVersion + 1,
            updatedAt: new Date().toISOString(),
            createdAt: "2020-01-01T00:00:00.000Z",
            classification: "restricted",
          },
          bindings: cur.bindings,
        });
        return handle;
      },
    });
    expect(done.ok).toBe(false);
    if (!done.ok) {
      expect(done.message).toBe("domain_ok_snapshot_mismatch_recovery_required");
    }
    expect(fs.existsSync(locator)).toBe(true);
    expect(fs.readFileSync(locator, "utf8")).toBe(original);
    const record = await catalog.get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
  });

  it("compensate skips restore when subsequent writer recreated the locator", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-skip-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-skip",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const material = await materializeMemoryForgetDomain({
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-skip",
      stateDir,
    });
    expect(material.deleted).toBe(true);
    expect(fs.existsSync(locator)).toBe(false);
    fs.writeFileSync(locator, "# rewritten by later writer\n", "utf8");

    const result = await compensateMemoryForgetDomain({
      plan: {
        resourceId: "memory:t1:source:s1",
        operationId: "op-forget-skip",
        stateDir,
      },
      material,
      reason: "test_recreated",
    });
    expect(result.compensated).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.restored).toBe(false);
    expect(fs.readFileSync(locator, "utf8")).toBe("# rewritten by later writer\n");
    expect(
      readGovernanceRecoveryReceipt({
        operationId: "op-forget-skip",
        stage: "memory_forget_domain_compensate_skip",
        stateDir,
      }),
    ).not.toBeNull();
  });
});

describe("P2-c durable staging + restart recovery", () => {
  it("crash after unlink reloads Catalog/receipt and restores from staging", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-crash-restore-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");
    const original = fs.readFileSync(locator, "utf8");

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-crash-r",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const material = await materializeMemoryForgetDomain({
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-crash-r",
      stateDir,
    });
    expect(material.deleted).toBe(true);
    expect(fs.existsSync(locator)).toBe(false);
    expect(
      loadMemoryForgetStaging({
        operationId: "op-forget-crash-r",
        resourceId: "memory:t1:source:s1",
        stateDir,
      }),
    ).not.toBeNull();

    // Simulate process crash: drop in-memory catalog + snapshot Buffer.
    resetSharedDataGovernanceCatalogForTests();

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const reloaded = await catalog.get("memory:t1:source:s1");
    expect(reloaded?.envelope.lifecycleState).toBe("active");
    expect(reloaded?.envelope.activeLifecycleOperation?.command).toBe("forget");
    expect(getLifecycleReceipt({ operationId: "op-forget-crash-r", stateDir })?.status).toBe(
      "open",
    );

    const recovered = await recoverMemoryForgetAfterRestart({
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-crash-r",
      stateDir,
    });
    expect(recovered.action).toBe("resume");
    if (recovered.action === "resume") {
      expect(recovered.canonicalExists).toBe(false);
      expect(recovered.staging?.meta.contentSha256).toBeTruthy();
    }

    const restored = await restoreMemoryForgetAfterRestart({
      plan: {
        resourceId: "memory:t1:source:s1",
        operationId: "op-forget-crash-r",
        stateDir,
      },
      executedBy: actor,
    });
    expect(restored.ok).toBe(true);
    expect(fs.existsSync(locator)).toBe(true);
    expect(fs.readFileSync(locator, "utf8")).toBe(original);
    const after = await catalog.get("memory:t1:source:s1");
    expect(after?.envelope.lifecycleState).toBe("active");
    expect(after?.envelope.activeLifecycleOperation).toBeNull();
    expect(after?.envelope.lifecycleState).not.toBe("purged");
  });

  it("crash after unlink can continue to purged then drop staging", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-crash-cont-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-crash-c",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    await materializeMemoryForgetDomain({
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-crash-c",
      stateDir,
    });
    expect(fs.existsSync(locator)).toBe(false);

    resetSharedDataGovernanceCatalogForTests();

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const reloaded = await catalog.get("memory:t1:source:s1");
    expect(reloaded?.envelope.lifecycleState).toBe("active");
    expect(getLifecycleReceipt({ operationId: "op-forget-crash-c", stateDir })?.status).toBe(
      "open",
    );

    const done = await completeMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-crash-c",
      expectedGovernanceVersion: reloaded!.envelope.governanceVersion,
      executedBy: actor,
      runDomainForget: createMemoryForgetDomainVerifier({
        resourceId: "memory:t1:source:s1",
        operationId: "op-forget-crash-c",
        stateDir,
      }),
    });
    expect(done.ok).toBe(true);
    expect(fs.existsSync(locator)).toBe(false);
    const record = await catalog.get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("purged");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(
      loadMemoryForgetStaging({
        operationId: "op-forget-crash-c",
        resourceId: "memory:t1:source:s1",
        stateDir,
      }),
    ).toBeNull();
  });

  it("active forget + missing canonical + missing staging is recovery_required", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-crash-gone-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-gone",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    fs.unlinkSync(locator);

    resetSharedDataGovernanceCatalogForTests();

    const recovered = await recoverMemoryForgetAfterRestart({
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-gone",
      stateDir,
      executedBy: actor,
    });
    expect(recovered.action).toBe("recovery_required");
    if (recovered.action === "recovery_required") {
      expect(recovered.reason).toBe("canonical_and_staging_missing");
      expect(recovered.record.envelope.lifecycleState).toBe("recovery_required");
      expect(recovered.record.envelope.lifecycleState).not.toBe("purged");
      expect(recovered.record.envelope.activeLifecycleOperation).toBeNull();
    }
  });

  it("purged leftover staging is safe-cleaned without catalog mutation", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-stale-stg-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);

    const result = await forgetMemoryWithGovernance({
      plan: {
        resourceId: "memory:t1:source:s1",
        operationId: "op-forget-stale",
        stateDir,
      },
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(result.ok).toBe(true);

    writeMemoryForgetStaging({
      operationId: "op-forget-stale",
      resourceId: "memory:t1:source:s1",
      bindingId: "bind-m1",
      locator: path.join(stateDir, "MEMORY.md"),
      payload: Buffer.from("# leftover\n"),
      mode: 0o600,
      uid: 0,
      gid: 0,
      mtimeMs: Date.now(),
      stateDir,
    });
    expect(
      loadMemoryForgetStaging({
        operationId: "op-forget-stale",
        resourceId: "memory:t1:source:s1",
        stateDir,
      }),
    ).not.toBeNull();

    resetSharedDataGovernanceCatalogForTests();
    const recovered = await recoverMemoryForgetAfterRestart({
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-stale",
      stateDir,
    });
    expect(recovered.action).toBe("cleanup_staging");
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("purged");
    expect(
      loadMemoryForgetStaging({
        operationId: "op-forget-stale",
        resourceId: "memory:t1:source:s1",
        stateDir,
      }),
    ).toBeNull();
  });

  it("cogniweave/sqlite canonical fail-closed to a dedicated adapter", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-cw-"));
    tempDirs.push(stateDir);
    const locator = path.join(stateDir, "cw.sqlite");
    fs.writeFileSync(locator, "sqlite-bytes");
    await getSharedDataGovernanceCatalog({ stateDir }).put({
      envelope: {
        resourceId: "memory:t1:source:cw1",
        resourceType: "memory",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner,
        scope,
        lifecycleState: "active",
        classification: "confidential",
        governanceVersion: 2,
        canonicalBindingId: "bind-cw",
        createdAt: "2026-08-12T00:00:00Z",
        updatedAt: "2026-08-12T00:00:00Z",
        projection: { canonicalKind: "cogniweave" },
      },
      bindings: [
        {
          bindingId: "bind-cw",
          resourceId: "memory:t1:source:cw1",
          role: "canonical",
          storageKind: "sqlite",
          locator,
          state: "active",
          contentVersion: "1",
          objectKey: "memory:t1:source:cw1",
        },
      ],
    });

    const result = await forgetMemoryWithGovernance({
      plan: {
        resourceId: "memory:t1:source:cw1",
        operationId: "op-forget-cw",
        stateDir,
      },
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe("domain_failed");
      expect(result.message).toMatch(/unsupported_storage_kind|unsupported_canonical_kind/);
    }
    expect(fs.existsSync(locator)).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:cw1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
  });

  it("unlinkFileDurable fsyncs parent; missing dir fsync fails closed", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-unlink-"));
    tempDirs.push(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");
    fs.writeFileSync(locator, "# mem\n");
    unlinkFileDurable(locator);
    expect(fs.existsSync(locator)).toBe(false);
    expect(() => fsyncDirectory(path.join(stateDir, "no-such-dir"), "canonical_unlink")).toThrow(
      /dir_fsync_failed:canonical_unlink:/,
    );
  });

  it("resume does not treat missing canonical as deleted until parent dir fsync succeeds", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-resume-undurable-"));
    tempDirs.push(stateDir);
    const memDir = path.join(stateDir, "mem-root");
    const locator = path.join(memDir, "MEMORY.md");
    await seedActiveMemory(stateDir, "memory:t1:source:s1", locator);

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-undurable",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    await materializeMemoryForgetDomain({
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-undurable",
      stateDir,
    });
    expect(fs.existsSync(locator)).toBe(false);
    expect(
      loadMemoryForgetStaging({
        operationId: "op-forget-undurable",
        resourceId: "memory:t1:source:s1",
        stateDir,
      }),
    ).not.toBeNull();

    // Unlink completed but durable confirmation cannot run: parent directory is gone.
    fs.rmdirSync(memDir);
    resetSharedDataGovernanceCatalogForTests();

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const reloaded = await catalog.get("memory:t1:source:s1");
    const done = await completeMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-undurable",
      expectedGovernanceVersion: reloaded!.envelope.governanceVersion,
      executedBy: actor,
      runDomainForget: createMemoryForgetDomainVerifier({
        resourceId: "memory:t1:source:s1",
        operationId: "op-forget-undurable",
        stateDir,
      }),
    });
    expect(done.ok).toBe(false);
    if (!done.ok) {
      expect(done.message).toMatch(/dir_fsync_failed:canonical_unlink:/);
    }
    const record = await catalog.get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(
      loadMemoryForgetStaging({
        operationId: "op-forget-undurable",
        resourceId: "memory:t1:source:s1",
        stateDir,
      }),
    ).not.toBeNull();
  });

  it("mkdirDurableSync fsyncs parent of new dir, not only the new dir itself", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-mkdir-"));
    tempDirs.push(stateDir);
    const opened: string[] = [];
    const realOpen = fs.openSync.bind(fs);
    vi.spyOn(fs, "openSync").mockImplementation(((
      p: fs.PathLike,
      flags: fs.OpenMode | undefined,
      mode?: fs.Mode,
    ) => {
      if (typeof p === "string") {
        opened.push(path.resolve(p));
      }
      return realOpen(p, flags as fs.OpenMode, mode);
    }) as typeof fs.openSync);

    const child = path.join(stateDir, "stg-root", "op-1");
    mkdirDurableSync(child);
    expect(fs.existsSync(child)).toBe(true);
    const parent = path.resolve(path.join(stateDir, "stg-root"));
    expect(opened).toContain(path.resolve(stateDir));
    expect(opened).toContain(parent);
    expect(opened.filter((p) => p === path.resolve(child)).length).toBe(0);
  });

  it("restart restore subsequent-writer stays recovery_required (no keep_prior)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-rst-skip-"));
    tempDirs.push(stateDir);
    await seedActiveMemory(stateDir);
    const locator = path.join(stateDir, "MEMORY.md");

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-rst-skip",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    await materializeMemoryForgetDomain({
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-rst-skip",
      stateDir,
    });
    fs.writeFileSync(locator, "# rewritten by later writer\n", "utf8");
    resetSharedDataGovernanceCatalogForTests();

    const restored = await restoreMemoryForgetAfterRestart({
      plan: {
        resourceId: "memory:t1:source:s1",
        operationId: "op-forget-rst-skip",
        stateDir,
      },
      executedBy: actor,
    });
    expect(restored.ok).toBe(false);
    if (!restored.ok) {
      expect(restored.message).toBe("restart_restore_compensate_failed:subsequent_writer");
    }
    expect(fs.readFileSync(locator, "utf8")).toBe("# rewritten by later writer\n");
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.lifecycleState).not.toBe("active");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(
      readGovernanceRecoveryReceipt({
        operationId: "op-forget-rst-skip",
        stage: "memory_forget_restart_restore",
        stateDir,
      }),
    ).not.toBeNull();
  });

  it("restart restore write-failure stays recovery_required (no keep_prior)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2c-rst-wr-"));
    tempDirs.push(stateDir);
    const memDir = path.join(stateDir, "mem-root");
    const locator = path.join(memDir, "MEMORY.md");
    await seedActiveMemory(stateDir, "memory:t1:source:s1", locator);

    const begun = await beginMemoryForget({
      stateDir,
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-rst-wr",
      expectedGovernanceVersion: 2,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    await materializeMemoryForgetDomain({
      resourceId: "memory:t1:source:s1",
      operationId: "op-forget-rst-wr",
      stateDir,
    });
    expect(fs.existsSync(locator)).toBe(false);
    fs.chmodSync(memDir, 0o500);
    resetSharedDataGovernanceCatalogForTests();

    try {
      const restored = await restoreMemoryForgetAfterRestart({
        plan: {
          resourceId: "memory:t1:source:s1",
          operationId: "op-forget-rst-wr",
          stateDir,
        },
        executedBy: actor,
      });
      expect(restored.ok).toBe(false);
      if (!restored.ok) {
        expect(restored.message).toBe("restart_restore_compensate_failed:restore_write_failed");
      }
    } finally {
      fs.chmodSync(memDir, 0o700);
    }

    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("memory:t1:source:s1");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(fs.existsSync(locator)).toBe(false);
    expect(
      readGovernanceRecoveryReceipt({
        operationId: "op-forget-rst-wr",
        stage: "memory_forget_restart_restore",
        stateDir,
      }),
    ).not.toBeNull();
  });
});
