import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRunModelSetSnapshot,
  buildSpawnGovernanceSnapshot,
  discardStagedSpawnGovernanceSnapshot,
  forgetChildModelSet,
  forgetRunModelSet,
  lookupChildModelSet,
  lookupRunModelAllowlist,
  lookupRunModelSet,
  rebindChildModelSet,
  rememberChildModelSet,
  stageChildRunGovernanceSnapshot,
  recordSubagentModelShadow,
  rememberRunModelSet,
  resetSpawnGovernanceSnapshotHandoffForTest,
  snapshotCreditReportingFromGate,
  snapshotForChildModelHandoff,
  stageSpawnGovernanceSnapshot,
  SubagentModelOutsideParentSetError,
  takeStagedSpawnGovernanceSnapshot,
} from "./spawn-snapshot-handoff.js";

const shadowEnv = { OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE: "shadow" };
const enforcedEnv = { OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE: "enforced" };

describe("spawn governance snapshot handoff", () => {
  it("stages and takes one snapshot per child idempotency key", () => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    const snapshot = buildSpawnGovernanceSnapshot({
      parentRunId: "parent-1",
      tenantId: "tenant-a",
      now: "2026-09-27T00:00:00.000Z",
      env: {},
    });
    expect(snapshot?.parentRunId).toBe("parent-1");
    stageSpawnGovernanceSnapshot("child-1", snapshot);
    expect(takeStagedSpawnGovernanceSnapshot("child-1")).toBe(snapshot);
    expect(takeStagedSpawnGovernanceSnapshot("child-1")).toBeUndefined();
  });

  it("does not stage without a parent run id", () => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    expect(buildSpawnGovernanceSnapshot({ tenantId: "tenant-a" })).toBeUndefined();
    stageSpawnGovernanceSnapshot("child-empty", undefined);
    expect(takeStagedSpawnGovernanceSnapshot("child-empty")).toBeUndefined();
  });

  it("discards a staged snapshot on the failure path", () => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    const snapshot = buildSpawnGovernanceSnapshot({ parentRunId: "parent-1", now: "t" });
    stageSpawnGovernanceSnapshot("child-fail", snapshot);
    discardStagedSpawnGovernanceSnapshot("child-fail");
    expect(takeStagedSpawnGovernanceSnapshot("child-fail")).toBeUndefined();
  });

  it("does not reject a missing snapshot, including when the mode is enforced", () => {
    const decision = recordSubagentModelShadow({
      isSubagentLane: true,
      provider: "openai",
      model: "gpt",
      env: enforcedEnv,
    });
    expect(decision).toMatchObject({
      effect: "skipped",
      mode: "enforced",
      reason: "missing-parent-snapshot",
    });
    expect(decision?.effect).not.toBe("allow");
  });

  it("records skipped, not allow, when the parent snapshot has no allowlist array", () => {
    const snapshot = buildSpawnGovernanceSnapshot({
      parentRunId: "parent-1",
      now: "t",
      env: shadowEnv,
    });
    expect(snapshot?.effectiveModelSet).toBeUndefined();
    const decision = recordSubagentModelShadow({
      isSubagentLane: true,
      snapshot,
      provider: "openai",
      model: "gpt",
      env: enforcedEnv,
    });
    expect(decision).toMatchObject({
      effect: "skipped",
      mode: "enforced",
      reason: "parent-model-set-absent",
    });
    expect(decision?.effect).not.toBe("allow");
  });

  it("shadow records deny for an empty parent allowlist and does not throw", () => {
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-1",
      allowlist: [],
      now: "t",
    });
    const decision = recordSubagentModelShadow({
      isSubagentLane: true,
      snapshot,
      provider: "openai",
      model: "gpt",
      env: shadowEnv,
    });
    expect(decision).toMatchObject({
      effect: "deny",
      mode: "shadow",
      reason: "outside-parent-model-set",
    });
  });

  it("enforced rejects an empty parent allowlist", () => {
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-1",
      allowlist: [],
      now: "t",
    });
    expect(() =>
      recordSubagentModelShadow({
        isSubagentLane: true,
        snapshot,
        provider: "openai",
        model: "gpt",
        env: enforcedEnv,
      }),
    ).toThrow(SubagentModelOutsideParentSetError);
  });

  it("records allow when the child model is inside the parent allowlist", () => {
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-1",
      allowlist: ["openai/gpt"],
      now: "t",
    });
    const decision = recordSubagentModelShadow({
      isSubagentLane: true,
      snapshot: snapshotForChildModelHandoff(snapshot),
      provider: "openai",
      model: "gpt",
      env: shadowEnv,
    });
    expect(decision).toMatchObject({ effect: "allow", mode: "shadow" });
    expect(decision?.reason).toBeUndefined();
    expect(decision?.parentRunId).toBe("parent-1");
  });

  it("matches modelKey exactly, the same way hard-deny does", () => {
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-1",
      allowlist: ["OpenAI/gpt"],
      now: "t",
    });
    const decision = recordSubagentModelShadow({
      isSubagentLane: true,
      snapshot,
      provider: "openai",
      model: "gpt",
      env: shadowEnv,
    });
    expect(decision?.effect).toBe("deny");
  });

  it("remembers a parent model set without deleting it on lookup", () => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    const source = ["openai/gpt"];
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-1",
      allowlist: source,
      governanceMode: "shadow",
      commercialAuthorizationId: "auth-1",
      tenantId: "tenant-a",
      actorId: "platform-user:user-1",
      now: "2026-09-28T00:00:00.000Z",
    });
    expect(snapshot?.snapshotId).toMatch(/^gd-/);
    expect(snapshot?.governanceMode).toBe("shadow");
    source.push("other/model");
    expect(snapshot?.effectiveModelSet?.allowlist).toEqual(["openai/gpt"]);
    expect(buildRunModelSetSnapshot({ runId: "parent-1" })).toBeUndefined();
    rememberRunModelSet("parent-1", snapshot!);
    expect(lookupRunModelSet("parent-1")).toBe(lookupRunModelSet("parent-1"));
    expect(lookupRunModelSet("parent-1")?.effectiveModelSet?.allowlist).toEqual(["openai/gpt"]);
    const child = snapshotForChildModelHandoff(lookupRunModelSet("parent-1"));
    expect(child?.parentRunId).toBe("parent-1");
    expect(child?.effectiveModelSet?.allowlist).toEqual(["openai/gpt"]);
    expect(lookupRunModelAllowlist("parent-1")).toEqual(["openai/gpt"]);
    lookupRunModelAllowlist("parent-1")?.push("mutated/copy");
    expect(lookupRunModelSet("parent-1")?.effectiveModelSet?.allowlist).toEqual(["openai/gpt"]);
    forgetRunModelSet("parent-1");
    expect(lookupRunModelSet("parent-1")).toBeUndefined();
    expect(lookupRunModelAllowlist("missing")).toBeUndefined();
  });

  it("steer takes the same allowlist when the child run is mounted, and stages nothing otherwise", () => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-1",
      allowlist: ["openai/gpt"],
      now: "t",
    });
    const child = snapshotForChildModelHandoff(snapshot);
    expect(child).toBeDefined();
    rememberChildModelSet("child-run", child!);
    expect(
      stageChildRunGovernanceSnapshot("steer-1", "child-run")?.effectiveModelSet?.allowlist,
    ).toEqual(["openai/gpt"]);
    expect(takeStagedSpawnGovernanceSnapshot("steer-1")?.effectiveModelSet?.allowlist).toEqual([
      "openai/gpt",
    ]);

    resetSpawnGovernanceSnapshotHandoffForTest();
    expect(stageChildRunGovernanceSnapshot("steer-missing", "child-run")).toBeUndefined();
    expect(takeStagedSpawnGovernanceSnapshot("steer-missing")).toBeUndefined();
  });

  it("rebinds the child snapshot when steer replaces the run id", () => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-1",
      allowlist: ["anthropic/claude"],
      now: "t",
    });
    rememberChildModelSet("old-run", snapshotForChildModelHandoff(snapshot)!);
    rebindChildModelSet("old-run", "new-run");
    expect(lookupChildModelSet("old-run")).toBeUndefined();
    expect(lookupChildModelSet("new-run")?.effectiveModelSet?.allowlist).toEqual([
      "anthropic/claude",
    ]);
  });

  it("clears a child snapshot when that run ends, and keeps a rebound run", () => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-1",
      allowlist: ["openai/gpt"],
      now: "t",
    });
    rememberChildModelSet("child-run", snapshotForChildModelHandoff(snapshot)!);
    forgetChildModelSet("child-run");
    expect(lookupChildModelSet("child-run")).toBeUndefined();

    rememberChildModelSet("old-run", snapshotForChildModelHandoff(snapshot)!);
    rebindChildModelSet("old-run", "new-run");
    forgetChildModelSet("old-run");
    expect(lookupChildModelSet("new-run")?.effectiveModelSet?.allowlist).toEqual(["openai/gpt"]);
    forgetChildModelSet("new-run");
    expect(lookupChildModelSet("new-run")).toBeUndefined();

    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const registry = fs.readFileSync(path.join(root, "agents/subagent-registry.ts"), "utf8");
    const complete = registry.slice(
      registry.indexOf("async function completeSubagentRun"),
      registry.indexOf("function startSubagentAnnounceCleanupFlow"),
    );
    const steerGuard = complete.indexOf("if (suppressedForSteerRestart)");
    const startCleanup = complete.indexOf("startSubagentAnnounceCleanupFlow");
    expect(steerGuard).toBeGreaterThan(-1);
    expect(startCleanup).toBeGreaterThan(steerGuard);
    expect(complete).not.toContain("forgetChildModelSet");

    const cleanup = registry.slice(
      registry.indexOf("function startSubagentAnnounceCleanupFlow"),
      registry.indexOf("function resumeSubagentRun"),
    );
    expect(cleanup.indexOf("forgetChildModelSet")).toBeGreaterThan(-1);
    expect(cleanup.indexOf("forgetChildModelSet")).toBeLessThan(
      cleanup.indexOf("beginSubagentCleanup"),
    );
    expect(
      registry.slice(
        registry.indexOf("export function releaseSubagentRun"),
        registry.indexOf("function findRunIdsByChildSessionKey"),
      ),
    ).toContain("forgetChildModelSet");
    expect(registry.slice(registry.indexOf("export function markSubagentRunTerminated"))).toContain(
      "forgetChildModelSet",
    );
    expect(
      registry.slice(
        registry.indexOf("function reconcileOrphanedRun"),
        registry.indexOf("function reconcileOrphanedRestoredRuns"),
      ),
    ).toContain("forgetChildModelSet");

    const spawn = fs.readFileSync(path.join(root, "agents/subagent-spawn.ts"), "utf8");
    const registrationFailure = spawn.slice(
      spawn.indexOf("registerSubagentRun({"),
      spawn.indexOf("Failed to register subagent run"),
    );
    expect(registrationFailure).toContain("forgetChildModelSet");
  });

  it("spawn looks up the parent set and does not build an empty snapshot", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../agents/subagent-spawn.ts"),
      "utf8",
    );
    expect(source).toContain("lookupRunModelSet");
    expect(source).toContain("snapshotForChildModelHandoff");
    expect(source).toContain("rememberChildModelSet");
    expect(source).not.toContain("buildSpawnGovernanceSnapshot");
    const control = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../agents/subagent-control.ts"),
      "utf8",
    );
    expect(control).toContain("stageChildRunGovernanceSnapshot");
    expect(control).not.toContain("stageSpawnGovernanceSnapshot(idempotencyKey, undefined)");
  });

  it("image and pdf tools look up the parent allowlist by run id", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const image = fs.readFileSync(path.join(root, "agents/tools/image-tool.ts"), "utf8");
    const pdf = fs.readFileSync(path.join(root, "agents/tools/pdf-tool.ts"), "utf8");
    const tools = fs.readFileSync(path.join(root, "agents/openclaw-tools.ts"), "utf8");
    expect(image).toContain("lookupRunModelAllowlist");
    expect(pdf).toContain("lookupRunModelAllowlist");
    expect(tools).toContain("agentRunId: options?.agentRunId");
  });

  it("shadow does not reject a model outside the parent set", () => {
    const snapshot = buildSpawnGovernanceSnapshot({
      parentRunId: "parent-1",
      effectiveModelSet: { allowlist: ["anthropic/claude"] },
      now: "t",
      env: { OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE: "shadow" },
    });
    expect(() =>
      recordSubagentModelShadow({
        isSubagentLane: true,
        snapshot,
        provider: "openai",
        model: "gpt",
        env: { OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE: "shadow" },
      }),
    ).not.toThrow();
  });

  it("enforced rejects a model outside the parent set", () => {
    const snapshot = buildSpawnGovernanceSnapshot({
      parentRunId: "parent-1",
      effectiveModelSet: { allowlist: ["anthropic/claude"] },
      now: "t",
    });
    expect(() =>
      recordSubagentModelShadow({
        isSubagentLane: true,
        snapshot,
        provider: "openai",
        model: "gpt",
        env: { OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE: "enforced" },
      }),
    ).toThrow(SubagentModelOutsideParentSetError);
  });

  it("stamps entry E6 (not E6a / E6b / E6c) on every subagent model row", () => {
    const snapshot = buildSpawnGovernanceSnapshot({
      parentRunId: "parent-1",
      effectiveModelSet: { allowlist: ["anthropic/claude"] },
      now: "t",
    });
    const rows = [
      recordSubagentModelShadow({
        isSubagentLane: true,
        provider: "openai",
        model: "gpt",
        env: shadowEnv,
      }),
      recordSubagentModelShadow({
        isSubagentLane: true,
        snapshot,
        provider: "anthropic",
        model: "claude",
        env: shadowEnv,
      }),
      recordSubagentModelShadow({
        isSubagentLane: true,
        snapshot,
        provider: "openai",
        model: "gpt",
        env: shadowEnv,
      }),
      recordSubagentModelShadow({
        isSubagentLane: true,
        snapshot,
        provider: "openai",
        model: "gpt",
        env: { OPENBOT_GOVERNANCE_SUBAGENT_MODEL_MODE: "legacy" },
      }),
    ];
    expect(rows.map((row) => [row?.reason ?? "(allow)", row?.entry])).toEqual([
      ["missing-parent-snapshot", "E6"],
      ["(allow)", "E6"],
      ["outside-parent-model-set", "E6"],
      ["legacy", "E6"],
    ]);
  });
});

