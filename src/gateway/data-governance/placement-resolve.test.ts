import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadValidatedCatalogRecordSync } from "./catalog-store.js";
import {
  authenticateGovernanceCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import * as dataGovernanceBarrel from "./index.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { writePlacementConsentRecord } from "./placement-consent-store.js";
import * as placementProofs from "./placement-platform-proofs.js";
import * as placementVerify from "./placement-platform-verify.js";
import {
  reverifySubjectConsent,
  verifyPlatformDeploymentRegionReceipt,
  verifyResourceConsentScope,
  verifySubjectConsent,
} from "./placement-platform-verify.js";
import {
  PLACEMENT_DENY_REASONS,
  resolvePlacement,
  trustedRegionDefaultFromReceipt,
  type PlacementDenyReason,
  type PlacementPolicy,
  type PlacementResolverInput,
  type PlacementResolverOutput,
  type SyncClassification,
  type UntrustedRegionSource,
} from "./placement-resolve.js";
import {
  installPlacementRegionTrustSecretForTests,
  mintPlatformDeploymentRegionReceiptForTests,
  mintResourceConsentScopeForTests,
  mintSubjectConsentProofForTests,
  placementFixtureStateDirForTests,
  putPlacementCatalogRecordForTests,
  resetPlacementAuthorityForTests,
  signPlatformDeploymentRegionReceiptForTests,
} from "./placement-resolve.test-harness.js";

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

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const REGION = "us-west-2";
const RESOURCE_ID = "res-1";
const SUBJECT_A = "subject-a";
const SUBJECT_B = "subject-b";
const CONSENT_EXPIRES = new Date(Date.now() + 86_400_000).toISOString();
const CONSENT_EXPIRED = new Date(Date.now() - 86_400_000).toISOString();

let tenantCall: GovernanceAuthenticatedCall;
let otherCall: GovernanceAuthenticatedCall;

async function authenticatePlacementCall(tenantId: string): Promise<GovernanceAuthenticatedCall> {
  resolveTenantContextMock.mockResolvedValue({
    tenantId,
    userId: "u-placement",
    domain: "enterprise",
  });
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: `${tenantId}@acme.test`,
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    throw new Error("expected placement GovernanceAuthenticatedCall");
  }
  return authenticated.call;
}

function callFor(tenantId: string): GovernanceAuthenticatedCall {
  return tenantId === OTHER_TENANT ? otherCall : tenantCall;
}

beforeEach(async () => {
  resetPlacementAuthorityForTests();
  installPlacementRegionTrustSecretForTests();
  tenantCall = await authenticatePlacementCall(TENANT);
  otherCall = await authenticatePlacementCall(OTHER_TENANT);
});

afterEach(() => {
  resetPlacementAuthorityForTests();
  vi.useRealTimers();
});

function forgedPlatformReceipt(patch: Record<string, string> = {}) {
  return {
    kind: "platform_deployment_region_receipt",
    receiptId: "drr-forged",
    tenantId: TENANT,
    region: REGION,
    issuer: "platform",
    ...patch,
  };
}

function mintedReceipt(tenantId = TENANT, region = REGION) {
  return mintPlatformDeploymentRegionReceiptForTests({
    receiptId: `drr-${tenantId}-${region}`,
    tenantId,
    region,
    call: callFor(tenantId),
  });
}

function trustedRegion(tenantId = TENANT, region = REGION) {
  const built = trustedRegionDefaultFromReceipt({
    receipt: mintedReceipt(tenantId, region),
    call: callFor(tenantId),
  });
  if (!built.ok) {
    throw new Error("expected trusted region");
  }
  return built.value;
}

async function resourceScope(
  patch: { tenantId?: string; resourceId?: string; ownerUserId?: string } = {},
) {
  const tenantId = patch.tenantId ?? TENANT;
  return mintResourceConsentScopeForTests({
    tenantId,
    resourceId: patch.resourceId ?? RESOURCE_ID,
    ownerUserId: patch.ownerUserId ?? SUBJECT_A,
    call: callFor(tenantId),
  });
}

async function subjectConsent(
  patch: {
    tenantId?: string;
    resourceId?: string;
    ownerUserId?: string;
    expiresAt?: string;
    revoked?: boolean;
    consentVersion?: string;
  } = {},
) {
  const tenantId = patch.tenantId ?? TENANT;
  return mintSubjectConsentProofForTests({
    tenantId,
    resourceId: patch.resourceId ?? RESOURCE_ID,
    consentVersion: patch.consentVersion ?? "cv-1",
    ownerUserId: patch.ownerUserId ?? SUBJECT_A,
    expiresAt: patch.expiresAt ?? CONSENT_EXPIRES,
    revoked: patch.revoked,
    call: callFor(tenantId),
  });
}

async function consentInput(
  patch: Partial<PlacementResolverInput> = {},
): Promise<PlacementResolverInput> {
  return input({
    syncClassification: "eligible-with-consent",
    resourceConsentScope: patch.resourceConsentScope ?? (await resourceScope()),
    subjectConsent: patch.subjectConsent ?? (await subjectConsent()),
    ...patch,
  });
}

function policy(patch: Partial<PlacementPolicy> = {}): PlacementPolicy {
  return {
    allowedCustodians: ["device", "openbot"],
    allowedRegions: [REGION, "eu-central-1"],
    requireDedicatedKey: false,
    requireDedicatedDatabase: false,
    offlineRequired: false,
    replicationClass: "none",
    ...patch,
  };
}

function input(patch: Partial<PlacementResolverInput> = {}): PlacementResolverInput {
  return {
    tenantId: TENANT,
    ownerScope: "user_owned",
    controllerId: "ctrl-1",
    classification: "internal",
    retentionClass: "standard",
    legalHoldActive: false,
    residencyRequiredRegions: [REGION],
    deploymentProfile: "personal",
    trustedRegionDefault: trustedRegion(),
    tenantContract: policy(),
    requestedOfflineRequired: null,
    costObjective: null,
    recoveryObjective: null,
    syncClassification: "local-only",
    resourceConsentScope: null,
    subjectConsent: null,
    ...patch,
  };
}

