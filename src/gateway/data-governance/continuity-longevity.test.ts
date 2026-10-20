import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAgentAssetManifestPointer } from "./agent-asset-manifest-store.js";
import {
  authenticateGovernanceCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import * as continuityLongevityStore from "./continuity-longevity-store.js";
import {
  checkpointChecksum,
  refuseAnchorAutoActivationFromReview,
  refuseContinuityDomainMerge,
  refuseContinuityMtimeAsTruth,
  refusePlacementFromContinuityReview,
  runContinuityRestoreDrill,
  runHumanAnchorReview,
  validateContinuityCheckpoint,
} from "./continuity-longevity.js";
import * as dataGovernanceBarrel from "./index.js";
import {
  resolveTenantKeyManagementAuth,
  writeTenantKeyManagementPolicyAtDeployBoundary,
  type TenantKeyManagementAuth,
} from "./key-rotation-auth.js";
import {
  resolveAgentAssetManifestPointerRoot,
  resolveContinuityLongevityRoot,
  resolveContinuityRestorePointerPath,
} from "./paths.js";
import type {
  AgentAssetContinuityManifest,
  ContinuityCheckpointPackage,
  HumanVerifiedAnchor,
} from "./types.js";

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

const TENANT = "tenant-p5e";
const OTHER_TENANT = "tenant-p5e-other";
const MEMBER = "user-p5e";
const AGENT_ASSET = "agent-p5e-1";
const CHECKPOINT_EPOCH = "2026-08-18T08:00:00.000Z";
const RESTORE_NOW = "2026-08-18T09:00:00.000Z";
const REVIEW_NOW = "2026-08-18T10:00:00.000Z";
const here = path.dirname(fileURLToPath(import.meta.url));

let stateDir = "";
let call: GovernanceAuthenticatedCall;
let otherCall: GovernanceAuthenticatedCall;
let auth: TenantKeyManagementAuth;
let otherAuth: TenantKeyManagementAuth;

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "p5e-continuity-"));
}

async function authCall(tenantId: string, userId: string): Promise<GovernanceAuthenticatedCall> {
  resolveTenantContextMock.mockResolvedValue({
    tenantId,
    userId,
    domain: "enterprise",
  });
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: `${userId}@${tenantId}.test`,
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    throw new Error("expected GovernanceAuthenticatedCall");
  }
  return authenticated.call;
}

function seedPolicy(tenantId: string, userId: string): void {
  writeTenantKeyManagementPolicyAtDeployBoundary({
    stateDir,
    record: {
      schemaVersion: 1,
      tenantId,
      operators: [{ userId, role: "tenant-admin" }],
    },
  });
}

function sampleManifest(policyBaselineRef = "policy-v1"): AgentAssetContinuityManifest {
  return {
    manifestId: "manifest-p5e-1",
    kind: "agent_asset_continuity_manifest",
    agentAssetId: AGENT_ASSET,
    ownerScope: "user_owned",
    identityVersionRef: "identity-v1",
    capabilitySetVersionRef: "cap-v1",
    policyBaselineRef,
    operationalIdentityBindingRefs: ["oi-bind-1"],
    contentKey: "ck-p5e-1",
    reasonCode: "restore_drill",
    effectiveAt: CHECKPOINT_EPOCH,
    createdAt: CHECKPOINT_EPOCH,
  };
}

function buildCheckpoint(
  overrides: Partial<ContinuityCheckpointPackage> = {},
): ContinuityCheckpointPackage {
  const effectiveManifest = overrides.effectiveManifest ?? sampleManifest();
  const base = {
    kind: "p5_continuity_checkpoint" as const,
    tenantId: TENANT,
    agentAssetId: AGENT_ASSET,
    checkpointEpoch: CHECKPOINT_EPOCH,
    effectiveManifest,
    anchorHistory: [] as readonly HumanVerifiedAnchor[],
    anchorPointers: [] as ContinuityCheckpointPackage["anchorPointers"],
    ...overrides,
  };
  return {
    ...base,
    checksum: checkpointChecksum(base),
  };
}

