import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setRuntimeConfigSnapshot } from "../../config/io.js";
import {
  __agentRuntimeStoreInternals,
  canInvokeBinding,
  listBindings,
  type RuntimeAgent,
} from "../agent-runtime-store.js";
import { listRegistry, registerCapability } from "../capability-governance-store.js";
import {
  __capabilityInstallGovernanceStoreInternals,
  getEnterpriseSubmission,
  listGovernanceEvents,
} from "../capability-install-governance-store.js";
import {
  __agentInstallRequestStoreInternals,
  agentInstallRequestHandlers,
} from "./agent-install-request.js";
import { __employeeInstallStoreInternals } from "./employee-install.js";
import { employeeInstallHandlers } from "./employee-install.js";
import { enterpriseCapabilityHandlers } from "./enterprise-capability.js";
import { platformCapabilityHandlers } from "./platform-capability.js";

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

async function invokeEmployee(
  method: string,
  params: Record<string, unknown>,
  user = "alice@example.com",
): Promise<HandlerResponse> {
  const handler = employeeInstallHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        role: "employee",
        scopes: ["write"],
        client: { id: "openbot-control-ui", version: "1.0.0", platform: "test", mode: "test" },
        minProtocol: 1,
        maxProtocol: 1,
      },
      user,
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as unknown as import("./types.js").GatewayRequestContext,
  });
  return response ?? { ok: false };
}

async function invokeAgent(
  method: string,
  params: Record<string, unknown>,
  user = "robot-1@example.com",
): Promise<HandlerResponse> {
  const handler = agentInstallRequestHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        role: "robot",
        scopes: ["write"],
        client: { id: "openbot-control-ui", version: "1.0.0", platform: "test", mode: "test" },
        minProtocol: 1,
        maxProtocol: 1,
      },
      user,
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as unknown as import("./types.js").GatewayRequestContext,
  });
  return response ?? { ok: false };
}

async function invokeEnterprise(
  method: string,
  params: Record<string, unknown>,
): Promise<HandlerResponse> {
  const handler = enterpriseCapabilityHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        role: "employee",
        scopes: ["write"],
        client: { id: "openbot-control-ui", version: "1.0.0", platform: "test", mode: "test" },
        minProtocol: 1,
        maxProtocol: 1,
      },
      user: "alice@example.com",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as unknown as import("./types.js").GatewayRequestContext,
  });
  return response ?? { ok: false };
}

async function invokePlatform(
  method: string,
  params: Record<string, unknown>,
): Promise<HandlerResponse> {
  const handler = platformCapabilityHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        role: "operator",
        scopes: ["write"],
        client: { id: "openbot-control-ui", version: "1.0.0", platform: "test", mode: "test" },
        minProtocol: 1,
        maxProtocol: 1,
      },
      user: "platform-reviewer@example.com",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as unknown as import("./types.js").GatewayRequestContext,
  });
  return response ?? { ok: false };
}

