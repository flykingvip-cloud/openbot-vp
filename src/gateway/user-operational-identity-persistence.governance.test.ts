import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateOperationalIdentityGovernanceRegistration,
  beginOperationalIdentityGovernanceRegistration,
  buildOperationalIdentityResourceId,
} from "./data-governance/operational-identity-register.js";
import { ownershipProofFromTenantUser } from "./data-governance/ownership-proof.js";
import { ownershipProofForEnterpriseOperationalIdentity } from "./data-governance/ownership-proof.js";
import { getSharedDataGovernanceCatalog } from "./data-governance/runtime-catalog.js";
import { resetSharedDataGovernanceCatalogForTests } from "./data-governance/runtime-catalog.js";
import { saveEnterpriseSeatAssetsStoreWithOiGovernance } from "./enterprise-operational-identity-governance.js";
import { loadEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";
import {
  normalizeUserOperationalIdentityStore,
  saveUserOperationalIdentityStore,
} from "./user-operational-identity-persistence.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("OI metadata save governance gate", () => {
  it("managed user OI save fail-closes without trusted ownership proof", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "oi-gov-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "openbot-user-operational-identity.json");
    const store = normalizeUserOperationalIdentityStore({
      identities: {
        "id-1": {
          identityId: "id-1",
          ownerType: "user",
          ownerId: "u1",
          provider: "github-personal",
          displayName: "gh",
          credentialHandleId: "cred-1",
          status: "active",
          tenantId: "t1",
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      },
    });

    await expect(
      saveUserOperationalIdentityStore(store, storePath, { governanceStateDir: stateDir }),
    ).rejects.toThrow(/missing_ownership_proof|governance_write_denied/);
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it("managed user OI first save creates pending→active Catalog then persists", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "oi-gov-create-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "openbot-user-operational-identity.json");
    const store = normalizeUserOperationalIdentityStore({
      identities: {
        "id-new": {
          identityId: "id-new",
          ownerType: "user",
          ownerId: "u1",
          provider: "github-personal",
          displayName: "gh",
          credentialHandleId: "cred-1",
          status: "active",
          tenantId: "t1",
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      },
    });
    await saveUserOperationalIdentityStore(store, storePath, {
      governanceStateDir: stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "t1", userId: "u1" }),
    });
    expect(fs.existsSync(storePath)).toBe(true);
    const resourceId = buildOperationalIdentityResourceId({
      tenantId: "t1",
      identityId: "id-new",
    });
    const row = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(row?.envelope.lifecycleState).toBe("active");
  });

  it("managed user OI save succeeds when Catalog active and ownership matches", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "oi-gov-ok-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "openbot-user-operational-identity.json");
    const metaCanonical = path.join(stateDir, "oi-meta.json");
    fs.writeFileSync(metaCanonical, "{}");

    const resourceId = buildOperationalIdentityResourceId({
      tenantId: "t1",
      identityId: "id-ok",
    });
    await beginOperationalIdentityGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      identityId: "id-ok",
      credentialHandleId: "cred-1",
      canonicalLocator: metaCanonical,
    });
    await activateOperationalIdentityGovernanceRegistration({ resourceId, stateDir });

    const store = normalizeUserOperationalIdentityStore({
      identities: {
        "id-ok": {
          identityId: "id-ok",
          ownerType: "user",
          ownerId: "u1",
          provider: "github-personal",
          displayName: "gh",
          credentialHandleId: "cred-1",
          status: "active",
          tenantId: "t1",
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      },
    });
    await saveUserOperationalIdentityStore(store, storePath, {
      governanceStateDir: stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "t1", userId: "u1" }),
    });
    expect(fs.existsSync(storePath)).toBe(true);
    const raw = fs.readFileSync(storePath, "utf8");
    expect(raw).not.toMatch(/Bearer |sk-|password/i);
  });

  it("enterprise tenant-owned OI stream registers Catalog on seat-assets persist", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "oi-ent-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "enterprise-seat-assets.json");
    const store = await loadEnterpriseSeatAssetsStore(storePath);
    await saveEnterpriseSeatAssetsStoreWithOiGovernance({
      storePath,
      store,
      tenantId: "ent-1",
      governedIdentityIds: ["ent-id-1"],
      ownershipProof: ownershipProofForEnterpriseOperationalIdentity({ tenantId: "ent-1" }),
      governanceStateDir: stateDir,
      credentialHandleByIdentityId: { "ent-id-1": "cred-ent-1" },
    });
    expect(fs.existsSync(storePath)).toBe(true);
    const resourceId = buildOperationalIdentityResourceId({
      tenantId: "ent-1",
      identityId: "ent-id-1",
    });
    const row = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(row?.envelope.lifecycleState).toBe("active");
    expect(row?.envelope.owner).toEqual({ kind: "system", systemId: "enterprise-oi" });
    expect(row?.envelope.scope).toEqual({ kind: "tenant", tenantId: "ent-1" });
  });
});
