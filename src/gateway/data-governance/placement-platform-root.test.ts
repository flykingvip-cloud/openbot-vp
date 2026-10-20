import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import {
  authenticateGovernanceCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import * as dataGovernanceBarrel from "./index.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { writePlacementConsentRecord } from "./placement-consent-store.js";
import { clearPlacementAuthorityBindingsForTests } from "./placement-platform-bindings.js";
import {
  getPlacementAuthorityBindings,
  installPlacementPlatformAuthority,
} from "./placement-platform-root.js";
import {
  PLACEMENT_REGION_HMAC_KEY_ENV,
  verifyPlatformDeploymentRegionReceipt,
  verifyResourceConsentScope,
  verifySubjectConsent,
} from "./placement-platform-verify.js";
import { resolvePlacement, trustedRegionDefaultFromReceipt } from "./placement-resolve.js";
import { resetSharedDataGovernanceCatalogForTests } from "./runtime-catalog.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";

const TENANT = "tenant-root";
const RESOURCE_ID = "ws-root-1";
const SUBJECT = "user-root";
const REGION = "us-west-2";

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ tenantId: string; userId: string; domain: string } | null> => null),
);
const resolveAuthoritativeMembershipMock = vi.hoisted(() =>
  vi.fn(async () => ({ tenantId: null, userId: null })),
);

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: resolveTenantContextMock,
  resolveAuthoritativeMembership: resolveAuthoritativeMembershipMock,
  TenantContextError: class TenantContextError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
}));

const tempDirs: string[] = [];
const previousStateDir = process.env.OPENBOT_STATE_DIR;
const previousHmac = process.env[PLACEMENT_REGION_HMAC_KEY_ENV];

afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  clearPlacementAuthorityBindingsForTests();
  if (previousStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = previousStateDir;
  }
  if (previousHmac === undefined) {
    delete process.env[PLACEMENT_REGION_HMAC_KEY_ENV];
  } else {
    process.env[PLACEMENT_REGION_HMAC_KEY_ENV] = previousHmac;
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function stateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p4a-root-"));
  tempDirs.push(dir);
  return dir;
}

async function authCall(tenantId: string): Promise<GovernanceAuthenticatedCall> {
  resolveTenantContextMock.mockResolvedValue({
    tenantId,
    userId: SUBJECT,
    domain: "enterprise",
  });
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: `${tenantId}@acme.test`,
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    throw new Error("expected production GovernanceAuthenticatedCall");
  }
  return authenticated.call;
}

async function seedCatalog(dir: string): Promise<void> {
  const store = createFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(dir),
  });
  await store.put({
    envelope: {
      resourceId: RESOURCE_ID,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: TENANT,
      owner: { kind: "user", userId: SUBJECT },
      scope: { kind: "user", userId: SUBJECT },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `bind-${RESOURCE_ID}`,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: `bind-${RESOURCE_ID}`,
        resourceId: RESOURCE_ID,
        role: "canonical",
        storageKind: "filesystem",
        locator: path.join(dir, RESOURCE_ID),
        state: "active",
        contentVersion: "v1",
      },
    ],
  });
}