function seedRuntimeAgent(agentId: string) {
  const agent: RuntimeAgent = {
    runtimeAgentId: agentId,
    name: `Agent ${agentId}`,
    runtimeVersion: "1.0.0",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-a"],
    boundCapabilityCount: 0,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  __agentRuntimeStoreInternals.seed({ agents: { [agentId]: agent }, bindings: {} });
}

function seedRegistry(capabilityId: string) {
  registerCapability(
    {
      id: capabilityId,
      kind: "skill",
      version: "1.0.0",
      skillKey: capabilityId,
      name: `Test ${capabilityId}`,
      description: "Test capability",
      source: { kind: "platform-registry", origin: "openbot", trustTier: "first-party" },
      risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    },
    undefined,
    {
      distributionScope: {},
      defaultEnabled: true,
      employeeVisibilityMode: "direct_employee_visible",
    },
  );
}

function createTempAuthStore(userEmail: string): string {
  const tmpDir = os.tmpdir();
  const storePath = path.join(tmpDir, `openbot-test-auth-${Date.now()}.json`);
  const store = {
    version: 5,
    secret: "test-secret-32bytes-long-string",
    policy: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      platformName: "OpenBot Test",
      defaultTrialDays: 14,
      allowSelfSignup: true,
      requireApproval: false,
      defaultSeatLimit: 10,
    },
    enterprises: {
      "tenant-a": {
        id: "tenant-a",
        slug: "tenant-a",
        name: "Tenant A",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    users: {
      "user-alice": {
        id: "user-alice",
        email: userEmail,
        normalizedEmail: userEmail.toLowerCase(),
        displayName: "Alice",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        role: "employee",
        status: "active",
        emailVerified: true,
        lastLoginAt: new Date().toISOString(),
      },
    },
    sessions: {},
    memberships: {
      "mem-alice": {
        id: "mem-alice",
        userId: "user-alice",
        enterpriseId: "tenant-a",
        role: "employee",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        seatType: "employee",
      },
    },
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  };
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  return storePath;
}

function setupTestConfig(authStorePath: string) {
  const config = {
    gateway: {
      auth: {
        trustedProxy: {
          platformAuth: {
            store: authStorePath,
            sessionTtlHours: 24,
            cookieName: "openbot-session",
          },
        },
      },
    },
  } as unknown as import("../../config/types.js").OpenBotConfig;
  setRuntimeConfigSnapshot(config, config);
}

describe("E2E closed-loop capability install governance", () => {
  it("E2E-1: install platform capability targets specific robot and creates runtime binding", async () => {
    const authStorePath = createTempAuthStore("alice@example.com");
    try {
      setupTestConfig(authStorePath);
      seedRuntimeAgent("robot-e2e-1");
      seedRegistry("cap-e2e-1");

      const createRes = await invokeEmployee("employee-install.create-request", {
        targetRobotId: "robot-e2e-1",
        targetRobotName: "Robot E2E-1",
        capabilityId: "cap-e2e-1",
        capabilityName: "E2E Test Cap",
        source: "platform-marketplace",
      });
      expect(createRes.ok).toBe(true);
      const requestId = (createRes.payload as { requestId: string }).requestId;

      const confirmRes = await invokeEmployee("employee-install.confirm", { requestId });
      expect(confirmRes.ok).toBe(true);

      // Verify runtime binding was created for the target robot
      const bindings = listBindings({
        runtimeAgentId: "robot-e2e-1",
        capabilityId: "cap-e2e-1",
        bindingType: null,
        bindingState: null,
        health: null,
      });
      expect(bindings.length).toBeGreaterThan(0);
      expect(bindings[0].runtimeAgentId).toBe("robot-e2e-1");
      expect(bindings[0].installRequestId).toBeTruthy();
      expect(bindings[0].tenantInstallSource).toBe("platform-marketplace");
    } finally {
      __agentRuntimeStoreInternals.reset();
      __employeeInstallStoreInternals.reset();
      __capabilityInstallGovernanceStoreInternals.reset();
      __agentInstallRequestStoreInternals.reset();
      if (fs.existsSync(authStorePath)) {
        fs.unlinkSync(authStorePath);
      }
    }
  });

  it("E2E-2: external/local install requires scan and enforces block results", async () => {
    // Without scan: should fail
    const createResWithoutScan = await invokeEmployee("employee-install.create-request", {
      targetRobotId: "robot-e2e-2",
      capabilityId: "cap-external-e2e",
      source: "external-local",
    });
    expect(createResWithoutScan.ok).toBe(false);

    // With failed scan: should fail at confirm
    await invokeEmployee("employee-install.scan-external", {
      targetRobotId: "robot-e2e-2",
      contentHash: "bad-e2e",
    });
    const createResBad = await invokeEmployee("employee-install.create-request", {
      targetRobotId: "robot-e2e-2",
      capabilityId: "cap-external-e2e",
      source: "external-local",
      contentHash: "bad-e2e",
    });
    expect(createResBad.ok).toBe(false);

    // With passed scan: should succeed
    await invokeEmployee("employee-install.scan-external", {
      targetRobotId: "robot-e2e-2",
      contentHash: "good-e2e",
    });
    const createResGood = await invokeEmployee("employee-install.create-request", {
      targetRobotId: "robot-e2e-2",
      capabilityId: "cap-external-e2e-2",
      source: "external-local",
      contentHash: "good-e2e",
    });
    expect(createResGood.ok).toBe(true);
  });

  it("E2E-3: install with configuration blocks invocation until config applied", async () => {
    const authStorePath = createTempAuthStore("alice@example.com");
    try {
      setupTestConfig(authStorePath);
      seedRuntimeAgent("robot-e2e-3");
      seedRegistry("cap-config-e2e");

      await invokeEmployee("employee-install.scan-external", {
        targetRobotId: "robot-e2e-3",
        contentHash: "config-e2e",
      });
      const createRes = await invokeEmployee("employee-install.create-request", {
        targetRobotId: "robot-e2e-3",
        capabilityId: "cap-config-e2e",
        source: "external-local",
        contentHash: "config-e2e",
      });
      expect(createRes.ok).toBe(true);
      const requestId = (createRes.payload as { requestId: string }).requestId;

      const confirmRes = await invokeEmployee("employee-install.confirm", { requestId });
      expect(confirmRes.ok).toBe(true);
      const confirmPayload = confirmRes.payload as { status?: string; nextStep?: string };
      expect(confirmPayload.status).toBe("pending-configuration");
      expect(confirmPayload.nextStep).toBe("apply-configuration");

      // Verify binding is disabled until configuration is applied
      const bindings = listBindings({
        runtimeAgentId: "robot-e2e-3",
        capabilityId: "cap-config-e2e",
        bindingType: null,
        bindingState: null,
        health: null,
      });
      expect(bindings.length).toBeGreaterThan(0);
      expect(bindings[0].bindingState).toBe("disabled");
      expect(bindings[0].configurationState).toBe("pending");

      // Verify invocation is blocked before configuration
      const invokeCheckBefore = canInvokeBinding(bindings[0].bindingId);
      expect(invokeCheckBefore.allowed).toBe(false);
      expect(invokeCheckBefore.reason).toBe("pending-configuration");

      // Apply configuration
      const applyRes = await invokeEmployee("employee-install.apply-configuration", {
        requestId,
        configuration: { sandbox_mode: "strict" },
      });
      expect(applyRes.ok).toBe(true);

      // Verify binding is now active
      const bindingsAfter = listBindings({
        runtimeAgentId: "robot-e2e-3",
        capabilityId: "cap-config-e2e",
        bindingType: null,
        bindingState: null,
        health: null,
      });
      expect(bindingsAfter[0].bindingState).toBe("active");
      expect(bindingsAfter[0].configurationState).toBe("complete");

      // Verify invocation is allowed after configuration
      const invokeCheckAfter = canInvokeBinding(bindingsAfter[0].bindingId);
      expect(invokeCheckAfter.allowed).toBe(true);
    } finally {
      __agentRuntimeStoreInternals.reset();
      __employeeInstallStoreInternals.reset();
      __capabilityInstallGovernanceStoreInternals.reset();
      __agentInstallRequestStoreInternals.reset();
      if (fs.existsSync(authStorePath)) {
        fs.unlinkSync(authStorePath);
      }
    }
  });

  it("E2E-4: Da Bai proxy routes into unified install service and produces binding", async () => {
    const authStorePath = createTempAuthStore("robot-1@example.com");
    try {
      setupTestConfig(authStorePath);
      seedRuntimeAgent("robot-dabai-e2e");
      seedRegistry("cap-dabai-e2e");

      const sendRes = await invokeAgent("agent-install.request-send", {
        targetRobotId: "robot-dabai-e2e",
        targetRobotName: "Robot DaBai",
        capabilityId: "cap-dabai-e2e",
        capabilityName: "DaBai E2E Cap",
        actorType: "dabai-proxy",
        actorId: "dabai-session-e2e",
      });
      expect(sendRes.ok).toBe(true);
      const requestId = (sendRes.payload as { requestId: string }).requestId;

      const acceptRes = await invokeAgent("agent-install.request-accept", { requestId });
      expect(acceptRes.ok).toBe(true);
      const acceptPayload = acceptRes.payload as {
        status?: string;
        installRequestId?: string;
        bindingId?: string;
      };
      expect(acceptPayload.status).toBe("installed");
      expect(acceptPayload.installRequestId).toBeTruthy();

      // Verify runtime binding exists on target robot
      const bindings = listBindings({
        runtimeAgentId: "robot-dabai-e2e",
        capabilityId: "cap-dabai-e2e",
        bindingType: null,
        bindingState: null,
        health: null,
      });
      expect(bindings.length).toBeGreaterThan(0);
      expect(bindings[0].tenantInstallSource).toBe("dabai-proxy");
      expect(bindings[0].installRequestId).toBe(acceptPayload.installRequestId);
    } finally {
      __agentRuntimeStoreInternals.reset();
      __employeeInstallStoreInternals.reset();
      __capabilityInstallGovernanceStoreInternals.reset();
      __agentInstallRequestStoreInternals.reset();
      if (fs.existsSync(authStorePath)) {
        fs.unlinkSync(authStorePath);
      }
    }
  });

  it("E2E-5: install external capability produces enterprise governance event", async () => {
    await invokeEmployee("employee-install.scan-external", {
      targetRobotId: "robot-e2e-5",
      contentHash: "scan-e2e-5",
    });
    const createRes = await invokeEmployee("employee-install.create-request", {
      targetRobotId: "robot-e2e-5",
      targetRobotName: "Robot E2E-5",
      capabilityId: "cap-external-event",
      capabilityName: "External Event Cap",
      source: "external-local",
      contentHash: "scan-e2e-5",
    });
    expect(createRes.ok).toBe(true);
    const requestId = (createRes.payload as { requestId: string }).requestId;

    const before = listGovernanceEvents({ capabilityId: "cap-external-event" }).length;
    const confirmRes = await invokeEmployee("employee-install.confirm", { requestId });
    expect(confirmRes.ok).toBe(true);

    const after = listGovernanceEvents({ capabilityId: "cap-external-event" });
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].type).toBe("external-filing");
    expect(after[after.length - 1].targetRobotId).toBe("robot-e2e-5");
  });

  it("E2E-6: enterprise submit to platform only after sanitization with shared submission", async () => {
    const capabilityId = "cap-e2e-6";

    // P0-5 完整脱敏：走完整的 sanitization 流程
    const previewRes = await invokeEnterprise("enterprise-capability.sanitization-preview", {
      capabilityId,
    });
    expect(previewRes.ok).toBe(true);
    const previewPayload = previewRes.payload as { findings: Array<{ id: string }> };

    // 逐项提供 resolution
    const resolutions = previewPayload.findings.map((f) => ({
      findingId: f.id,
      replacement: "[REDACTED]",
      replacementType: "redact" as const,
    }));

    const confirmRes = await invokeEnterprise("enterprise-capability.sanitization-confirm", {
      capabilityId,
      replacements: resolutions,
    });
    expect(confirmRes.ok).toBe(true);
    const confirmPayload = confirmRes.payload as { sanitizedPackageId: string };

    // 提交到平台（携带 sanitized package provenance）
    const submitRes = await invokeEnterprise("enterprise-capability.submit-to-platform", {
      capabilityId,
      capabilityName: "E2E Submit Cap",
      enterpriseId: "tenant-e2e-6",
    });
    expect(submitRes.ok).toBe(true);
    const submitPayload = submitRes.payload as { submissionId: string; sanitizedPackageId: string };
    expect(submitPayload.submissionId).toBeTruthy();
    expect(submitPayload.sanitizedPackageId).toBe(confirmPayload.sanitizedPackageId);

    // Platform side sees the same submission
    const platformRes = await invokePlatform("platform-capability.review-enterprise-submission", {
      submissionId: submitPayload.submissionId,
    });
    expect(platformRes.ok).toBe(true);
    const platformPayload = platformRes.payload as { submissionId: string; status: string };
    expect(platformPayload.submissionId).toBe(submitPayload.submissionId);
    expect(platformPayload.status).toBe("pending-review");

    // Verify shared store has the same record
    const submission = getEnterpriseSubmission(submitPayload.submissionId);
    expect(submission).toBeTruthy();
    expect(submission!.status).toBe("pending-review");
    expect(submission!.sanitized).toBe(true);
  });

  it("E2E-7: platform publish creates capability governance registry entry", async () => {
    const capabilityId = "cap-e2e-7";

    // P0-5 完整脱敏：走完整的 sanitization 流程
    const previewRes = await invokeEnterprise("enterprise-capability.sanitization-preview", {
      capabilityId,
    });
    expect(previewRes.ok).toBe(true);
    const previewPayload = previewRes.payload as {
      findings: Array<{ id: string; category: string; severity: string }>;
    };
    expect(previewPayload.findings.length).toBeGreaterThan(0);

    // 逐项提供 resolution
    const resolutions = previewPayload.findings.map((f) => ({
      findingId: f.id,
      replacement: "[REDACTED]",
      replacementType: "redact" as const,
    }));

    const confirmRes = await invokeEnterprise("enterprise-capability.sanitization-confirm", {
      capabilityId,
      replacements: resolutions,
    });
    expect(confirmRes.ok).toBe(true);
    const confirmPayload = confirmRes.payload as {
      sanitizedPackageId: string;
      canSubmitToPlatform: boolean;
    };
    expect(confirmPayload.sanitizedPackageId).toBeTruthy();
    expect(confirmPayload.canSubmitToPlatform).toBe(true);

    // 提交到平台（携带 sanitized package provenance）
    const submitRes = await invokeEnterprise("enterprise-capability.submit-to-platform", {
      capabilityId,
      capabilityName: "E2E Registry Cap",
      enterpriseId: "tenant-e2e-7",
    });
    expect(submitRes.ok).toBe(true);
    const submitPayload = submitRes.payload as {
      submissionId: string;
      sanitizedPackageId: string;
      artifactHash: string;
    };
    expect(submitPayload.sanitizedPackageId).toBe(confirmPayload.sanitizedPackageId);
    expect(submitPayload.artifactHash).toBeTruthy();

    const publishRes = await invokePlatform("platform-capability.publish-enterprise-capability", {
      submissionId: submitPayload.submissionId,
    });
    expect(publishRes.ok).toBe(true);

    const registry = listRegistry();
    const entry = registry.find((e) => e.manifest.id === capabilityId);
    expect(entry).toBeTruthy();
    expect(entry!.manifest.name).toBe("E2E Registry Cap");
    expect(entry!.lifecycleState).toBe("active");
  });

  it("E2E-8: sanitization confirm requires per-item resolution", async () => {
    const capabilityId = "cap-e2e-8";

    // 获取 preview findings
    const previewRes = await invokeEnterprise("enterprise-capability.sanitization-preview", {
      capabilityId,
    });
    expect(previewRes.ok).toBe(true);
    const previewPayload = previewRes.payload as { findings: Array<{ id: string }> };

    // 尝试用空的 resolutions 确认（应该失败）
    const confirmRes = await invokeEnterprise("enterprise-capability.sanitization-confirm", {
      capabilityId,
      replacements: [],
    });
    expect(confirmRes.ok).toBe(false);

    // 尝试只处理部分 finding（应该失败）
    const partialResolutions = [
      {
        findingId: previewPayload.findings[0].id,
        replacement: "[REDACTED]",
        replacementType: "redact" as const,
      },
    ];
    const partialConfirmRes = await invokeEnterprise("enterprise-capability.sanitization-confirm", {
      capabilityId,
      replacements: partialResolutions,
    });
    expect(partialConfirmRes.ok).toBe(false);

    // 完整处理后应该成功
    const allResolutions = previewPayload.findings.map((f) => ({
      findingId: f.id,
      replacement: "[REDACTED]",
      replacementType: "redact" as const,
    }));
    const fullConfirmRes = await invokeEnterprise("enterprise-capability.sanitization-confirm", {
      capabilityId,
      replacements: allResolutions,
    });
    expect(fullConfirmRes.ok).toBe(true);
  });

  it("E2E-9: submit-to-platform requires sanitized package provenance", async () => {
    const capabilityId = "cap-e2e-9";

    // 未脱敏直接提交应该失败
    const submitRes = await invokeEnterprise("enterprise-capability.submit-to-platform", {
      capabilityId,
      capabilityName: "E2E No Sanitize Cap",
      enterpriseId: "tenant-e2e-9",
    });
    expect(submitRes.ok).toBe(false);

    // 完成脱敏后提交应该成功
    const previewRes = await invokeEnterprise("enterprise-capability.sanitization-preview", {
      capabilityId,
    });
    expect(previewRes.ok).toBe(true);
    const previewPayload = previewRes.payload as { findings: Array<{ id: string }> };

    const resolutions = previewPayload.findings.map((f) => ({
      findingId: f.id,
      replacement: "[REDACTED]",
      replacementType: "redact" as const,
    }));

    const confirmRes = await invokeEnterprise("enterprise-capability.sanitization-confirm", {
      capabilityId,
      replacements: resolutions,
    });
    expect(confirmRes.ok).toBe(true);
    const confirmPayload = confirmRes.payload as { sanitizedPackageId: string };

    const validSubmitRes = await invokeEnterprise("enterprise-capability.submit-to-platform", {
      capabilityId,
      capabilityName: "E2E Valid Sanitize Cap",
      enterpriseId: "tenant-e2e-9",
    });
    expect(validSubmitRes.ok).toBe(true);
    const submitPayload = validSubmitRes.payload as {
      submissionId: string;
      sanitizedPackageId: string;
      artifactHash: string;
    };

    // 验证 submission 携带了 sanitized package 元数据
    expect(submitPayload.sanitizedPackageId).toBe(confirmPayload.sanitizedPackageId);
    expect(submitPayload.artifactHash).toBeTruthy();

    // 验证共享存储中的 submission 有 sanitizedPackageId
    const submission = getEnterpriseSubmission(submitPayload.submissionId);
    expect(submission).toBeTruthy();
    expect(submission!.sanitizedPackageId).toBe(confirmPayload.sanitizedPackageId);
  });
});
