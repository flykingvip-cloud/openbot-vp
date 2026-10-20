import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadValidatedCatalogRecordSync } from "./catalog-store.js";
import { applyCognitivePromotion } from "./cognitive-promotion-apply.js";
import { prepareCognitivePromotionApply } from "./cognitive-promotion.js";
import {
  P4B_RECOMMENDATION,
  P4B_REGION,
  P4B_RESOURCE,
  P4B_SUBJECT,
  P4B_TENANT,
  authenticateP4bCall,
  beginP4bFixture,
  defaultPlacementPolicy,
  installPromotionKeySecretForTests,
  p4bTrustedRegion,
  resolveP4bAuth,
  seedP4bCatalog,
  seedP4bRecommendation,
  seedP4cCanonicalBytes,
  writeP4bGrant,
} from "./cognitive-promotion.test-harness.js";
import * as dataGovernanceBarrel from "./index.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { getPlacementExportReceipt } from "./placement-export-store.js";
import { exportPlacement, restorePlacement } from "./placement-export.js";
import type { PlacementExportBundle } from "./placement-export.js";
import type { StorageBinding } from "./types.js";

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
const EXPORT_GRANT = "grant-export-1";

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

async function exportAuth(call: Awaited<ReturnType<typeof authenticateP4bCall>>) {
  writeP4bGrant({
    grantId: EXPORT_GRANT,
    grantKind: "placement_export_restore",
  });
  return resolveP4bAuth({
    call,
    grantId: EXPORT_GRANT,
    requiredKind: "placement_export_restore",
  });
}

async function seedLocal() {
  await seedP4bCatalog();
  const bytes = seedP4cCanonicalBytes();
  const call = await authenticateP4bCall();
  const auth = await exportAuth(call);
  return { call, auth, bytes };
}

