// @vitest-environment node
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceDecision } from "../gateway/governance/decision.js";

const { appendMock } = vi.hoisted(() => ({ appendMock: vi.fn() }));
vi.mock("../gateway/governance/shadow-sink.js", () => ({
  appendGovernanceShadowDecision: appendMock,
}));

const { runWithModelFallback, runWithImageModelFallback, ModelEntitlementEmptyError } =
  await import("./model-fallback.js");
const { EMBEDDED_MODEL_MODE_ENV, resolveEmbeddedModelGovernance } =
  await import("./embedded-model-governance.js");
const { makeModelFallbackCfg } = await import("./test-helpers/model-fallback-config-fixture.js");
const {
  buildRunModelSetSnapshot,
  lookupRunModelSet,
  recordSubagentModelShadow,
  rememberRunModelSet,
  resetSpawnGovernanceSnapshotHandoffForTest,
  snapshotForChildModelHandoff,
  stageSpawnGovernanceSnapshot,
  takeStagedSpawnGovernanceSnapshot,
} = await import("../gateway/governance/spawn-snapshot-handoff.js");

// Candidates from the fixture: primary openai/gpt-4.1-mini, fallback anthropic/claude-haiku-3-5.
const PRIMARY = "openai/gpt-4.1-mini";
const FALLBACK = "anthropic/claude-haiku-3-5";

function makeRun() {
  return vi.fn(async (provider: string, model: string) => {
    if (provider === "openai") {
      throw Object.assign(new Error("rate-limited"), { status: 429 });
    }
    return `ok:${provider}/${model}`;
  });
}

function calledKeys(run: ReturnType<typeof makeRun>): string[] {
  return run.mock.calls.map(([provider, model]) => `${provider}/${model}`);
}

function recordedDecisions(): GovernanceDecision[] {
  return appendMock.mock.calls.map(([decision]) => decision as GovernanceDecision);
}