describe("parent billing context on the run snapshot (P4-1)", () => {
  const acquiredGate = {
    subscriptionId: "sub-1",
    subscriptionSnapshotId: "sub-snap-1",
    planId: "plan-1",
    planVersionId: "pv-1",
    modelGate: { creditReporting: { enterpriseId: "tenant-a", policyId: "policy-1" } },
  };

  it("copies enterprise / policy from creditReporting and the gate's subscription ids", () => {
    expect(snapshotCreditReportingFromGate(acquiredGate)).toEqual({
      enterpriseId: "tenant-a",
      policyId: "policy-1",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "sub-snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
    });
  });

  it("carries subscription ids only when the gate has them", () => {
    expect(
      snapshotCreditReportingFromGate({
        planVersionId: " pv-2 ",
        subscriptionId: "  ",
        modelGate: { creditReporting: { enterpriseId: "tenant-a", policyId: "policy-1" } },
      }),
    ).toEqual({ enterpriseId: "tenant-a", policyId: "policy-1", planVersionId: "pv-2" });
  });

  it("invents nothing without creditReporting, even when subscription ids exist", () => {
    expect(snapshotCreditReportingFromGate({ subscriptionId: "sub-1", planId: "plan-1" })).toBe(
      undefined,
    );
    expect(snapshotCreditReportingFromGate({ modelGate: {} })).toBe(undefined);
    expect(snapshotCreditReportingFromGate(undefined)).toBe(undefined);
  });

  it("the parent snapshot keeps it and the child handoff copies it with the parent id", () => {
    const parent = buildRunModelSetSnapshot({
      runId: "parent-run",
      allowlist: ["openai/gpt-5.2"],
      commercialAuthorizationId: "auth-parent-1",
      creditReporting: snapshotCreditReportingFromGate(acquiredGate),
      now: "2026-09-28T00:00:00.000Z",
    });
    expect(parent?.creditReporting).toMatchObject({
      enterpriseId: "tenant-a",
      policyId: "policy-1",
    });
    const child = snapshotForChildModelHandoff(parent);
    expect(child).toMatchObject({
      parentRunId: "parent-run",
      commercialAuthorizationId: "auth-parent-1",
      creditReporting: {
        enterpriseId: "tenant-a",
        policyId: "policy-1",
        subscriptionId: "sub-1",
        planVersionId: "pv-1",
      },
    });
    expect(child?.creditReporting).not.toBe(parent?.creditReporting);
  });

  it("a parent without billing context hands none to the child", () => {
    const parent = buildRunModelSetSnapshot({
      runId: "parent-run",
      allowlist: ["openai/gpt-5.2"],
      commercialAuthorizationId: "auth-parent-1",
      now: "2026-09-28T00:00:00.000Z",
    });
    expect(parent).not.toHaveProperty("creditReporting");
    expect(snapshotForChildModelHandoff(parent)).not.toHaveProperty("creditReporting");
  });
});
