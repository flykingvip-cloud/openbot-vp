import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateKnowledgeGovernanceRegistration,
  beginKnowledgeGovernanceRegistration,
  buildKnowledgeResourceId,
} from "../data-governance/knowledge-register.js";
import { ownershipProofFromTenantUser } from "../data-governance/ownership-proof.js";
import { getSharedDataGovernanceCatalog } from "../data-governance/runtime-catalog.js";
import { resetSharedDataGovernanceCatalogForTests } from "../data-governance/runtime-catalog.js";
import {
  getKnowledgeDocument,
  listKnowledgeDocumentVersions,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "./kb-index.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const proof = ownershipProofFromTenantUser({ tenantId: "t1", userId: "u1" });

describe("kb-ingest governance write gate (P1-2 Changes Required round 2)", () => {
  it("managed ingest fail-closes without trusted ownership proof", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-gov-miss-proof-"));
    const indexRoot = path.join(stateDir, "index");
    tempDirs.push(stateDir);

    await expect(
      ingestKnowledgeDocument({
        kbId: "kb-1",
        docId: "doc-1",
        title: "Doc",
        fileName: "a.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Hello\n\nbody\n", "utf8"),
        ownerId: "u1",
        tenantId: "t1",
        indexRoot,
        governanceVersionId: "v-missing",
        governanceStateDir: stateDir,
      }),
    ).rejects.toThrow(/missing_ownership_proof|governance_write_denied/);

    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "u1",
      tenantId: "t1",
      indexRoot,
    });
    if (fs.existsSync(dbPath)) {
      const index = await openKnowledgeIndex({ dbPath });
      try {
        expect(getKnowledgeDocument(index.db, "doc-1")).toBeNull();
        expect(listKnowledgeDocumentVersions(index.db, "doc-1")).toEqual([]);
      } finally {
        index.db.close();
      }
    }
  });

  it("managed first ingest allocates pending Catalog then activates after write", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-gov-create-"));
    const indexRoot = path.join(stateDir, "index");
    tempDirs.push(stateDir);
    const versionId = "v-create-1";

    const result = await ingestKnowledgeDocument({
      kbId: "kb-1",
      docId: "doc-create",
      title: "Doc",
      fileName: "a.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Hello\n\nbody create\n", "utf8"),
      ownerId: "u1",
      tenantId: "t1",
      indexRoot,
      governanceVersionId: versionId,
      governanceStateDir: stateDir,
      governanceOwnershipProof: proof,
    });
    expect(result.skipped).toBe(false);
    expect(result.versionId).toBe(versionId);

    const resourceId = buildKnowledgeResourceId({
      tenantId: "t1",
      contentClass: "document_version",
      docId: "doc-create",
      versionId,
    });
    const row = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(row?.envelope.lifecycleState).toBe("active");
  });

  it("managed ingest succeeds with pre-active Catalog + matching ownership proof", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-gov-ok-"));
    const indexRoot = path.join(stateDir, "index");
    tempDirs.push(stateDir);
    const versionId = "v-gov-1";
    const canonical = path.join(stateDir, "canonical.json");
    fs.writeFileSync(canonical, "{}");

    const resourceId = buildKnowledgeResourceId({
      tenantId: "t1",
      contentClass: "document_version",
      docId: "doc-ok",
      versionId,
    });
    await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      contentClass: "document_version",
      docId: "doc-ok",
      versionId,
      kbId: "kb-1",
      canonicalLocator: canonical,
    });
    await activateKnowledgeGovernanceRegistration({ resourceId, stateDir });

    const result = await ingestKnowledgeDocument({
      kbId: "kb-1",
      docId: "doc-ok",
      title: "Doc",
      fileName: "a.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Hello\n\nbody\n", "utf8"),
      ownerId: "u1",
      tenantId: "t1",
      indexRoot,
      governanceVersionId: versionId,
      governanceStateDir: stateDir,
      governanceOwnershipProof: proof,
    });
    expect(result.skipped).toBe(false);
    expect(result.versionId).toBe(versionId);
  });

  it("managed ingest denies when ownership proof does not match Catalog owner", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-gov-owner-"));
    const indexRoot = path.join(stateDir, "index");
    tempDirs.push(stateDir);
    const versionId = "v-owner";
    const canonical = path.join(stateDir, "canonical.json");
    fs.writeFileSync(canonical, "{}");

    const resourceId = buildKnowledgeResourceId({
      tenantId: "t1",
      contentClass: "document_version",
      docId: "doc-owner",
      versionId,
    });
    await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      contentClass: "document_version",
      docId: "doc-owner",
      versionId,
      canonicalLocator: canonical,
    });
    await activateKnowledgeGovernanceRegistration({ resourceId, stateDir });

    await expect(
      ingestKnowledgeDocument({
        kbId: "kb-1",
        docId: "doc-owner",
        title: "Doc",
        fileName: "a.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Hello\n\nbody\n", "utf8"),
        ownerId: "u2",
        tenantId: "t1",
        indexRoot,
        governanceVersionId: versionId,
        governanceStateDir: stateDir,
        governanceOwnershipProof: ownershipProofFromTenantUser({
          tenantId: "t1",
          userId: "u2",
        }),
      }),
    ).rejects.toThrow(/owner_mismatch|governance_write_denied/);
  });
});
