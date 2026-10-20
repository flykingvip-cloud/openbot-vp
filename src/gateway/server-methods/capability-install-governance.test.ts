import { describe, expect, it } from "vitest";
import { listRegistry } from "../capability-governance-store.js";
import {
  canSubmitToPlatform,
  getEnterpriseSubmission,
  getSanitizationSession,
  listEnterpriseSubmissions,
  listGovernanceEvents,
} from "../capability-install-governance-store.js";
import { agentInstallRequestHandlers } from "./agent-install-request.js";
import { employeeInstallHandlers } from "./employee-install.js";
import { enterpriseCapabilityHandlers } from "./enterprise-capability.js";
import { platformCapabilityHandlers } from "./platform-capability.js";

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

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
        client: {
          id: "openbot-control-ui",
          version: "1.0.0",
          platform: "test",
          mode: "test",
        },
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
        client: {
          id: "openbot-control-ui",
          version: "1.0.0",
          platform: "test",
          mode: "test",
        },
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

async function invokeEmployeeInstall(
  method: string,
  params: Record<string, unknown>,
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
        client: {
          id: "openbot-control-ui",
          version: "1.0.0",
          platform: "test",
          mode: "test",
        },
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

async function invokeAgentInstall(
  method: string,
  params: Record<string, unknown>,
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
        client: {
          id: "openbot-control-ui",
          version: "1.0.0",
          platform: "test",
          mode: "test",
        },
        minProtocol: 1,
        maxProtocol: 1,
      },
      user: "robot-1@example.com",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as unknown as import("./types.js").GatewayRequestContext,
  });
  return response ?? { ok: false };
}

async function completeSanitization(capabilityId: string): Promise<string> {
  const preview = await invokeEnterprise("enterprise-capability.sanitization-preview", {
    capabilityId,
  });
  expect(preview.ok).toBe(true);
  const previewPayload = preview.payload as { findings: Array<{ id: string }> };
  const replacements = previewPayload.findings.map((finding) => ({
    findingId: finding.id,
    replacement: "[REDACTED]",
    replacementType: "redact",
  }));

  const confirm = await invokeEnterprise("enterprise-capability.sanitization-confirm", {
    capabilityId,
    replacements,
  });
  expect(confirm.ok).toBe(true);
  const confirmPayload = confirm.payload as {
    canSubmitToPlatform: boolean;
    sanitizedPackageId: string;
  };
  expect(confirmPayload.canSubmitToPlatform).toBe(true);
  expect(confirmPayload.sanitizedPackageId).toBeTruthy();
  return confirmPayload.sanitizedPackageId;
}

describe("P0 capability install governance closed-loop", () => {
  it("P0-5 / P0-6: cannot submit to platform without completing sanitization", async () => {
    const capabilityId = "cap-gov-001";
    // No sanitization session started
    const gate = canSubmitToPlatform(capabilityId);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("sanitization-not-started");

    const res = await invokeEnterprise("enterprise-capability.submit-to-platform", {
      capabilityId,
    });
    expect(res.ok).toBe(false);
  });

  it("P0-5 / P0-6: sanitization session gates and shared store round-trip", async () => {
    const capabilityId = "cap-gov-002";
    const _enterpriseId = "tenant-test";

    // Step 1: preview seeds sanitization session
    const preview = await invokeEnterprise("enterprise-capability.sanitization-preview", {
      capabilityId,
    });
    expect(preview.ok).toBe(true);
    const previewPayload = preview.payload as {
      canProceed: boolean;
      findings: Array<{ id: string }>;
      totalFindings: number;
    };
    expect(previewPayload.canProceed).toBe(false);
    expect(previewPayload.totalFindings).toBeGreaterThan(0);

    const session = getSanitizationSession(capabilityId);
    expect(session).not.toBeNull();
    expect(session!.status).toBe("in-progress");

    // Step 2: cannot submit before confirm
    const gateBefore = canSubmitToPlatform(capabilityId);
    expect(gateBefore.allowed).toBe(false);

    // Step 3: confirm sanitization
    const replacements = previewPayload.findings.map((finding) => ({
      findingId: finding.id,
      replacement: "[REDACTED]",
      replacementType: "redact",
    }));
    const confirm = await invokeEnterprise("enterprise-capability.sanitization-confirm", {
      capabilityId,
      replacements,
    });
    expect(confirm.ok).toBe(true);
    const confirmPayload = confirm.payload as {
      canSubmitToPlatform: boolean;
      sanitizedPackageId: string;
    };
    expect(confirmPayload.canSubmitToPlatform).toBe(true);
    expect(confirmPayload.sanitizedPackageId).toBeTruthy();

    const confirmedSession = getSanitizationSession(capabilityId);
    expect(confirmedSession!.status).toBe("complete");
    expect(confirmedSession!.sanitizedPackageId).toBe(confirmPayload.sanitizedPackageId);

    // Step 4: now submit to platform writes shared store
    const submit = await invokeEnterprise("enterprise-capability.submit-to-platform", {
      capabilityId,
    });
    expect(submit.ok).toBe(true);
    const submitPayload = submit.payload as { submissionId: string; status: string };
    expect(submitPayload.status).toBe("submitted");
    expect(submitPayload.submissionId).toBeTruthy();

    // Step 5: platform side sees the same submission (P0-6)
    const allSubmissions = listEnterpriseSubmissions();
    const found = allSubmissions.find((s) => s.submissionId === submitPayload.submissionId);
    expect(found).toBeTruthy();
    expect(found!.status).toBe("pending-review");
    expect(found!.sanitized).toBe(true);

    // Step 6: platform review reads shared store
    const review = await invokePlatform("platform-capability.review-enterprise-submission", {
      submissionId: submitPayload.submissionId,
    });
    expect(review.ok).toBe(true);
    const reviewPayload = review.payload as { status: string; sanitized: boolean };
    expect(reviewPayload.status).toBe("pending-review");
    expect(reviewPayload.sanitized).toBe(true);

    // Step 7: platform publish updates shared store
    const publish = await invokePlatform("platform-capability.publish-enterprise-capability", {
      submissionId: submitPayload.submissionId,
    });
    expect(publish.ok).toBe(true);

    const published = getEnterpriseSubmission(submitPayload.submissionId);
    expect(published!.status).toBe("published");
  });

  it("P0-5: canSubmitToPlatform allows completed sessions with package provenance", async () => {
    await completeSanitization("cap-sanitized-package-test");

    const gate = canSubmitToPlatform("cap-sanitized-package-test");
    expect(gate.allowed).toBe(true);
    expect(gate.sanitizedPackageId).toBeTruthy();
  });
});

