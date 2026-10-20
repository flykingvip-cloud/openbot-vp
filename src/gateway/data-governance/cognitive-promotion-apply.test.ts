import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadValidatedCatalogRecordSync } from "./catalog-store.js";
import {
  decryptManagedCloudObjectForTests,
  laterWaveAdapterUnavailable,
  parseCloudProjectionEnvelope,
  projectionBodyPath,
  projectionTombstonePath,
  readCloudProjectionEnvelope,
} from "./cognitive-promotion-adapters.js";
import {
  applyCognitivePromotion,
  recoverPromotionApplyIfNeeded,
  serveCloudProjection,
  tombstoneCognitiveProjection,
} from "./cognitive-promotion-apply.js";
import { getCognitiveProjectionTombstoneReceipt } from "./cognitive-promotion-store.js";
import { prepareCognitivePromotionApply } from "./cognitive-promotion.js";
import {
  P4B_GRANT,
  P4B_RECOMMENDATION,
  P4B_REGION,
  P4B_RESOURCE,
  P4B_SUBJECT,
  P4B_TENANT,
  authenticateP4bCall,
  beginP4bFixture,
  defaultPlacementPolicy,
  installPromotionKeySecretForTests,
  p4bConsent,
  p4bTrustedRegion,
  resolveP4bAuth,
  seedP4bCatalog,
  seedP4bRecommendation,
  seedP4cCanonicalBytes,
  writeP4bGrant,
} from "./cognitive-promotion.test-harness.js";
import * as dataGovernanceBarrel from "./index.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { writePlacementConsentRecord } from "./placement-consent-store.js";

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ tenantId: string; userId: string; domain: string } | null> => null),
);
const resolveAuthoritativeMembershipMock = vi.hoisted(() => vi.fn(async () => null));

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

const previousStateDir = process.env.OPENBOT_STATE_DIR;
const previousKey = process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY;

beforeEach(async () => {
  beginP4bFixture();
  resolveTenantContextMock.mockResolvedValue({
    tenantId: P4B_TENANT,
    userId: P4B_SUBJECT,
    domain: "enterprise",
  });
});

afterEach(() => {
  if (previousStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = previousStateDir;
  }
  if (previousKey === undefined) {
    delete process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY;
  } else {
    process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY = previousKey;
  }
});

function catalogRecord() {
  return (
    loadValidatedCatalogRecordSync({
      storePath: resolveDataGovernanceCatalogPath(process.env.OPENBOT_STATE_DIR!),
      resourceId: P4B_RESOURCE,
    })?.record ?? null
  );
}

function writableCanonicals(record = catalogRecord()) {
  return (record?.bindings ?? []).filter((b) => b.role === "canonical" && b.state === "active");
}

async function localPlacement() {
  const call = await authenticateP4bCall();
  return {
    call,
    placement: {
      controllerId: "ctrl-1",
      retentionClass: "standard",
      residencyRequiredRegions: [P4B_REGION],
      deploymentProfile: "personal" as const,
      trustedRegionDefault: null,
      tenantContract: defaultPlacementPolicy(),
      requestedOfflineRequired: null,
      costObjective: null,
      recoveryObjective: null,
      syncClassification: "local-only" as const,
      resourceConsentScope: null,
      subjectConsent: null,
    },
  };
}

async function cloudPlacement() {
  const call = await authenticateP4bCall();
  return {
    call,
    placement: {
      controllerId: "ctrl-1",
      retentionClass: "standard",
      residencyRequiredRegions: [P4B_REGION],
      deploymentProfile: "personal" as const,
      trustedRegionDefault: await p4bTrustedRegion(call),
      tenantContract: defaultPlacementPolicy(),
      requestedOfflineRequired: null,
      costObjective: null,
      recoveryObjective: null,
      syncClassification: "encrypted-cloud" as const,
      resourceConsentScope: null,
      subjectConsent: null,
    },
  };
}

async function prepareLocal() {
  await seedP4bCatalog();
  writeP4bGrant();
  await seedP4bRecommendation();
  const bytes = seedP4cCanonicalBytes();
  const { call, placement } = await localPlacement();
  const auth = await resolveP4bAuth({ call });
  const prepared = await prepareCognitivePromotionApply({
    call,
    auth,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    placement,
  });
  return { call, auth, prepared, bytes };
}

