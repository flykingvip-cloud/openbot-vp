import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGovernanceApprovalGrant } from "./cognitive-approval-grant-store.js";
import { uniqueCreatePreparedPromotionReceipt } from "./cognitive-promotion-store.js";
import {
  computePromotionReplayId,
  computeShadowPromotionDecisionFingerprint,
  getCognitivePromotionReceipt,
  prepareCognitivePromotionApply,
} from "./cognitive-promotion.js";
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
  p4bConsent,
  p4bTrustedRegion,
  resolveP4bAuth,
  seedP4bCatalog,
  seedP4bRecommendation,
  writeP4bGrant,
} from "./cognitive-promotion.test-harness.js";
import {
  getCognitiveRecommendationReceipt,
  persistCognitiveRecommendationReceipt,
} from "./cognitive-recommendation-store.js";
import * as shadowPromotion from "./cognitive-shadow-promotion.js";
import * as dataGovernanceBarrel from "./index.js";
import { resolveCognitiveApprovalGrantRoot, resolveCognitivePromotionRoot } from "./paths.js";
import { writePlacementConsentRecord } from "./placement-consent-store.js";
import { placementFixtureStateDirForTests } from "./placement-resolve.test-harness.js";
import type { CognitivePromotionReceipt } from "./types.js";

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

const previousStateDir = process.env.OPENBOT_STATE_DIR;

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
});

function grantRecord() {
  return readGovernanceApprovalGrant({
    grantId: P4B_GRANT,
    tenantId: P4B_TENANT,
    stateDir: process.env.OPENBOT_STATE_DIR!,
  });
}

function appliesStorePath(): string {
  return join(resolveCognitivePromotionRoot(process.env.OPENBOT_STATE_DIR!), "applies.json");
}

function readApplies(): {
  receipts: Record<string, unknown>;
  consumedGrants: Record<string, string>;
} {
  const storePath = appliesStorePath();
  if (!existsSync(storePath)) {
    return { receipts: {}, consumedGrants: {} };
  }
  const parsed = JSON.parse(readFileSync(storePath, "utf8")) as {
    receipts?: Record<string, unknown>;
    consumedGrants?: Record<string, string>;
  };
  return {
    receipts: parsed.receipts ?? {},
    consumedGrants: parsed.consumedGrants ?? {},
  };
}

function journalPath(): string {
  return `${appliesStorePath()}.prepare-txn`;
}

function recoveryMarkerPath(): string {
  return `${appliesStorePath()}.prepare-txn.recovery`;
}

function readRecoveryMarker(): {
  schemaVersion: number;
  kind: string;
  replayId: string;
  grantId: string;
  reason: string;
  journalPresent: boolean;
  createdAt: string;
} | null {
  if (!existsSync(recoveryMarkerPath())) {
    return null;
  }
  return JSON.parse(readFileSync(recoveryMarkerPath(), "utf8")) as {
    schemaVersion: number;
    kind: string;
    replayId: string;
    grantId: string;
    reason: string;
    journalPresent: boolean;
    createdAt: string;
  };
}

