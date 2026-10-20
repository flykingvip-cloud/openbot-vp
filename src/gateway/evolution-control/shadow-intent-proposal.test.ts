import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  observeRuntimeAutoConsumption,
  observeSkillAutoConsumption,
  setControlPlaneIntentRegistrar,
} from "../evolution-governance/index.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
import { createShadowIntentProposalRegistrar } from "./shadow-intent-proposal.js";
import { runtimePlatformInspector } from "./test-support.js";

const tempDirs: string[] = [];

async function planeAt(persistDir: string) {
  return createGatewayEvolutionControlPlane({
    persistDir,
    cfg: { agents: { list: [] } } as unknown as OpenBotConfig,
    inspector: runtimePlatformInspector("tenant-a"),
  });
}

afterEach(async () => {
  setControlPlaneIntentRegistrar();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("E5.1.7 shadow intent proposal registration", () => {
  it("deduplicates daily runtime intents as DISCOVERED proposals without execution", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-e517-runtime-"));
    tempDirs.push(root);
    const persistDir = path.join(root, "control");
    const plane = await planeAt(persistDir);
    const registrar = createShadowIntentProposalRegistrar(plane);

    const first = registrar({
      commandId: "limit:bot-a:high_skill_latency:2026-09-24",
      intent: {
        kind: "runtime-action",
        surfaceId: "system.runtime-binding-governance",
        adapterId: "runtime-governance",
        runtimeAgentId: "bot-a",
        action: "limit",
        approvedAction: "limit",
        candidateVersion: "",
        tenantScope: "tenant-a",
      },
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-09-24T01:00:00.000Z",
    });
    const second = registrar({
      commandId: "limit:bot-a:high_skill_latency:2026-09-25",
      intent: first!.intent,
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-09-25T01:00:00.000Z",
    });

    expect(second?.proposal?.proposalId).toBe(first?.proposal?.proposalId);
    expect(plane.listProposals()).toHaveLength(1);
    expect(plane.listProposals()[0]).toMatchObject({
      status: "DISCOVERED",
      surfaceId: "system.runtime-binding-governance",
      sourceMechanismRef: "assist-shadow:runtime-action",
    });
    expect(plane.listApplications()).toEqual([]);
    expect(first?.experiment).toBeNull();
    expect(first?.application).toBeNull();
    expect(first?.grant).toBeNull();
    expect(first?.storedCandidate?.candidateRef).toBe(first?.proposal?.candidateRef);
  });

  it("persists the proposal across restart and classifies shadow as missing_experiment", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-e517-restart-"));
    tempDirs.push(root);
    const persistDir = path.join(root, "control");
    const configDir = path.join(root, "state");
    const firstPlane = await planeAt(persistDir);
    setControlPlaneIntentRegistrar(createShadowIntentProposalRegistrar(firstPlane));

    const first = observeRuntimeAutoConsumption({
      commandId: "pause:bot-b:error_health:2026-09-24",
      runtimeAgentId: "bot-b",
      action: "pause",
      liveExecuted: false,
      mode: "assist",
      killSwitch: false,
      tenantScope: "tenant-a",
      configDir,
      recordedAt: "2026-09-24T02:00:00.000Z",
    });
    expect(first.denyReason).toBe("missing_experiment");
    expect(first.liveExecuted).toBe(false);
    expect(first.executedConsumer).toBe(false);
    expect(firstPlane.listApplications()).toEqual([]);

    const restarted = await planeAt(persistDir);
    setControlPlaneIntentRegistrar(createShadowIntentProposalRegistrar(restarted));
    const replay = observeRuntimeAutoConsumption({
      commandId: "pause:bot-b:error_health:2026-09-25",
      runtimeAgentId: "bot-b",
      action: "pause",
      liveExecuted: false,
      mode: "assist",
      killSwitch: false,
      tenantScope: "tenant-a",
      configDir,
      recordedAt: "2026-09-25T02:00:00.000Z",
    });

    expect(replay.proposalId).toBe(first.proposalId);
    expect(replay.denyReason).toBe("missing_experiment");
    expect(restarted.listProposals()).toHaveLength(1);
    expect(restarted.listApplications()).toEqual([]);
  });

  it("deduplicates skill install intents without creating an experiment or application", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-e517-skill-"));
    tempDirs.push(root);
    const plane = await planeAt(path.join(root, "control"));
    setControlPlaneIntentRegistrar(createShadowIntentProposalRegistrar(plane));

    const first = observeSkillAutoConsumption({
      commandId: "skill-auto-install:candidate-a:skill-a",
      agentId: "bot-skill",
      skillId: "skill-a",
      version: "1.2.3",
      autoInstallIntent: true,
      approvalAuditRef: "audit:skill-a",
      liveExecuted: false,
      mode: "assist",
      killSwitch: false,
      tenantScope: "tenant-a",
      configDir: path.join(root, "state"),
      recordedAt: "2026-09-24T02:30:00.000Z",
    });
    const replay = observeSkillAutoConsumption({
      commandId: "skill-auto-install:candidate-b:skill-a",
      agentId: "bot-skill",
      skillId: "skill-a",
      version: "1.2.3",
      autoInstallIntent: true,
      approvalAuditRef: "audit:skill-a",
      liveExecuted: false,
      mode: "assist",
      killSwitch: false,
      tenantScope: "tenant-a",
      configDir: path.join(root, "state"),
      recordedAt: "2026-09-25T02:30:00.000Z",
    });

    expect(replay.proposalId).toBe(first.proposalId);
    expect(first.denyReason).toBe("missing_experiment");
    expect(plane.listProposals()).toHaveLength(1);
    expect(plane.listProposals()[0]).toMatchObject({
      status: "DISCOVERED",
      surfaceId: "capability.skill-installation",
      tenantScope: "tenant-a",
    });
    expect(plane.listApplications()).toEqual([]);
    expect(plane.getCandidate(plane.listProposals()[0].candidateRef)?.payload).toMatchObject({
      agentId: "bot-skill",
      skillId: "skill-a",
      operation: "install",
    });
  });

  it("renews only an expired DISCOVERED proposal without duplicating it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-e517-renew-"));
    tempDirs.push(root);
    const plane = await planeAt(path.join(root, "control"));
    const registrar = createShadowIntentProposalRegistrar(plane);
    const intent = {
      kind: "runtime-action" as const,
      surfaceId: "system.runtime-binding-governance" as const,
      adapterId: "runtime-governance" as const,
      runtimeAgentId: "bot-renew",
      action: "limit" as const,
      approvedAction: "limit" as const,
      candidateVersion: "",
      tenantScope: "tenant-a",
    };

    const first = registrar({
      commandId: "limit:bot-renew:high_skill_latency:2026-09-01",
      intent,
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-09-01T00:00:00.000Z",
    });
    const renewed = registrar({
      commandId: "limit:bot-renew:high_skill_latency:2026-10-02",
      intent,
      mode: "assist",
      killSwitch: false,
      recordedAt: "2026-10-02T00:00:00.000Z",
    });

    expect(renewed?.proposal?.proposalId).toBe(first?.proposal?.proposalId);
    expect(renewed?.proposal?.expiresAt).toBe("2026-11-01T00:00:00.000Z");
    expect(renewed?.proposal?.sourceEvidenceRefs).toContain(
      "shadow:limit:bot-renew:high_skill_latency:2026-10-02",
    );
    expect(plane.listProposals()).toHaveLength(1);
    expect(plane.listApplications()).toEqual([]);
  });

  it("does not register live or non-assist intents", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-e517-negative-"));
    tempDirs.push(root);
    const plane = await planeAt(path.join(root, "control"));
    setControlPlaneIntentRegistrar(createShadowIntentProposalRegistrar(plane));

    const automatic = observeRuntimeAutoConsumption({
      commandId: "pause:bot-c:error_health:2026-09-24",
      runtimeAgentId: "bot-c",
      action: "pause",
      liveExecuted: false,
      mode: "auto",
      killSwitch: false,
      tenantScope: "tenant-a",
      configDir: path.join(root, "auto-state"),
      recordedAt: "2026-09-24T03:00:00.000Z",
    });
    const executed = observeRuntimeAutoConsumption({
      commandId: "pause:bot-d:error_health:2026-09-24",
      runtimeAgentId: "bot-d",
      action: "pause",
      liveExecuted: true,
      mode: "assist",
      killSwitch: false,
      tenantScope: "tenant-a",
      configDir: path.join(root, "executed-state"),
      recordedAt: "2026-09-24T03:01:00.000Z",
    });

    expect(automatic.denyReason).toBe("missing_application");
    expect(executed.denyReason).toBe("missing_application");
    expect(plane.listProposals()).toEqual([]);
    expect(plane.listApplications()).toEqual([]);
  });
});
