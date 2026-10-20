/**
 * Test-only helpers. Production modules must not import this file.
 * Seeds Catalog via official put() and consent via the file store, then rebinds
 * through the test-only installer. Does not pass stateDir to the production install.
 */
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import type { GovernanceAuthenticatedCall } from "./cognitive-recommendation-auth.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { writePlacementConsentRecord } from "./placement-consent-store.js";
import { replacePlacementAuthorityBindingsForTests } from "./placement-platform-bindings.js";
import {
  PLACEMENT_REGION_HMAC_KEY_ENV,
  verifyPlatformDeploymentRegionReceipt,
  verifyResourceConsentScope,
  verifySubjectConsent,
  type PlatformDeploymentRegionReceipt,
  type ResourceConsentScope,
  type SignedPlatformDeploymentRegionReceipt,
  type SubjectConsentProof,
} from "./placement-platform-verify.js";
import type { ActorRef, OwnershipPrincipal, ResourceScope } from "./types.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";

const TEST_REGION_HMAC = "p4a-test-region-hmac-key";

let fixtureStateDir: string | null = null;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function installPlacementRegionTrustSecretForTests(secret = TEST_REGION_HMAC): () => void {
  const previous = process.env[PLACEMENT_REGION_HMAC_KEY_ENV];
  process.env[PLACEMENT_REGION_HMAC_KEY_ENV] = secret;
  return () => {
    if (previous === undefined) {
      delete process.env[PLACEMENT_REGION_HMAC_KEY_ENV];
      return;
    }
    process.env[PLACEMENT_REGION_HMAC_KEY_ENV] = previous;
  };
}

export function rebindPlacementAuthorityForTests(stateDir: string): void {
  replacePlacementAuthorityBindingsForTests(stateDir);
}

export function resetPlacementAuthorityForTests(): string {
  fixtureStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "p4a-placement-"));
  rebindPlacementAuthorityForTests(fixtureStateDir);
  return fixtureStateDir;
}

export function placementFixtureStateDirForTests(): string {
  return fixtureStateDir ?? resetPlacementAuthorityForTests();
}

function ensureFixtureDir(): string {
  return fixtureStateDir ?? resetPlacementAuthorityForTests();
}

function ownerAndScope(
  owner: OwnershipPrincipal,
  tenantId: string,
): { owner: OwnershipPrincipal; scope: ResourceScope } {
  if (owner.kind === "user") {
    return { owner, scope: { kind: "user", userId: owner.userId } };
  }
  if (owner.kind === "group") {
    return { owner, scope: { kind: "group", groupId: owner.groupId } };
  }
  if (owner.kind === "position") {
    return { owner, scope: { kind: "tenant", tenantId } };
  }
  return { owner, scope: { kind: "system" } };
}

export async function putPlacementCatalogRecordForTests(params: {
  tenantId: string;
  resourceId: string;
  owner: OwnershipPrincipal;
  projection?: Record<string, string | null>;
  classification?: "public" | "internal" | "confidential" | "restricted";
  lifecycleState?: "active" | "archived" | "read_only";
  legalHold?: { holdId: string; reason: string; appliedBy: ActorRef; appliedAt: string };
}): Promise<void> {
  const stateDir = ensureFixtureDir();
  const { owner, scope } = ownerAndScope(params.owner, params.tenantId);
  const store = createFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
  });
  await store.put({
    envelope: {
      resourceId: params.resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: params.tenantId,
      owner,
      scope,
      lifecycleState: params.lifecycleState ?? "active",
      classification: params.classification ?? "internal",
      governanceVersion: 1,
      canonicalBindingId: `bind-${params.resourceId}`,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
      ...(params.projection ? { projection: params.projection } : {}),
      ...(params.legalHold ? { legalHold: params.legalHold } : {}),
    },
    bindings: [
      {
        bindingId: `bind-${params.resourceId}`,
        resourceId: params.resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: path.join(stateDir, params.resourceId),
        state: "active",
        contentVersion: "v1",
      },
    ],
  });
  rebindPlacementAuthorityForTests(stateDir);
}

export function signPlatformDeploymentRegionReceiptForTests(params: {
  receiptId: string;
  tenantId: string;
  region: string;
  issuedAt?: string;
  secret?: string;
}): SignedPlatformDeploymentRegionReceipt {
  const payload = {
    kind: "platform_deployment_region_receipt" as const,
    receiptId: params.receiptId,
    tenantId: params.tenantId,
    region: params.region,
    issuer: "platform" as const,
    issuedAt: params.issuedAt ?? new Date().toISOString(),
  };
  const secret = params.secret ?? process.env[PLACEMENT_REGION_HMAC_KEY_ENV] ?? TEST_REGION_HMAC;
  return {
    payload,
    signature: createHmac("sha256", secret).update(canonicalJson(payload)).digest("base64url"),
  };
}

export function mintPlatformDeploymentRegionReceiptForTests(params: {
  receiptId: string;
  tenantId: string;
  region: string;
  call: GovernanceAuthenticatedCall;
}): PlatformDeploymentRegionReceipt {
  installPlacementRegionTrustSecretForTests();
  const verified = verifyPlatformDeploymentRegionReceipt({
    signedReceipt: signPlatformDeploymentRegionReceiptForTests(params),
    call: params.call,
  });
  if (!verified.ok) {
    throw new Error("test harness region receipt failed production verify");
  }
  return verified.receipt;
}

export async function mintResourceConsentScopeForTests(params: {
  tenantId: string;
  resourceId: string;
  ownerUserId: string;
  call: GovernanceAuthenticatedCall;
}): Promise<ResourceConsentScope> {
  await putPlacementCatalogRecordForTests({
    tenantId: params.tenantId,
    resourceId: params.resourceId,
    owner: { kind: "user", userId: params.ownerUserId },
  });
  const verified = verifyResourceConsentScope({
    call: params.call,
    resourceId: params.resourceId,
  });
  if (!verified.ok) {
    throw new Error("test harness catalog scope failed production verify");
  }
  return verified.scope;
}

export async function mintSubjectConsentProofForTests(params: {
  tenantId: string;
  resourceId: string;
  consentVersion: string;
  ownerUserId: string;
  expiresAt: string;
  call: GovernanceAuthenticatedCall;
  revoked?: boolean;
}): Promise<SubjectConsentProof> {
  await putPlacementCatalogRecordForTests({
    tenantId: params.tenantId,
    resourceId: params.resourceId,
    owner: { kind: "user", userId: params.ownerUserId },
  });
  writePlacementConsentRecord(ensureFixtureDir(), {
    tenantId: params.tenantId,
    resourceId: params.resourceId,
    consentVersion: params.consentVersion,
    subjectIds: [params.ownerUserId],
    purpose: "eligible_cloud_projection",
    expiresAt: params.expiresAt,
    revoked: params.revoked === true,
    consentEpoch: "ce-1",
  });
  const scope = verifyResourceConsentScope({
    call: params.call,
    resourceId: params.resourceId,
  });
  if (!scope.ok) {
    throw new Error("test harness catalog scope failed production verify");
  }
  const verified = verifySubjectConsent({
    call: params.call,
    resourceId: params.resourceId,
    consentVersion: params.consentVersion,
    scope: scope.scope,
  });
  if (!verified.ok) {
    throw new Error("test harness consent failed production verify");
  }
  return verified.proof;
}