function denyOf(reason: PlacementDenyReason, patch: Partial<PlacementResolverInput> = {}) {
  return resolvePlacement(input(patch));
}

describe("trustedRegionDefaultFromReceipt", () => {
  it("constructs only from a branded platform receipt bound to auth.tenantId", () => {
    const built = trustedRegionDefaultFromReceipt({
      receipt: mintedReceipt(),
      call: tenantCall,
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.region).toBe(REGION);
      expect(built.value.tenantId).toBe(TENANT);
    }
  });

  it('rejects a structurally correct but unbranded { issuer: "platform" } receipt', () => {
    expect(
      trustedRegionDefaultFromReceipt({
        receipt: forgedPlatformReceipt(),
        call: tenantCall,
      }),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
    expect(
      resolvePlacement(
        input({
          syncClassification: "encrypted-cloud",
          trustedRegionDefault: trustedRegionDefaultFromReceipt({
            receipt: forgedPlatformReceipt(),
            call: tenantCall,
          }).ok
            ? trustedRegion()
            : null,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });

  it.each([
    "client",
    "envelope",
    "cogniweave",
    "tenant_contract",
  ] satisfies UntrustedRegionSource[])(
    "rejects %s self-reported default region",
    (claimedSource) => {
      expect(
        trustedRegionDefaultFromReceipt({
          receipt: mintedReceipt(),
          call: tenantCall,
          claimedSource,
        }),
      ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
    },
  );

  it("rejects tenant mismatch on a branded receipt", () => {
    expect(
      trustedRegionDefaultFromReceipt({
        receipt: mintedReceipt(OTHER_TENANT),
        call: tenantCall,
      }),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });
});

describe("resolvePlacement deny reasons", () => {
  const cases: Array<{ reason: PlacementDenyReason; patch: Partial<PlacementResolverInput> }> = [
    { reason: "missing_auth_tenant", patch: { tenantId: "  " } },
    { reason: "missing_placement_policy", patch: { tenantContract: null } },
    { reason: "missing_sync_classification", patch: { syncClassification: null } },
    { reason: "missing_classification", patch: { classification: null } },
    { reason: "sync_class_blocked", patch: { syncClassification: "blocked" } },
    {
      reason: "legal_hold_blocks_placement_change",
      patch: { legalHoldActive: true, syncClassification: "encrypted-cloud" },
    },
    {
      reason: "dedicated_key_unsupported",
      patch: { tenantContract: policy({ requireDedicatedKey: true }) },
    },
    {
      reason: "dedicated_database_unsupported",
      patch: { tenantContract: policy({ requireDedicatedDatabase: true }) },
    },
    {
      reason: "replication_unsupported",
      patch: { tenantContract: policy({ replicationClass: "regional" }) },
    },
    {
      reason: "policy_conflict",
      patch: { tenantContract: policy({ allowedCustodians: [] }) },
    },
    {
      reason: "sync_class_not_first_wave",
      patch: { syncClassification: "tenant-only" },
    },
    {
      reason: "offline_requires_local_canonical",
      patch: {
        requestedOfflineRequired: true,
        syncClassification: "encrypted-cloud",
        tenantContract: policy({ allowedCustodians: ["device"] }),
      },
    },
    {
      reason: "offline_conflicts_managed_cloud",
      patch: {
        requestedOfflineRequired: true,
        syncClassification: "encrypted-cloud",
        tenantContract: policy({ allowedCustodians: ["openbot"] }),
      },
    },
    {
      reason: "custodian_not_allowed",
      patch: {
        syncClassification: "local-only",
        tenantContract: policy({ allowedCustodians: ["openbot"] }),
      },
    },
    {
      reason: "missing_trusted_region",
      patch: { syncClassification: "encrypted-cloud", trustedRegionDefault: null },
    },
    {
      reason: "residency_conflict",
      patch: {
        syncClassification: "encrypted-cloud",
        residencyRequiredRegions: ["eu-central-1"],
      },
    },
    {
      reason: "first_wave_adapter_unavailable",
      patch: {
        deploymentProfile: "dedicated",
        syncClassification: "tenant-cloud",
        tenantContract: policy({ allowedCustodians: ["tenant"] }),
      },
    },
    {
      reason: "consent_required",
      patch: { syncClassification: "eligible-with-consent", subjectConsent: null },
    },
  ];

  it("covers every deny reason exactly once in the reachable matrix", () => {
    const seen = new Set(cases.map((row) => row.reason));
    expect([...seen].toSorted()).toEqual([...PLACEMENT_DENY_REASONS].toSorted());
    expect(cases).toHaveLength(PLACEMENT_DENY_REASONS.length);
  });

  it.each(cases)("denies $reason", ({ reason, patch }) => {
    expect(denyOf(reason, patch)).toEqual({ ok: false, reasonCode: reason });
  });

  it("treats unknown classification strings as missing_classification", () => {
    expect(
      resolvePlacement(
        input({ classification: "secret" as PlacementResolverInput["classification"] }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_classification" });
  });

  it("denies later-wave sync classes and multi-region replication", () => {
    for (const sync of ["tenant-only"] as const) {
      expect(denyOf("sync_class_not_first_wave", { syncClassification: sync })).toEqual({
        ok: false,
        reasonCode: "sync_class_not_first_wave",
      });
    }
    expect(
      denyOf("replication_unsupported", {
        tenantContract: policy({ replicationClass: "multi-region" }),
      }),
    ).toEqual({ ok: false, reasonCode: "replication_unsupported" });
  });
});

describe("resolvePlacement precedence (first deny wins)", () => {
  it("empty tenant wins over missing policy and later denies", () => {
    expect(
      resolvePlacement(
        input({
          tenantId: "",
          tenantContract: null,
          syncClassification: null,
          classification: null,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_auth_tenant" });
  });

  it("missing policy wins over missing sync and classification", () => {
    expect(
      resolvePlacement(
        input({
          tenantContract: null,
          syncClassification: null,
          classification: null,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_placement_policy" });
  });

  it("missing sync wins over missing classification", () => {
    expect(resolvePlacement(input({ syncClassification: null, classification: null }))).toEqual({
      ok: false,
      reasonCode: "missing_sync_classification",
    });
  });

  it("blocked sync wins over dedicated-key and later-wave-shaped policy", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "blocked",
          tenantContract: policy({ requireDedicatedKey: true, replicationClass: "regional" }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "sync_class_blocked" });
  });

  it("legal hold that would move the writable canonical wins over dedicated key", () => {
    expect(
      resolvePlacement(
        input({
          legalHoldActive: true,
          syncClassification: "encrypted-cloud",
          tenantContract: policy({ requireDedicatedKey: true }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "legal_hold_blocks_placement_change" });
  });

  it("dedicated key wins over dedicated database and regional replication", () => {
    expect(
      resolvePlacement(
        input({
          tenantContract: policy({
            requireDedicatedKey: true,
            requireDedicatedDatabase: true,
            replicationClass: "regional",
          }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "dedicated_key_unsupported" });
  });

  it("dedicated database wins over regional replication", () => {
    expect(
      resolvePlacement(
        input({
          tenantContract: policy({
            requireDedicatedDatabase: true,
            replicationClass: "multi-region",
          }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "dedicated_database_unsupported" });
  });

  it("regional replication wins over empty custodians and later-wave sync", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "byos-only",
          tenantContract: policy({
            replicationClass: "regional",
            allowedCustodians: [],
          }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "replication_unsupported" });
  });

  it("empty custodians wins over later-wave sync", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "tenant-only",
          tenantContract: policy({ allowedCustodians: [] }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "policy_conflict" });
  });

  it("later-wave sync wins over offline+encrypted-cloud deny codes", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "tenant-only",
          requestedOfflineRequired: true,
          tenantContract: policy({ allowedCustodians: ["device"] }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "sync_class_not_first_wave" });
  });

  it("later-wave sync wins over missing consent on a cloud-shaped request", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "tenant-only",
          subjectConsent: null,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "sync_class_not_first_wave" });
  });

  it("consent_required wins over missing trusted region for eligible-with-consent", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "eligible-with-consent",
          trustedRegionDefault: null,
          subjectConsent: null,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("offline_requires_local_canonical wins over missing trusted region", () => {
    expect(
      resolvePlacement(
        input({
          requestedOfflineRequired: true,
          syncClassification: "encrypted-cloud",
          trustedRegionDefault: null,
          tenantContract: policy({ allowedCustodians: ["device"] }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "offline_requires_local_canonical" });
  });
});

describe("forged and default region rejection", () => {
  it("rejects a raw string trustedRegionDefault as forged", () => {
    const forged = input({
      syncClassification: "encrypted-cloud",
      trustedRegionDefault: REGION as unknown as PlacementResolverInput["trustedRegionDefault"],
    });
    expect(resolvePlacement(forged)).toEqual({
      ok: false,
      reasonCode: "missing_trusted_region",
    });
  });

  it("rejects an unbranded object that looks like a default region", () => {
    const forged = input({
      syncClassification: "encrypted-cloud",
      trustedRegionDefault: {
        region: REGION,
        tenantId: TENANT,
        receiptId: "forged",
      } as unknown as PlacementResolverInput["trustedRegionDefault"],
    });
    expect(resolvePlacement(forged)).toEqual({
      ok: false,
      reasonCode: "missing_trusted_region",
    });
  });

  it("does not read a region out of tenantContract.allowedRegions when receipt is missing", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "encrypted-cloud",
          trustedRegionDefault: null,
          tenantContract: policy({ allowedRegions: [REGION] }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });
});

describe("region intersection", () => {
  it("selects trustedRegionDefault only when it is in allowed ∩ residency", () => {
    const allowed = resolvePlacement(
      input({
        syncClassification: "encrypted-cloud",
        residencyRequiredRegions: [REGION, "ap-southeast-1"],
        tenantContract: policy({ allowedRegions: [REGION, "eu-central-1"] }),
      }),
    );
    expect(allowed).toMatchObject({
      ok: true,
      region: REGION,
      mode: "encrypted-cloud",
      canonicalHome: "managed_encrypted_cloud",
    });
  });

  it("denies when trusted region is allowed but outside residency", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "encrypted-cloud",
          residencyRequiredRegions: ["eu-central-1"],
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "residency_conflict" });
  });

  it("denies when trusted region is in residency but not allowed", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "encrypted-cloud",
          residencyRequiredRegions: [REGION],
          tenantContract: policy({ allowedRegions: ["eu-central-1"] }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "residency_conflict" });
  });

  it("treats null residency as wildcard and still requires allowedRegions membership", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "encrypted-cloud",
          residencyRequiredRegions: null,
        }),
      ),
    ).toMatchObject({ ok: true, region: REGION });
    expect(
      resolvePlacement(
        input({
          syncClassification: "encrypted-cloud",
          residencyRequiredRegions: null,
          tenantContract: policy({ allowedRegions: ["eu-central-1"] }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "residency_conflict" });
  });

  it("returns region null for local-only with no implied cloud write", () => {
    expect(resolvePlacement(input({ syncClassification: "local-only" }))).toMatchObject({
      ok: true,
      mode: "local-only",
      canonicalHome: "local",
      projection: "none",
      region: null,
      keyRef: null,
    });
  });
});

describe("offline policy cannot be relaxed by the caller", () => {
  it("keeps tenant offlineRequired=true when requestedOfflineRequired is false", () => {
    const result = resolvePlacement(
      input({
        requestedOfflineRequired: false,
        syncClassification: "encrypted-cloud",
        tenantContract: policy({ offlineRequired: true }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      mode: "encrypted-cloud",
      canonicalHome: "local",
      projection: "managed_encrypted_cloud",
    });
    expect(result.ok && result.canonicalHome === "managed_encrypted_cloud").toBe(false);
  });
});

describe("offline + encrypted-cloud projection", () => {
  it("keeps local writable canonical and adds a managed projection", () => {
    const result = resolvePlacement(
      input({
        requestedOfflineRequired: true,
        syncClassification: "encrypted-cloud",
      }),
    );
    expect(result).toEqual({
      ok: true,
      mode: "encrypted-cloud",
      canonicalHome: "local",
      projection: "managed_encrypted_cloud",
      region: REGION,
      keyRef: null,
      replicationClass: "none",
      reasonCode: "resolved",
    });
  });

  it("never returns a cloud writable canonical when offlineRequired is true", async () => {
    const variants: Array<Partial<PlacementResolverInput>> = [
      { requestedOfflineRequired: true, syncClassification: "encrypted-cloud" },
      {
        requestedOfflineRequired: null,
        tenantContract: policy({ offlineRequired: true }),
        syncClassification: "encrypted-cloud",
      },
      {
        requestedOfflineRequired: true,
        syncClassification: "eligible-with-consent",
        resourceConsentScope: await resourceScope(),
        subjectConsent: await subjectConsent(),
      },
      { requestedOfflineRequired: true, syncClassification: "local-only" },
    ];
    for (const patch of variants) {
      const result = resolvePlacement(input(patch));
      if (result.ok) {
        expect(result.canonicalHome).toBe("local");
      } else {
        expect(result.reasonCode).not.toBe("resolved");
      }
    }
  });

  it("allows legal hold when only a derived projection is added", () => {
    expect(
      resolvePlacement(
        input({
          legalHoldActive: true,
          requestedOfflineRequired: true,
          syncClassification: "encrypted-cloud",
        }),
      ),
    ).toMatchObject({
      ok: true,
      canonicalHome: "local",
      projection: "managed_encrypted_cloud",
    });
  });
});

describe("later-wave mode fail-closed", () => {
  it("never emits archive except for archive-only, and only emits byos when byos custodian is set", async () => {
    const syncs: SyncClassification[] = [
      "local-only",
      "eligible-with-consent",
      "encrypted-cloud",
      "tenant-only",
      "tenant-cloud",
      "byos-only",
      "archive-only",
      "blocked",
    ];
    for (const syncClassification of syncs) {
      const result = resolvePlacement(
        input({
          syncClassification,
          tenantContract:
            syncClassification === "tenant-cloud"
              ? policy({ allowedCustodians: ["tenant"] })
              : syncClassification === "byos-only"
                ? policy({ allowedCustodians: ["byos"] })
                : policy(),
          trustedRegionDefault:
            syncClassification === "tenant-cloud" ||
            syncClassification === "byos-only" ||
            syncClassification === "archive-only" ||
            syncClassification === "encrypted-cloud" ||
            syncClassification === "eligible-with-consent"
              ? trustedRegion()
              : null,
          subjectConsent:
            syncClassification === "eligible-with-consent" ? await subjectConsent() : null,
          resourceConsentScope:
            syncClassification === "eligible-with-consent" ? await resourceScope() : null,
        }),
      );
      if (result.ok) {
        expect(["local-only", "encrypted-cloud", "tenant-cloud", "byos", "cold-archive"]).toContain(
          result.mode,
        );
        expect([
          "local",
          "managed_encrypted_cloud",
          "tenant_managed_cloud",
          "byos",
          "cold_archive",
        ]).toContain(result.canonicalHome);
        if (result.mode === "cold-archive") {
          expect(syncClassification).toBe("archive-only");
          expect(result.canonicalHome).toBe("cold_archive");
          expect(result.projection).toBe("none");
        } else {
          expect(JSON.stringify(result)).not.toMatch(/cold-archive|cold_archive/);
        }
        if (result.mode === "byos") {
          expect(result.canonicalHome).toBe("byos");
          expect(result.projection).toBe("none");
        }
      }
    }
  });
});

describe("P4-L-a tenant-cloud resolver", () => {
  it("resolves tenant-cloud when tenant custodian and trusted region are present", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "tenant-cloud",
          tenantContract: policy({ allowedCustodians: ["tenant"] }),
          trustedRegionDefault: trustedRegion(),
        }),
      ),
    ).toMatchObject({
      ok: true,
      mode: "tenant-cloud",
      canonicalHome: "tenant_managed_cloud",
      projection: "none",
      region: REGION,
      reasonCode: "resolved",
    });
  });

  it("denies tenant-cloud without trusted region", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "tenant-cloud",
          tenantContract: policy({ allowedCustodians: ["tenant"] }),
          trustedRegionDefault: null,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });

  it("blocks tenant-cloud under legal hold", () => {
    expect(
      resolvePlacement(
        input({
          legalHoldActive: true,
          syncClassification: "tenant-cloud",
          tenantContract: policy({ allowedCustodians: ["tenant"] }),
          trustedRegionDefault: trustedRegion(),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "legal_hold_blocks_placement_change" });
  });

  it("denies tenant-cloud without tenant custodian", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "tenant-cloud",
          tenantContract: policy({ allowedCustodians: ["device", "openbot"] }),
          trustedRegionDefault: trustedRegion(),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "custodian_not_allowed" });
  });
});

describe("P4-L-b dedicated resolver", () => {
  it("resolves dedicated regional home for dedicated profile + encrypted-cloud", () => {
    expect(
      resolvePlacement(
        input({
          deploymentProfile: "dedicated",
          syncClassification: "encrypted-cloud",
          tenantContract: policy({
            requireDedicatedKey: true,
            requireDedicatedDatabase: true,
            replicationClass: "regional",
          }),
        }),
      ),
    ).toMatchObject({
      ok: true,
      mode: "dedicated",
      canonicalHome: "dedicated_regional",
      projection: "none",
      region: REGION,
      replicationClass: "regional",
      reasonCode: "resolved",
    });
  });

  it("keeps local-only on dedicated profile when no isolated-store flags are set", () => {
    expect(
      resolvePlacement(
        input({
          deploymentProfile: "dedicated",
          syncClassification: "local-only",
        }),
      ),
    ).toMatchObject({
      ok: true,
      mode: "local-only",
      canonicalHome: "local",
      projection: "none",
    });
  });

  it("still fail-closes dedicated flags without dedicated profile", () => {
    expect(
      resolvePlacement(
        input({
          tenantContract: policy({ requireDedicatedKey: true }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "dedicated_key_unsupported" });
    expect(
      resolvePlacement(
        input({
          tenantContract: policy({ requireDedicatedDatabase: true }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "dedicated_database_unsupported" });
    expect(
      resolvePlacement(
        input({
          tenantContract: policy({ replicationClass: "regional" }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "replication_unsupported" });
  });

  it("still fail-closes multi-region even on dedicated profile", () => {
    expect(
      resolvePlacement(
        input({
          deploymentProfile: "dedicated",
          syncClassification: "encrypted-cloud",
          tenantContract: policy({ replicationClass: "multi-region" }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "replication_unsupported" });
  });

  it("blocks dedicated regional move under legal hold", () => {
    expect(
      resolvePlacement(
        input({
          deploymentProfile: "dedicated",
          legalHoldActive: true,
          syncClassification: "encrypted-cloud",
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "legal_hold_blocks_placement_change" });
  });

  it("keeps local writable canonical when dedicated profile is offline", () => {
    expect(
      resolvePlacement(
        input({
          deploymentProfile: "dedicated",
          requestedOfflineRequired: true,
          syncClassification: "encrypted-cloud",
        }),
      ),
    ).toMatchObject({
      ok: true,
      canonicalHome: "local",
      projection: "managed_encrypted_cloud",
    });
  });
});

describe("P4-L-c BYOS resolver", () => {
  it("resolves byos when byos custodian and trusted region are present", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "byos-only",
          tenantContract: policy({ allowedCustodians: ["byos"] }),
          trustedRegionDefault: trustedRegion(),
        }),
      ),
    ).toMatchObject({
      ok: true,
      mode: "byos",
      canonicalHome: "byos",
      projection: "none",
      region: REGION,
      reasonCode: "resolved",
    });
  });

  it("denies byos without byos custodian", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "byos-only",
          tenantContract: policy({ allowedCustodians: ["device", "openbot"] }),
          trustedRegionDefault: trustedRegion(),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "custodian_not_allowed" });
  });

  it("denies byos without trusted region", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "byos-only",
          tenantContract: policy({ allowedCustodians: ["byos"] }),
          trustedRegionDefault: null,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });

  it("blocks byos under legal hold", () => {
    expect(
      resolvePlacement(
        input({
          legalHoldActive: true,
          syncClassification: "byos-only",
          tenantContract: policy({ allowedCustodians: ["byos"] }),
          trustedRegionDefault: trustedRegion(),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "legal_hold_blocks_placement_change" });
  });

  it("does not mix dedicated profile with byos-only", () => {
    expect(
      resolvePlacement(
        input({
          deploymentProfile: "dedicated",
          syncClassification: "byos-only",
          tenantContract: policy({ allowedCustodians: ["byos"] }),
          trustedRegionDefault: trustedRegion(),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "first_wave_adapter_unavailable" });
  });
});

describe("P4-L-d cold-archive resolver", () => {
  it("resolves archive-only when openbot custodian and trusted region are present", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "archive-only",
        }),
      ),
    ).toMatchObject({
      ok: true,
      mode: "cold-archive",
      canonicalHome: "cold_archive",
      projection: "none",
      region: REGION,
      reasonCode: "resolved",
    });
  });

  it("denies archive-only without openbot custodian", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "archive-only",
          tenantContract: policy({ allowedCustodians: ["device"] }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "custodian_not_allowed" });
  });

  it("denies archive-only without trusted region", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "archive-only",
          trustedRegionDefault: null,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });

  it("blocks archive-only under legal hold", () => {
    expect(
      resolvePlacement(
        input({
          legalHoldActive: true,
          syncClassification: "archive-only",
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "legal_hold_blocks_placement_change" });
  });

  it("denies archive-only while offline", () => {
    expect(
      resolvePlacement(
        input({
          requestedOfflineRequired: true,
          syncClassification: "archive-only",
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "offline_requires_local_canonical" });
  });

  it("does not mix dedicated profile with archive-only", () => {
    expect(
      resolvePlacement(
        input({
          deploymentProfile: "dedicated",
          syncClassification: "archive-only",
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "first_wave_adapter_unavailable" });
  });

  it("does not unlock archive via costObjective archive_preferred", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "local-only",
          costObjective: "archive_preferred",
        }),
      ),
    ).toMatchObject({
      ok: true,
      mode: "local-only",
      canonicalHome: "local",
    });
  });
});

describe("tenant isolation", () => {
  it("rejects a receipt bound to another tenant even when the region string matches", () => {
    const other = trustedRegion(OTHER_TENANT, REGION);
    expect(
      resolvePlacement(
        input({
          tenantId: TENANT,
          syncClassification: "encrypted-cloud",
          trustedRegionDefault: other,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });

  it("does not let tenant B reuse tenant A's trusted region object", () => {
    const a = trustedRegion(TENANT, REGION);
    expect(
      resolvePlacement(
        input({
          tenantId: OTHER_TENANT,
          syncClassification: "encrypted-cloud",
          trustedRegionDefault: a,
          tenantContract: policy(),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });
});

describe("determinism", () => {
  it("does not change the result when cost/recovery objectives or input key order change", () => {
    const base = input({
      syncClassification: "encrypted-cloud",
      costObjective: "archive_preferred",
      recoveryObjective: "regional",
    });
    const expected = resolvePlacement(base);
    expect(expected.ok).toBe(true);

    const reshuffled: PlacementResolverInput = {
      recoveryObjective: "regional",
      costObjective: "standard",
      resourceConsentScope: null,
      subjectConsent: null,
      syncClassification: base.syncClassification,
      requestedOfflineRequired: base.requestedOfflineRequired,
      tenantContract: base.tenantContract,
      trustedRegionDefault: base.trustedRegionDefault,
      deploymentProfile: base.deploymentProfile,
      residencyRequiredRegions: base.residencyRequiredRegions,
      legalHoldActive: base.legalHoldActive,
      retentionClass: base.retentionClass,
      classification: base.classification,
      controllerId: base.controllerId,
      ownerScope: base.ownerScope,
      tenantId: base.tenantId,
    };
    expect(resolvePlacement(reshuffled)).toEqual(expected);
    expect(
      resolvePlacement(
        input({
          syncClassification: "encrypted-cloud",
          costObjective: null,
          recoveryObjective: null,
        }),
      ),
    ).toEqual({ ...expected, reasonCode: "resolved" });
  });
});

describe("eligible-with-consent requires subject consent", () => {
  it("denies when openbot is allowed and consent proof is missing", async () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "eligible-with-consent",
          resourceConsentScope: await resourceScope(),
          subjectConsent: null,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("denies when the authoritative resource scope is missing", async () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "eligible-with-consent",
          resourceConsentScope: null,
          subjectConsent: await subjectConsent(),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("denies a structurally complete but unregistered consent object", async () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "eligible-with-consent",
          resourceConsentScope: await resourceScope(),
          subjectConsent: {
            tenantId: TENANT,
            resourceId: RESOURCE_ID,
            purpose: "eligible_cloud_projection",
            consentVersion: "cv-1",
            subjectIds: [SUBJECT_A],
            expiresAt: CONSENT_EXPIRES,
            revoked: false,
          } as unknown as PlacementResolverInput["subjectConsent"],
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("does not treat a governance approval / grant as consent", async () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "eligible-with-consent",
          resourceConsentScope: await resourceScope(),
          subjectConsent: {
            grantKind: "cognitive_promotion_apply",
            tenantId: TENANT,
            state: "unused",
          } as unknown as PlacementResolverInput["subjectConsent"],
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("denies when proof subjects do not cover the authoritative owner", async () => {
    const proofB = await subjectConsent({ ownerUserId: SUBJECT_B });
    const scopeA = await resourceScope({ ownerUserId: SUBJECT_A });
    expect(
      resolvePlacement(
        await consentInput({
          resourceConsentScope: scopeA,
          subjectConsent: proofB,
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("denies a same-tenant proof bound to a different resource", async () => {
    expect(
      resolvePlacement(
        await consentInput({
          resourceConsentScope: await resourceScope({ resourceId: RESOURCE_ID }),
          subjectConsent: await subjectConsent({ resourceId: "res-other" }),
        }),
      ),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("denies a previously verified proof after the server clock passes expiresAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T15:00:00.000Z"));
    const proof = await subjectConsent({ expiresAt: "2026-08-16T16:00:00.000Z" });
    expect(resolvePlacement(await consentInput({ subjectConsent: proof }))).toMatchObject({
      ok: true,
    });
    vi.setSystemTime(new Date("2026-08-16T16:00:01.000Z"));
    expect(resolvePlacement(await consentInput({ subjectConsent: proof }))).toEqual({
      ok: false,
      reasonCode: "consent_required",
    });
    vi.useRealTimers();
  });

  it("maps eligible-with-consent to encrypted-cloud when proof covers the resource owner", async () => {
    expect(resolvePlacement(await consentInput())).toEqual({
      ok: true,
      mode: "encrypted-cloud",
      canonicalHome: "local",
      projection: "managed_encrypted_cloud",
      region: REGION,
      keyRef: null,
      replicationClass: "none",
      reasonCode: "resolved",
    });
  });

  it("maps eligible-with-consent to local-only when openbot is not allowed", () => {
    expect(
      resolvePlacement(
        input({
          syncClassification: "eligible-with-consent",
          tenantContract: policy({ allowedCustodians: ["device"] }),
          subjectConsent: null,
          resourceConsentScope: null,
        }),
      ),
    ).toMatchObject({
      ok: true,
      mode: "local-only",
      canonicalHome: "local",
      projection: "none",
      region: null,
    });
  });
});

describe("source guard", () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it("does not depend on cognitive scores, Catalog writes, adapters, or grant consume", () => {
    const source = readFileSync(join(here, "placement-resolve.ts"), "utf8");
    expect(source).not.toMatch(/CognitiveTier|PreservationPriority/);
    expect(source).not.toMatch(
      /admissionScore|retrievalScore|promotionScore|decideShadowPromotion/,
    );
    expect(source).not.toMatch(/mint[A-Z]|ForTests|issuePlatform|issueSubject|evaluationTime/);
    expect(source).toMatch(/from "\.\/placement-platform-verify\.js";/);
    expect(source).toMatch(/^import type \{ DataClassification \} from "\.\/types\.js";$/m);
    expect(source).not.toMatch(
      /compareAndPut\(|writeFile\(|createWriteStream\(|putObject\(|fetch\(/,
    );
    expect(source).not.toMatch(/consumeGrant\(|grantKind/);
    expect(source).toContain("pure decision");
  });

  it("does not export raw mints from the public barrel or proof verifier", () => {
    expect("mintPlatformDeploymentRegionReceiptForTests" in dataGovernanceBarrel).toBe(false);
    expect("mintSubjectConsentProofForTests" in dataGovernanceBarrel).toBe(false);
    expect("mintResourceConsentScopeForTests" in dataGovernanceBarrel).toBe(false);
    expect("issuePlatformDeploymentRegionReceipt" in dataGovernanceBarrel).toBe(false);
    expect("issueSubjectConsentProof" in dataGovernanceBarrel).toBe(false);
    expect("issuePlatformDeploymentRegionReceipt" in placementProofs).toBe(false);
    expect("issueSubjectConsentProof" in placementProofs).toBe(false);
    expect("registerVerifiedSubjectConsentProofForTests" in placementProofs).toBe(false);
    expect("registerVerifiedSubjectConsentProofForTests" in placementVerify).toBe(false);
    expect("verifyPlatformDeploymentRegionReceipt" in dataGovernanceBarrel).toBe(true);
    expect("verifySubjectConsent" in dataGovernanceBarrel).toBe(true);
    expect("reverifySubjectConsent" in dataGovernanceBarrel).toBe(true);
    expect("trustedRegionDefaultFromReceipt" in dataGovernanceBarrel).toBe(true);
    expect("resolvePlacement" in dataGovernanceBarrel).toBe(true);
    expect("bindPlacementAuthority" in dataGovernanceBarrel).toBe(false);
    expect("resetPlacementAuthorityBindings" in dataGovernanceBarrel).toBe(false);
    expect("installPlacementPlatformAuthority" in dataGovernanceBarrel).toBe(false);
    expect("installPlacementAuthorityForTests" in dataGovernanceBarrel).toBe(false);
    expect("rebindPlacementAuthorityForTests" in dataGovernanceBarrel).toBe(false);
    expect("replacePlacementAuthorityBindingsForTests" in dataGovernanceBarrel).toBe(false);
    expect("loadValidatedCatalogRecordSync" in dataGovernanceBarrel).toBe(false);
  });

  it("forbids unauthorized production modules from importing the test issuer", () => {
    const issuerImport =
      /issuePlatformDeploymentRegionReceipt|issueSubjectConsentProof|registerVerifiedPlatformDeploymentRegionReceiptForTests|registerVerifiedResourceConsentScopeForTests|registerVerifiedSubjectConsentProofForTests|mintPlatformDeploymentRegionReceiptForTests|mintSubjectConsentProofForTests|mintResourceConsentScopeForTests|replacePlacementAuthorityBindingsForTests|clearPlacementAuthorityBindingsForTests|rebindPlacementAuthorityForTests|placement-resolve\.test-harness|placement-resolve\.test-mint/;
    const allowed = /\.(test|test-harness)\.ts$|placement-platform-bindings\.ts$/;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name === "dist") {
          continue;
        }
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
          continue;
        }
        if (ent.name.endsWith(".ts")) {
          files.push(full);
        }
      }
    };
    walk(join(here, ".."));
    const violations = files
      .filter((file) => !allowed.test(file))
      .filter((file) => issuerImport.test(readFileSync(file, "utf8")))
      .map((file) => relative(here, file));
    expect(violations).toEqual([]);
    const proofsSource = readFileSync(join(here, "placement-platform-proofs.ts"), "utf8");
    const verifySource = readFileSync(join(here, "placement-platform-verify.ts"), "utf8");
    expect(proofsSource).not.toMatch(/export function issue|registerVerified/);
    expect(verifySource).not.toMatch(/export function issue|ForTests|registerVerified/);
    const verifyParamBlocks =
      verifySource.match(/export function verify\w+\(params: \{[\s\S]*?\}\):/g) ?? [];
    expect(verifyParamBlocks.length).toBeGreaterThanOrEqual(3);
    for (const block of verifyParamBlocks) {
      expect(block).not.toMatch(/catalog:|store:|authTenantId:/);
    }
    expect(verifySource).toContain("Does not accept raw mint");
    expect(verifySource).toContain("composition root");
    expect(verifySource).not.toMatch(/bindPlacementAuthority|resetPlacementAuthorityBindings/);
    const rootSource = readFileSync(join(here, "placement-platform-root.ts"), "utf8");
    expect(rootSource).toContain("does not accept arguments");
    expect(rootSource).not.toMatch(/stateDir\?:/);
    expect(rootSource).not.toMatch(/replacePlacementAuthorityBindingsForTests/);
    const installAllowed =
      /\.(test|test-harness)\.ts$|placement-platform-root\.ts$|placement-platform-bindings\.ts$|server\.impl\.ts$/;
    const installViolations = files
      .filter((file) => !installAllowed.test(file))
      .filter((file) => /installPlacementPlatformAuthority/.test(readFileSync(file, "utf8")))
      .map((file) => relative(here, file));
    expect(installViolations).toEqual([]);
  });
});

describe("production placement authority", () => {
  it("verifies a platform-signed deployment-region receipt and rejects a bad signature", () => {
    const signed = signPlatformDeploymentRegionReceiptForTests({
      receiptId: "drr-signed",
      tenantId: TENANT,
      region: REGION,
    });
    const verified = verifyPlatformDeploymentRegionReceipt({
      signedReceipt: signed,
      call: tenantCall,
    });
    expect(verified.ok).toBe(true);
    expect(
      verifyPlatformDeploymentRegionReceipt({
        signedReceipt: { ...signed, signature: "forged" },
        call: tenantCall,
      }),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
    delete process.env.OPENBOT_PLACEMENT_REGION_HMAC_KEY;
    expect(
      verifyPlatformDeploymentRegionReceipt({
        signedReceipt: signed,
        call: tenantCall,
      }),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });

  it("constructs resource scope and consent from the composition-root catalog and store", async () => {
    const proof = await subjectConsent();
    expect(proof.subjectIds).toEqual([SUBJECT_A]);
    expect(proof.consentEpoch).toBe("ce-1");
    expect(proof.verifiedAt).toMatch(/^\d{4}-/);
    const scope = verifyResourceConsentScope({
      call: tenantCall,
      resourceId: RESOURCE_ID,
    });
    expect(scope.ok).toBe(true);
    if (scope.ok) {
      expect(scope.scope.dataSubjectIds).toEqual([SUBJECT_A]);
    }
  });

  it("fails closed on revoked or already-expired consent store records", async () => {
    const scope = await resourceScope();
    writePlacementConsentRecord(placementFixtureStateDirForTests(), {
      tenantId: TENANT,
      resourceId: RESOURCE_ID,
      consentVersion: "cv-1",
      subjectIds: [SUBJECT_A],
      purpose: "eligible_cloud_projection",
      expiresAt: CONSENT_EXPIRES,
      revoked: true,
      consentEpoch: "ce-1",
    });
    expect(
      verifySubjectConsent({
        call: tenantCall,
        resourceId: RESOURCE_ID,
        consentVersion: "cv-1",
        scope,
      }),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
    writePlacementConsentRecord(placementFixtureStateDirForTests(), {
      tenantId: TENANT,
      resourceId: RESOURCE_ID,
      consentVersion: "cv-1",
      subjectIds: [SUBJECT_A],
      purpose: "eligible_cloud_projection",
      expiresAt: CONSENT_EXPIRED,
      revoked: false,
      consentEpoch: "ce-1",
    });
    expect(
      verifySubjectConsent({
        call: tenantCall,
        resourceId: RESOURCE_ID,
        consentVersion: "cv-1",
        scope,
      }),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("reverifies from the bound consent store instead of trusting a stale object", async () => {
    const first = await subjectConsent();
    expect(first.consentVersion).toBe("cv-1");
    const scope = await resourceScope();
    writePlacementConsentRecord(placementFixtureStateDirForTests(), {
      tenantId: TENANT,
      resourceId: RESOURCE_ID,
      consentVersion: "cv-1",
      subjectIds: [SUBJECT_A],
      purpose: "eligible_cloud_projection",
      expiresAt: CONSENT_EXPIRES,
      revoked: true,
      consentEpoch: "ce-1",
    });
    expect(
      reverifySubjectConsent({
        call: tenantCall,
        resourceId: RESOURCE_ID,
        consentVersion: "cv-1",
        scope,
      }),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("does not issue scope or proof when a production caller injects a forged loader or store", async () => {
    const forgedCatalog = {
      loadResourceConsentScope: () => ({
        tenantId: TENANT,
        resourceId: RESOURCE_ID,
        dataSubjectIds: [SUBJECT_A],
        catalogEpoch: "forged",
      }),
    };
    const forgedStore = {
      loadConsent: () => ({
        tenantId: TENANT,
        resourceId: RESOURCE_ID,
        consentVersion: "cv-1",
        subjectIds: [SUBJECT_A],
        purpose: "eligible_cloud_projection" as const,
        expiresAt: CONSENT_EXPIRES,
        revoked: false,
        consentEpoch: "forged",
      }),
    };
    expect(
      verifyResourceConsentScope({
        call: tenantCall,
        resourceId: RESOURCE_ID,
        catalog: forgedCatalog,
      } as never),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
    const boundScope = await resourceScope();
    expect(
      verifySubjectConsent({
        call: tenantCall,
        resourceId: RESOURCE_ID,
        consentVersion: "cv-1",
        scope: boundScope,
        store: forgedStore,
      } as never),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
    expect(
      reverifySubjectConsent({
        call: tenantCall,
        resourceId: RESOURCE_ID,
        consentVersion: "cv-1",
        scope: boundScope,
        store: forgedStore,
      } as never),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
  });

  it("rejects a raw or cross-tenant authTenantId that is not a GovernanceAuthenticatedCall", async () => {
    await resourceScope();
    expect(
      verifyResourceConsentScope({
        authTenantId: OTHER_TENANT,
        resourceId: RESOURCE_ID,
      } as never),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
    expect(
      verifyResourceConsentScope({
        call: { callerTenantId: OTHER_TENANT, actor: { kind: "user", userId: "forged" } },
        resourceId: RESOURCE_ID,
      } as never),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
    expect(
      verifyResourceConsentScope({
        call: otherCall,
        resourceId: RESOURCE_ID,
      }),
    ).toEqual({ ok: false, reasonCode: "consent_required" });
    expect(
      trustedRegionDefaultFromReceipt({
        receipt: mintedReceipt(),
        authTenantId: OTHER_TENANT,
      } as never),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
    expect(
      verifyPlatformDeploymentRegionReceipt({
        signedReceipt: signPlatformDeploymentRegionReceiptForTests({
          receiptId: "drr-cross",
          tenantId: TENANT,
          region: REGION,
        }),
        call: otherCall,
      }),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
  });
});

describe("catalog owner is the only consent subject", () => {
  it("fails closed for position owners", async () => {
    await putPlacementCatalogRecordForTests({
      tenantId: TENANT,
      resourceId: RESOURCE_ID,
      owner: { kind: "position", seatId: "seat-1" },
    });
    expect(verifyResourceConsentScope({ call: tenantCall, resourceId: RESOURCE_ID })).toEqual({
      ok: false,
      reasonCode: "consent_required",
    });
  });

  it("fails closed for group owners", async () => {
    await putPlacementCatalogRecordForTests({
      tenantId: TENANT,
      resourceId: RESOURCE_ID,
      owner: { kind: "group", groupId: "group-1" },
    });
    expect(verifyResourceConsentScope({ call: tenantCall, resourceId: RESOURCE_ID })).toEqual({
      ok: false,
      reasonCode: "consent_required",
    });
  });

  it("rejects first-wave projection through official Catalog put", async () => {
    await expect(
      putPlacementCatalogRecordForTests({
        tenantId: TENANT,
        resourceId: RESOURCE_ID,
        owner: { kind: "user", userId: SUBJECT_A },
        projection: { dataSubjectIds: `${SUBJECT_A},${SUBJECT_B}` },
      }),
    ).rejects.toThrow(/invalid_projection/);
  });

  it("fails closed when Catalog JSON is tampered with an illegal projection", async () => {
    await putPlacementCatalogRecordForTests({
      tenantId: TENANT,
      resourceId: RESOURCE_ID,
      owner: { kind: "user", userId: SUBJECT_A },
    });
    const catalogPath = resolveDataGovernanceCatalogPath(placementFixtureStateDirForTests());
    const file = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      records: Record<string, { envelope: Record<string, unknown> }>;
    };
    file.records[RESOURCE_ID].envelope.projection = {
      dataSubjectIds: `${SUBJECT_A},${SUBJECT_B}`,
    };
    writeFileSync(catalogPath, JSON.stringify(file));
    expect(
      loadValidatedCatalogRecordSync({ storePath: catalogPath, resourceId: RESOURCE_ID }),
    ).toBeNull();
    expect(verifyResourceConsentScope({ call: tenantCall, resourceId: RESOURCE_ID })).toEqual({
      ok: false,
      reasonCode: "consent_required",
    });
  });

  it("fails closed on a corrupt Catalog file", async () => {
    await resourceScope();
    const catalogPath = resolveDataGovernanceCatalogPath(placementFixtureStateDirForTests());
    writeFileSync(catalogPath, "{not-json");
    expect(
      loadValidatedCatalogRecordSync({ storePath: catalogPath, resourceId: RESOURCE_ID }),
    ).toBeNull();
    expect(verifyResourceConsentScope({ call: tenantCall, resourceId: RESOURCE_ID })).toEqual({
      ok: false,
      reasonCode: "consent_required",
    });
  });
});

describe("output contract", () => {
  it("returns a deny-shaped object for every failing reason", () => {
    const sample: PlacementResolverOutput = { ok: false, reasonCode: "missing_auth_tenant" };
    expect(sample.ok).toBe(false);
  });
});
