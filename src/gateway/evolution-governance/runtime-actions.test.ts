import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-gov-actions-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const runtime = await import("../agent-runtime-store.js");
const {
  applyGovernanceRuntimeAction,
  getAgentLimitRecord,
  getAgentRedirectRecord,
  getAgentPauseRecord,
} = await import("./runtime-actions.js");
const { setGovernanceKillSwitch } = await import("./index.js");

function seedAgent(id: string) {
  const now = Date.now();
  runtime.upsertAgent({
    runtimeAgentId: id,
    name: id,
    runtimeVersion: "1",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-a"],
    boundCapabilityCount: 1,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: now,
    lastActiveAt: now,
  });
}

describe("governance runtime snapshot restore", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    setGovernanceKillSwitch(false);
  });
  afterEach(() => {
    setGovernanceKillSwitch(false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pause/resume preserves pre-existing disabled bindings", () => {
    seedAgent("bot-pr");
    const keepDisabled = runtime.createBinding({
      runtimeAgentId: "bot-pr",
      capabilityId: "cap-manual-off",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 10,
      loadStrategy: "eager",
    });
    runtime.updateBindingState(keepDisabled.bindingId, "disabled");
    const active = runtime.createBinding({
      runtimeAgentId: "bot-pr",
      capabilityId: "cap-active",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 50,
      loadStrategy: "eager",
    });

    applyGovernanceRuntimeAction({ runtimeAgentId: "bot-pr", action: "pause" });
    expect(runtime.getBinding(keepDisabled.bindingId)?.bindingState).toBe("disabled");
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("disabled");
    expect(getAgentPauseRecord("bot-pr")?.disabledByThisAction).toContain(active.bindingId);
    expect(getAgentPauseRecord("bot-pr")?.disabledByThisAction).not.toContain(
      keepDisabled.bindingId,
    );

    applyGovernanceRuntimeAction({ runtimeAgentId: "bot-pr", action: "resume" });
    expect(runtime.getBinding(keepDisabled.bindingId)?.bindingState).toBe("disabled");
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("active");
  });

  it("limit/clear-limit restores original state not blanket active", () => {
    seedAgent("bot-lim");
    const degraded = runtime.createBinding({
      runtimeAgentId: "bot-lim",
      capabilityId: "cap-deg",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 40,
      loadStrategy: "eager",
    });
    runtime.updateBindingState(degraded.bindingId, "degraded");
    const active = runtime.createBinding({
      runtimeAgentId: "bot-lim",
      capabilityId: "cap-ok",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 80,
      loadStrategy: "eager",
    });
    const disabled = runtime.createBinding({
      runtimeAgentId: "bot-lim",
      capabilityId: "cap-off",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 20,
      loadStrategy: "eager",
    });
    runtime.updateBindingState(disabled.bindingId, "disabled");

    applyGovernanceRuntimeAction({ runtimeAgentId: "bot-lim", action: "limit" });
    expect(getAgentLimitRecord("bot-lim")?.changedBindingIds).not.toContain(disabled.bindingId);
    expect(runtime.getBinding(disabled.bindingId)?.bindingState).toBe("disabled");
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("degraded");

    applyGovernanceRuntimeAction({ runtimeAgentId: "bot-lim", action: "clear_limit" });
    expect(runtime.getBinding(disabled.bindingId)?.bindingState).toBe("disabled");
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("active");
    expect(runtime.getBinding(active.bindingId)?.routingPriority).toBe(80);
    expect(runtime.getBinding(degraded.bindingId)?.bindingState).toBe("degraded");
  });

  it("redirect/clear-redirect only restores bindings paused by redirect", () => {
    seedAgent("bot-src");
    seedAgent("bot-dst");
    const keepOff = runtime.createBinding({
      runtimeAgentId: "bot-src",
      capabilityId: "cap-keep-off",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 10,
      loadStrategy: "eager",
    });
    runtime.updateBindingState(keepOff.bindingId, "disabled");
    const active = runtime.createBinding({
      runtimeAgentId: "bot-src",
      capabilityId: "cap-will-pause",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 50,
      loadStrategy: "eager",
    });

    const red = applyGovernanceRuntimeAction({
      runtimeAgentId: "bot-src",
      action: "redirect",
      redirectTargetAgentId: "bot-dst",
    });
    expect(red.ok).toBe(true);
    expect(getAgentRedirectRecord("bot-src")?.pausedBindingIds).toContain(active.bindingId);
    expect(getAgentRedirectRecord("bot-src")?.pausedBindingIds).not.toContain(keepOff.bindingId);

    applyGovernanceRuntimeAction({ runtimeAgentId: "bot-src", action: "clear_redirect" });
    expect(runtime.getBinding(keepOff.bindingId)?.bindingState).toBe("disabled");
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("active");
  });

  it("rejects invalid redirect targets", () => {
    seedAgent("bot-a");
    expect(
      applyGovernanceRuntimeAction({
        runtimeAgentId: "bot-a",
        action: "redirect",
        redirectTargetAgentId: "missing-bot",
      }).reason,
    ).toBe("target-agent-not-found");

    seedAgent("bot-b");
    applyGovernanceRuntimeAction({
      runtimeAgentId: "bot-b",
      action: "redirect",
      redirectTargetAgentId: "bot-a",
    });
    // A→B would cycle with B→A
    const cycle = applyGovernanceRuntimeAction({
      runtimeAgentId: "bot-a",
      action: "redirect",
      redirectTargetAgentId: "bot-b",
    });
    expect(cycle.ok).toBe(false);
    expect(cycle.reason).toBe("redirect-cycle");
  });

  it("rejects cross-tenant and self redirect targets", () => {
    seedAgent("bot-src-t");
    const now = Date.now();
    runtime.upsertAgent({
      runtimeAgentId: "bot-other-tenant",
      name: "bot-other-tenant",
      runtimeVersion: "1",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: ["tenant-b"],
      boundCapabilityCount: 0,
      activeSessionCount: 0,
      resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
      deployedAt: now,
      lastActiveAt: now,
    });
    const cross = applyGovernanceRuntimeAction({
      runtimeAgentId: "bot-src-t",
      action: "redirect",
      redirectTargetAgentId: "bot-other-tenant",
    });
    expect(cross.ok).toBe(false);
    expect(cross.reason).toBe("target-tenant-mismatch");

    expect(
      applyGovernanceRuntimeAction({
        runtimeAgentId: "bot-src-t",
        action: "redirect",
        redirectTargetAgentId: "bot-src-t",
      }).reason,
    ).toBe("invalid-redirect-target");
  });

  it("rejects redirect onto governance-paused target", () => {
    seedAgent("bot-from");
    seedAgent("bot-paused-dst");
    runtime.createBinding({
      runtimeAgentId: "bot-paused-dst",
      capabilityId: "cap-x",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 10,
      loadStrategy: "eager",
    });
    applyGovernanceRuntimeAction({ runtimeAgentId: "bot-paused-dst", action: "pause" });
    const res = applyGovernanceRuntimeAction({
      runtimeAgentId: "bot-from",
      action: "redirect",
      redirectTargetAgentId: "bot-paused-dst",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("target-governance-paused");
  });

  it("resume without pause snapshot refuses mass-enable", () => {
    seedAgent("bot-no-snap");
    const disabled = runtime.createBinding({
      runtimeAgentId: "bot-no-snap",
      capabilityId: "cap-x",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 10,
      loadStrategy: "eager",
    });
    runtime.updateBindingState(disabled.bindingId, "disabled");
    const res = applyGovernanceRuntimeAction({
      runtimeAgentId: "bot-no-snap",
      action: "resume",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no-pause-snapshot");
    expect(runtime.getBinding(disabled.bindingId)?.bindingState).toBe("disabled");
  });

  it("blocks new pause under kill switch but still restores a prior pause", () => {
    seedAgent("bot-ks");
    const active = runtime.createBinding({
      runtimeAgentId: "bot-ks",
      capabilityId: "cap-ks",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 20,
      loadStrategy: "eager",
    });
    expect(applyGovernanceRuntimeAction({ runtimeAgentId: "bot-ks", action: "pause" }).ok).toBe(
      true,
    );
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("disabled");
    setGovernanceKillSwitch(true);
    expect(applyGovernanceRuntimeAction({ runtimeAgentId: "bot-ks", action: "pause" }).reason).toBe(
      "kill-switch-active",
    );
    expect(applyGovernanceRuntimeAction({ runtimeAgentId: "bot-ks", action: "resume" }).ok).toBe(
      true,
    );
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("active");
  });
});