async function tenantCloudPlacement() {
  const call = await authenticateP4bCall();
  return {
    call,
    placement: {
      controllerId: "ctrl-1",
      retentionClass: "standard",
      residencyRequiredRegions: [P4B_REGION],
      deploymentProfile: "personal" as const,
      trustedRegionDefault: await p4bTrustedRegion(call),
      tenantContract: defaultPlacementPolicy({ allowedCustodians: ["tenant"] }),
      requestedOfflineRequired: null,
      costObjective: null,
      recoveryObjective: null,
      syncClassification: "tenant-cloud" as const,
      resourceConsentScope: null,
      subjectConsent: null,
    },
  };
}

async function prepareTenantCloud() {
  installPromotionKeySecretForTests();
  await seedP4bCatalog();
  writeP4bGrant();
  await seedP4bRecommendation();
  const bytes = seedP4cCanonicalBytes();
  const { call, placement } = await tenantCloudPlacement();
  const auth = await resolveP4bAuth({ call });
  const prepared = await prepareCognitivePromotionApply({
    call,
    auth,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    placement,
  });
  return { call, auth, prepared, bytes };
}

async function dedicatedPlacement() {
  const call = await authenticateP4bCall();
  return {
    call,
    placement: {
      controllerId: "ctrl-1",
      retentionClass: "standard",
      residencyRequiredRegions: [P4B_REGION],
      deploymentProfile: "dedicated" as const,
      trustedRegionDefault: await p4bTrustedRegion(call),
      tenantContract: defaultPlacementPolicy({
        requireDedicatedKey: true,
        requireDedicatedDatabase: true,
        replicationClass: "regional",
      }),
      requestedOfflineRequired: null,
      costObjective: null,
      recoveryObjective: null,
      syncClassification: "encrypted-cloud" as const,
      resourceConsentScope: null,
      subjectConsent: null,
    },
  };
}

async function byosPlacement() {
  const call = await authenticateP4bCall();
  return {
    call,
    placement: {
      controllerId: "ctrl-1",
      retentionClass: "standard",
      residencyRequiredRegions: [P4B_REGION],
      deploymentProfile: "personal" as const,
      trustedRegionDefault: await p4bTrustedRegion(call),
      tenantContract: defaultPlacementPolicy({ allowedCustodians: ["byos"] }),
      requestedOfflineRequired: null,
      costObjective: null,
      recoveryObjective: null,
      syncClassification: "byos-only" as const,
      resourceConsentScope: null,
      subjectConsent: null,
    },
  };
}

async function prepareByos() {
  installPromotionKeySecretForTests();
  await seedP4bCatalog();
  writeP4bGrant();
  await seedP4bRecommendation();
  const bytes = seedP4cCanonicalBytes();
  const { call, placement } = await byosPlacement();
  const auth = await resolveP4bAuth({ call });
  const prepared = await prepareCognitivePromotionApply({
    call,
    auth,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    placement,
  });
  return { call, auth, prepared, bytes };
}

async function archivePlacement() {
  const call = await authenticateP4bCall();
  return {
    call,
    placement: {
      controllerId: "ctrl-1",
      retentionClass: "standard",
      residencyRequiredRegions: [P4B_REGION],
      deploymentProfile: "personal" as const,
      trustedRegionDefault: await p4bTrustedRegion(call),
      tenantContract: defaultPlacementPolicy(),
      requestedOfflineRequired: null,
      costObjective: null,
      recoveryObjective: null,
      syncClassification: "archive-only" as const,
      resourceConsentScope: null,
      subjectConsent: null,
    },
  };
}

async function prepareColdArchive() {
  installPromotionKeySecretForTests();
  await seedP4bCatalog();
  writeP4bGrant();
  await seedP4bRecommendation();
  const bytes = seedP4cCanonicalBytes();
  const { call, placement } = await archivePlacement();
  const auth = await resolveP4bAuth({ call });
  const prepared = await prepareCognitivePromotionApply({
    call,
    auth,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    placement,
  });
  return { call, auth, prepared, bytes };
}

