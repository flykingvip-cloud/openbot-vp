import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../tenant-context.js";
import {
  compareAndPutManifestPointer,
  listAgentAssetManifests,
  listManifestMutations,
  readManifestMutationByOperation,
} from "./agent-asset-manifest-store.js";
import {
  approveManifestSupersession,
  proposeManifestSupersession,
  readAgentAssetManifest,
  readAgentAssetManifestPointer,
} from "./agent-asset-manifest.js";
import {
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import { resolveGovernanceApprovalAuth } from "./cognitive-approval-auth.js";
import { writeGovernanceApprovalGrantAtDeployBoundary } from "./cognitive-approval-grant-store.js";
import { authenticateGovernanceCall } from "./cognitive-recommendation-auth.js";
import { unlockCognitiveWritesForTests } from "./cognitive-write-unlock.test-harness.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { reclaimManifestPointerOrphans } from "./pointer-orphan-reclamation.js";
import type { CatalogRecord, GovernanceApprovalGrantRecord, OwnershipPrincipal } from "./types.js";

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<TenantContext | null> => null),
);
const resolveAuthoritativeMembershipMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ tenantId: string | null; userId: string | null }> => ({
      tenantId: null,
      userId: null,
    }),
  ),
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
afterEach(() => {
  resetCatalogStoreSingletonsForTests();
  resolveTenantContextMock.mockReset();
  resolveTenantContextMock.mockResolvedValue(null);
  resolveAuthoritativeMembershipMock.mockReset();
  resolveAuthoritativeMembershipMock.mockResolvedValue({ tenantId: null, userId: null });
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p3f-"));
  tempDirs.push(dir);
  return dir;
}

async function enterpriseCall() {
  resolveTenantContextMock.mockResolvedValue({
    tenantId: "t1",
    userId: "u1",
    domain: "enterprise",
  });
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: "u1@acme.test",
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    throw new Error("expected authenticated call");
  }
  return authenticated.call;
}

