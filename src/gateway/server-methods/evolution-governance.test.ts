import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-evo-gov-rpc-${Date.now()}`);

/**
 * Integration-style RPC tests: three-way ACL uses real assertClientMayAccess* code.
 * Authority seams are stubbed (membership + agent ownership) — NOT resolveAgentDirForClient.
 * Unit proof of ownership intersection lives in operator-access.test.ts.
 */
const membershipByEmail = vi.hoisted(() => new Map<string, { tenantId: string; userId: string }>());
const agentOwners = vi.hoisted(() => new Map<string, string[]>());

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../tenant-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...actual,
    resolveAuthoritativeMembership: async (client: { user?: string } | null) => {
      const email = client?.user?.trim().toLowerCase() ?? "";
      const hit = membershipByEmail.get(email);
      return hit
        ? { tenantId: hit.tenantId, userId: hit.userId }
        : { tenantId: null, userId: null };
    },
  };
});

vi.mock("../agent-tenant.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent-tenant.js")>();
  return {
    ...actual,
    resolveAgentTenant: async (agentId: string) => agentOwners.get(agentId)?.[0] ?? null,
  };
});
vi.mock("../agent-runtime-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent-runtime-store.js")>();
  return {
    ...actual,
    // Prefer coverage from agentOwners when set (secondary ownership source).
    getAgent: (agentId: string) => {
      const owners = agentOwners.get(agentId);
      if (owners?.length) {
        return { runtimeAgentId: agentId, tenantCoverage: owners };
      }
      return actual.getAgent(agentId);
    },
  };
});

const { setGovernanceKillSwitch, writeGovernancePersistedState, readGovernancePersistedState } =
  await import("../evolution-governance/index.js");
const { recordAttributionOutcome, resetAttributionStatsForTests } =
  await import("../skill-invocation/index.js");
const { evolutionGovernanceHandlers } = await import("./evolution-governance.js");
const { patternDetectionHandlers } = await import("./pattern-detection.js");
const {
  ingestPatternSample,
  listPatternCandidates,
  approvePatternCandidate,
  structureHashFromText,
  resetPatternDetectionStoreForTests,
  getPatternCandidate,
} = await import("../pattern-detection/index.js");
const { resolveAuthenticatedOperatorPrincipal } = await import("./operator-access.js");

function invoke(method: string, params: Record<string, unknown> = {}, client: unknown = null) {
  return new Promise<{ ok: boolean; payload?: unknown; error?: unknown }>((resolve) => {
    const handler = evolutionGovernanceHandlers[method];
    if (!handler) {
      resolve({ ok: false, error: "missing handler" });
      return;
    }
    void handler({
      params,
      respond: (ok: boolean, payload: unknown, error: unknown) => resolve({ ok, payload, error }),
      client,
      context: {} as never,
      req: { type: "req", id: "t", method } as never,
    } as never);
  });
}

function seedApprovedCandidate(agentId: string, tenantId: string) {
  const hash = structureHashFromText("# rpc evo\n1. a");
  const out = structureHashFromText("# out\n- ok");
  for (let i = 1; i <= 3; i += 1) {
    ingestPatternSample({
      agentId,
      tenantId,
      operatorUserId: "user-seed",
      runId: `rpc-run-${agentId}-${i}`,
      taskId: `rpc-task-${agentId}-${i}`,
      inputStructureHash: hash,
      outputStructureHash: out,
      success: true,
      suggestedNameHint: "RPC skill",
    });
  }
  const candidate = listPatternCandidates({ agentId })[0];
  approvePatternCandidate(candidate.candidateId, {
    approvedBy: "seed-ops",
    autoInstallIntent: true,
  });
  return getPatternCandidate(candidate.candidateId)!;
}

function membershipClient(email: string) {
  return {
    user: email,
    sessionDomain: "enterprise" as const,
    connect: { clientId: "cli" },
    connId: "conn-1",
  };
}

describe("evolution-governance RPCs", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    setGovernanceKillSwitch(false);
    resetAttributionStatsForTests();
    resetPatternDetectionStoreForTests();
    membershipByEmail.clear();
    agentOwners.clear();
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });
    membershipByEmail.set("ops-b@globex.com", { tenantId: "tenant-b", userId: "user-b" });
    membershipByEmail.set("auth-user-bob@acme.com", { tenantId: "tenant-a", userId: "user-a" });
    agentOwners.set("agent-a", ["tenant-a"]);
    agentOwners.set("agent-b", ["tenant-b"]);
    agentOwners.set("bot-hold", ["tenant-a"]);
    agentOwners.set("bot-x", ["tenant-a"]);
  });
  afterEach(() => {
    setGovernanceKillSwitch(false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("snapshot returns effects and attribution", async () => {
    recordAttributionOutcome("unique_owner");
    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      effectVerifications: [
        {
          id: "effect:1",
          assetId: "asset:bot:x",
          runtimeAgentId: "bot-x",
          reason: "idle_with_cost",
          pausedAt: new Date().toISOString(),
          verifyAfterAt: new Date().toISOString(),
          baseline: {
            skillSuccessRate: 0.5,
            skillUsageTotal: 5,
            invocationCount7d: 0,
            tokenConsumption7d: 10,
          },
          status: "open",
        },
      ],
    });
    const res = await invoke("evolution-governance.snapshot");
    expect(res.ok).toBe(true);
    const payload = res.payload as {
      effectVerifications: unknown[];
      attribution: { totalAttributed: number };
    };
    expect(payload.effectVerifications).toHaveLength(1);
    expect(payload.attribution.totalAttributed).toBeGreaterThanOrEqual(1);
  });

  it("human-hold closes open effects without resume", async () => {
    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      effectVerifications: [
        {
          id: "effect:pause:bot-hold:idle",
          assetId: "asset:bot:bot-hold",
          runtimeAgentId: "bot-hold",
          reason: "idle_with_cost",
          pausedAt: new Date().toISOString(),
          verifyAfterAt: new Date(Date.now() + 3600_000).toISOString(),
          baseline: {
            skillSuccessRate: null,
            skillUsageTotal: 0,
            invocationCount7d: 0,
            tokenConsumption7d: 1,
          },
          status: "open",
        },
      ],
    });
    const res = await invoke("evolution-governance.human-hold", {
      runtimeAgentId: "bot-hold",
      reason: "ops review",
    });
    expect(res.ok).toBe(true);
    const effects = readGovernancePersistedState().effectVerifications as Array<{
      status: string;
    }>;
    expect(effects[0]?.status).toBe("held");
  });

  it("enroll denies operator of tenant A for tenant B candidate (three-way ACL)", async () => {
    const candidateB = seedApprovedCandidate("agent-b", "tenant-b");
    expect(candidateB.tenantId).toBe("tenant-b");

    const res = await invoke(
      "evolution-governance.enroll-skill-auto",
      { candidateId: candidateB.candidateId, enrolledBy: "forged" },
      membershipClient("ops-a@acme.com"),
    );
    expect(res.ok).toBe(false);
    const msg = (res.error as { message?: string })?.message ?? String(res.error);
    expect(msg).toMatch(/access denied|tenant mismatch|ownership|tenantId required/i);
    expect(readGovernancePersistedState().skillAutoJobs?.[candidateB.candidateId]).toBeUndefined();
  });

  it("enroll allows when membership, agent ownership, and candidate.tenantId match", async () => {
    const candidateA = seedApprovedCandidate("agent-a", "tenant-a");
    const res = await invoke(
      "evolution-governance.enroll-skill-auto",
      {
        candidateId: candidateA.candidateId,
        enrolledBy: "forged-other-person",
      },
      membershipClient("ops-a@acme.com"),
    );
    expect(res.ok).toBe(true);
    const payload = res.payload as { ok: boolean; job?: { enrolledBy?: string } };
    expect(payload.job?.enrolledBy).toBe("ops-a@acme.com");
    expect(payload.job?.enrolledBy).not.toBe("forged-other-person");
  });

  it("cancel denies cross-tenant operator", async () => {
    const candidateB = seedApprovedCandidate("agent-b", "tenant-b");
    const enrolled = await invoke("evolution-governance.enroll-skill-auto", {
      candidateId: candidateB.candidateId,
    });
    expect(enrolled.ok).toBe(true);

    const res = await invoke(
      "evolution-governance.cancel-skill-auto",
      { candidateId: candidateB.candidateId, cancelledBy: "forged" },
      membershipClient("ops-a@acme.com"),
    );
    expect(res.ok).toBe(false);
    const jobs = readGovernancePersistedState().skillAutoJobs as Record<string, { stage?: string }>;
    expect(jobs[candidateB.candidateId]?.stage).not.toBe("cancelled");
  });

  it("cancel ignores client-supplied cancelledBy for matching tenant", async () => {
    const candidateA = seedApprovedCandidate("agent-a", "tenant-a");
    await invoke(
      "evolution-governance.enroll-skill-auto",
      { candidateId: candidateA.candidateId },
      membershipClient("ops-a@acme.com"),
    );
    const res = await invoke(
      "evolution-governance.cancel-skill-auto",
      {
        candidateId: candidateA.candidateId,
        cancelledBy: "forged-canceller",
        reason: "abort note",
      },
      membershipClient("ops-a@acme.com"),
    );
    expect(res.ok).toBe(true);
    const jobs = readGovernancePersistedState().skillAutoJobs as Record<
      string,
      { stage?: string; cancelReason?: string }
    >;
    expect(jobs[candidateA.candidateId]?.stage).toBe("cancelled");
    expect(jobs[candidateA.candidateId]?.cancelReason).toBe("abort note");
  });

  it("resolveAuthenticatedOperatorPrincipal ignores unauthenticated client", () => {
    expect(
      resolveAuthenticatedOperatorPrincipal({
        connect: {} as never,
      }),
    ).toBeNull();
    expect(
      resolveAuthenticatedOperatorPrincipal({
        user: "alice",
        connect: {} as never,
      }),
    ).toBe("alice");
  });

  it("tenant operator cannot human-resume another tenant's runtime agent", async () => {
    agentOwners.set("bot-tenant-b", ["tenant-b"]);
    agentOwners.set("bot-tenant-a", ["tenant-a"]);
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });
    membershipByEmail.set("ops-b@globex.com", { tenantId: "tenant-b", userId: "user-b" });

    const denied = await invoke(
      "evolution-governance.human-resume",
      { runtimeAgentId: "bot-tenant-b", reason: "cross" },
      membershipClient("ops-a@acme.com"),
    );
    expect(denied.ok).toBe(false);

    const deniedRedirect = await invoke(
      "evolution-governance.apply-redirect",
      {
        runtimeAgentId: "bot-tenant-a",
        targetAgentId: "bot-tenant-b",
        reason: "cross-redirect",
      },
      membershipClient("ops-a@acme.com"),
    );
    expect(deniedRedirect.ok).toBe(false);
  });

  it("snapshot hides other tenants' limits/redirects/effects", async () => {
    agentOwners.set("bot-tenant-a", ["tenant-a"]);
    agentOwners.set("bot-tenant-b", ["tenant-b"]);
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });

    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      effectVerifications: [
        {
          id: "effect:a",
          assetId: "asset:bot:bot-tenant-a",
          runtimeAgentId: "bot-tenant-a",
          reason: "idle",
          pausedAt: new Date().toISOString(),
          verifyAfterAt: new Date().toISOString(),
          baseline: {
            skillSuccessRate: null,
            skillUsageTotal: 0,
            invocationCount7d: 0,
            tokenConsumption7d: 0,
          },
          status: "open",
        },
        {
          id: "effect:b",
          assetId: "asset:bot:bot-tenant-b",
          runtimeAgentId: "bot-tenant-b",
          reason: "idle",
          pausedAt: new Date().toISOString(),
          verifyAfterAt: new Date().toISOString(),
          baseline: {
            skillSuccessRate: null,
            skillUsageTotal: 0,
            invocationCount7d: 0,
            tokenConsumption7d: 0,
          },
          status: "open",
        },
      ],
      limits: {
        "bot-tenant-a": { reason: "lim-a" },
        "bot-tenant-b": { reason: "lim-b" },
      },
      redirects: {
        "bot-tenant-b": { targetAgentId: "x", reason: "r" },
      },
    });

    const snap = await invoke(
      "evolution-governance.snapshot",
      {},
      membershipClient("ops-a@acme.com"),
    );
    expect(snap.ok).toBe(true);
    const payload = snap.payload as {
      effectVerifications: Array<{ runtimeAgentId: string }>;
      limits: Record<string, unknown>;
      redirects: Record<string, unknown>;
    };
    expect(payload.effectVerifications.every((e) => e.runtimeAgentId === "bot-tenant-a")).toBe(
      true,
    );
    expect(payload.limits["bot-tenant-a"]).toBeTruthy();
    expect(payload.limits["bot-tenant-b"]).toBeFalsy();
    expect(payload.redirects["bot-tenant-b"]).toBeFalsy();
  });

  it("shared multi-tenant agent: tenant operator cannot limit/pause (platform admin can)", async () => {
    // Shared agent owned by both tenants
    agentOwners.set("shared-bot", ["tenant-a", "tenant-b"]);
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });

    const tenantLimit = await invoke(
      "evolution-governance.apply-limit",
      { runtimeAgentId: "shared-bot", reason: "should-fail" },
      membershipClient("ops-a@acme.com"),
    );
    expect(tenantLimit.ok).toBe(false);
    expect((tenantLimit.error as { message?: string })?.message ?? "").toMatch(
      /shared-agent-requires-platform-admin/,
    );

    const adminLimit = await invoke(
      "evolution-governance.apply-limit",
      { runtimeAgentId: "shared-bot", reason: "admin-ok" },
      {
        user: "ops-a@acme.com",
        sessionDomain: "platform",
        connect: { scopes: ["operator.admin"] },
        connId: "admin",
      },
    );
    // Admin passes ACL; runtime action may still fail if agent not fully seeded — ACL is the gate.
    // When ok=false without shared-agent message, that is runtime-layer; when ok=true, ACL passed.
    if (!adminLimit.ok) {
      const msg = (adminLimit.error as { message?: string })?.message ?? "";
      expect(msg).not.toMatch(
        /shared-agent-requires-platform-admin|access denied|membership required/,
      );
    }
  });

  it("shared agent: pending-approvals strips write actions; snapshot lists writeDenied", async () => {
    agentOwners.set("shared-bot", ["tenant-a", "tenant-b"]);
    agentOwners.set("solo-bot", ["tenant-a"]);
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });

    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      limits: {
        "shared-bot": { reason: "admin-limit" },
        "solo-bot": { reason: "tenant-limit" },
      },
      redirects: {},
      effectVerifications: [],
    });

    const pending = await invoke(
      "evolution-governance.pending-approvals",
      {},
      membershipClient("ops-a@acme.com"),
    );
    expect(pending.ok).toBe(true);
    const items = (
      pending.payload as {
        items: Array<{
          runtimeAgentId: string;
          actions: string[];
          requiresPlatformAdmin?: boolean;
        }>;
      }
    ).items;
    const sharedItem = items.find((i) => i.runtimeAgentId === "shared-bot");
    const soloItem = items.find((i) => i.runtimeAgentId === "solo-bot");
    expect(sharedItem?.requiresPlatformAdmin).toBe(true);
    expect(sharedItem?.actions).toEqual([]);
    expect(soloItem?.requiresPlatformAdmin).toBe(false);
    expect(soloItem?.actions).toContain("clear-limit");

    const snap = await invoke(
      "evolution-governance.snapshot",
      {},
      membershipClient("ops-a@acme.com"),
    );
    expect(snap.ok).toBe(true);
    const payload = snap.payload as {
      limits: Record<string, unknown>;
      sharedAgentWriteDenied: string[];
    };
    expect(payload.limits["shared-bot"]).toBeTruthy();
    expect(payload.limits["solo-bot"]).toBeTruthy();
    expect(payload.sharedAgentWriteDenied).toEqual(["shared-bot"]);
  });

  it("platform admin without enterprise membership can govern any owned agent", async () => {
    agentOwners.set("bot-tenant-b-only", ["tenant-b"]);
    // Admin email has NO membership entry
    membershipByEmail.delete("platform-admin@openbot.love");

    const adminOk = await invoke(
      "evolution-governance.human-hold",
      { runtimeAgentId: "bot-tenant-b-only", reason: "cross-tenant-admin" },
      {
        user: "platform-admin@openbot.love",
        sessionDomain: "platform",
        connect: { scopes: ["operator.admin"] },
        connId: "plat-admin",
      },
    );
    expect(adminOk.ok).toBe(true);
  });

  it("platform admin with tenant-a membership can still govern tenant-b-only agent", async () => {
    agentOwners.set("bot-only-b", ["tenant-b"]);
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });

    const res = await invoke(
      "evolution-governance.human-hold",
      { runtimeAgentId: "bot-only-b", reason: "admin-cross" },
      {
        user: "ops-a@acme.com",
        sessionDomain: "enterprise",
        connect: { scopes: ["operator.admin", "operator.approvals"] },
        connId: "admin-a",
      },
    );
    expect(res.ok).toBe(true);
  });

  it("attribution-stats requires platform admin", async () => {
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });
    const denied = await invoke(
      "evolution-governance.attribution-stats",
      {},
      {
        user: "ops-a@acme.com",
        sessionDomain: "enterprise",
        connect: { scopes: ["operator.read", "operator.approvals"] },
        connId: "t1",
      },
    );
    expect(denied.ok).toBe(false);

    const allowed = await invoke(
      "evolution-governance.attribution-stats",
      {},
      {
        user: "ops-a@acme.com",
        sessionDomain: "platform",
        connect: { scopes: ["operator.admin"] },
        connId: "t2",
      },
    );
    expect(allowed.ok).toBe(true);
    expect((allowed.payload as { stats?: unknown }).stats).toBeTruthy();
  });

  it("skillAutoJobs in snapshot only match exact tenantId (no shared-agent fallback)", async () => {
    agentOwners.set("shared-bot", ["tenant-a", "tenant-b"]);
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });

    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      skillAutoJobs: {
        job_a: {
          candidateId: "job_a",
          agentId: "shared-bot",
          tenantId: "tenant-a",
          stage: "pending_publish",
          autoInstallIntent: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        job_b: {
          candidateId: "job_b",
          agentId: "shared-bot",
          tenantId: "tenant-b",
          stage: "pending_publish",
          autoInstallIntent: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        job_legacy: {
          candidateId: "job_legacy",
          agentId: "shared-bot",
          // missing tenantId — fail-closed
          stage: "pending_publish",
          autoInstallIntent: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      } as never,
    });

    const snap = await invoke(
      "evolution-governance.snapshot",
      {},
      membershipClient("ops-a@acme.com"),
    );
    expect(snap.ok).toBe(true);
    const jobs = (snap.payload as { skillAutoJobs: Record<string, unknown> }).skillAutoJobs;
    expect(jobs.job_a).toBeTruthy();
    expect(jobs.job_b).toBeFalsy();
    expect(jobs.job_legacy).toBeFalsy();
    // Global attribution / scheduler not leaked to tenant
    expect((snap.payload as { attribution?: unknown }).attribution).toBeNull();
    expect((snap.payload as { scheduler?: unknown }).scheduler).toBeNull();
    expect((snap.payload as { jobCursor?: unknown }).jobCursor).toBeNull();
  });

  it("kill-switch requires platform admin scope", async () => {
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });
    const tenantOnly = await invoke(
      "evolution-governance.set-kill-switch",
      { enabled: true },
      {
        user: "ops-a@acme.com",
        sessionDomain: "enterprise",
        connect: { scopes: ["operator.approvals"] },
        connId: "c1",
      },
    );
    expect(tenantOnly.ok).toBe(false);

    const adminOk = await invoke(
      "evolution-governance.set-kill-switch",
      { enabled: false },
      {
        user: "ops-a@acme.com",
        sessionDomain: "platform",
        connect: { scopes: ["operator.admin"] },
        connId: "c-admin",
      },
    );
    expect(adminOk.ok).toBe(true);
  });

  it("cancel uses immutable job.tenantId when candidate record is gone", async () => {
    const candidateA = seedApprovedCandidate("agent-a", "tenant-a");
    const enrolled = await invoke(
      "evolution-governance.enroll-skill-auto",
      { candidateId: candidateA.candidateId },
      membershipClient("ops-a@acme.com"),
    );
    expect(enrolled.ok).toBe(true);
    const job = (enrolled.payload as { job?: { tenantId?: string } }).job;
    expect(job?.tenantId).toBe("tenant-a");

    // Delete candidate file entry (simulate loss) but keep job
    const candPath = path.join(tmpDir, "pattern-detection", "candidates.json");
    fs.writeFileSync(candPath, "[]\n");
    expect(getPatternCandidate(candidateA.candidateId)).toBeNull();

    const res = await invoke(
      "evolution-governance.cancel-skill-auto",
      { candidateId: candidateA.candidateId, reason: "orphan-cancel" },
      membershipClient("ops-a@acme.com"),
    );
    expect(res.ok).toBe(true);
    const jobs = readGovernancePersistedState().skillAutoJobs as Record<
      string,
      { stage?: string; tenantId?: string }
    >;
    expect(jobs[candidateA.candidateId]?.stage).toBe("cancelled");
    expect(jobs[candidateA.candidateId]?.tenantId).toBe("tenant-a");

    // Tenant B still cannot cancel tenant-a job
    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      skillAutoJobs: {
        [candidateA.candidateId]: {
          ...jobs[candidateA.candidateId],
          stage: "pending_publish",
          autoInstallIntent: true,
          agentId: "agent-a",
          candidateId: candidateA.candidateId,
          tenantId: "tenant-a",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as never,
      },
    });
    const denied = await invoke(
      "evolution-governance.cancel-skill-auto",
      { candidateId: candidateA.candidateId },
      membershipClient("ops-b@globex.com"),
    );
    expect(denied.ok).toBe(false);
  });

  it("cancel fails closed when job.candidateId disagrees with map key", async () => {
    const candidateA = seedApprovedCandidate("agent-a", "tenant-a");
    await invoke(
      "evolution-governance.enroll-skill-auto",
      { candidateId: candidateA.candidateId },
      membershipClient("ops-a@acme.com"),
    );
    const state = readGovernancePersistedState();
    const jobs = { ...(state.skillAutoJobs as Record<string, Record<string, unknown>>) };
    jobs[candidateA.candidateId] = {
      ...jobs[candidateA.candidateId],
      candidateId: "pc_wrong_id",
      stage: "pending_publish",
      autoInstallIntent: true,
    };
    writeGovernancePersistedState({ ...state, skillAutoJobs: jobs as never });

    const res = await invoke(
      "evolution-governance.cancel-skill-auto",
      { candidateId: candidateA.candidateId },
      membershipClient("ops-a@acme.com"),
    );
    expect(res.ok).toBe(false);
    expect((res.error as { message?: string })?.message ?? String(res.error)).toMatch(
      /ownership-mismatch/,
    );
  });

  it("cancel fails closed when candidate.tenantId conflicts with job.tenantId snapshot", async () => {
    const candidateA = seedApprovedCandidate("agent-a", "tenant-a");
    const enrolled = await invoke(
      "evolution-governance.enroll-skill-auto",
      { candidateId: candidateA.candidateId },
      membershipClient("ops-a@acme.com"),
    );
    expect(enrolled.ok).toBe(true);

    // Drift job tenant snapshot while candidate still says tenant-a
    const state = readGovernancePersistedState();
    const jobs = { ...(state.skillAutoJobs as Record<string, Record<string, unknown>>) };
    jobs[candidateA.candidateId] = {
      ...jobs[candidateA.candidateId],
      tenantId: "tenant-b",
      agentId: "agent-a",
      stage: "pending_publish",
      autoInstallIntent: true,
    };
    writeGovernancePersistedState({ ...state, skillAutoJobs: jobs as never });

    const res = await invoke(
      "evolution-governance.cancel-skill-auto",
      { candidateId: candidateA.candidateId },
      membershipClient("ops-a@acme.com"),
    );
    expect(res.ok).toBe(false);
    expect((res.error as { message?: string })?.message ?? String(res.error)).toMatch(
      /ownership-mismatch/,
    );
    // Job must not be cancelled (manual resolution required)
    expect(
      (readGovernancePersistedState().skillAutoJobs as Record<string, { stage?: string }>)[
        candidateA.candidateId
      ]?.stage,
    ).toBe("pending_publish");
  });
});

describe("pattern-detection shared-agent multi-tenant isolation", () => {
  const SHARED = "shared-bot";

  beforeEach(() => {
    resetPatternDetectionStoreForTests();
    membershipByEmail.clear();
    agentOwners.clear();
    // Shared agent owned by both tenants (multi-tenant coverage)
    agentOwners.set(SHARED, ["tenant-a", "tenant-b"]);
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });
    membershipByEmail.set("ops-b@globex.com", { tenantId: "tenant-b", userId: "user-b" });
  });

  function seedTenantCandidate(tenantId: string, nameHint: string) {
    const hash = structureHashFromText(`# shared ${tenantId}\n1. x`);
    const out = structureHashFromText(`# out ${tenantId}\n- y`);
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId: SHARED,
        tenantId,
        operatorUserId: tenantId === "tenant-a" ? "user-a" : "user-b",
        runId: `shared-${tenantId}-${i}`,
        taskId: `task-${tenantId}-${i}`,
        inputStructureHash: hash,
        outputStructureHash: out,
        success: true,
        suggestedNameHint: nameHint,
      });
    }
    return listPatternCandidates({ agentId: SHARED, tenantId })[0];
  }

  it("list only returns candidates for the caller's membership tenant", async () => {
    const candA = seedTenantCandidate("tenant-a", "Skill A");
    const candB = seedTenantCandidate("tenant-b", "Skill B");
    expect(candA.tenantId).toBe("tenant-a");
    expect(candB.tenantId).toBe("tenant-b");

    const listA = await new Promise<{ ok: boolean; payload?: unknown }>((resolve) => {
      void patternDetectionHandlers["pattern-detection.list-candidates"]({
        params: { agentId: SHARED },
        respond: (ok: boolean, payload: unknown) => resolve({ ok, payload }),
        client: membershipClient("ops-a@acme.com"),
        context: {} as never,
        req: { type: "req", id: "t", method: "pattern-detection.list-candidates" } as never,
      } as never);
    });
    expect(listA.ok).toBe(true);
    const idsA = (
      listA.payload as { candidates: Array<{ candidateId: string; tenantId: string }> }
    ).candidates.map((c) => c.candidateId);
    expect(idsA).toContain(candA.candidateId);
    expect(idsA).not.toContain(candB.candidateId);

    const listB = await new Promise<{ ok: boolean; payload?: unknown }>((resolve) => {
      void patternDetectionHandlers["pattern-detection.list-candidates"]({
        params: { agentId: SHARED },
        respond: (ok: boolean, payload: unknown) => resolve({ ok, payload }),
        client: membershipClient("ops-b@globex.com"),
        context: {} as never,
        req: { type: "req", id: "t", method: "pattern-detection.list-candidates" } as never,
      } as never);
    });
    const idsB = (listB.payload as { candidates: Array<{ candidateId: string }> }).candidates.map(
      (c) => c.candidateId,
    );
    expect(idsB).toContain(candB.candidateId);
    expect(idsB).not.toContain(candA.candidateId);
  });

  it("approve/reject/get deny cross-tenant candidate on shared agent", async () => {
    const candB = seedTenantCandidate("tenant-b", "Skill B only");
    approvePatternCandidate(candB.candidateId, {
      approvedBy: "seed",
      autoInstallIntent: false,
    });

    const getDenied = await new Promise<{ ok: boolean }>((resolve) => {
      void patternDetectionHandlers["pattern-detection.get-candidate"]({
        params: { candidateId: candB.candidateId, agentId: SHARED },
        respond: (ok: boolean) => resolve({ ok }),
        client: membershipClient("ops-a@acme.com"),
        context: {} as never,
        req: { type: "req", id: "t", method: "pattern-detection.get-candidate" } as never,
      } as never);
    });
    expect(getDenied.ok).toBe(false);

    const rejectDenied = await new Promise<{ ok: boolean }>((resolve) => {
      void patternDetectionHandlers["pattern-detection.reject"]({
        params: { candidateId: candB.candidateId, agentId: SHARED },
        respond: (ok: boolean) => resolve({ ok }),
        client: membershipClient("ops-a@acme.com"),
        context: {} as never,
        req: { type: "req", id: "t", method: "pattern-detection.reject" } as never,
      } as never);
    });
    expect(rejectDenied.ok).toBe(false);
  });
});