describe("placement platform composition root", () => {
  it("does not export bind, install, or test rebind from the public barrel", () => {
    expect("bindPlacementAuthority" in dataGovernanceBarrel).toBe(false);
    expect("installPlacementPlatformAuthority" in dataGovernanceBarrel).toBe(false);
    expect("getPlacementAuthorityBindings" in dataGovernanceBarrel).toBe(false);
    expect("writePlacementConsentRecord" in dataGovernanceBarrel).toBe(false);
    expect("replacePlacementAuthorityBindingsForTests" in dataGovernanceBarrel).toBe(false);
    expect("loadValidatedCatalogRecordSync" in dataGovernanceBarrel).toBe(false);
    const gatewaySource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.impl.ts"),
      "utf8",
    );
    expect(gatewaySource).toContain("installPlacementPlatformAuthority()");
    expect(gatewaySource).not.toMatch(/bindPlacementAuthority|stateDir:/);
  });

  it("rejects any arguments on the production install path", () => {
    const install = installPlacementPlatformAuthority as (...args: unknown[]) => unknown;
    expect(() =>
      install({
        stateDir: stateDir(),
        catalog: { loadResourceConsentScope: () => null },
        store: { loadConsent: () => null },
      }),
    ).toThrow(/does not accept arguments/);
    expect(() => install({ stateDir: stateDir() })).toThrow(/does not accept arguments/);
  });

  it("binds resolveStateDir once without the test harness and resolves placement", async () => {
    const dir = stateDir();
    process.env.OPENBOT_STATE_DIR = dir;
    await seedCatalog(dir);
    writePlacementConsentRecord(dir, {
      tenantId: TENANT,
      resourceId: RESOURCE_ID,
      consentVersion: "cv-root",
      subjectIds: [SUBJECT],
      purpose: "eligible_cloud_projection",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      revoked: false,
      consentEpoch: "ce-root",
    });

    const first = installPlacementPlatformAuthority();
    expect(first).toEqual({ ok: true, stateDir: path.resolve(dir), alreadyBound: false });
    expect(installPlacementPlatformAuthority()).toEqual({
      ok: true,
      stateDir: path.resolve(dir),
      alreadyBound: true,
    });
    expect(getPlacementAuthorityBindings()).not.toBeNull();

    const call = await authCall(TENANT);
    const scope = verifyResourceConsentScope({ call, resourceId: RESOURCE_ID });
    expect(scope.ok).toBe(true);
    if (!scope.ok) {
      return;
    }
    expect(scope.scope.dataSubjectIds).toEqual([SUBJECT]);
    const proof = verifySubjectConsent({
      call,
      resourceId: RESOURCE_ID,
      consentVersion: "cv-root",
      scope: scope.scope,
    });
    expect(proof.ok).toBe(true);
    if (!proof.ok) {
      return;
    }

    process.env[PLACEMENT_REGION_HMAC_KEY_ENV] = "p4a-root-hmac";
    const payload = {
      kind: "platform_deployment_region_receipt" as const,
      receiptId: "drr-root",
      tenantId: TENANT,
      region: REGION,
      issuer: "platform" as const,
      issuedAt: new Date().toISOString(),
    };
    const canonical = `{${Object.keys(payload)
      .toSorted()
      .map(
        (key) => `${JSON.stringify(key)}:${JSON.stringify(payload[key as keyof typeof payload])}`,
      )
      .join(",")}}`;
    const signed = {
      payload,
      signature: createHmac("sha256", "p4a-root-hmac").update(canonical).digest("base64url"),
    };
    const receipt = verifyPlatformDeploymentRegionReceipt({ signedReceipt: signed, call });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) {
      return;
    }
    const region = trustedRegionDefaultFromReceipt({ receipt: receipt.receipt, call });
    expect(region.ok).toBe(true);
    if (!region.ok) {
      return;
    }
    expect(
      resolvePlacement({
        tenantId: TENANT,
        ownerScope: "user_owned",
        controllerId: "ctrl-root",
        classification: "internal",
        retentionClass: "standard",
        legalHoldActive: false,
        residencyRequiredRegions: [REGION],
        deploymentProfile: "personal",
        trustedRegionDefault: region.value,
        tenantContract: {
          allowedCustodians: ["device", "openbot"],
          allowedRegions: [REGION],
          requireDedicatedKey: false,
          requireDedicatedDatabase: false,
          offlineRequired: false,
          replicationClass: "none",
        },
        requestedOfflineRequired: null,
        costObjective: null,
        recoveryObjective: null,
        syncClassification: "eligible-with-consent",
        resourceConsentScope: scope.scope,
        subjectConsent: proof.proof,
      }),
    ).toMatchObject({
      ok: true,
      mode: "encrypted-cloud",
      reasonCode: "resolved",
    });
  });

  it("does not switch stateDir on a second production install", async () => {
    const firstDir = stateDir();
    const attackerDir = stateDir();
    process.env.OPENBOT_STATE_DIR = firstDir;
    await seedCatalog(firstDir);
    const first = installPlacementPlatformAuthority();
    process.env.OPENBOT_STATE_DIR = attackerDir;
    await seedCatalog(attackerDir);
    const second = installPlacementPlatformAuthority();
    expect(first.alreadyBound).toBe(false);
    expect(second.alreadyBound).toBe(true);
    expect(second.stateDir).toBe(path.resolve(firstDir));
    expect(() =>
      (installPlacementPlatformAuthority as (...args: unknown[]) => unknown)({
        stateDir: attackerDir,
      }),
    ).toThrow(/does not accept arguments/);
    const call = await authCall(TENANT);
    const scope = verifyResourceConsentScope({ call, resourceId: RESOURCE_ID });
    expect(scope.ok).toBe(true);
  });
});