/** The authoritative AgentAsset row. Proposal/approval authority is derived from it. */
function agentAssetRow(params: {
  agentAssetId: string;
  tenantId?: string | null;
  owner?: OwnershipPrincipal;
}): CatalogRecord {
  const tenantId = params.tenantId === undefined ? "t1" : params.tenantId;
  const owner = params.owner ?? { kind: "user", userId: "u1" };
  return {
    envelope: {
      resourceId: params.agentAssetId,
      resourceType: "agent",
      schemaVersion: 1,
      tenantId,
      owner,
      scope: tenantId ? { kind: "tenant", tenantId } : { kind: "system" },
      lifecycleState: "active",
      classification: "confidential",
      governanceVersion: 1,
      canonicalBindingId: `bind-${params.agentAssetId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
    },
    bindings: [
      {
        bindingId: `bind-${params.agentAssetId}`,
        resourceId: params.agentAssetId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `/data/${params.agentAssetId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

async function registerAgentAsset(
  stateDir: string,
  params: { agentAssetId?: string; tenantId?: string | null; owner?: OwnershipPrincipal } = {},
): Promise<void> {
  const catalog = createFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
  });
  await catalog.put(
    agentAssetRow({
      agentAssetId: params.agentAssetId ?? "asset-1",
      tenantId: params.tenantId,
      owner: params.owner,
    }),
  );
}

/** Unlocked writes + a registered, caller-owned AgentAsset: the normal precondition set. */
async function readyStateDir(): Promise<string> {
  const stateDir = tmpStateDir();
  unlockCognitiveWritesForTests(stateDir);
  await registerAgentAsset(stateDir);
  return stateDir;
}

function writeGrant(stateDir: string, record: GovernanceApprovalGrantRecord): void {
  writeGovernanceApprovalGrantAtDeployBoundary({ record, stateDir });
}

async function manifestAuth(stateDir: string, agentAssetId = "asset-1") {
  writeGrant(stateDir, {
    grantId: `grant-manifest-${agentAssetId}`,
    kind: "governance_approval_grant",
    grantKind: "manifest_supersede",
    tenantId: "t1",
    scope: { kind: "agentAsset", agentAssetId },
    approverUserId: "u1",
    issuedBy: "enterprise_ops",
    issuedAt: "2026-08-11T00:00:00Z",
    expiresAt: "2027-08-11T00:00:00Z",
  });
  const resolved = await resolveGovernanceApprovalAuth({
    call: await enterpriseCall(),
    owner: { kind: "user", userId: "u1" },
    grantId: `grant-manifest-${agentAssetId}`,
    requiredKind: "manifest_supersede",
    requiredScope: { kind: "agentAsset", agentAssetId },
    stateDir,
  });
  if (!resolved.ok) {
    throw new Error(`expected manifest auth: ${resolved.reason}`);
  }
  return resolved.auth;
}

function baseRefs(patch?: Partial<Parameters<typeof proposeManifestSupersession>[0]>) {
  return {
    ownerScope: "user_owned" as const,
    identityVersionRef: "id-v1",
    capabilitySetVersionRef: "cap-v1",
    policyBaselineRef: "policy-v1",
    operationalIdentityBindingRefs: ["oi-1"],
    reasonCode: "continuity-checkpoint",
    expectedPointerVersion: 0,
    ...patch,
  };
}

function countReceiptFiles(stateDir: string, agentAssetId = "asset-1"): number {
  const root = path.join(
    stateDir,
    "data-governance",
    "agent-asset-manifest-mutations",
    agentAssetId,
  );
  if (!fs.existsSync(root)) {
    return 0;
  }
  return fs.readdirSync(root).filter((name) => name.endsWith(".json")).length;
}

describe("P3-f AgentAsset continuity manifest", () => {
  it("rejects embedded domain bodies and requires write unlock", async () => {
    const stateDir = tmpStateDir();
    await registerAgentAsset(stateDir);
    const call = await enterpriseCall();
    const locked = await proposeManifestSupersession({
      call,
      operationId: "op-locked",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    expect(locked).toEqual({ ok: false, error: "schema_write_locked" });

    unlockCognitiveWritesForTests(stateDir);
    const forbidden = await proposeManifestSupersession({
      call,
      operationId: "op-embed",
      agentAssetId: "asset-1",
      ...baseRefs(),
      persona: { name: "should-not" },
      stateDir,
    } as never);
    expect(forbidden).toEqual({ ok: false, error: "embedded_payload_forbidden" });
  });

  it("writes history before pointer CAS and never creates a dangling pointer", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const proposed = await proposeManifestSupersession({
      call,
      operationId: "op-1",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      throw new Error("expected propose");
    }
    expect(readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir })).toBeNull();
    expect(
      readAgentAssetManifest({
        agentAssetId: "asset-1",
        manifestId: proposed.manifest.manifestId,
        stateDir,
      }),
    ).toMatchObject({ kind: "agent_asset_continuity_manifest" });

    const approved = await approveManifestSupersession({
      auth: await manifestAuth(stateDir),
      agentAssetId: "asset-1",
      operationId: "op-1",
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) {
      throw new Error("expected approve");
    }
    expect(approved.pointer?.activeManifestId).toBe(proposed.manifest.manifestId);
    expect(approved.pointer?.pointerVersion).toBe(1);
  });

  it("pointer CAS: concurrent supersede yields one applied and one conflicted", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const a = await proposeManifestSupersession({
      call,
      operationId: "op-a",
      agentAssetId: "asset-1",
      ...baseRefs({ reasonCode: "a" }),
      stateDir,
    });
    const b = await proposeManifestSupersession({
      call,
      operationId: "op-b",
      agentAssetId: "asset-1",
      ...baseRefs({
        reasonCode: "b",
        identityVersionRef: "id-v2",
      }),
      stateDir,
    });
    expect(a.ok && b.ok).toBe(true);
    const auth = await manifestAuth(stateDir);
    const first = await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-a",
      expectedPointerVersion: 0,
      stateDir,
    });
    const second = await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-b",
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe("version_conflict");
      expect(second.receipt?.status).toBe("conflicted");
    }
    expect(
      readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir })?.pointerVersion,
    ).toBe(1);
  });

  it("content dedup reuses an existing manifest without a pointer bump", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const first = await proposeManifestSupersession({
      call,
      operationId: "op-d1",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    const second = await proposeManifestSupersession({
      call,
      operationId: "op-d2",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("expected propose");
    }
    expect(second.manifest.manifestId).toBe(first.manifest.manifestId);
    expect(listAgentAssetManifests({ agentAssetId: "asset-1", stateDir })).toHaveLength(1);
    expect(readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir })).toBeNull();
  });

  it("replaying the same operationId returns the prior outcome with no second pointer CAS", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    await proposeManifestSupersession({
      call,
      operationId: "op-replay",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    const auth = await manifestAuth(stateDir);
    const first = await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-replay",
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(first.ok).toBe(true);
    const replay = await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-replay",
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok || !first.ok) {
      throw new Error("expected replay");
    }
    expect(replay.receipt.mutationId).toBe(first.receipt.mutationId);
    expect(
      readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir })?.pointerVersion,
    ).toBe(1);
  });

  it("a new authorized operation activates a previously orphaned manifest", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const orphan = await proposeManifestSupersession({
      call,
      operationId: "op-orphan",
      agentAssetId: "asset-1",
      ...baseRefs({ reasonCode: "orphan" }),
      stateDir,
    });
    expect(orphan.ok).toBe(true);
    if (!orphan.ok) {
      throw new Error("expected orphan propose");
    }
    const auth = await manifestAuth(stateDir);
    const lost = await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-orphan",
      expectedPointerVersion: 99,
      stateDir,
    });
    expect(lost.ok).toBe(false);
    expect(readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir })).toBeNull();

    const activated = await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-activate-orphan",
      manifestId: orphan.manifest.manifestId,
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) {
      throw new Error("expected activation");
    }
    expect(activated.pointer?.activeManifestId).toBe(orphan.manifest.manifestId);
    expect(activated.pointer?.pointerVersion).toBe(1);
  });

  it("reclamation uses pointer predicate, never fencing tokens, and skips prepared", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const prepared = await proposeManifestSupersession({
      call,
      operationId: "op-prep",
      agentAssetId: "asset-1",
      ...baseRefs({ reasonCode: "prep" }),
      stateDir,
    });
    expect(prepared.ok).toBe(true);
    const now = new Date();
    const early = await reclaimManifestPointerOrphans({
      agentAssetId: "asset-1",
      stateDir,
      now,
      ttlMs: 0,
    });
    expect(early.skipped).toContain(prepared.ok ? prepared.manifest.manifestId : "missing");

    const conflicted = await proposeManifestSupersession({
      call,
      operationId: "op-lose",
      agentAssetId: "asset-1",
      ...baseRefs({ reasonCode: "lose", identityVersionRef: "id-lose" }),
      stateDir,
    });
    expect(conflicted.ok).toBe(true);
    const auth = await manifestAuth(stateDir);
    await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-prep",
      expectedPointerVersion: 0,
      stateDir,
    });
    await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-lose",
      expectedPointerVersion: 0,
      stateDir,
    });
    const receipt = readManifestMutationByOperation({
      agentAssetId: "asset-1",
      operationId: "op-lose",
      stateDir,
    });
    expect(receipt?.status).toBe("conflicted");
    const oldNow = new Date(Date.now() + 60_000);
    const reclaimed = await reclaimManifestPointerOrphans({
      agentAssetId: "asset-1",
      stateDir,
      now: oldNow,
      ttlMs: 1,
    });
    expect(reclaimed.annotated).toContain(conflicted.ok ? conflicted.manifest.manifestId : "");
    expect(
      readAgentAssetManifest({
        agentAssetId: "asset-1",
        manifestId: conflicted.ok ? conflicted.manifest.manifestId : "",
        stateDir,
      }),
    ).not.toBeNull();
    expect(fs.existsSync(path.join(stateDir, "data-governance", "cognitive-recovery"))).toBe(true);
  });

  it("supersession leaves the prior manifest row byte-identical", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const first = await proposeManifestSupersession({
      call,
      operationId: "op-s1",
      agentAssetId: "asset-1",
      ...baseRefs({ reasonCode: "first" }),
      stateDir,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error("expected first");
    }
    const auth = await manifestAuth(stateDir);
    await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-s1",
      expectedPointerVersion: 0,
      stateDir,
    });
    const before = JSON.stringify(
      readAgentAssetManifest({
        agentAssetId: "asset-1",
        manifestId: first.manifest.manifestId,
        stateDir,
      }),
    );
    const second = await proposeManifestSupersession({
      call,
      operationId: "op-s2",
      agentAssetId: "asset-1",
      ...baseRefs({
        reasonCode: "second",
        identityVersionRef: "id-v2",
        previousManifestId: first.manifest.manifestId,
        expectedPointerVersion: 1,
      }),
      stateDir,
    });
    expect(second.ok).toBe(true);
    await approveManifestSupersession({
      auth,
      agentAssetId: "asset-1",
      operationId: "op-s2",
      expectedPointerVersion: 1,
      stateDir,
    });
    const after = JSON.stringify(
      readAgentAssetManifest({
        agentAssetId: "asset-1",
        manifestId: first.manifest.manifestId,
        stateDir,
      }),
    );
    expect(after).toBe(before);
    expect(
      readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir })?.activeManifestId,
    ).toBe(second.ok ? second.manifest.manifestId : "");
  });

  it("AI propose OK; approve without GovernanceApprovalAuth is denied", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const proposed = await proposeManifestSupersession({
      call,
      operationId: "op-auth",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    expect(proposed.ok).toBe(true);
    const denied = await approveManifestSupersession({
      auth: { kind: "operator", operatorId: "op-1" } as never,
      agentAssetId: "asset-1",
      operationId: "op-auth",
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(denied).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir })).toBeNull();
  });

  it("manifest modules do not import P2 purge", () => {
    for (const name of [
      "agent-asset-manifest.ts",
      "agent-asset-manifest-store.ts",
      "pointer-orphan-reclamation.ts",
    ]) {
      const src = fs.readFileSync(path.join(import.meta.dirname, name), "utf8");
      expect(src).not.toMatch(/lifecycle-purge/);
    }
  });

  it("compareAndPutManifestPointer refuses stale expected versions", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const first = await compareAndPutManifestPointer({
      agentAssetId: "asset-1",
      stateDir,
      expectedPointerVersion: 0,
      next: {
        kind: "agent_asset_manifest_pointer",
        agentAssetId: "asset-1",
        activeManifestId: "m1",
        pointerVersion: 1,
        lastMutationId: "mut-1",
        updatedAt: new Date().toISOString(),
      },
    });
    expect(first.ok).toBe(true);
    const stale = await compareAndPutManifestPointer({
      agentAssetId: "asset-1",
      stateDir,
      expectedPointerVersion: 0,
      next: {
        kind: "agent_asset_manifest_pointer",
        agentAssetId: "asset-1",
        activeManifestId: "m2",
        pointerVersion: 1,
        lastMutationId: "mut-2",
        updatedAt: new Date().toISOString(),
      },
    });
    expect(stale.ok).toBe(false);
  });

  // --- Kiro CR: operation-level atomicity -------------------------------------------------

  it("serializes concurrent proposals that share one operationId", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const [left, right] = await Promise.all([
      proposeManifestSupersession({
        call,
        operationId: "op-race",
        agentAssetId: "asset-1",
        ...baseRefs({ reasonCode: "race" }),
        stateDir,
      }),
      proposeManifestSupersession({
        call,
        operationId: "op-race",
        agentAssetId: "asset-1",
        ...baseRefs({ reasonCode: "race" }),
        stateDir,
      }),
    ]);
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) {
      throw new Error("expected both proposals to resolve");
    }
    // One operationId ⇒ exactly one authoritative receipt, whatever mutationIds were generated.
    expect(right.receipt.mutationId).toBe(left.receipt.mutationId);
    expect(countReceiptFiles(stateDir)).toBe(1);
    expect(listManifestMutations({ agentAssetId: "asset-1", stateDir })).toHaveLength(1);
    const indexed = readManifestMutationByOperation({
      agentAssetId: "asset-1",
      operationId: "op-race",
      stateDir,
    });
    expect(indexed?.mutationId).toBe(left.receipt.mutationId);
  });

  it("serializes concurrent approvals of one operationId to a single pointer CAS", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    await proposeManifestSupersession({
      call,
      operationId: "op-approve-race",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    const auth = await manifestAuth(stateDir);
    const results = await Promise.all([
      approveManifestSupersession({
        auth,
        agentAssetId: "asset-1",
        operationId: "op-approve-race",
        expectedPointerVersion: 0,
        stateDir,
      }),
      approveManifestSupersession({
        auth,
        agentAssetId: "asset-1",
        operationId: "op-approve-race",
        expectedPointerVersion: 0,
        stateDir,
      }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const pointer = readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir });
    expect(pointer?.pointerVersion).toBe(1);
    expect(countReceiptFiles(stateDir)).toBe(1);
  });

  // --- Kiro CR: prepared-receipt crash recovery -------------------------------------------

  it("heals a prepared receipt when the pointer CAS already landed", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const proposed = await proposeManifestSupersession({
      call,
      operationId: "op-crash",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    if (!proposed.ok) {
      throw new Error("expected propose");
    }
    // Crash window: pointer moved by this mutation, receipt never finalized.
    const moved = await compareAndPutManifestPointer({
      agentAssetId: "asset-1",
      stateDir,
      expectedPointerVersion: 0,
      next: {
        kind: "agent_asset_manifest_pointer",
        agentAssetId: "asset-1",
        activeManifestId: proposed.manifest.manifestId,
        pointerVersion: 1,
        lastMutationId: proposed.receipt.mutationId,
        updatedAt: new Date().toISOString(),
      },
    });
    expect(moved.ok).toBe(true);
    expect(
      readManifestMutationByOperation({
        agentAssetId: "asset-1",
        operationId: "op-crash",
        stateDir,
      })?.status,
    ).toBe("prepared");

    const healed = await approveManifestSupersession({
      auth: await manifestAuth(stateDir),
      agentAssetId: "asset-1",
      operationId: "op-crash",
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(healed.ok).toBe(true);
    if (!healed.ok) {
      throw new Error("expected heal");
    }
    expect(healed.receipt.status).toBe("applied");
    expect(healed.receipt.mutationId).toBe(proposed.receipt.mutationId);
    expect(healed.receipt.resultingPointerVersion).toBe(1);
    // No second CAS: the pointer generation is untouched by the heal.
    expect(
      readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir })?.pointerVersion,
    ).toBe(1);
  });

  it("resumes a prepared receipt with its recorded history row when the pointer never moved", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const proposed = await proposeManifestSupersession({
      call,
      operationId: "op-resume",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    if (!proposed.ok) {
      throw new Error("expected propose");
    }
    const resumed = await approveManifestSupersession({
      auth: await manifestAuth(stateDir),
      agentAssetId: "asset-1",
      operationId: "op-resume",
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      throw new Error("expected resume");
    }
    expect(resumed.receipt.mutationId).toBe(proposed.receipt.mutationId);
    expect(resumed.receipt.historyRowId).toBe(proposed.manifest.manifestId);
    expect(resumed.pointer?.activeManifestId).toBe(proposed.manifest.manifestId);
    expect(listAgentAssetManifests({ agentAssetId: "asset-1", stateDir })).toHaveLength(1);
  });

  it("fails closed when a prepared replay meets a foreign or newer pointer", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const proposed = await proposeManifestSupersession({
      call,
      operationId: "op-foreign",
      agentAssetId: "asset-1",
      ...baseRefs(),
      stateDir,
    });
    if (!proposed.ok) {
      throw new Error("expected propose");
    }
    const foreign = await compareAndPutManifestPointer({
      agentAssetId: "asset-1",
      stateDir,
      expectedPointerVersion: 0,
      next: {
        kind: "agent_asset_manifest_pointer",
        agentAssetId: "asset-1",
        activeManifestId: "manifest-foreign",
        pointerVersion: 1,
        lastMutationId: "mut-foreign",
        updatedAt: new Date().toISOString(),
      },
    });
    expect(foreign.ok).toBe(true);
    const replay = await approveManifestSupersession({
      auth: await manifestAuth(stateDir),
      agentAssetId: "asset-1",
      operationId: "op-foreign",
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(replay.ok).toBe(false);
    if (replay.ok) {
      throw new Error("expected fail closed");
    }
    expect(replay.error).toBe("version_conflict");
    expect(replay.receipt?.status).toBe("conflicted");
    const pointer = readAgentAssetManifestPointer({ agentAssetId: "asset-1", stateDir });
    expect(pointer?.activeManifestId).toBe("manifest-foreign");
    expect(pointer?.lastMutationId).toBe("mut-foreign");
    expect(pointer?.pointerVersion).toBe(1);
  });

  // --- Kiro CR: ownership and tenant binding ---------------------------------------------

  it("refuses a proposal against an unknown AgentAsset", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const proposed = await proposeManifestSupersession({
      call: await enterpriseCall(),
      operationId: "op-unknown",
      agentAssetId: "asset-unknown",
      ...baseRefs(),
      stateDir,
    });
    expect(proposed).toEqual({ ok: false, error: "not_found" });
    expect(listAgentAssetManifests({ agentAssetId: "asset-unknown", stateDir })).toHaveLength(0);
  });

  it("refuses a proposal against a foreign-tenant AgentAsset", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    await registerAgentAsset(stateDir, { agentAssetId: "asset-foreign", tenantId: "t2" });
    const proposed = await proposeManifestSupersession({
      call: await enterpriseCall(),
      operationId: "op-cross-tenant",
      agentAssetId: "asset-foreign",
      ...baseRefs(),
      stateDir,
    });
    expect(proposed).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(listAgentAssetManifests({ agentAssetId: "asset-foreign", stateDir })).toHaveLength(0);
    expect(
      fs.existsSync(path.join(stateDir, "data-governance", "agent-asset-manifest-mutations")),
    ).toBe(false);
  });

  it("refuses a proposal against an AgentAsset the caller does not own", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    await registerAgentAsset(stateDir, {
      agentAssetId: "asset-other",
      owner: { kind: "user", userId: "u2" },
    });
    const proposed = await proposeManifestSupersession({
      call: await enterpriseCall(),
      operationId: "op-unowned",
      agentAssetId: "asset-other",
      ...baseRefs(),
      stateDir,
    });
    expect(proposed).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(listAgentAssetManifests({ agentAssetId: "asset-other", stateDir })).toHaveLength(0);
  });

  it("refuses a proposal whose declared ownerScope disagrees with the AgentAsset", async () => {
    const stateDir = await readyStateDir();
    const proposed = await proposeManifestSupersession({
      call: await enterpriseCall(),
      operationId: "op-scope",
      agentAssetId: "asset-1",
      ...baseRefs({ ownerScope: "group_owned" }),
      stateDir,
    });
    expect(proposed).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(listAgentAssetManifests({ agentAssetId: "asset-1", stateDir })).toHaveLength(0);
  });

  it("refuses approval when the grant's AgentAsset is not the caller's tenant row", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    await registerAgentAsset(stateDir, { agentAssetId: "asset-x", tenantId: "t2" });
    const approved = await approveManifestSupersession({
      auth: await manifestAuth(stateDir, "asset-x"),
      agentAssetId: "asset-x",
      operationId: "op-approve-cross",
      manifestId: "manifest-any",
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(approved).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(readAgentAssetManifestPointer({ agentAssetId: "asset-x", stateDir })).toBeNull();
  });
});