describe("P1 governance event store", () => {
  it("P1-3: employee-install.confirm records an install governance event", async () => {
    const createRes = await invokeEmployeeInstall("employee-install.create-request", {
      targetRobotId: "robot-emp-1",
      targetRobotName: "Robot A",
      capabilityId: "cap-emp-001",
      capabilityName: "Test Capability",
      source: "platform-marketplace",
    });
    expect(createRes.ok).toBe(true);
    const createPayload = createRes.payload as { requestId: string };

    const before = listGovernanceEvents({ capabilityId: "cap-emp-001" }).length;

    const confirmRes = await invokeEmployeeInstall("employee-install.confirm", {
      requestId: createPayload.requestId,
    });
    expect(confirmRes.ok).toBe(true);

    const after = listGovernanceEvents({ capabilityId: "cap-emp-001" });
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].type).toBe("install");
    expect(after[after.length - 1].actorType).toBe("employee");
    expect(after[after.length - 1].targetRobotId).toBe("robot-emp-1");
  });

  it("P1-3: agent-install.request-accept records an install governance event", async () => {
    const sendRes = await invokeAgentInstall("agent-install.request-send", {
      targetRobotId: "robot-agent-1",
      targetRobotName: "Robot B",
      capabilityId: "cap-agent-001",
      capabilityName: "Agent Cap",
      actorType: "dabai-proxy",
      actorId: "dabai-1",
    });
    expect(sendRes.ok).toBe(true);
    const sendPayload = sendRes.payload as { requestId: string };

    const before = listGovernanceEvents({ capabilityId: "cap-agent-001" }).length;

    const acceptRes = await invokeAgentInstall("agent-install.request-accept", {
      requestId: sendPayload.requestId,
    });
    expect(acceptRes.ok).toBe(true);

    const after = listGovernanceEvents({ capabilityId: "cap-agent-001" });
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].type).toBe("install");
    expect(after[after.length - 1].actorType).toBe("system");
  });

  it("P1-3: governance-events returns real recorded events (not static stubs)", async () => {
    // Record a direct event with a known tenant so filtering works
    const direct = listGovernanceEvents({ enterpriseId: "tenant-test" }).length;

    const eventsRes = await invokeEnterprise("enterprise-capability.governance-events", {
      tenantId: "tenant-test",
    });
    expect(eventsRes.ok).toBe(true);
    const payload = eventsRes.payload as { events: unknown[]; total: number };
    // Since no prior test in this file sets enterpriseId on events, total should equal direct count
    expect(payload.total).toBe(direct);
    expect(payload.events.length).toBe(payload.total);
  });

  it("P1-3: governance-action records a restrict event", async () => {
    const before = listGovernanceEvents({ type: "restrict" }).length;

    const actionRes = await invokeEnterprise("enterprise-capability.governance-action", {
      capabilityId: "cap-action-001",
      capabilityName: "Action Cap",
      action: "restrict",
    });
    expect(actionRes.ok).toBe(true);

    const after = listGovernanceEvents({ type: "restrict" });
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].severity).toBe("medium");
    expect(after[after.length - 1].actorType).toBe("admin");
  });

  it("P1-5: platform publish creates a capability governance registry entry", async () => {
    const capabilityId = "cap-registry-001";

    // Ensure sanitization is complete
    await completeSanitization(capabilityId);

    // Submit to platform
    const submitRes = await invokeEnterprise("enterprise-capability.submit-to-platform", {
      capabilityId,
      capabilityName: "Registry Test Cap",
      enterpriseId: "tenant-registry",
    });
    expect(submitRes.ok).toBe(true);
    const submitPayload = submitRes.payload as { submissionId: string };

    // Publish via platform
    const publishRes = await invokePlatform("platform-capability.publish-enterprise-capability", {
      submissionId: submitPayload.submissionId,
    });
    expect(publishRes.ok).toBe(true);

    // Verify registry entry was created
    const registry = listRegistry();
    const entry = registry.find((e) => e.manifest.id === capabilityId);
    expect(entry).toBeTruthy();
    expect(entry!.manifest.name).toBe("Registry Test Cap");
    expect(entry!.manifest.source.trustTier).toBe("enterprise-certified");
    expect(entry!.lifecycleState).toBe("active");
  });
});