describe("runWithModelFallback governanceMode", () => {
  let agentDir: string;

  beforeEach(async () => {
    appendMock.mockReset();
    appendMock.mockResolvedValue(true);
    agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-gov-mf-"));
  });

  afterEach(async () => {
    await fs.rm(agentDir, { recursive: true, force: true });
  });

  async function runWith(extra: Record<string, unknown>) {
    const run = makeRun();
    const result = await runWithModelFallback({
      cfg: makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-1",
      agentDir,
      run,
      ...extra,
    });
    return { run, result };
  }

  it("baseline (no mode, no allowlist) tries primary then fallback", async () => {
    const { run, result } = await runWith({});
    expect(calledKeys(run)).toEqual([PRIMARY, FALLBACK]);
    expect(result.result).toBe(`ok:${FALLBACK}`);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("undefined mode keeps today's allowlist hard-filter and records nothing", async () => {
    const { run } = await runWith({ entitlementAllowlist: [FALLBACK] });
    expect(calledKeys(run)).toEqual([FALLBACK]);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("legacy never filters and records skipped + legacy", async () => {
    const { run } = await runWith({ governanceMode: "legacy", entitlementAllowlist: [] });
    expect(calledKeys(run)).toEqual([PRIMARY, FALLBACK]);
    expect(recordedDecisions()).toEqual([
      expect.objectContaining({
        source: "model-entitlement",
        effect: "skipped",
        mode: "legacy",
        runId: "run-1",
      }),
    ]);
  });

  it("legacy on an enterprise-scoped run is marked as configured, not no-scope", async () => {
    await runWith({
      governanceMode: "legacy",
      entitlementAllowlist: [],
      governanceContext: { commercialAuthorizationId: "auth-7" },
    });
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "skipped",
      mode: "legacy",
      reason: "legacy-by-configuration",
      commercialAuthorizationId: "auth-7",
    });
  });

  it("shadow with an empty-after-filter allowlist records would-deny without filtering", async () => {
    const baseline = await runWith({});
    appendMock.mockClear();
    const { run, result } = await runWith({
      governanceMode: "shadow",
      entitlementAllowlist: ["other/not-configured"],
      governanceContext: { tenantId: "tenant-a", commercialAuthorizationId: "auth-1" },
    });
    expect(calledKeys(run)).toEqual(calledKeys(baseline.run));
    expect(result.result).toBe(baseline.result.result);
    const [decision] = recordedDecisions();
    expect(decision).toMatchObject({
      source: "model-entitlement",
      mode: "shadow",
      effect: "deny",
      reason: "entitlement-empty",
      tenantId: "tenant-a",
      commercialAuthorizationId: "auth-1",
      subject: { kind: "model", id: PRIMARY },
      shadow: { existing: { effect: "allow" }, divergence: "D1" },
    });
    expect(decision?.decisionId).toMatch(/^gd-/);
    expect(decision?.decisionId).not.toBe("auth-1");
  });

  it("shadow with a partial allowlist records allow and keeps every candidate", async () => {
    const { run } = await runWith({ governanceMode: "shadow", entitlementAllowlist: [FALLBACK] });
    expect(calledKeys(run)).toEqual([PRIMARY, FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "allow",
      mode: "shadow",
      reason: "primary-outside-allowlist",
      matchedRules: [`outside-allowlist:${PRIMARY}`],
      shadow: { divergence: "D0" },
    });
  });

  it("shadow without an allowlist records an enterprise-scope skipped (not allow)", async () => {
    const { run } = await runWith({ governanceMode: "shadow" });
    expect(calledKeys(run)).toEqual([PRIMARY, FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "skipped",
      mode: "shadow",
      reason: "enterprise-scope-without-allowlist",
    });
  });

  it("enforced filters to the allowlist", async () => {
    const { run } = await runWith({ governanceMode: "enforced", entitlementAllowlist: [FALLBACK] });
    expect(calledKeys(run)).toEqual([FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({ effect: "allow", mode: "enforced" });
  });

  it("enforced with nothing authorized yields the existing empty-set error", async () => {
    const run = makeRun();
    await expect(
      runWithModelFallback({
        cfg: makeModelFallbackCfg(),
        provider: "openai",
        model: "gpt-4.1-mini",
        agentDir,
        governanceMode: "enforced",
        entitlementAllowlist: [],
        run,
      }),
    ).rejects.toBeInstanceOf(ModelEntitlementEmptyError);
    expect(run).not.toHaveBeenCalled();
    expect(recordedDecisions()[0]).toMatchObject({ effect: "deny", mode: "enforced" });
  });

  it("a failing shadow sink never changes the run", async () => {
    appendMock.mockRejectedValue(new Error("disk full"));
    const { run, result } = await runWith({
      governanceMode: "shadow",
      entitlementAllowlist: [],
    });
    expect(calledKeys(run)).toEqual([PRIMARY, FALLBACK]);
    expect(result.result).toBe(`ok:${FALLBACK}`);
  });

  it("tags a filtered CLI-backend primary as cli-backend-model (D4) without changing candidates", async () => {
    const cfg = makeModelFallbackCfg({
      agents: {
        defaults: { model: { primary: "claude-cli/opus", fallbacks: [FALLBACK] } },
      },
    });
    const run = vi.fn(async (provider: string, model: string) => {
      if (provider === "claude-cli") {
        throw Object.assign(new Error("rate-limited"), { status: 429 });
      }
      return `ok:${provider}/${model}`;
    });
    await runWithModelFallback({
      cfg,
      provider: "claude-cli",
      model: "opus",
      runId: "run-cli",
      agentDir,
      governanceMode: "shadow",
      entitlementAllowlist: [FALLBACK],
      run,
    });
    expect(calledKeys(run as never)).toEqual(["claude-cli/opus", FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "allow",
      mode: "shadow",
      reason: "cli-backend-model",
      matchedRules: ["cli-backend-model", "cli-backend-model:claude-cli/opus"],
      shadow: { divergence: "D4" },
    });
  });

  it("a configured cliBackends provider is tagged too; catalog models keep outside-allowlist", async () => {
    const cfg = makeModelFallbackCfg({
      agents: {
        defaults: {
          model: { primary: "openai/gpt-4.1-mini", fallbacks: ["my-cli/fast"] },
          cliBackends: { "my-cli": { command: "my-cli" } },
        },
      },
    } as never);
    const run = vi.fn(async (provider: string, model: string) => `ok:${provider}/${model}`);
    await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir,
      governanceMode: "shadow",
      entitlementAllowlist: [],
      run,
    });
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "deny",
      reason: "entitlement-empty",
      matchedRules: [
        "cli-backend-model",
        `outside-allowlist:${PRIMARY}`,
        "cli-backend-model:my-cli/fast",
      ],
      shadow: { divergence: "D1" },
    });
  });

  it("a looked-up parent allowlist records shadow deny without changing fallback candidates", async () => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-1",
      allowlist: ["other/not-configured"],
      governanceMode: "shadow",
      now: "t",
    });
    expect(snapshot).toBeDefined();
    rememberRunModelSet("parent-1", snapshot!);
    const lookedUp = lookupRunModelSet("parent-1");
    expect(lookupRunModelSet("parent-1")).toBe(lookedUp);
    const child = snapshotForChildModelHandoff(lookedUp);
    expect(child?.parentRunId).toBe("parent-1");
    stageSpawnGovernanceSnapshot("child-1", child);
    const taken = takeStagedSpawnGovernanceSnapshot("child-1");
    const decision = recordSubagentModelShadow({
      isSubagentLane: true,
      snapshot: taken,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "child-1",
      env: { OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE: "shadow" },
    });
    expect(decision).toMatchObject({
      effect: "deny",
      mode: "shadow",
      reason: "outside-parent-model-set",
      parentRunId: "parent-1",
    });

    const baseline = await runWith({});
    const { run } = await runWith({});
    expect(calledKeys(run)).toEqual(calledKeys(baseline.run));
    expect(calledKeys(run)).toEqual([PRIMARY, FALLBACK]);
  });

  it("image shadow without a parent allowlist records skipped, not allow", async () => {
    const run = vi.fn(async () => "image-ok");
    const result = await runWithImageModelFallback({
      cfg: makeModelFallbackCfg(),
      modelOverride: "openai/gpt-image-1",
      governanceMode: "shadow",
      run,
    });
    expect(result.result).toBe("image-ok");
    expect(run).toHaveBeenCalledWith("openai", "gpt-image-1");
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "skipped",
      mode: "shadow",
      reason: "parent-model-set-absent",
    });
    expect(recordedDecisions()[0]?.effect).not.toBe("allow");
  });

  it("image shadow with an empty parent allowlist records deny and still runs", async () => {
    const run = vi.fn(async () => "image-ok");
    const result = await runWithImageModelFallback({
      cfg: makeModelFallbackCfg(),
      modelOverride: "openai/gpt-image-1",
      governanceMode: "shadow",
      entitlementAllowlist: [],
      run,
    });
    expect(result.result).toBe("image-ok");
    expect(run).toHaveBeenCalledWith("openai", "gpt-image-1");
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "deny",
      mode: "shadow",
    });
  });

  it("image / PDF fallback rows carry entry E10 in every mode", async () => {
    const run = vi.fn(async () => "image-ok");
    const base = { cfg: makeModelFallbackCfg(), modelOverride: "openai/gpt-image-1", run };
    await runWithImageModelFallback({ ...base, governanceMode: "shadow" });
    await runWithImageModelFallback({
      ...base,
      governanceMode: "shadow",
      entitlementAllowlist: ["openai/gpt-image-1"],
    });
    await runWithImageModelFallback({
      ...base,
      governanceMode: "enforced",
      entitlementAllowlist: ["openai/gpt-image-1"],
    });
    await runWithImageModelFallback({ ...base, governanceMode: "legacy" });
    expect(recordedDecisions().map((d) => [d.mode, d.reason, d.entry])).toEqual([
      ["shadow", "parent-model-set-absent", "E10"],
      ["shadow", "within-allowlist", "E10"],
      ["enforced", "within-allowlist", "E10"],
      ["legacy", "no-enterprise-scope", "E10"],
    ]);
  });

  // Regression: production E10 rows arrived with tenantId and runId null, so an
  // image/pdf decision could not be attributed to the tenant or run that caused
  // it. The callers now pass runId + governanceContext.
  it("image / PDF fallback stamps tenant, actor and run attribution when the caller provides it", async () => {
    const run = vi.fn(async () => "image-ok");
    await runWithImageModelFallback({
      cfg: makeModelFallbackCfg(),
      modelOverride: "openai/gpt-image-1",
      run,
      governanceMode: "shadow",
      entitlementAllowlist: ["openai/gpt-image-1"],
      runId: "run-pdf-1",
      governanceContext: { tenantId: "001", actorId: "platform-user:emp-1" },
    });
    expect(recordedDecisions()[0]).toMatchObject({
      entry: "E10",
      mode: "shadow",
      runId: "run-pdf-1",
      tenantId: "001",
      actorId: "platform-user:emp-1",
    });
  });

  it("text fallback stamps no entry unless the caller's context carries one", async () => {
    await runWith({ governanceMode: "shadow", entitlementAllowlist: [PRIMARY, FALLBACK] });
    await runWith({
      governanceMode: "shadow",
      entitlementAllowlist: [PRIMARY, FALLBACK],
      governanceContext: { tenantId: "tenant-a", entry: "E2" },
    });
    const [unstamped, stamped] = recordedDecisions();
    expect(unstamped).not.toHaveProperty("entry");
    expect(stamped).toMatchObject({ source: "model-entitlement", entry: "E2" });
  });

  it("the shadow path does not use management audit or the security profile", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    for (const file of [path.join(dir, "model-fallback-governance.ts")]) {
      const code = readFileSync(file, "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "");
      expect(code).not.toMatch(/auditManagementDecision|authorizeAgentInvocation/);
      expect(code).not.toMatch(/resolveSecurityProfile/);
    }
  });
});