describe("pattern-detection approve principal", () => {
  beforeEach(() => {
    resetPatternDetectionStoreForTests();
    membershipByEmail.clear();
    agentOwners.clear();
    membershipByEmail.set("auth-user-bob@acme.com", {
      tenantId: "tenant-a",
      userId: "user-a",
    });
    agentOwners.set("agent-a", ["tenant-a"]);
  });

  it("ignores client-supplied approvedBy and uses auth principal", async () => {
    const hash = structureHashFromText("# appr\n1");
    const out = structureHashFromText("# o\n-");
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId: "agent-a",
        tenantId: "tenant-a",
        operatorUserId: "user-a",
        runId: `appr-run-${i}`,
        taskId: `appr-task-${i}`,
        inputStructureHash: hash,
        outputStructureHash: out,
        success: true,
      });
    }
    const candidate = listPatternCandidates({ agentId: "agent-a" })[0];
    const client = {
      user: "auth-user-bob@acme.com",
      sessionDomain: "enterprise" as const,
      connect: { clientId: "c1" },
      connId: "conn-bob",
    };
    const res = await new Promise<{ ok: boolean; payload?: unknown }>((resolve) => {
      void patternDetectionHandlers["pattern-detection.approve"]({
        params: {
          candidateId: candidate.candidateId,
          agentId: "agent-a",
          approvedBy: "forged-approver",
        },
        respond: (ok: boolean, payload: unknown) => resolve({ ok, payload }),
        client,
        context: {} as never,
        req: { type: "req", id: "t", method: "pattern-detection.approve" } as never,
      } as never);
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { candidate: { approvedBy?: string } };
    expect(payload.candidate.approvedBy).toBe("auth-user-bob@acme.com");
    expect(payload.candidate.approvedBy).not.toBe("forged-approver");
  });
});

