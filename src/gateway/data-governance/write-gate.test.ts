import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateKnowledgeGovernanceRegistration,
  beginKnowledgeGovernanceRegistration,
} from "./knowledge-register.js";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "./runtime-catalog.js";
import { assertManagedCreateTenant, requireGovernedContentWrite } from "./write-gate.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const proof = {
  owner: { kind: "user" as const, userId: "u1" },
  scope: { kind: "tenant" as const, tenantId: "t1" },
};

describe("second-wave write gate (P1-2-d/g)", () => {
  it("fail-closes managed create without tenantId", () => {
    expect(() =>
      assertManagedCreateTenant({
        profile: "managed_enterprise",
        tenantId: null,
        scopeKind: "tenant",
      }),
    ).toThrow(/managed_requires_tenant/);
  });

  it("fail-closes managed write without ownership proof", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-wg-"));
    tempDirs.push(stateDir);
    const canonical = path.join(stateDir, "doc-v1.json");
    fs.writeFileSync(canonical, "{}");

    const { resourceId } = await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      contentClass: "document_version",
      docId: "d1",
      versionId: "v1",
      canonicalLocator: canonical,
    });
    await activateKnowledgeGovernanceRegistration({ resourceId, stateDir });

    await expect(
      requireGovernedContentWrite({
        resourceId,
        resourceType: "knowledge",
        callerTenantId: "t1",
        profile: "managed_enterprise",
        stateDir,
      }),
    ).rejects.toThrow(/missing_ownership_proof/);
  });

  it("allows content write only when active + tenant + ownership match + single canonical", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-wg-"));
    tempDirs.push(stateDir);
    const canonical = path.join(stateDir, "doc-v1.json");
    fs.writeFileSync(canonical, "{}");

    const { resourceId } = await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      contentClass: "document_version",
      docId: "d1",
      versionId: "v1",
      canonicalLocator: canonical,
    });

    await expect(
      requireGovernedContentWrite({
        resourceId,
        resourceType: "knowledge",
        callerTenantId: "t1",
        profile: "managed_enterprise",
        ownershipProof: proof,
        stateDir,
      }),
    ).rejects.toThrow(/not_writable:pending|write_denied/);

    await activateKnowledgeGovernanceRegistration({ resourceId, stateDir });

    await expect(
      requireGovernedContentWrite({
        resourceId,
        resourceType: "knowledge",
        callerTenantId: "t-other",
        profile: "managed_enterprise",
        ownershipProof: proof,
        stateDir,
      }),
    ).rejects.toThrow(/cross_tenant/);

    await expect(
      requireGovernedContentWrite({
        resourceId,
        resourceType: "knowledge",
        callerTenantId: "t1",
        profile: "managed_enterprise",
        ownershipProof: {
          owner: { kind: "user", userId: "u-other" },
          scope: { kind: "tenant", tenantId: "t1" },
        },
        stateDir,
      }),
    ).rejects.toThrow(/owner_mismatch/);

    const ok = await requireGovernedContentWrite({
      resourceId,
      resourceType: "knowledge",
      callerTenantId: "t1",
      profile: "managed_enterprise",
      ownershipProof: proof,
      stateDir,
    });
    expect(ok?.envelope.lifecycleState).toBe("active");
  });

  it("fail-closes when catalog row missing or type mismatches", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-wg-miss-"));
    tempDirs.push(stateDir);
    await expect(
      requireGovernedContentWrite({
        resourceId: "knowledge:t1:doc:missing:v1",
        resourceType: "knowledge",
        callerTenantId: "t1",
        profile: "managed_enterprise",
        ownershipProof: proof,
        stateDir,
      }),
    ).rejects.toThrow(/missing_catalog/);

    const canonical = path.join(stateDir, "doc.json");
    fs.writeFileSync(canonical, "{}");
    const { resourceId } = await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      contentClass: "document_version",
      docId: "d2",
      versionId: "v1",
      canonicalLocator: canonical,
    });
    await activateKnowledgeGovernanceRegistration({ resourceId, stateDir });

    await expect(
      requireGovernedContentWrite({
        resourceId,
        resourceType: "memory",
        callerTenantId: "t1",
        profile: "managed_enterprise",
        ownershipProof: proof,
        stateDir,
      }),
    ).rejects.toThrow(/type_mismatch/);

    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(record).toBeTruthy();
  });
});
