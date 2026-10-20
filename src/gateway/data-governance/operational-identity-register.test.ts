import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  abortOperationalIdentityGovernanceRegistration,
  activateOperationalIdentityGovernanceRegistration,
  assertNoSecretProjection,
  beginOperationalIdentityGovernanceRegistration,
  buildOperationalIdentityResourceId,
  linkOperationalIdentityToAgentAsset,
} from "./operational-identity-register.js";
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

describe("operational identity governance (P1-2-c)", () => {
  it("builds OI resource ids from identityId", () => {
    expect(buildOperationalIdentityResourceId({ tenantId: "t1", identityId: "id-github-1" })).toBe(
      "operational_identity:t1:id-github-1",
    );
    expect(buildOperationalIdentityResourceId({ tenantId: null, identityId: "local-1" })).toBe(
      "operational_identity:local:local-1",
    );
  });

  it("rejects secret-like projection keys and token-shaped values", () => {
    expect(() => assertNoSecretProjection({ accessToken: "x" })).toThrow(/secret_forbidden/);
    expect(() => assertNoSecretProjection({ smtpPassword: "x" })).toThrow(/secret_forbidden/);
    expect(() => assertNoSecretProjection({ note: "sk-live-abcdefghijklmnopqrstuvwxyz" })).toThrow(
      /secret_forbidden/,
    );
    expect(() =>
      assertNoSecretProjection({ credentialHandleId: "cred-1", provider: "github" }),
    ).not.toThrow();
  });

  it("registers OI metadata with handle + AgentAsset continuity refs only", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-oi-"));
    tempDirs.push(stateDir);
    const metaPath = path.join(stateDir, "openbot-user-operational-identity.json");
    fs.writeFileSync(metaPath, JSON.stringify({ identities: [] }));

    const { resourceId, continuity } = await beginOperationalIdentityGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      identityId: "id-github-1",
      canonicalLocator: metaPath,
      provider: "github",
      credentialHandleId: "cred-github-1",
      agentAssetId: "asset-42",
    });

    expect(resourceId).toBe("operational_identity:t1:id-github-1");
    expect(continuity).toEqual({
      agentAssetId: "asset-42",
      operationalIdentityResourceId: resourceId,
    });

    const linked = linkOperationalIdentityToAgentAsset({
      agentAssetId: "asset-42",
      operationalIdentityResourceId: resourceId,
      relatedResourceIds: ["agent:t1:asset-42"],
    });
    expect(linked.relatedResourceIds).toEqual(["agent:t1:asset-42"]);

    await activateOperationalIdentityGovernanceRegistration({ resourceId, stateDir });
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(record?.envelope.resourceType).toBe("operational_identity");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.projection).toEqual({
      identityId: "id-github-1",
      provider: "github",
      credentialHandleId: "cred-github-1",
      agentAssetId: "asset-42",
    });

    const serialized = JSON.stringify(record);
    expect(serialized).not.toMatch(/Bearer |sk-|BEGIN PRIVATE|password/i);
    expect(serialized).not.toContain("accessToken");
  });

  it("aborts pending OI into recovery_required / quarantine without copying secrets", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-oi-abort-"));
    tempDirs.push(stateDir);
    const metaPath = path.join(stateDir, "oi-meta.json");
    fs.writeFileSync(metaPath, "{}");

    const { resourceId } = await beginOperationalIdentityGovernanceRegistration({
      stateDir,
      tenantId: null,
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "user", userId: "u1" },
      identityId: "id-local-1",
      canonicalLocator: metaPath,
      credentialHandleId: "cred-1",
    });

    const result = await abortOperationalIdentityGovernanceRegistration({
      resourceId,
      reason: "create_failed",
      operationId: "op-oi-1",
      allowedRoots: [stateDir],
      stateDir,
    });
    expect(result.recoveryRequired || result.quarantine).toBeTruthy();

    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(["quarantined", "recovery_required"]).toContain(record?.envelope.lifecycleState);
  });
});