beforeEach(async () => {
  stateDir = tmpStateDir();
  seedPolicy(TENANT, MEMBER);
  seedPolicy(OTHER_TENANT, MEMBER);
  call = await authCall(TENANT, MEMBER);
  otherCall = await authCall(OTHER_TENANT, MEMBER);
  const resolved = resolveTenantKeyManagementAuth({ call, stateDir });
  const otherResolved = resolveTenantKeyManagementAuth({ call: otherCall, stateDir });
  if (!resolved.ok || !otherResolved.ok) {
    throw new Error("expected auth");
  }
  auth = resolved.auth;
  otherAuth = otherResolved.auth;
  continuityLongevityStore.writeTenantPolicyBaselineAtDeployBoundary({
    stateDir,
    record: {
      schemaVersion: 1,
      tenantId: TENANT,
      currentBaselineRef: "policy-v2-current",
      updatedAt: REVIEW_NOW,
    },
  });
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("P5-e continuity restore + human-anchor review", () => {
  function checkpointBody(
    overrides: Partial<Omit<ContinuityCheckpointPackage, "checksum">> = {},
  ): Omit<ContinuityCheckpointPackage, "checksum"> {
    return {
      kind: "p5_continuity_checkpoint",
      tenantId: TENANT,
      agentAssetId: AGENT_ASSET,
      checkpointEpoch: CHECKPOINT_EPOCH,
      effectiveManifest: sampleManifest(),
      anchorHistory: [],
      anchorPointers: [],
      ...overrides,
    };
  }

  function signedCheckpoint(
    overrides: Partial<Omit<ContinuityCheckpointPackage, "checksum">> = {},
  ): ContinuityCheckpointPackage {
    const body = checkpointBody(overrides);
    return { ...body, checksum: checkpointChecksum(body) };
  }

  it("rejects embedded domain payloads in checkpoint packages", () => {
    const bad = {
      ...buildCheckpoint(),
      personaBody: { secret: "x" },
    };
    expect(validateContinuityCheckpoint(bad)).toEqual({
      ok: false,
      error: "embedded_payload_forbidden",
    });
    const tampered = buildCheckpoint();
    tampered.checksum = createHash("sha256").update("bad", "utf8").digest("hex");
    expect(validateContinuityCheckpoint(tampered)).toEqual({
      ok: false,
      error: "checksum_mismatch",
    });
  });

  it("rejects nested forbidden payloads, unknown top-level fields, and strict schema violations", async () => {
    const nestedAnchorPayload = signedCheckpoint({
      anchorHistory: [
        {
          anchorId: "anchor-nested-payload",
          kind: "human_verified_anchor",
          resourceId: "res-anchor-nested",
          anchorType: "identity",
          version: 1,
          rowKind: "proposal",
          evidenceRefs: ["evidence-1"],
          effectiveAt: CHECKPOINT_EPOCH,
          createdAt: CHECKPOINT_EPOCH,
          payload: { secret: "nested" },
        } as unknown as HumanVerifiedAnchor,
      ],
    });
    expect(validateContinuityCheckpoint(nestedAnchorPayload)).toEqual({
      ok: false,
      error: "embedded_payload_forbidden",
    });

    const nestedPointerSecret = signedCheckpoint({
      anchorPointers: [
        {
          kind: "anchor_active_pointer",
          resourceId: "res-pointer-nested",
          pointerState: "active",
          activeAnchorId: "anchor-nested-payload",
          anchorVersion: 1,
          pointerVersion: 1,
          lastMutationId: "mut-1",
          updatedAt: CHECKPOINT_EPOCH,
          secret: "nested-secret",
        } as unknown as ContinuityCheckpointPackage["anchorPointers"][number],
      ],
    });
    expect(validateContinuityCheckpoint(nestedPointerSecret)).toEqual({
      ok: false,
      error: "embedded_payload_forbidden",
    });

    const manifestCapabilityBody = signedCheckpoint({
      effectiveManifest: {
        ...sampleManifest(),
        capabilityBody: { capability: "smuggled" },
      } as unknown as AgentAssetContinuityManifest,
    });
    expect(validateContinuityCheckpoint(manifestCapabilityBody)).toEqual({
      ok: false,
      error: "embedded_payload_forbidden",
    });

    const unknownTopLevel = {
      ...signedCheckpoint(),
      smuggledExtension: { body: "x" },
    };
    expect(validateContinuityCheckpoint(unknownTopLevel)).toEqual({
      ok: false,
      error: "checkpoint_invalid",
    });

    const nestedOiToken = signedCheckpoint({
      anchorPointers: [
        {
          kind: "anchor_active_pointer",
          resourceId: "res-pointer-oi",
          pointerState: "active",
          activeAnchorId: "anchor-oi",
          anchorVersion: 1,
          pointerVersion: 1,
          lastMutationId: "mut-oi",
          updatedAt: CHECKPOINT_EPOCH,
          operationalIdentity: { token: "nested-token" },
        } as unknown as ContinuityCheckpointPackage["anchorPointers"][number],
      ],
    });
    expect(validateContinuityCheckpoint(nestedOiToken)).toEqual({
      ok: false,
      error: "embedded_payload_forbidden",
    });

    for (const checkpoint of [
      nestedAnchorPayload,
      nestedPointerSecret,
      manifestCapabilityBody,
      unknownTopLevel,
      nestedOiToken,
    ]) {
      const result = await runContinuityRestoreDrill({
        auth,
        stateDir,
        checkpoint,
        now: RESTORE_NOW,
      });
      expect(result.ok).toBe(false);
      expect(
        continuityLongevityStore.readContinuityRestorePointer({
          stateDir,
          tenantId: TENANT,
          agentAssetId: AGENT_ASSET,
        }),
      ).toBeNull();
      const longevityState = continuityLongevityStore.readContinuityLongevityState({
        stateDir,
        tenantId: TENANT,
      });
      expect(Object.keys(longevityState?.restoreReceipts ?? {})).toHaveLength(0);
      expect(
        fs.existsSync(resolveContinuityRestorePointerPath(stateDir, TENANT, AGENT_ASSET)),
      ).toBe(false);
    }
  });

  it("restores continuity checkpoint into isolated namespace without touching production", async () => {
    const checkpoint = buildCheckpoint();
    const restored = await runContinuityRestoreDrill({
      auth,
      stateDir,
      checkpoint,
      now: RESTORE_NOW,
    });
    expect(restored.ok && restored.value.state).toBe("applied");
    expect(restored.ok && restored.value.restoredManifestId).toBe("manifest-p5e-1");
    const isolatedPointer = continuityLongevityStore.readContinuityRestorePointer({
      stateDir,
      tenantId: TENANT,
      agentAssetId: AGENT_ASSET,
    });
    expect(isolatedPointer?.activeManifestId).toBe("manifest-p5e-1");
    const productionPointer = readAgentAssetManifestPointer({
      stateDir,
      agentAssetId: AGENT_ASSET,
    });
    expect(productionPointer).toBeNull();
    const isolatedRoot = resolveContinuityLongevityRoot(stateDir);
    const productionRoot = resolveAgentAssetManifestPointerRoot(stateDir);
    expect(isolatedRoot).not.toBe(productionRoot);
    expect(
      resolveContinuityRestorePointerPath(stateDir, TENANT, AGENT_ASSET).startsWith(productionRoot),
    ).toBe(false);
  });

  it("is idempotent on replay and refuses tenant mismatch", async () => {
    const checkpoint = buildCheckpoint();
    const first = await runContinuityRestoreDrill({
      auth,
      stateDir,
      checkpoint,
      now: RESTORE_NOW,
    });
    const second = await runContinuityRestoreDrill({
      auth,
      stateDir,
      checkpoint,
      now: RESTORE_NOW,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("expected restore drills to succeed");
    }
    expect(first.value.receiptId).toBe(second.value.receiptId);
    expect(
      await runContinuityRestoreDrill({
        auth: otherAuth,
        stateDir,
        checkpoint,
        now: RESTORE_NOW,
      }),
    ).toEqual({ ok: false, error: "tenant_mismatch" });
  });

  it("runs human-anchor review for due anchors and stale policy baselines", async () => {
    const checkpoint = buildCheckpoint({ effectiveManifest: sampleManifest("policy-v1-stale") });
    await runContinuityRestoreDrill({
      auth,
      stateDir,
      checkpoint,
      now: RESTORE_NOW,
    });
    const review = await runHumanAnchorReview({
      auth,
      stateDir,
      now: REVIEW_NOW,
      reviewCadenceDays: 90,
      agentAssetIds: [AGENT_ASSET],
      anchorReviewCandidates: [
        {
          resourceId: "res-anchor-1",
          anchorType: "identity",
          lastReviewedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          resourceId: "res-anchor-2",
          anchorType: "principle",
          lastReviewedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    expect(review.ok && review.value.anchorReviewDue).toEqual([
      {
        resourceId: "res-anchor-1",
        anchorType: "identity",
        code: "anchor_review_due",
      },
    ]);
    expect(review.ok && review.value.stalePolicyBaselines).toEqual([
      {
        agentAssetId: AGENT_ASSET,
        manifestPolicyRef: "policy-v1-stale",
        currentBaselineRef: "policy-v2-current",
      },
    ]);
    expect(review.ok && review.value.state).toBe("applied");
  });

  it("refuses domain merge, anchor auto-activation, placement, and mtime truth", () => {
    expect(refuseContinuityDomainMerge()).toEqual({ ok: false, error: "domain_merge_forbidden" });
    expect(refuseAnchorAutoActivationFromReview()).toEqual({
      ok: false,
      error: "anchor_auto_activation_forbidden",
    });
    expect(refusePlacementFromContinuityReview()).toEqual({
      ok: false,
      error: "placement_authority_forbidden",
    });
    expect(refuseContinuityMtimeAsTruth()).toEqual({ ok: false, error: "mtime_truth_forbidden" });
  });

  it("requires tenant policy baseline for human-anchor review", async () => {
    const bareDir = tmpStateDir();
    writeTenantKeyManagementPolicyAtDeployBoundary({
      stateDir: bareDir,
      record: {
        schemaVersion: 1,
        tenantId: TENANT,
        operators: [{ userId: MEMBER, role: "tenant-admin" }],
      },
    });
    const bareCall = await authCall(TENANT, MEMBER);
    const bareAuth = resolveTenantKeyManagementAuth({ call: bareCall, stateDir: bareDir });
    if (!bareAuth.ok) {
      throw new Error("expected auth");
    }
    expect(
      await runHumanAnchorReview({
        auth: bareAuth.auth,
        stateDir: bareDir,
        now: REVIEW_NOW,
        agentAssetIds: [],
      }),
    ).toEqual({ ok: false, error: "policy_baseline_missing" });
    fs.rmSync(bareDir, { recursive: true, force: true });
  });

  it("keeps continuity source free of placement forks and store internals in the barrel", () => {
    const source = fs.readFileSync(path.join(here, "continuity-longevity.ts"), "utf8");
    for (const token of [
      "decideShadowPromotion",
      "fs.stat",
      "statSync",
      "mtimeMs",
      "placement_export",
      "activateAnchor",
    ]) {
      expect(source.includes(token), token).toBe(false);
    }
    expect(dataGovernanceBarrel).not.toHaveProperty("mutateContinuityLongevityState");
    expect(dataGovernanceBarrel).not.toHaveProperty("writeContinuityRestoreSnapshot");
    expect(dataGovernanceBarrel).toHaveProperty("runContinuityRestoreDrill");
    expect(dataGovernanceBarrel).toHaveProperty("runHumanAnchorReview");
    expect(dataGovernanceBarrel).toHaveProperty("validateContinuityCheckpoint");
  });
});