async function prepareDedicated() {
  installPromotionKeySecretForTests();
  await seedP4bCatalog();
  writeP4bGrant();
  await seedP4bRecommendation();
  const bytes = seedP4cCanonicalBytes();
  const { call, placement } = await dedicatedPlacement();
  const auth = await resolveP4bAuth({ call });
  const prepared = await prepareCognitivePromotionApply({
    call,
    auth,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    placement,
  });
  return { call, auth, prepared, bytes };
}

async function prepareCloud() {
  installPromotionKeySecretForTests();
  await seedP4bCatalog();
  writeP4bGrant();
  await seedP4bRecommendation();
  const bytes = seedP4cCanonicalBytes();
  const { call, placement } = await cloudPlacement();
  const auth = await resolveP4bAuth({ call });
  const prepared = await prepareCognitivePromotionApply({
    call,
    auth,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    placement,
  });
  return { call, auth, prepared, bytes };
}

async function prepareEligibleCloud() {
  installPromotionKeySecretForTests();
  await seedP4bCatalog();
  writeP4bGrant();
  await seedP4bRecommendation();
  const bytes = seedP4cCanonicalBytes();
  const { call, placement } = await cloudPlacement();
  const { scope, proof } = await p4bConsent(call);
  const auth = await resolveP4bAuth({ call });
  const prepared = await prepareCognitivePromotionApply({
    call,
    auth,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    placement: {
      ...placement,
      syncClassification: "eligible-with-consent",
      resourceConsentScope: scope,
      subjectConsent: proof,
    },
  });
  return { call, auth, prepared, bytes };
}

async function tombstoneAuth(call: Awaited<ReturnType<typeof authenticateP4bCall>>) {
  writeP4bGrant({
    grantId: "grant-tombstone-1",
    grantKind: "cognitive_projection_tombstone",
  });
  return resolveP4bAuth({
    call,
    grantId: "grant-tombstone-1",
    requiredKind: "cognitive_projection_tombstone",
  });
}