function assertPrepareConsistency(params: {
  replayId: string;
  expectReceipt: boolean;
  expectReceiptState?: "prepared" | "conflicted" | "aborted";
  expectGrantState: "unused" | "consumed" | "revoked" | "expired" | "missing";
  expectConsumedBy: string | null;
  expectJournalPresent?: boolean;
  expectMarker?: boolean;
  expectMarkerReason?: string;
}) {
  const applies = readApplies();
  const receipt = applies.receipts[params.replayId] as
    | { state?: string; checksum?: unknown; decisionReasonCode?: string }
    | undefined;
  expect(Boolean(receipt)).toBe(params.expectReceipt);
  if (params.expectReceipt) {
    expect(receipt?.state).toBe(params.expectReceiptState ?? "prepared");
    expect(receipt?.checksum).toBeUndefined();
  }
  expect(applies.consumedGrants[P4B_GRANT] ?? null).toBe(params.expectConsumedBy);
  expect(existsSync(journalPath())).toBe(Boolean(params.expectJournalPresent));
  if (params.expectMarker) {
    const marker = readRecoveryMarker();
    expect(marker).toMatchObject({
      schemaVersion: 1,
      kind: "cognitive_promotion_prepare_recovery",
      replayId: params.replayId,
      grantId: P4B_GRANT,
      journalPresent: true,
    });
    if (params.expectMarkerReason) {
      expect(marker?.reason).toBe(params.expectMarkerReason);
    }
  } else {
    expect(existsSync(recoveryMarkerPath())).toBe(false);
  }
  const grant = grantRecord();
  if (params.expectGrantState === "missing") {
    expect(grant).toBeNull();
    return;
  }
  if (params.expectGrantState === "revoked") {
    expect(grant?.revokedAt).toBeTruthy();
    expect(grant?.state).not.toBe("consumed");
    expect(grant?.consumedByReplayId).toBeUndefined();
    return;
  }
  if (params.expectGrantState === "expired") {
    expect(grant).toBeTruthy();
    expect(grant?.state).not.toBe("consumed");
    expect(grant?.consumedByReplayId).toBeUndefined();
    return;
  }
  expect(grant?.state ?? "unused").toBe(params.expectGrantState);
  if (params.expectGrantState === "consumed") {
    expect(grant?.consumedByReplayId ?? null).toBe(params.expectConsumedBy);
  } else {
    expect(grant?.consumedByReplayId).toBeUndefined();
  }
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

async function consentPlacement() {
  const call = await authenticateP4bCall();
  const { scope, proof } = await p4bConsent(call);
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
      syncClassification: "eligible-with-consent" as const,
      resourceConsentScope: scope,
      subjectConsent: proof,
    },
  };
}

function crashReceipt(): CognitivePromotionReceipt {
  return {
    kind: "cognitive_promotion_receipt",
    receiptId: "cpr_crash1",
    replayId: "replay-crash-1",
    grantId: P4B_GRANT,
    recommendationId: P4B_RECOMMENDATION,
    resourceId: P4B_RESOURCE,
    tenantId: P4B_TENANT,
    decision: "recommend_admit",
    decisionReasonCode: "shadow_allow",
    placementMode: "local-only",
    canonicalHome: "local",
    fromBindingId: "bind-local-1",
    toCanonicalBindingId: "bind-local-1",
    contentVersion: "cv-1",
    state: "prepared",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  };
}

function crashReceiptOther(): CognitivePromotionReceipt {
  return {
    ...crashReceipt(),
    receiptId: "cpr_crash_other",
    replayId: "replay-crash-other",
  };
}

async function injectJournalCrash(receipt = crashReceipt()) {
  await expect(
    uniqueCreatePreparedPromotionReceipt({
      receipt,
      grantTenantId: P4B_TENANT,
      stateDir: process.env.OPENBOT_STATE_DIR,
      faultAfter: "journal",
    }),
  ).rejects.toThrow("fault_inject:journal");
  expect(readApplies().receipts).toEqual({});
  expect(existsSync(journalPath())).toBe(true);
  expect(grantRecord()?.state).not.toBe("consumed");
  return receipt;
}

function assertUnusedJournalAborted(replayId: string) {
  const recovered = getCognitivePromotionReceipt({ replayId });
  expect(recovered?.state).toBe("aborted");
  expect(recovered?.decisionReasonCode).toBe("grant_unused");
  expect(recovered?.checksum).toBeUndefined();
  expect(readApplies().receipts[replayId]).not.toMatchObject({ state: "prepared" });
  assertPrepareConsistency({
    replayId,
    expectReceipt: true,
    expectReceiptState: "aborted",
    expectGrantState: "unused",
    expectConsumedBy: null,
    expectJournalPresent: true,
    expectMarker: true,
    expectMarkerReason: "grant_unused",
  });
}

function assertConflictedDurable(params: {
  replayId: string;
  reason: string;
  expectGrantState: "unused" | "consumed" | "revoked" | "expired" | "missing";
  expectConsumedBy: string | null;
}) {
  const recovered = getCognitivePromotionReceipt({ replayId: params.replayId });
  expect(recovered?.state).toBe("conflicted");
  expect(recovered?.decisionReasonCode).toBe(params.reason);
  expect(recovered?.checksum).toBeUndefined();
  expect(recovered?.replayId).toBe(params.replayId);
  expect(recovered?.grantId).toBe(P4B_GRANT);
  assertPrepareConsistency({
    replayId: params.replayId,
    expectReceipt: true,
    expectReceiptState: "conflicted",
    expectGrantState: params.expectGrantState,
    expectConsumedBy: params.expectConsumedBy,
    expectJournalPresent: true,
    expectMarker: true,
    expectMarkerReason: params.reason,
  });
}