async function applyCloudCutover() {
  installPromotionKeySecretForTests();
  await seedP4bCatalog();
  writeP4bGrant();
  await seedP4bRecommendation();
  const bytes = seedP4cCanonicalBytes();
  const call = await authenticateP4bCall();
  const placement = {
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
  };
  const promoAuth = await resolveP4bAuth({ call });
  const prepared = await prepareCognitivePromotionApply({
    call,
    auth: promoAuth,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    placement,
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) {
    throw new Error("expected prepare");
  }
  const applied = await applyCognitivePromotion({
    call,
    auth: promoAuth,
    replayId: prepared.receipt.replayId,
  });
  expect(applied.ok).toBe(true);
  const auth = await exportAuth(call);
  return { call, auth, bytes, prepared, applied };
}

async function applyArchiveCutover() {
  installPromotionKeySecretForTests();
  await seedP4bCatalog();
  writeP4bGrant();
  await seedP4bRecommendation();
  const bytes = seedP4cCanonicalBytes();
  const call = await authenticateP4bCall();
  const placement = {
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
  };
  const promoAuth = await resolveP4bAuth({ call });
  const prepared = await prepareCognitivePromotionApply({
    call,
    auth: promoAuth,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    placement,
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) {
    throw new Error("expected archive prepare");
  }
  const applied = await applyCognitivePromotion({
    call,
    auth: promoAuth,
    replayId: prepared.receipt.replayId,
  });
  expect(applied.ok).toBe(true);
  const auth = await exportAuth(call);
  return { call, auth, bytes, prepared, applied };
}

describe("P4-d exportPlacement / restorePlacement", () => {
  it("exports local placement with checksum of canonical bytes", async () => {
    const { call, auth, bytes } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    expect(exported.receipt.kind).toBe("p4_placement_export_receipt");
    expect(exported.receipt.resourceId).toBe(P4B_RESOURCE);
    expect(exported.receipt.agentAssetId).toBe(P4B_RESOURCE);
    expect(exported.receipt.canonicalHome).toBe("local");
    expect(exported.receipt.mode).toBe("local-only");
    expect(exported.receipt.checksum).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(exported.receipt.bindingsChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(exported.bundle.kind).toBe("p4_placement_export_bundle");
    expect(
      getPlacementExportReceipt({
        replayId: exported.receipt.replayId,
        stateDir: process.env.OPENBOT_STATE_DIR,
      })?.state,
    ).toBe("applied");
  });

  it("exports managed-cloud cutover without rewriting resourceId", async () => {
    const { call, auth } = await applyCloudCutover();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    expect(exported.receipt.canonicalHome).toBe("managed_encrypted_cloud");
    expect(exported.receipt.mode).toBe("encrypted-cloud");
    expect(exported.receipt.resourceId).toBe(P4B_RESOURCE);
    expect(catalogRecord()?.envelope.resourceId).toBe(P4B_RESOURCE);
  });

  it("exports cold-archive cutover as archive home without rewriting resourceId", async () => {
    const { call, auth } = await applyArchiveCutover();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    expect(exported.receipt.canonicalHome).toBe("cold_archive");
    expect(exported.receipt.mode).toBe("cold-archive");
    expect(exported.receipt.resourceId).toBe(P4B_RESOURCE);
    expect(catalogRecord()?.envelope.resourceId).toBe(P4B_RESOURCE);
  });

  it("restores cold-archive bindings without rewriting resourceId", async () => {
    const { call, auth } = await applyArchiveCutover();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const restored = await restorePlacement({ call, auth, bundle: exported.bundle });
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }
    expect(catalogRecord()?.envelope.resourceId).toBe(P4B_RESOURCE);
    expect(restored.receipt.canonicalHome).toBe("cold_archive");
    expect(restored.receipt.mode).toBe("cold-archive");
  });

  it("restores bindings without rewriting resourceId or agentAssetId", async () => {
    const { call, auth } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const cutover = await applyCloudCutover();
    expect(cutover.applied.ok).toBe(true);
    const restored = await restorePlacement({ call, auth, bundle: exported.bundle });
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }
    expect(restored.replay).toBe(false);
    expect(catalogRecord()?.envelope.resourceId).toBe(P4B_RESOURCE);
    expect(catalogRecord()?.envelope.projection?.agentAssetId ?? P4B_RESOURCE).toBe(P4B_RESOURCE);
    expect(catalogRecord()?.envelope.canonicalBindingId).toBe(`bind-${P4B_RESOURCE}`);
    expect(
      catalogRecord()?.bindings.find((b) => b.bindingId === `bind-${P4B_RESOURCE}`)?.role,
    ).toBe("canonical");
  });

  it("rejects L3 members credentials/outbox/cursors/locks/caches", async () => {
    const { call, auth } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    for (const member of ["credentials", "outbox", "cursors", "locks", "caches"] as const) {
      const tainted = { ...exported.bundle, [member]: { secret: "x" } };
      const result = await restorePlacement({
        call,
        auth,
        bundle: tainted as PlacementExportBundle,
      });
      expect(result).toEqual({ ok: false, error: "bundle_member_excluded" });
    }
  });

  it("rejects a restore that rewrites resourceId on bindings", async () => {
    const { call, auth } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const rewritten: StorageBinding[] = exported.bundle.bindings.map((binding) => ({
      ...binding,
      resourceId: "ws-forged",
    }));
    const result = await restorePlacement({
      call,
      auth,
      bundle: { ...exported.bundle, bindings: rewritten },
    });
    expect(result).toEqual({ ok: false, error: "bindings_integrity_mismatch" });
    expect(catalogRecord()?.envelope.resourceId).toBe(P4B_RESOURCE);
    expect(catalogRecord()?.envelope.governanceVersion).toBe(1);
  });

  it("rejects a restore that rewrites agentAssetId", async () => {
    const { call, auth } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const result = await restorePlacement({
      call,
      auth,
      bundle: {
        ...exported.bundle,
        receipt: { ...exported.bundle.receipt, agentAssetId: "asset-forged" },
      },
    });
    expect(result).toEqual({ ok: false, error: "identity_rewrite_rejected" });
  });

  it("denies cross-tenant export", async () => {
    const { call, auth } = await seedLocal();
    await seedP4bCatalog({ tenantId: "tenant-other" });
    const result = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(result).toEqual({ ok: false, error: "envelope_tenant_mismatch" });
  });

  it("denies promotion grant for export", async () => {
    await seedP4bCatalog();
    seedP4cCanonicalBytes();
    const call = await authenticateP4bCall();
    writeP4bGrant();
    const promoAuth = await resolveP4bAuth({ call });
    const result = exportPlacement({
      call,
      auth: promoAuth,
      resourceId: P4B_RESOURCE,
    });
    expect(result).toEqual({ ok: false, error: "grant_kind_mismatch" });
  });

  it("fail-closes later-wave byos bindings on restore", async () => {
    const { call, auth } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const byos: StorageBinding[] = exported.bundle.bindings.map((binding) =>
      binding.role === "canonical" ? { ...binding, storageKind: "byos" as const } : binding,
    );
    const result = await restorePlacement({
      call,
      auth,
      bundle: { ...exported.bundle, bindings: byos },
    });
    expect(result).toEqual({ ok: false, error: "bindings_integrity_mismatch" });
  });

  it("fail-closes restore that would create two writable canonicals", async () => {
    const { call, auth } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const dual: StorageBinding[] = [
      ...exported.bundle.bindings,
      {
        ...exported.bundle.bindings[0],
        bindingId: "bind-second-canonical",
      },
    ];
    const result = await restorePlacement({
      call,
      auth,
      bundle: { ...exported.bundle, bindings: dual },
    });
    expect(result).toEqual({ ok: false, error: "bindings_integrity_mismatch" });
    expect(catalogRecord()?.envelope.governanceVersion).toBe(1);
  });

  it("refuses to restore a projection binding as the writable canonical", async () => {
    const { call, auth, prepared } = await applyCloudCutover();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    expect(exported.receipt.projectionBindingId).toBe(`planned-projection-${P4B_RESOURCE}`);
    const flipped: StorageBinding[] = exported.bundle.bindings.map((binding) => {
      if (binding.bindingId === exported.receipt.projectionBindingId) {
        return { ...binding, role: "canonical" as const, state: "active" as const };
      }
      if (binding.bindingId === prepared.receipt.toCanonicalBindingId) {
        return { ...binding, role: "replica" as const, state: "read_only" as const };
      }
      return binding;
    });
    const result = await restorePlacement({
      call,
      auth,
      bundle: { ...exported.bundle, bindings: flipped },
    });
    expect(result).toEqual({ ok: false, error: "bindings_integrity_mismatch" });
  });

  it("rejects locator/objectKey/contentVersion/state/role tampers before Catalog CAS", async () => {
    const { call, auth } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const versionBefore = catalogRecord()?.envelope.governanceVersion;
    const patches: Array<(binding: StorageBinding) => StorageBinding> = [
      (binding) => ({ ...binding, locator: `${binding.locator}/forged` }),
      (binding) => ({ ...binding, objectKey: "forged-object" }),
      (binding) => ({ ...binding, contentVersion: "v-forged" }),
      (binding) =>
        binding.role === "canonical" ? { ...binding, state: "read_only" as const } : binding,
      (binding) =>
        binding.role === "canonical" ? { ...binding, role: "replica" as const } : binding,
    ];
    for (const patch of patches) {
      const result = await restorePlacement({
        call,
        auth,
        bundle: {
          ...exported.bundle,
          bindings: exported.bundle.bindings.map(patch),
        },
      });
      expect(result).toEqual({ ok: false, error: "bindings_integrity_mismatch" });
      expect(result).not.toEqual({ ok: true, receipt: exported.receipt, replay: true });
      expect(catalogRecord()?.envelope.governanceVersion).toBe(versionBefore);
      expect(catalogRecord()?.bindings[0]?.locator).toBe(exported.bundle.bindings[0]?.locator);
    }
  });

  it("rejects receipt tenantId/mode/canonicalHome/checksum tampers", async () => {
    const { call, auth } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const versionBefore = catalogRecord()?.envelope.governanceVersion;
    const patches: Partial<typeof exported.bundle.receipt>[] = [
      { tenantId: "tenant-forged" },
      { mode: "encrypted-cloud" },
      { canonicalHome: "managed_encrypted_cloud" },
      { checksum: "0".repeat(64) },
      { fromBindingId: "bind-forged" },
      { projectionBindingId: "proj-forged" },
      { bindingsChecksum: "0".repeat(64) },
    ];
    for (const patch of patches) {
      const result = await restorePlacement({
        call,
        auth,
        bundle: {
          ...exported.bundle,
          receipt: { ...exported.bundle.receipt, ...patch },
        },
      });
      expect(result).toEqual({ ok: false, error: "identity_rewrite_rejected" });
      expect(catalogRecord()?.envelope.governanceVersion).toBe(versionBefore);
    }
  });

  it("does not treat a locator-tampered bundle as replay when Catalog already matches", async () => {
    const { call, auth } = await seedLocal();
    const exported = exportPlacement({ call, auth, resourceId: P4B_RESOURCE });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const result = await restorePlacement({
      call,
      auth,
      bundle: {
        ...exported.bundle,
        bindings: exported.bundle.bindings.map((binding) => ({
          ...binding,
          locator: `${binding.locator}/hijacked`,
        })),
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe("bindings_integrity_mismatch");
    expect("replay" in result).toBe(false);
    expect(catalogRecord()?.envelope.governanceVersion).toBe(1);
  });

  it("does not export store internals from the public barrel", () => {
    expect("exportPlacement" in dataGovernanceBarrel).toBe(true);
    expect("restorePlacement" in dataGovernanceBarrel).toBe(true);
    expect("uniqueCreatePlacementExportReceipt" in dataGovernanceBarrel).toBe(false);
    expect("finalizePlacementExportReceipt" in dataGovernanceBarrel).toBe(false);
    expect("getPlacementExportImage" in dataGovernanceBarrel).toBe(false);
  });
});