describe("P4-c applyCognitivePromotion", () => {
  it("applies local-only with checksum of canonical bytes and one Catalog CAS", async () => {
    const { call, auth, prepared, bytes } = await prepareLocal();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    const applied = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.receipt.state).toBe("applied");
    expect(applied.receipt.checksum).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(applied.receipt.checksum).not.toBe(
      createHash("sha256").update(P4B_RESOURCE, "utf8").digest("hex"),
    );
    const record = catalogRecord();
    expect(writableCanonicals(record)).toHaveLength(1);
    expect(record?.envelope.canonicalBindingId).toBe(`bind-${P4B_RESOURCE}`);
    expect(record?.envelope.resourceId).toBe(P4B_RESOURCE);
    expect(record?.envelope.governanceVersion).toBe(2);
  });

  it("applies managed encrypted cloud cutover without dual writable canonicals", async () => {
    const { call, auth, prepared } = await prepareCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(prepared.receipt.keyRefId).toBe(`keyref:${P4B_TENANT}`);
    expect(prepared.receipt.region).toBe(P4B_REGION);
    const applied = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const record = catalogRecord();
    const canonicals = writableCanonicals(record);
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0]?.storageKind).toBe("object-store");
    expect(canonicals[0]?.bindingId).toBe(prepared.receipt.toCanonicalBindingId);
    const local = record?.bindings.find((b) => b.bindingId === prepared.receipt.fromBindingId);
    expect(local?.role).toBe("replica");
    expect(local?.state).toBe("read_only");
    expect(record?.envelope.resourceId).toBe(P4B_RESOURCE);
  });

  it("keeps resourceId unchanged across local to managed cloud cutover", async () => {
    const { call, auth, prepared } = await prepareCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    await applyCognitivePromotion({ call, auth, replayId: prepared.receipt.replayId });
    expect(catalogRecord()?.envelope.resourceId).toBe(P4B_RESOURCE);
  });

  it("unlocks later-wave adapters for tenant-cloud, dedicated, byos, and cold-archive", () => {
    expect(laterWaveAdapterUnavailable("byos")).toEqual({
      ok: true,
      adapter: "byos",
    });
    expect(laterWaveAdapterUnavailable("tenant-cloud")).toEqual({
      ok: true,
      adapter: "tenant-cloud",
    });
    expect(laterWaveAdapterUnavailable("cold-archive")).toEqual({
      ok: true,
      adapter: "cold-archive",
    });
    expect(laterWaveAdapterUnavailable("dedicated")).toEqual({
      ok: true,
      adapter: "dedicated",
    });
  });

  it("applies byos promotion to customer-controlled byos store", async () => {
    const { call, auth, prepared, bytes } = await prepareByos();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(prepared.receipt.placementMode).toBe("byos");
    expect(prepared.receipt.canonicalHome).toBe("byos");
    expect(prepared.receipt.keyRefId).toBe(`byos-keyref:${P4B_TENANT}`);
    const applied = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.receipt.state).toBe("applied");
    const record = catalogRecord();
    expect(record?.envelope.canonicalBindingId).toBe(prepared.receipt.toCanonicalBindingId);
    const canonical = writableCanonicals(record)[0];
    expect(canonical?.storageKind).toBe("byos");
    expect(canonical?.locator).toMatch(/\/byos\//);
    expect(writableCanonicals(record)).toHaveLength(1);
    expect(canonical?.locator).toBeTruthy();
    if (!canonical?.locator) {
      return;
    }
    const stored = JSON.parse(readFileSync(canonical.locator, "utf8"));
    expect(stored.kind).toBe("byos_object");
    expect(stored.wrapKeyId).toBe(`wrap:byos_customer:${P4B_TENANT}`);
    expect(decryptManagedCloudObjectForTests(stored).equals(bytes)).toBe(true);
  });

  it("applies dedicated promotion to dedicated-regional store", async () => {
    const { call, auth, prepared, bytes } = await prepareDedicated();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(prepared.receipt.placementMode).toBe("dedicated");
    expect(prepared.receipt.canonicalHome).toBe("dedicated_regional");
    expect(prepared.receipt.keyRefId).toBe(`dedicated-keyref:${P4B_TENANT}`);
    const applied = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.receipt.state).toBe("applied");
    const record = catalogRecord();
    expect(record?.envelope.canonicalBindingId).toBe(prepared.receipt.toCanonicalBindingId);
    const canonical = writableCanonicals(record)[0];
    expect(canonical?.locator).toMatch(/dedicated-regional/);
    expect(canonical?.role).toBe("canonical");
    expect(writableCanonicals(record)).toHaveLength(1);
    expect(canonical?.locator).toBeTruthy();
    if (!canonical?.locator) {
      return;
    }
    const stored = JSON.parse(readFileSync(canonical.locator, "utf8"));
    expect(stored.kind).toBe("dedicated_regional_object");
    expect(stored.wrapKeyId).toBe(`wrap:dedicated_tenant:${P4B_TENANT}`);
    expect(decryptManagedCloudObjectForTests(stored).equals(bytes)).toBe(true);
  });

  it("applies cold-archive promotion and denies live projection recall", async () => {
    const { call, auth, prepared, bytes } = await prepareColdArchive();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(prepared.receipt.placementMode).toBe("cold-archive");
    expect(prepared.receipt.canonicalHome).toBe("cold_archive");
    expect(prepared.receipt.keyRefId).toBe(`archive-keyref:${P4B_TENANT}`);
    const applied = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.receipt.state).toBe("applied");
    const record = catalogRecord();
    expect(record?.envelope.canonicalBindingId).toBe(prepared.receipt.toCanonicalBindingId);
    const canonical = writableCanonicals(record)[0];
    expect(canonical?.storageKind).toBe("object-store");
    expect(canonical?.locator).toMatch(/\/cold-archive\//);
    expect(canonical?.role).toBe("canonical");
    expect(writableCanonicals(record)).toHaveLength(1);
    expect(canonical?.locator).toBeTruthy();
    if (!canonical?.locator) {
      return;
    }
    const stored = JSON.parse(readFileSync(canonical.locator, "utf8"));
    expect(stored.kind).toBe("cold_archive_object");
    expect(stored.wrapKeyId).toBe(`wrap:archive_tenant:${P4B_TENANT}`);
    expect(decryptManagedCloudObjectForTests(stored).equals(bytes)).toBe(true);
    expect(
      serveCloudProjection({
        call,
        stateDir: process.env.OPENBOT_STATE_DIR,
        resourceId: P4B_RESOURCE,
      }),
    ).toEqual({ ok: false, error: "archive_recall_denied" });
  });

  it("applies tenant-cloud promotion to tenant-managed-cloud store", async () => {
    const { call, auth, prepared, bytes } = await prepareTenantCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(prepared.receipt.placementMode).toBe("tenant-cloud");
    expect(prepared.receipt.canonicalHome).toBe("tenant_managed_cloud");
    const applied = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.receipt.state).toBe("applied");
    const record = catalogRecord();
    expect(record?.envelope.canonicalBindingId).toBe(prepared.receipt.toCanonicalBindingId);
    const canonical = writableCanonicals(record)[0];
    expect(canonical?.locator).toMatch(/tenant-managed-cloud/);
    expect(canonical?.role).toBe("canonical");
    expect(writableCanonicals(record)).toHaveLength(1);
    expect(canonical?.locator).toBeTruthy();
    if (!canonical?.locator) {
      return;
    }
    const stored = JSON.parse(readFileSync(canonical.locator, "utf8"));
    expect(stored.kind).toBe("tenant_managed_cloud_object");
    expect(decryptManagedCloudObjectForTests(stored).equals(bytes)).toBe(true);
  });

  it("rejects a projection envelope missing checksum, consentVersion, or tombstoneVersion", () => {
    expect(
      parseCloudProjectionEnvelope({
        resourceId: P4B_RESOURCE,
        permittedClaims: [],
        scope: "cloud_intelligence",
        privacyLevel: "internal",
        contentVersion: "v1",
        provenanceRefs: [],
        policyVersion: "pv-1",
        tombstoneVersion: 0,
      }),
    ).toBeNull();
    expect(
      parseCloudProjectionEnvelope({
        resourceId: P4B_RESOURCE,
        permittedClaims: [],
        scope: "cloud_intelligence",
        privacyLevel: "internal",
        contentVersion: "v1",
        checksum: "abc",
        provenanceRefs: [],
        policyVersion: "pv-1",
        tombstoneVersion: 0,
      }),
    ).toBeNull();
    expect(
      parseCloudProjectionEnvelope({
        resourceId: P4B_RESOURCE,
        permittedClaims: [],
        scope: "cloud_intelligence",
        privacyLevel: "internal",
        contentVersion: "v1",
        checksum: "abc",
        provenanceRefs: [],
        consentVersion: "cv-1",
        policyVersion: "pv-1",
      }),
    ).toBeNull();
  });

  it("reclaims orphan adapter writes when Catalog is unchanged after crash", async () => {
    const { call, auth, prepared } = await prepareCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    await expect(
      applyCognitivePromotion({
        call,
        auth,
        replayId: prepared.receipt.replayId,
        faultAfter: "adapter",
      }),
    ).rejects.toThrow("fault_inject:adapter");
    expect(catalogRecord()?.envelope.governanceVersion).toBe(1);
    expect(writableCanonicals()).toHaveLength(1);
    expect(writableCanonicals()[0]?.storageKind).toBe("filesystem");
    recoverPromotionApplyIfNeeded({
      replayId: prepared.receipt.replayId,
      stateDir: process.env.OPENBOT_STATE_DIR,
    });
    expect(catalogRecord()?.envelope.governanceVersion).toBe(1);
    const retried = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(retried.ok).toBe(true);
    expect(writableCanonicals()).toHaveLength(1);
  });

  it("heals prepared to applied when Catalog already matches after CAS crash", async () => {
    const { call, auth, prepared } = await prepareCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    await expect(
      applyCognitivePromotion({
        call,
        auth,
        replayId: prepared.receipt.replayId,
        faultAfter: "catalog_cas",
      }),
    ).rejects.toThrow("fault_inject:catalog_cas");
    expect(catalogRecord()?.envelope.governanceVersion).toBe(2);
    expect(writableCanonicals()).toHaveLength(1);
    const healed = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(healed.ok).toBe(true);
    if (!healed.ok) {
      return;
    }
    expect(healed.receipt.state).toBe("applied");
    expect(healed.replay).toBe(true);
  });

  it("never re-activates a demoted local canonical after applied", async () => {
    const { call, auth, prepared } = await prepareCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    const first = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(first.ok).toBe(true);
    const second = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.replay).toBe(true);
    const local = catalogRecord()?.bindings.find(
      (b) => b.bindingId === prepared.receipt.fromBindingId,
    );
    expect(local?.role).toBe("replica");
    expect(local?.state).toBe("read_only");
    expect(writableCanonicals()).toHaveLength(1);
  });

  it("fail-closes when two writable canonicals exist", async () => {
    const { call, auth, prepared } = await prepareLocal();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    const record = catalogRecord();
    if (!record) {
      return;
    }
    const storePath = resolveDataGovernanceCatalogPath(process.env.OPENBOT_STATE_DIR!);
    const raw = JSON.parse(readFileSync(storePath, "utf8")) as {
      schemaVersion: number;
      revision: number;
      records: Record<string, unknown>;
    };
    const row = raw.records[P4B_RESOURCE] as {
      envelope: { canonicalBindingId: string };
      bindings: Array<Record<string, unknown>>;
    };
    row.bindings.push({
      bindingId: "bind-second-canonical",
      resourceId: P4B_RESOURCE,
      role: "canonical",
      storageKind: "filesystem",
      locator: join(process.env.OPENBOT_STATE_DIR!, "other"),
      state: "active",
      contentVersion: "v1",
    });
    writeFileSync(storePath, `${JSON.stringify(raw, null, 2)}\n`);
    expect(writableCanonicals()).toHaveLength(0);
    const result = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(result).toEqual({ ok: false, error: "catalog_not_found" });
  });

  it("writes tombstone and checksum before Catalog CAS, then hides the body", async () => {
    const { call, auth, prepared } = await prepareCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    const applied = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(applied.ok).toBe(true);
    const stateDir = process.env.OPENBOT_STATE_DIR!;
    const lifecycleAuth = await tombstoneAuth(call);
    await expect(
      tombstoneCognitiveProjection({
        call,
        auth: lifecycleAuth,
        resourceId: P4B_RESOURCE,
        faultAfter: "tombstone_checksum",
      }),
    ).rejects.toThrow("fault_inject:tombstone_checksum");
    expect(
      existsSync(
        projectionTombstonePath({ stateDir, tenantId: P4B_TENANT, resourceId: P4B_RESOURCE }),
      ),
    ).toBe(true);
    expect(
      existsSync(projectionBodyPath({ stateDir, tenantId: P4B_TENANT, resourceId: P4B_RESOURCE })),
    ).toBe(true);
    expect(catalogRecord()?.envelope.projection?.tombstoneVersion).not.toBe("1");
    const done = await tombstoneCognitiveProjection({
      call,
      auth: lifecycleAuth,
      resourceId: P4B_RESOURCE,
    });
    expect(done.ok).toBe(true);
    expect(catalogRecord()?.envelope.projection?.tombstoneVersion).toBe("1");
    expect(
      existsSync(projectionBodyPath({ stateDir, tenantId: P4B_TENANT, resourceId: P4B_RESOURCE })),
    ).toBe(false);
    expect(
      serveCloudProjection({
        call,
        stateDir,
        resourceId: P4B_RESOURCE,
      }).ok,
    ).toBe(false);
    expect(
      getCognitiveProjectionTombstoneReceipt({
        replayId: done.ok ? done.receipt.replayId : "",
        stateDir,
      })?.state,
    ).toBe("applied");
  });

  it("tombstone wins against a stale projection body", async () => {
    const { call, auth, prepared } = await prepareCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    await applyCognitivePromotion({ call, auth, replayId: prepared.receipt.replayId });
    const stateDir = process.env.OPENBOT_STATE_DIR!;
    const before = readCloudProjectionEnvelope({
      stateDir,
      tenantId: P4B_TENANT,
      resourceId: P4B_RESOURCE,
    });
    expect(before).toBeTruthy();
    const lifecycleAuth = await tombstoneAuth(call);
    await tombstoneCognitiveProjection({
      call,
      auth: lifecycleAuth,
      resourceId: P4B_RESOURCE,
    });
    expect(
      serveCloudProjection({
        call,
        stateDir,
        resourceId: P4B_RESOURCE,
      }),
    ).toMatchObject({ ok: false });
  });

  it("does not export apply internals from the public barrel", () => {
    expect("writeApplyTxnJournal" in dataGovernanceBarrel).toBe(false);
    expect("finalizePromotionReceipt" in dataGovernanceBarrel).toBe(false);
    expect("uniqueCreatePreparedPromotionReceipt" in dataGovernanceBarrel).toBe(false);
    expect("applyCognitivePromotion" in dataGovernanceBarrel).toBe(true);
    expect("tombstoneCognitiveProjection" in dataGovernanceBarrel).toBe(true);
  });
});