describe("evolution-runtime-closure RPC chain", () => {
  function invokePattern(method: string, params: Record<string, unknown>, client: unknown = null) {
    return new Promise<{ ok: boolean; payload?: unknown; error?: unknown }>((resolve) => {
      const handler = patternDetectionHandlers[method];
      if (!handler) {
        resolve({ ok: false, error: "missing handler" });
        return;
      }
      void handler({
        params,
        respond: (ok: boolean, payload: unknown, error: unknown) => resolve({ ok, payload, error }),
        client,
        context: {} as never,
        req: { type: "req", id: "t", method } as never,
      } as never);
    });
  }

  beforeEach(() => {
    resetPatternDetectionStoreForTests();
    membershipByEmail.clear();
    agentOwners.clear();
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });
    agentOwners.set("agent-a", ["tenant-a"]);
  });

  it("ingest-sample RPC forwards toolsUsed into candidate contract", async () => {
    const inHash = structureHashFromText("# rpc tools\n1");
    const outHash = structureHashFromText("# out\n-");
    for (let i = 1; i <= 3; i += 1) {
      const res = await invokePattern(
        "pattern-detection.ingest-sample",
        {
          agentId: "agent-a",
          runId: `tools-run-${i}`,
          taskId: `tools-task-${i}`,
          inputStructureHash: inHash,
          outputStructureHash: outHash,
          toolsUsed: ["notes", "read"],
          success: true,
        },
        membershipClient("ops-a@acme.com"),
      );
      expect(res.ok).toBe(true);
    }
    const candidate = listPatternCandidates({ agentId: "agent-a", tenantId: "tenant-a" })[0];
    expect(candidate.contract.toolsRequired).toEqual(expect.arrayContaining(["notes", "read"]));
  });

  it("backfills legacy null tenantId from linked samples on read", () => {
    const samplesPath = path.join(tmpDir, "pattern-detection", "samples.json");
    const candidatesPath = path.join(tmpDir, "pattern-detection", "candidates.json");
    fs.mkdirSync(path.dirname(samplesPath), { recursive: true });
    fs.writeFileSync(
      samplesPath,
      JSON.stringify([
        {
          sampleId: "ps_legacy1",
          agentId: "agent-a",
          tenantId: "tenant-a",
          operatorUserId: "user-a",
          runId: "legacy-run-1",
          taskId: "legacy-task-1",
          sessionKey: null,
          recordedAt: Date.now(),
          inputStructureHash: "in-legacy",
          outputStructureHash: "out-legacy",
          toolTraceHash: null,
          toolsUsed: null,
          success: true,
          humanEdited: null,
        },
      ]),
    );
    fs.writeFileSync(
      candidatesPath,
      JSON.stringify([
        {
          candidateId: "pc_legacy",
          agentId: "agent-a",
          tenantId: null,
          operatorUserId: "user-a",
          status: "candidate",
          sampleCount: 1,
          independentTaskCount: 1,
          independentRunIds: ["legacy-run-1"],
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          overallConfidence: 0.8,
          suggestedName: "Legacy",
          suggestedSummary: "Legacy candidate",
          sampleIds: ["ps_legacy1"],
          lineage: { evidenceKind: "server-pattern-samples", structureKey: "legacy-key" },
          contract: {
            inputDescription: "in",
            outputDescription: "out",
            toolsRequired: [],
            dependencies: [],
            riskLevel: "medium",
            requiresHumanApproval: true,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]),
    );

    const listed = listPatternCandidates({ agentId: "agent-a", tenantId: "tenant-a" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.tenantId).toBe("tenant-a");
    expect(getPatternCandidate("pc_legacy")?.tenantId).toBe("tenant-a");
  });

  it("apply-limit and apply-redirect mutate governance snapshot via RPC", async () => {
    const limit = await invoke(
      "evolution-governance.apply-limit",
      {
        runtimeAgentId: "agent-a",
        reason: "rpc-chain-limit",
      },
      membershipClient("ops-a@acme.com"),
    );
    expect(limit.ok).toBe(true);

    const redirect = await invoke(
      "evolution-governance.apply-redirect",
      {
        runtimeAgentId: "agent-a",
        targetAgentId: "agent-b",
        reason: "rpc-chain-redirect",
      },
      membershipClient("ops-a@acme.com"),
    );
    expect(redirect.ok).toBe(false);

    agentOwners.set("agent-b", ["tenant-a"]);
    const redirectOk = await invoke(
      "evolution-governance.apply-redirect",
      {
        runtimeAgentId: "agent-a",
        targetAgentId: "agent-b",
        reason: "rpc-chain-redirect",
      },
      membershipClient("ops-a@acme.com"),
    );
    expect(redirectOk.ok).toBe(true);

    const snapshot = await invoke(
      "evolution-governance.snapshot",
      {},
      membershipClient("ops-a@acme.com"),
    );
    expect(snapshot.ok).toBe(true);
    const payload = snapshot.payload as {
      limits?: Record<string, unknown>;
      redirects?: Record<string, { targetAgentId: string }>;
    };
    expect(payload.limits?.["agent-a"]).toBeTruthy();
    expect(payload.redirects?.["agent-a"]?.targetAgentId).toBe("agent-b");
  });
});