describe("runWithModelFallback allowlistEnforcement (P3-1)", () => {
  let agentDir: string;

  beforeEach(async () => {
    appendMock.mockReset();
    appendMock.mockResolvedValue(true);
    agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-gov-mf-pre-"));
  });

  afterEach(async () => {
    await fs.rm(agentDir, { recursive: true, force: true });
  });

  async function runWith(extra: Record<string, unknown>) {
    const run = makeRun();
    const result = await runWithModelFallback({
      cfg: makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-pre",
      agentDir,
      run,
      ...extra,
    });
    return { run, result };
  }

  it("preexisting + default shadow hard-filters like undefined mode; envelope deny + D0 when empty", async () => {
    const baseline = makeRun();
    await expect(
      runWithModelFallback({
        cfg: makeModelFallbackCfg(),
        provider: "openai",
        model: "gpt-4.1-mini",
        agentDir,
        entitlementAllowlist: ["other/not-configured"],
        run: baseline,
      }),
    ).rejects.toBeInstanceOf(ModelEntitlementEmptyError);
    expect(baseline).not.toHaveBeenCalled();
    appendMock.mockClear();

    const run = makeRun();
    await expect(
      runWithModelFallback({
        cfg: makeModelFallbackCfg(),
        provider: "openai",
        model: "gpt-4.1-mini",
        runId: "run-pre",
        agentDir,
        governanceMode: "shadow",
        allowlistEnforcement: "preexisting",
        entitlementAllowlist: ["other/not-configured"],
        run,
      }),
    ).rejects.toBeInstanceOf(ModelEntitlementEmptyError);
    expect(run).not.toHaveBeenCalled();
    const [decision] = recordedDecisions();
    expect(decision).toMatchObject({
      source: "model-entitlement",
      mode: "shadow",
      effect: "deny",
      reason: "entitlement-empty",
      shadow: {
        existing: { effect: "deny", source: "model-entitlement" },
        divergence: "D0",
      },
    });
    expect(decision?.shadow?.existing?.reason).not.toBe("not-enforced");
  });

  it("preexisting + partial allowlist matches pre-change hard filter and records D0", async () => {
    const legacyRun = makeRun();
    await runWithModelFallback({
      cfg: makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir,
      entitlementAllowlist: [FALLBACK],
      run: legacyRun,
    });
    const legacyKeys = calledKeys(legacyRun);
    appendMock.mockClear();

    const { run } = await runWith({
      governanceMode: "shadow",
      allowlistEnforcement: "preexisting",
      entitlementAllowlist: [FALLBACK],
    });
    expect(calledKeys(run)).toEqual(legacyKeys);
    expect(calledKeys(run)).toEqual([FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "allow",
      mode: "shadow",
      shadow: {
        existing: { effect: "allow" },
        divergence: "D0",
      },
    });
    expect(recordedDecisions()[0]?.shadow?.existing?.reason).not.toBe("not-enforced");
  });

  it("legacy without an allowlist: no filter, candidates unchanged, envelope skipped", async () => {
    const baseline = await runWith({});
    appendMock.mockClear();
    const { run } = await runWith({
      governanceMode: "legacy",
      allowlistEnforcement: "preexisting",
    });
    expect(calledKeys(run)).toEqual(calledKeys(baseline.run));
    expect(recordedDecisions()).toHaveLength(1);
    expect(recordedDecisions()[0]).toMatchObject({
      source: "model-entitlement",
      effect: "skipped",
      mode: "legacy",
    });
  });

  it("P3-2 rework: preexisting + legacy still hard-filters an allowlist without the current model", async () => {
    const preMigration = makeRun();
    await runWithModelFallback({
      cfg: makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir,
      entitlementAllowlist: [FALLBACK],
      run: preMigration,
    });
    appendMock.mockClear();

    const { run } = await runWith({
      governanceMode: "legacy",
      allowlistEnforcement: "preexisting",
      entitlementAllowlist: [FALLBACK],
      governanceContext: { tenantId: "tenant-a", commercialAuthorizationId: "auth-9" },
    });
    expect(calledKeys(run)).toEqual(calledKeys(preMigration));
    expect(calledKeys(run)).toEqual([FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({
      source: "model-entitlement",
      effect: "skipped",
      mode: "legacy",
      reason: "legacy-by-configuration",
    });
  });

  it("P3-2 rework: preexisting + legacy with nothing authorized yields the existing empty-set error", async () => {
    const run = makeRun();
    await expect(
      runWithModelFallback({
        cfg: makeModelFallbackCfg(),
        provider: "openai",
        model: "gpt-4.1-mini",
        runId: "run-pre",
        agentDir,
        governanceMode: "legacy",
        allowlistEnforcement: "preexisting",
        entitlementAllowlist: ["other/not-configured"],
        run,
      }),
    ).rejects.toBeInstanceOf(ModelEntitlementEmptyError);
    expect(run).not.toHaveBeenCalled();
    expect(recordedDecisions()[0]).toMatchObject({ effect: "skipped", mode: "legacy" });
  });

  it("P3-2 rework: OPENBOT_GOVERNANCE_EMBEDDED_MODEL_MODE=legacy on an acquired gate keeps the hard filter", async () => {
    const governance = resolveEmbeddedModelGovernance(
      { gateStatus: "acquired", allowlist: [FALLBACK], commercialAuthorizationId: "auth-9" },
      { [EMBEDDED_MODEL_MODE_ENV]: "legacy" },
    );
    expect(governance).toMatchObject({
      governanceMode: "legacy",
      allowlistEnforcement: "preexisting",
    });
    const { run } = await runWith({ ...governance });
    expect(calledKeys(run)).toEqual([FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({ effect: "skipped", mode: "legacy" });
  });

  it("enterprise scope without allowlist: skipped + enterprise-scope-without-allowlist, no filter", async () => {
    const baseline = await runWith({});
    appendMock.mockClear();
    const { run } = await runWith({
      governanceMode: "shadow",
      allowlistEnforcement: "preexisting",
      governanceContext: { tenantId: "tenant-a", commercialAuthorizationId: "auth-9" },
    });
    expect(calledKeys(run)).toEqual(calledKeys(baseline.run));
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "skipped",
      mode: "shadow",
      reason: "enterprise-scope-without-allowlist",
    });
  });

  it("governance-mode default still only records in shadow (no widen from preexisting)", async () => {
    const { run } = await runWith({
      governanceMode: "shadow",
      entitlementAllowlist: ["other/not-configured"],
    });
    expect(calledKeys(run)).toEqual([PRIMARY, FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "deny",
      shadow: { existing: { effect: "allow", reason: "not-enforced" }, divergence: "D1" },
    });
  });
});