describe("P4-c apply authorization negatives", () => {
  it("denies when grantId does not match the prepared receipt", async () => {
    const { call, prepared } = await prepareLocal();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    writeP4bGrant({ grantId: "grant-other" });
    const otherAuth = await resolveP4bAuth({ call, grantId: "grant-other" });
    const result = await applyCognitivePromotion({
      call,
      auth: otherAuth,
      replayId: prepared.receipt.replayId,
    });
    expect(result).toEqual({ ok: false, error: "grant_mismatch" });
  });

  it("denies when grant kind is not cognitive_promotion_apply", async () => {
    const { call, prepared } = await prepareLocal();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    writeP4bGrant({ grantId: "grant-merge", grantKind: "cognitive_merge_apply" });
    const mergeAuth = await resolveP4bAuth({
      call,
      grantId: "grant-merge",
      requiredKind: "cognitive_merge_apply",
    });
    const result = await applyCognitivePromotion({
      call,
      auth: mergeAuth,
      replayId: prepared.receipt.replayId,
    });
    expect(result).toEqual({ ok: false, error: "grant_kind_mismatch" });
  });

  it("denies when stored grant scope does not match receipt.resourceId", async () => {
    const { call, auth, prepared } = await prepareLocal();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    writeP4bGrant({ grantId: P4B_GRANT, resourceId: "ws-other" });
    const result = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(result).toEqual({ ok: false, error: "grant_scope_mismatch" });
  });

  it("denies when ownership proof does not match Catalog", async () => {
    const { call, auth, prepared } = await prepareLocal();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    await seedP4bCatalog({ owner: { kind: "user", userId: "user-other" } });
    const result = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(result).toEqual({ ok: false, error: "ownership_mismatch" });
  });

  it("denies when caller tenant does not match Catalog envelope tenant", async () => {
    const { call, auth, prepared } = await prepareLocal();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    await seedP4bCatalog({ tenantId: "tenant-other" });
    const result = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(result).toEqual({ ok: false, error: "envelope_tenant_mismatch" });
  });

  it("refuses tombstone without a dedicated lifecycle grant or durable receipt", async () => {
    const { call, auth, prepared } = await prepareCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    await applyCognitivePromotion({ call, auth, replayId: prepared.receipt.replayId });
    const refused = await tombstoneCognitiveProjection({
      call,
      auth,
      resourceId: P4B_RESOURCE,
    });
    expect(refused).toEqual({ ok: false, error: "grant_kind_mismatch" });
    expect(
      getCognitiveProjectionTombstoneReceipt({
        replayId: prepared.receipt.replayId,
        stateDir: process.env.OPENBOT_STATE_DIR,
      }),
    ).toBeNull();
  });

  it("denies apply after consent is revoked between prepare and apply", async () => {
    const { call, auth, prepared } = await prepareEligibleCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(prepared.ok && prepared.receipt.consentVersion).toBe("cv-1");
    writePlacementConsentRecord(process.env.OPENBOT_STATE_DIR!, {
      tenantId: P4B_TENANT,
      resourceId: P4B_RESOURCE,
      consentVersion: "cv-1",
      subjectIds: [P4B_SUBJECT],
      purpose: "eligible_cloud_projection",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      revoked: true,
      consentEpoch: "ce-1",
    });
    const result = await applyCognitivePromotion({
      call,
      auth,
      replayId: prepared.receipt.replayId,
    });
    expect(result).toEqual({ ok: false, error: "consent_required" });
  });

  it("denies serveCloudProjection across tenants", async () => {
    const { call, auth, prepared } = await prepareCloud();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    await applyCognitivePromotion({ call, auth, replayId: prepared.receipt.replayId });
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "tenant-b",
      userId: P4B_SUBJECT,
      domain: "enterprise",
    });
    const otherCall = await authenticateP4bCall("tenant-b");
    expect(
      serveCloudProjection({
        call: otherCall,
        stateDir: process.env.OPENBOT_STATE_DIR,
        resourceId: P4B_RESOURCE,
      }),
    ).toEqual({ ok: false, error: "envelope_tenant_mismatch" });
  });
});