describe("P4-b prepareCognitivePromotionApply", () => {
  it("creates a prepared receipt and consumes the grant for recommend_admit", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const result = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.replay).toBe(false);
    expect(result.receipt.state).toBe("prepared");
    expect(result.receipt.decision).toBe("recommend_admit");
    expect(result.receipt.kind).toBe("cognitive_promotion_receipt");
    expect(result.receipt.checksum).toBeUndefined();
    expect(grantRecord()?.state).toBe("consumed");
    expect(grantRecord()?.consumedByReplayId).toBe(result.receipt.replayId);
  });

  it("does not create a receipt or consume the grant on recommend_deny", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation({ promotionScore: 0.2 });
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const result = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(result).toMatchObject({ ok: false, error: "decision_denied" });
    expect(grantRecord()?.state).not.toBe("consumed");
    expect(getCognitivePromotionReceipt({ replayId: "missing" })).toBeNull();
  });

  it("does not create a receipt on invalid_score from decideShadowPromotion", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const spy = vi.spyOn(shadowPromotion, "decideShadowPromotion").mockReturnValue({
      ok: false,
      error: "invalid_score",
    });
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const result = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(result).toEqual({ ok: false, error: "invalid_score" });
    expect(grantRecord()?.state).not.toBe("consumed");
    spy.mockRestore();
  });

  it("rejects forged or unbranded auth", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth: {
          callerTenantId: P4B_TENANT,
          actor: { kind: "user", userId: P4B_SUBJECT },
          approvalGrant: { grantKind: "cognitive_promotion_apply" },
        } as never,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
      }),
    ).toEqual({ ok: false, error: "governance_approval_auth_required" });
  });

  it("rejects splicing a same-tenant auth actor onto a different call actor", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    resolveTenantContextMock.mockResolvedValue({
      tenantId: P4B_TENANT,
      userId: "user-p4b-other",
      domain: "enterprise",
    });
    const otherCall = await authenticateP4bCall();
    expect(otherCall.actor).toEqual({ kind: "user", userId: "user-p4b-other" });
    expect(
      await prepareCognitivePromotionApply({
        call: otherCall,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
      }),
    ).toEqual({ ok: false, error: "actor_mismatch" });
    expect(grantRecord()?.state).not.toBe("consumed");
  });

  it("rejects wire tenant, executedBy, requestedBy, and stateDir authority fields", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
        tenantId: "attacker-tenant",
      } as never),
    ).toEqual({ ok: false, error: "wire_authority_rejected" });
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
        executedBy: { kind: "user", userId: "attacker" },
        requestedBy: { kind: "user", userId: "attacker" },
      } as never),
    ).toEqual({ ok: false, error: "wire_authority_rejected" });
  });

  it("rejects the wrong grant kind, scope, and tenant", async () => {
    await seedP4bCatalog();
    writeP4bGrant({ grantKind: "cognitive_merge_apply" });
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const mergeAuth = await resolveGovernanceApprovalAuthForMerge(call);
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth: mergeAuth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
      }),
    ).toEqual({ ok: false, error: "grant_kind_mismatch" });

    writeP4bGrant();
    const auth = await resolveP4bAuth({ call });
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: "ws-other",
        placement,
      }),
    ).toEqual({ ok: false, error: "grant_scope_mismatch" });

    const grantPath = join(
      resolveCognitiveApprovalGrantRoot(process.env.OPENBOT_STATE_DIR!),
      "tenant-a",
      `${P4B_GRANT}.json`,
    );
    const stored = JSON.parse(readFileSync(grantPath, "utf8")) as { tenantId: string };
    stored.tenantId = "other-tenant";
    writeFileSync(grantPath, JSON.stringify(stored));
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
      }),
    ).toEqual({ ok: false, error: "grant_tenant_mismatch" });
    expect(grantRecord()?.state).not.toBe("consumed");
  });

  it("rejects agent-asset-wide or engine-issued promotion grants", () => {
    expect(() => writeP4bGrant({ scopeKind: "agentAsset" })).toThrow(
      "invalid_approval_grant_record",
    );
    expect(() => writeP4bGrant({ issuedBy: "engine" as unknown as "enterprise_ops" })).toThrow(
      "invalid_approval_grant_record",
    );
  });

  it("rejects an expired or revoked grant for a new apply", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    writeP4bGrant({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
      }),
    ).toEqual({ ok: false, error: "grant_expired" });
    writeP4bGrant({ revokedAt: "2026-08-16T00:00:00.000Z" });
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
      }),
    ).toEqual({ ok: false, error: "grant_revoked" });
    expect(grantRecord()?.state).not.toBe("consumed");
  });

  it("does not let Envelope tenant override auth tenant", async () => {
    await seedP4bCatalog({ tenantId: "other-tenant" });
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
      }),
    ).toEqual({ ok: false, error: "envelope_tenant_mismatch" });
    expect(grantRecord()?.state).not.toBe("consumed");
  });

  it("does not consume the grant when placement denies", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await cloudPlacement();
    const auth = await resolveP4bAuth({ call });
    const result = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement: { ...placement, trustedRegionDefault: null },
    });
    expect(result).toMatchObject({ ok: false, error: "placement_denied" });
    expect(grantRecord()?.state).not.toBe("consumed");
  });

  it("fail-closes cloud placement without a key-service keyRef", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await cloudPlacement();
    const auth = await resolveP4bAuth({ call });
    const result = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(result).toEqual({ ok: false, error: "key_ref_required" });
    expect(grantRecord()?.state).not.toBe("consumed");
  });

  it("rejects when consent is revoked after resolve and before prepare", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await consentPlacement();
    const auth = await resolveP4bAuth({ call });
    writePlacementConsentRecord(placementFixtureStateDirForTests(), {
      tenantId: P4B_TENANT,
      resourceId: P4B_RESOURCE,
      consentVersion: "cv-1",
      subjectIds: [P4B_SUBJECT],
      purpose: "eligible_cloud_projection",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      revoked: true,
      consentEpoch: "ce-1",
    });
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
      }),
    ).toEqual({ ok: false, error: "consent_required" });
    expect(grantRecord()?.state).not.toBe("consumed");
  });

  it("returns the same receipt on replay without consuming the grant again", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const first = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    const second = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.replay).toBe(true);
    expect(second.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(second.receipt.replayId).toBe(first.receipt.replayId);
  });

  it("returns the existing receipt for a consumed grant on the same replay", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const first = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(grantRecord()?.state).toBe("consumed");
    const second = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.receipt.receiptId).toBe(first.receipt.receiptId);
  });

  it("rejects a consumed grant when starting a new apply with no receipt", async () => {
    await seedP4bCatalog();
    writeP4bGrant({ state: "consumed", consumedAt: "2026-08-16T00:00:00.000Z" });
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    expect(
      await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement,
      }),
    ).toEqual({ ok: false, error: "grant_consumed" });
    expect(getCognitivePromotionReceipt({ replayId: "missing" })).toBeNull();
  });

  it("rejects a consumed grant used with a different replay", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    await seedP4bRecommendation({ recommendationId: "rec-p4b-2" });
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const first = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(first.ok).toBe(true);
    const second = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: "rec-p4b-2",
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(second).toEqual({ ok: false, error: "grant_consumed" });
    if (!first.ok) {
      return;
    }
    expect(getCognitivePromotionReceipt({ replayId: first.receipt.replayId })?.receiptId).toBe(
      first.receipt.receiptId,
    );
  });

  it("re-reads the existing receipt when unique-create loses the CAS", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const first = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const loser = await uniqueCreatePreparedPromotionReceipt({
      receipt: { ...first.receipt, receiptId: "cpr_forged" },
      grantTenantId: P4B_TENANT,
      stateDir: process.env.OPENBOT_STATE_DIR,
    });
    expect(loser).toEqual({ ok: true, receipt: first.receipt, created: false });
  });

  it("denies when the grant is consumed and the receipt is missing", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const first = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const storePath = join(
      resolveCognitivePromotionRoot(process.env.OPENBOT_STATE_DIR!),
      "applies.json",
    );
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(
      storePath,
      JSON.stringify({
        schemaVersion: 1,
        revision: 99,
        receipts: {},
        consumedGrants: { [P4B_GRANT]: first.receipt.replayId },
      }),
    );
    const crashed = await uniqueCreatePreparedPromotionReceipt({
      receipt: first.receipt,
      grantTenantId: P4B_TENANT,
      stateDir: process.env.OPENBOT_STATE_DIR,
    });
    expect(crashed).toEqual({ ok: false, conflict: "grant_consumed_without_receipt" });
  });

  it("recovers a grant-consumed crash by completing the prepared receipt", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = crashReceipt();
    await expect(
      uniqueCreatePreparedPromotionReceipt({
        receipt,
        grantTenantId: P4B_TENANT,
        stateDir: process.env.OPENBOT_STATE_DIR,
        faultAfter: "grant_consumed",
      }),
    ).rejects.toThrow("fault_inject:grant_consumed");
    expect(readApplies().receipts).toEqual({});
    expect(existsSync(journalPath())).toBe(true);
    expect(grantRecord()?.state).toBe("consumed");
    expect(grantRecord()?.consumedByReplayId).toBe(receipt.replayId);
    const recovered = getCognitivePromotionReceipt({ replayId: receipt.replayId });
    expect(recovered).toEqual(receipt);
    const again = getCognitivePromotionReceipt({ replayId: receipt.replayId });
    expect(again).toEqual(receipt);
    assertPrepareConsistency({
      replayId: receipt.replayId,
      expectReceipt: true,
      expectReceiptState: "prepared",
      expectGrantState: "consumed",
      expectConsumedBy: receipt.replayId,
    });
  });

  it("aborts a journal-before-consume crash without consuming an unused grant", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    assertUnusedJournalAborted(receipt.replayId);
    const again = getCognitivePromotionReceipt({ replayId: receipt.replayId });
    expect(again?.state).toBe("aborted");
    expect(grantRecord()?.state).not.toBe("consumed");
  });

  it("returns recovery_required instead of consuming an unused leftover journal", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    const again = await uniqueCreatePreparedPromotionReceipt({
      receipt,
      grantTenantId: P4B_TENANT,
      stateDir: process.env.OPENBOT_STATE_DIR,
    });
    expect(again).toEqual({ ok: false, conflict: "recovery_required" });
    assertUnusedJournalAborted(receipt.replayId);
  });

  it("does not consume after journal crash when subject consent is revoked", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    writePlacementConsentRecord(placementFixtureStateDirForTests(), {
      tenantId: P4B_TENANT,
      resourceId: P4B_RESOURCE,
      consentVersion: "cv-1",
      subjectIds: [P4B_SUBJECT],
      purpose: "eligible_cloud_projection",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      revoked: true,
      consentEpoch: "ce-1",
    });
    assertUnusedJournalAborted(receipt.replayId);
  });

  it("does not consume after journal crash when the recommendation is closed", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const receipt = await injectJournalCrash();
    const open = getCognitiveRecommendationReceipt({
      recommendationId: P4B_RECOMMENDATION,
      tenantId: P4B_TENANT,
      owner: { kind: "user", userId: P4B_SUBJECT },
      stateDir: process.env.OPENBOT_STATE_DIR,
    });
    expect(open?.status).toBe("open");
    await persistCognitiveRecommendationReceipt({
      receipt: { ...open!, status: "superseded" },
      stateDir: process.env.OPENBOT_STATE_DIR,
    });
    assertUnusedJournalAborted(receipt.replayId);
  });

  it("does not consume after journal crash when catalog lifecycle, hold, or classification change", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    await seedP4bCatalog({
      classification: "restricted",
      lifecycleState: "archived",
      legalHold: {
        holdId: "hold-p4b-1",
        reason: "legal_hold",
        appliedBy: { kind: "user", userId: P4B_SUBJECT },
        appliedAt: "2026-08-16T12:00:00.000Z",
      },
    });
    assertUnusedJournalAborted(receipt.replayId);
  });

  it("does not consume after journal crash when placement policy would now deny", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    await seedP4bCatalog({ classification: "confidential" });
    assertUnusedJournalAborted(receipt.replayId);
  });

  it("keeps the journal and writes conflicted evidence when recovery finds the grant revoked", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    writeP4bGrant({ revokedAt: "2026-08-16T00:00:00.000Z" });
    assertConflictedDurable({
      replayId: receipt.replayId,
      reason: "grant_revoked",
      expectGrantState: "revoked",
      expectConsumedBy: null,
    });
  });

  it("keeps the journal and writes conflicted evidence when recovery finds the grant expired", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    writeP4bGrant({ expiresAt: "2026-08-16T00:00:00.000Z" });
    assertConflictedDurable({
      replayId: receipt.replayId,
      reason: "grant_expired",
      expectGrantState: "expired",
      expectConsumedBy: null,
    });
  });

  it("keeps the journal and writes conflicted evidence when recovery finds the grant missing", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    unlinkSync(
      join(
        resolveCognitiveApprovalGrantRoot(process.env.OPENBOT_STATE_DIR!),
        P4B_TENANT,
        `${P4B_GRANT}.json`,
      ),
    );
    assertConflictedDurable({
      replayId: receipt.replayId,
      reason: "grant_not_found",
      expectGrantState: "missing",
      expectConsumedBy: null,
    });
  });

  it("keeps the journal when another replay already consumed the grant", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    writeP4bGrant({
      state: "consumed",
      consumedAt: "2026-08-16T00:00:00.000Z",
      consumedByReplayId: "replay-other",
    });
    writeFileSync(
      appliesStorePath(),
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        receipts: {},
        consumedGrants: { [P4B_GRANT]: "replay-other" },
      }),
    );
    expect(existsSync(journalPath())).toBe(true);
    assertConflictedDurable({
      replayId: receipt.replayId,
      reason: "grant_consumed_by_other_replay",
      expectGrantState: "consumed",
      expectConsumedBy: "replay-other",
    });
    expect(readApplies().receipts["replay-other"]).toBeUndefined();
  });

  it("fail-closes when a consumed grant has no replay identity", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    writeP4bGrant({ state: "consumed", consumedAt: "2026-08-16T00:00:00.000Z" });
    assertConflictedDurable({
      replayId: receipt.replayId,
      reason: "grant_consumed_identity_unproven",
      expectGrantState: "consumed",
      expectConsumedBy: null,
    });
  });

  it("does not treat conflicted recovery as a successful prepare replay", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const first = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const applies = readApplies();
    const conflicted: Record<string, unknown> = {
      ...(applies.receipts[first.receipt.replayId] as Record<string, unknown>),
      state: "conflicted",
      decisionReasonCode: "grant_revoked",
    };
    delete conflicted.checksum;
    writeFileSync(
      appliesStorePath(),
      JSON.stringify({
        schemaVersion: 1,
        revision: 2,
        receipts: { [first.receipt.replayId]: conflicted },
        consumedGrants: applies.consumedGrants,
      }),
    );
    const replayed = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(replayed).toEqual({
      ok: false,
      error: "recovery_required",
      reasonCode: "grant_revoked",
    });
    expect(getCognitivePromotionReceipt({ replayId: first.receipt.replayId })?.state).toBe(
      "conflicted",
    );
  });

  it("returns recovery_required instead of replaying a conflicted unique-create", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    writeP4bGrant({ revokedAt: "2026-08-16T00:00:00.000Z" });
    expect(getCognitivePromotionReceipt({ replayId: receipt.replayId })?.state).toBe("conflicted");
    const again = await uniqueCreatePreparedPromotionReceipt({
      receipt,
      grantTenantId: P4B_TENANT,
      stateDir: process.env.OPENBOT_STATE_DIR,
    });
    expect(again).toEqual({ ok: false, conflict: "recovery_required" });
    assertPrepareConsistency({
      replayId: receipt.replayId,
      expectReceipt: true,
      expectReceiptState: "conflicted",
      expectGrantState: "revoked",
      expectConsumedBy: null,
      expectJournalPresent: true,
      expectMarker: true,
      expectMarkerReason: "grant_revoked",
    });
  });

  it("does not let a different replay steal a leftover journal", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    const stolen = await uniqueCreatePreparedPromotionReceipt({
      receipt: crashReceiptOther(),
      grantTenantId: P4B_TENANT,
      stateDir: process.env.OPENBOT_STATE_DIR,
    });
    expect(stolen.ok).toBe(false);
    if (stolen.ok) {
      return;
    }
    expect(stolen).toEqual({ ok: false, conflict: "recovery_required" });
    expect(getCognitivePromotionReceipt({ replayId: receipt.replayId })?.state).toBe("aborted");
    expect(getCognitivePromotionReceipt({ replayId: crashReceiptOther().replayId })).toBeNull();
    assertPrepareConsistency({
      replayId: receipt.replayId,
      expectReceipt: true,
      expectReceiptState: "aborted",
      expectGrantState: "unused",
      expectConsumedBy: null,
      expectJournalPresent: true,
      expectMarker: true,
      expectMarkerReason: "grant_unused",
    });
  });

  it("does not overwrite a conflicted journal with a different replay", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = await injectJournalCrash();
    writeP4bGrant({ revokedAt: "2026-08-16T00:00:00.000Z" });
    expect(getCognitivePromotionReceipt({ replayId: receipt.replayId })?.state).toBe("conflicted");
    const journalBefore = readFileSync(journalPath(), "utf8");
    const stolen = await uniqueCreatePreparedPromotionReceipt({
      receipt: crashReceiptOther(),
      grantTenantId: P4B_TENANT,
      stateDir: process.env.OPENBOT_STATE_DIR,
    });
    expect(stolen).toEqual({ ok: false, conflict: "recovery_required" });
    expect(readFileSync(journalPath(), "utf8")).toBe(journalBefore);
    expect(getCognitivePromotionReceipt({ replayId: crashReceiptOther().replayId })).toBeNull();
    assertPrepareConsistency({
      replayId: receipt.replayId,
      expectReceipt: true,
      expectReceiptState: "conflicted",
      expectGrantState: "revoked",
      expectConsumedBy: null,
      expectJournalPresent: true,
      expectMarker: true,
      expectMarkerReason: "grant_revoked",
    });
  });

  it("does not consume a grant that a concurrent writer revoked before CAS", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    const receipt = crashReceipt();
    const result = await uniqueCreatePreparedPromotionReceipt({
      receipt,
      grantTenantId: P4B_TENANT,
      stateDir: process.env.OPENBOT_STATE_DIR,
      onBeforeGrantLock: () => writeP4bGrant({ revokedAt: "2026-08-16T00:00:00.000Z" }),
    });
    expect(result).toEqual({ ok: false, conflict: "grant_revoked" });
    expect(getCognitivePromotionReceipt({ replayId: receipt.replayId })).toBeNull();
    expect(grantRecord()?.state).not.toBe("consumed");
    expect(grantRecord()?.revokedAt).toBe("2026-08-16T00:00:00.000Z");
  });

  it("lets only one of two concurrent identical replays create the receipt", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const input = {
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    };
    const [a, b] = await Promise.all([
      prepareCognitivePromotionApply(input),
      prepareCognitivePromotionApply(input),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.receipt.receiptId).toBe(b.receipt.receiptId);
    expect(a.receipt.replayId).toBe(b.receipt.replayId);
    expect([a.replay, b.replay].filter((replay) => !replay)).toHaveLength(1);
  });

  it("re-reads the durable receipt after a simulated restart", async () => {
    await seedP4bCatalog();
    writeP4bGrant();
    await seedP4bRecommendation();
    const { call, placement } = await localPlacement();
    const auth = await resolveP4bAuth({ call });
    const first = await prepareCognitivePromotionApply({
      call,
      auth,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      placement,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const reloaded = getCognitivePromotionReceipt({ replayId: first.receipt.replayId });
    expect(reloaded).toEqual(first.receipt);
  });

  it("keeps decision fingerprints stable and changes replayId when an input changes", () => {
    const input = {
      admissionScore: 0.9,
      retrievalScore: 0.7,
      promotionScore: 0.9,
      classification: "internal" as const,
      lifecycleState: "active" as const,
    };
    const output = {
      ok: true as const,
      decision: "recommend_admit" as const,
      reasonCode: "shadow_allow",
    };
    const first = computeShadowPromotionDecisionFingerprint({ input, output });
    const second = computeShadowPromotionDecisionFingerprint({ input, output });
    expect(first).toBe(second);
    const changed = computeShadowPromotionDecisionFingerprint({
      input: { ...input, retrievalScore: 0.71 },
      output,
    });
    expect(changed).not.toBe(first);
    const replayA = computePromotionReplayId({
      grantId: P4B_GRANT,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      decisionFingerprint: first,
    });
    const replayB = computePromotionReplayId({
      grantId: P4B_GRANT,
      recommendationId: P4B_RECOMMENDATION,
      resourceId: P4B_RESOURCE,
      decisionFingerprint: changed,
    });
    expect(replayA).not.toBe(replayB);
  });

  it("fails closed for position and group catalog owners that need consent", async () => {
    for (const owner of [
      { kind: "position" as const, seatId: "seat-1" },
      { kind: "group" as const, groupId: "group-1" },
    ]) {
      beginP4bFixture();
      resolveTenantContextMock.mockResolvedValue({
        tenantId: P4B_TENANT,
        userId: P4B_SUBJECT,
        domain: "enterprise",
      });
      await seedP4bCatalog({ owner });
      writeP4bGrant();
      await seedP4bRecommendation({ owner });
      const { call, placement } = await cloudPlacement();
      const auth = await resolveP4bAuth({ call });
      const result = await prepareCognitivePromotionApply({
        call,
        auth,
        recommendationId: P4B_RECOMMENDATION,
        resourceId: P4B_RESOURCE,
        placement: {
          ...placement,
          syncClassification: "eligible-with-consent",
          resourceConsentScope: null,
          subjectConsent: null,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["placement_denied", "consent_required", "key_ref_required"]).toContain(
          result.error,
        );
      }
      expect(grantRecord()?.state).not.toBe("consumed");
    }
  });
});

describe("P4-b source guards", () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it("does not implement P4-c adapters or P4-d export/restore", () => {
    const source = readFileSync(join(here, "cognitive-promotion.ts"), "utf8");
    expect(source).toMatch(/decideShadowPromotion/);
    expect(source).toMatch(/resolvePlacement/);
    expect(source).toMatch(/reverifySubjectConsent/);
    expect(source).not.toMatch(/object-store|encryptBytes|uploadProjection|tombstoneVersion/);
    expect(source).not.toMatch(/dedicated region/);
    expect(source).not.toMatch(
      /encryptManagedCloudObject|encryptTenantManagedCloudObject|writeManagedEncryptedCloudObject|writeTenantManagedCloudObject|encryptColdArchiveObject|writeColdArchiveObject|unlinkColdArchiveObject/,
    );
    expect(source).not.toMatch(/replacePlacementAuthorityBindingsForTests/);
    expect(source).toContain("Does not write storage adapters");
    expect(source).not.toMatch(/canonicalChecksum/);
    expect(source).toMatch(/sameActorRef|actor_mismatch/);
    expect(source).toMatch(/key_ref_required/);
    expect("uniqueCreatePreparedPromotionReceipt" in dataGovernanceBarrel).toBe(false);
    expect("prepareCognitivePromotionApply" in dataGovernanceBarrel).toBe(true);
  });

  it("keeps test issuers out of production modules", () => {
    const issuerImport =
      /cognitive-promotion\.test-harness|replacePlacementAuthorityBindingsForTests/;
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
    walk(here);
    const violations = files
      .filter((file) => !allowed.test(file))
      .filter((file) => issuerImport.test(readFileSync(file, "utf8")))
      .map((file) => relative(here, file));
    expect(violations).toEqual([]);
  });
});

async function resolveGovernanceApprovalAuthForMerge(
  call: Awaited<ReturnType<typeof authenticateP4bCall>>,
) {
  const { resolveGovernanceApprovalAuth } = await import("./cognitive-approval-auth.js");
  const resolved = await resolveGovernanceApprovalAuth({
    call,
    owner: { kind: "user", userId: P4B_SUBJECT },
    grantId: P4B_GRANT,
    requiredKind: "cognitive_merge_apply",
    requiredScope: { kind: "resource", resourceId: P4B_RESOURCE },
    stateDir: process.env.OPENBOT_STATE_DIR,
  });
  if (!resolved.ok) {
    throw new Error(`expected merge auth: ${resolved.reason}`);
  }
  return resolved.auth;
}
