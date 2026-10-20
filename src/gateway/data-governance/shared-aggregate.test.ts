/**
 * P1-2 round-3: multi-resource shared physical aggregates + manager cache epoch.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getKnowledgeDocument,
  listKnowledgeDocumentVersions,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "../knowledge/kb-index.js";
import { ingestKnowledgeDocument } from "../knowledge/kb-ingest.js";
import { diagnoseDuplicateCanonicals } from "./diagnostics.js";
import {
  abortKnowledgeGovernanceRegistration,
  activateKnowledgeGovernanceRegistration,
  beginKnowledgeGovernanceRegistration,
  buildKnowledgeResourceId,
} from "./knowledge-register.js";
import { compensateOperationalIdentityAggregateWrite } from "./logical-compensate.js";
import {
  abortMemoryGovernanceRegistration,
  activateMemoryGovernanceRegistration,
  beginMemoryGovernanceRegistration,
  buildCogniWeaveMemorySourceId,
  buildMemoryResourceId,
} from "./memory-register.js";
import {
  abortOperationalIdentityGovernanceRegistration,
  activateOperationalIdentityGovernanceRegistration,
  beginOperationalIdentityGovernanceRegistration,
  buildOperationalIdentityResourceId,
} from "./operational-identity-register.js";
import { ownershipProofFromTenantUser } from "./ownership-proof.js";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "./runtime-catalog.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("shared physical aggregate objectKey uniqueness (P1-2 round 3)", () => {
  it("two Knowledge document versions on one KB SQLite do not duplicate_canonical", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-shared-kb-"));
    tempDirs.push(stateDir);
    const kbSqlite = path.join(stateDir, "kb", "personal.sqlite");
    fs.mkdirSync(path.dirname(kbSqlite), { recursive: true });
    fs.writeFileSync(kbSqlite, "");

    const a = await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      contentClass: "document_version",
      docId: "doc-1",
      versionId: "v1",
      kbId: "kb-shared",
      canonicalLocator: kbSqlite,
      indexLocator: kbSqlite,
    });
    await activateKnowledgeGovernanceRegistration({ resourceId: a.resourceId, stateDir });

    const b = await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      contentClass: "document_version",
      docId: "doc-1",
      versionId: "v2",
      kbId: "kb-shared",
      canonicalLocator: kbSqlite,
      indexLocator: kbSqlite,
    });
    await activateKnowledgeGovernanceRegistration({ resourceId: b.resourceId, stateDir });

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const records = [await catalog.get(a.resourceId), await catalog.get(b.resourceId)].filter(
      Boolean,
    );
    expect(diagnoseDuplicateCanonicals(records as NonNullable<(typeof records)[number]>[])).toEqual(
      [],
    );
    expect(a.resourceId).not.toBe(b.resourceId);
    expect(records[0]?.bindings[0]?.objectKey).toBe(a.resourceId);
    expect(records[1]?.bindings[0]?.objectKey).toBe(b.resourceId);
  });

  it("Knowledge v2 abort deletes version rows from shared SQLite and keeps v1", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-shared-kb-real-"));
    const indexRoot = path.join(stateDir, "index");
    tempDirs.push(stateDir);
    const proof = ownershipProofFromTenantUser({ tenantId: "t1", userId: "u1" });

    const v1 = await ingestKnowledgeDocument({
      kbId: "kb-shared",
      docId: "doc-1",
      title: "Doc",
      fileName: "a.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# v1\n\nkeep me\n", "utf8"),
      ownerId: "u1",
      tenantId: "t1",
      indexRoot,
      governanceVersionId: "v1",
      governanceStateDir: stateDir,
      governanceOwnershipProof: proof,
    });
    expect(v1.skipped).toBe(false);

    const v2 = await ingestKnowledgeDocument({
      kbId: "kb-shared",
      docId: "doc-1",
      title: "Doc",
      fileName: "a.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# v2\n\nremove me\n", "utf8"),
      ownerId: "u1",
      tenantId: "t1",
      indexRoot,
      governanceVersionId: "v2",
      governanceStateDir: stateDir,
      governanceOwnershipProof: proof,
    });
    expect(v2.skipped).toBe(false);

    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "u1",
      tenantId: "t1",
      indexRoot,
    });
    const v2Id = buildKnowledgeResourceId({
      tenantId: "t1",
      contentClass: "document_version",
      docId: "doc-1",
      versionId: "v2",
    });
    const v1Id = buildKnowledgeResourceId({
      tenantId: "t1",
      contentClass: "document_version",
      docId: "doc-1",
      versionId: "v1",
    });

    const abort = await abortKnowledgeGovernanceRegistration({
      resourceId: v2Id,
      reason: "activation_failed",
      operationId: "op-v2-fail",
      allowedRoots: [stateDir, path.dirname(dbPath)],
      stateDir,
    });
    expect(abort.quarantine?.status).toBe("skipped");
    expect(abort.recoveryRequired).toBe(false);
    expect(fs.existsSync(dbPath)).toBe(true);

    const index = await openKnowledgeIndex({ dbPath });
    try {
      const versions = listKnowledgeDocumentVersions(index.db, "doc-1");
      expect(versions.map((v) => v.versionId)).toEqual(["v1"]);
      expect(getKnowledgeDocument(index.db, "doc-1")?.currentVersionId).toBe("v1");
    } finally {
      index.close();
    }

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    expect((await catalog.get(v1Id))?.envelope.lifecycleState).toBe("active");
  });

  it("two CogniWeave scopes on one metadata SQLite do not duplicate_canonical", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-shared-cw-"));
    tempDirs.push(stateDir);
    const cwDb = path.join(stateDir, "cogniweave", "canonical.sqlite");
    fs.mkdirSync(path.dirname(cwDb), { recursive: true });
    fs.writeFileSync(cwDb, "");

    const sourceA = buildCogniWeaveMemorySourceId({
      visibility: "private",
      workspaceId: "ws-1",
      agentId: "agent-a",
    });
    const sourceB = buildCogniWeaveMemorySourceId({
      visibility: "private",
      workspaceId: "ws-1",
      agentId: "agent-b",
    });
    const a = await beginMemoryGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "position", seatId: "seat-a" },
      scope: { kind: "tenant", tenantId: "t1" },
      profile: "managed_enterprise",
      canonicalKind: "cogniweave",
      sourceId: sourceA,
      canonicalLocator: cwDb,
    });
    await activateMemoryGovernanceRegistration({ resourceId: a.resourceId, stateDir });
    const b = await beginMemoryGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "position", seatId: "seat-b" },
      scope: { kind: "tenant", tenantId: "t1" },
      profile: "managed_enterprise",
      canonicalKind: "cogniweave",
      sourceId: sourceB,
      canonicalLocator: cwDb,
    });
    await activateMemoryGovernanceRegistration({ resourceId: b.resourceId, stateDir });

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const records = [await catalog.get(a.resourceId), await catalog.get(b.resourceId)].filter(
      Boolean,
    );
    expect(diagnoseDuplicateCanonicals(records as NonNullable<(typeof records)[number]>[])).toEqual(
      [],
    );
    expect(a.resourceId).toBe(buildMemoryResourceId({ tenantId: "t1", sourceId: sourceA }));
    expect(b.resourceId).toBe(buildMemoryResourceId({ tenantId: "t1", sourceId: sourceB }));
  });

  it("Memory second-scope abort does not quarantine shared CogniWeave DB", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-shared-cw-abort-"));
    tempDirs.push(stateDir);
    const cwDb = path.join(stateDir, "cogniweave", "canonical.sqlite");
    fs.mkdirSync(path.dirname(cwDb), { recursive: true });
    fs.writeFileSync(cwDb, "scope-a");

    const sourceA = buildCogniWeaveMemorySourceId({
      visibility: "private",
      workspaceId: "ws-1",
      agentId: "agent-a",
    });
    const sourceB = buildCogniWeaveMemorySourceId({
      visibility: "private",
      workspaceId: "ws-1",
      agentId: "agent-b",
    });
    const a = await beginMemoryGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "position", seatId: "seat-a" },
      scope: { kind: "tenant", tenantId: "t1" },
      profile: "managed_enterprise",
      canonicalKind: "cogniweave",
      sourceId: sourceA,
      canonicalLocator: cwDb,
    });
    await activateMemoryGovernanceRegistration({ resourceId: a.resourceId, stateDir });
    const b = await beginMemoryGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "position", seatId: "seat-b" },
      scope: { kind: "tenant", tenantId: "t1" },
      profile: "managed_enterprise",
      canonicalKind: "cogniweave",
      sourceId: sourceB,
      canonicalLocator: cwDb,
    });

    const abort = await abortMemoryGovernanceRegistration({
      resourceId: b.resourceId,
      reason: "activation_failed",
      operationId: "op-mem-b",
      allowedRoots: [stateDir],
      stateDir,
      logicalCompensate: async () => ({ ok: true }),
    });
    expect(abort.quarantine?.status).toBe("skipped");
    expect(fs.readFileSync(cwDb, "utf8")).toBe("scope-a");
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    expect((await catalog.get(a.resourceId))?.envelope.lifecycleState).toBe("active");
  });

  it("Memory shared abort without logicalCompensate stays recovery_required", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-shared-cw-nocomp-"));
    tempDirs.push(stateDir);
    const cwDb = path.join(stateDir, "cogniweave", "canonical.sqlite");
    fs.mkdirSync(path.dirname(cwDb), { recursive: true });
    fs.writeFileSync(cwDb, "scope-a");
    const sourceB = buildCogniWeaveMemorySourceId({
      visibility: "private",
      workspaceId: "ws-1",
      agentId: "agent-b",
    });
    const b = await beginMemoryGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "position", seatId: "seat-b" },
      scope: { kind: "tenant", tenantId: "t1" },
      profile: "managed_enterprise",
      canonicalKind: "cogniweave",
      sourceId: sourceB,
      canonicalLocator: cwDb,
    });
    const abort = await abortMemoryGovernanceRegistration({
      resourceId: b.resourceId,
      reason: "activation_failed",
      operationId: "op-mem-nocomp",
      allowedRoots: [stateDir],
      stateDir,
    });
    expect(abort.recoveryRequired).toBe(true);
    expect(abort.quarantine?.status).toBe("failed");
    expect(fs.readFileSync(cwDb, "utf8")).toBe("scope-a");
  });

  it("two OI identities on one JSON store do not duplicate_canonical; abort restores snapshot", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-shared-oi-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "openbot-user-operational-identity.json");
    const prior = {
      version: 1,
      identities: {
        "id-a": { identityId: "id-a", ownerId: "u1", tenantId: "t1" },
      },
    };
    fs.writeFileSync(storePath, `${JSON.stringify(prior, null, 2)}\n`);

    const a = await beginOperationalIdentityGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      identityId: "id-a",
      canonicalLocator: storePath,
    });
    await activateOperationalIdentityGovernanceRegistration({ resourceId: a.resourceId, stateDir });

    const b = await beginOperationalIdentityGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      identityId: "id-b",
      canonicalLocator: storePath,
    });

    // Simulate failed create leaving a partial identity in the shared store.
    const dirty = {
      ...prior,
      identities: {
        ...prior.identities,
        "id-b": { identityId: "id-b", ownerId: "u1", tenantId: "t1", broken: true },
      },
    };
    fs.writeFileSync(storePath, `${JSON.stringify(dirty, null, 2)}\n`);

    const abort = await abortOperationalIdentityGovernanceRegistration({
      resourceId: b.resourceId,
      reason: "activation_failed",
      operationId: "op-oi-b",
      allowedRoots: [stateDir],
      stateDir,
      logicalCompensate: async () =>
        compensateOperationalIdentityAggregateWrite({
          storePath,
          identityId: "id-b",
          priorStoreJson: `${JSON.stringify(prior, null, 2)}\n`,
        }),
    });
    expect(abort.quarantine?.status).toBe("skipped");
    expect(abort.recoveryRequired).toBe(false);

    const restored = JSON.parse(fs.readFileSync(storePath, "utf8")) as {
      version: number;
      identities: Record<string, { identityId: string; ownerId: string; tenantId: string }>;
    };
    expect(restored.identities["id-a"]).toBeTruthy();
    expect(restored.identities["id-b"]).toBeUndefined();

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const records = [
      await catalog.get(a.resourceId),
      await catalog.get(buildOperationalIdentityResourceId({ tenantId: "t1", identityId: "id-b" })),
    ].filter(Boolean);
    // Active + aborted records sharing locator with distinct objectKeys → no duplicate diag.
    const activeOnly = [await catalog.get(a.resourceId)].filter(Boolean);
    expect(
      diagnoseDuplicateCanonicals(activeOnly as NonNullable<(typeof activeOnly)[number]>[]),
    ).toEqual([]);
    expect(records[0]?.bindings[0]?.objectKey).toBe(a.resourceId);
  });
});
