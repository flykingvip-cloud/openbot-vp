import { describe, expect, it } from "vitest";
import { employeeInstallHandlers, resolveEmployeeInstallAvailability } from "./employee-install.js";

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

async function invoke(method: string, params: Record<string, unknown>): Promise<HandlerResponse> {
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
      user: "test-user",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as unknown as import("./types.js").GatewayRequestContext,
  });
  return response ?? { ok: false };
}

describe("employee-install availability", () => {
  it("uses failed or degraded and never ready", () => {
    expect(resolveEmployeeInstallAvailability(false)).toBe("failed");
    expect(resolveEmployeeInstallAvailability(true)).toBe("degraded");
  });
});

describe("employee-install handlers", () => {
  it("list-sources returns stub sources", async () => {
    const res = await invoke("employee-install.list-sources", { targetRobotId: "robot-1" });
    expect(res.ok).toBe(true);
    const payload = res.payload as { sources?: unknown[] };
    expect(payload?.sources).toBeInstanceOf(Array);
    expect(payload?.sources?.length).toBeGreaterThan(0);
  });

  it("scan-external returns scan result", async () => {
    const res = await invoke("employee-install.scan-external", {
      targetRobotId: "robot-1",
      contentHash: "abc123",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { result?: { passed: boolean } };
    expect(payload?.result?.passed).toBe(true);
  });

  it("scan-external flags high-risk hash", async () => {
    const res = await invoke("employee-install.scan-external", {
      targetRobotId: "robot-1",
      contentHash: "bad-content",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { result?: { overallRisk: string } };
    expect(payload?.result?.overallRisk).toBe("high");
  });

  it("preview-risk returns risk preview", async () => {
    const res = await invoke("employee-install.preview-risk", {
      targetRobotId: "robot-1",
      capabilityId: "cap-1",
      source: "platform-marketplace",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { riskLevel?: string };
    expect(payload?.riskLevel).toBe("low");
  });

  it("preview-risk flags external source", async () => {
    const res = await invoke("employee-install.preview-risk", {
      targetRobotId: "robot-1",
      capabilityId: "cap-1",
      source: "external-local",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { riskLevel?: string };
    expect(payload?.riskLevel).toBe("medium");
  });

  it("create-request returns a request", async () => {
    const res = await invoke("employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: "cap-1",
      source: "platform-marketplace",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { requestId?: string; status?: string };
    expect(payload?.requestId).toBeTruthy();
    expect(payload?.status).toBe("pending-confirmation");
  });

  it("confirm transitions request to installed", async () => {
    const createRes = await invoke("employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: "cap-1",
      source: "platform-marketplace",
    });
    const requestId = (createRes.payload as { requestId: string }).requestId;

    const confirmRes = await invoke("employee-install.confirm", { requestId });
    expect(confirmRes.ok).toBe(true);
    const payload = confirmRes.payload as {
      status?: string;
      nextStep?: string;
      executable?: boolean;
      availability?: string;
      projection?: { state?: string };
      runtimeBinding?: { synced?: boolean; reason?: string };
    };
    expect(payload?.status).toBe("installed");
    expect(payload?.executable).toBe(false);
    expect(payload?.availability).not.toBe("ready");
    expect(payload?.availability).not.toBe("pending");
    expect(payload?.projection?.state).toBe("not_materialized");
    if (!payload?.runtimeBinding?.synced) {
      expect(payload?.availability).toBe("failed");
      expect(payload?.nextStep).not.toBe("done");
      expect(payload?.runtimeBinding?.reason).toBeTruthy();
    } else {
      expect(payload?.availability).toBe("degraded");
    }
  });

  it("history returns items after creation", async () => {
    await invoke("employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: "cap-1",
      source: "platform-marketplace",
    });

    const res = await invoke("employee-install.history", {});
    expect(res.ok).toBe(true);
    const payload = res.payload as { items?: unknown[] };
    expect(payload?.items?.length).toBeGreaterThan(0);
  });

  it("P1-4: create-request rejects external-local without scan", async () => {
    const res = await invoke("employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: "cap-external-001",
      source: "external-local",
    });
    expect(res.ok).toBe(false);
  });

  it("P1-4: create-request rejects external-local with failed scan", async () => {
    await invoke("employee-install.scan-external", {
      targetRobotId: "robot-1",
      contentHash: "bad-content",
    });
    const res = await invoke("employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: "cap-external-001",
      source: "external-local",
      contentHash: "bad-content",
    });
    expect(res.ok).toBe(false);
  });

  it("P1-4: create-request allows external-local after passed scan", async () => {
    await invoke("employee-install.scan-external", {
      targetRobotId: "robot-1",
      contentHash: "good-content",
    });
    const res = await invoke("employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: "cap-external-001",
      source: "external-local",
      contentHash: "good-content",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { requestId?: string; status?: string };
    expect(payload?.requestId).toBeTruthy();
    expect(payload?.status).toBe("pending-confirmation");
  });

  it("P1-2: confirm with requiredConfiguration creates pending-configuration request and disables binding", async () => {
    await invoke("employee-install.scan-external", {
      targetRobotId: "robot-1",
      contentHash: "config-required",
    });
    const createRes = await invoke("employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: "cap-external-001",
      source: "external-local",
      contentHash: "config-required",
    });
    const requestId = (createRes.payload as { requestId: string }).requestId;

    const confirmRes = await invoke("employee-install.confirm", { requestId });
    expect(confirmRes.ok).toBe(true);
    const payload = confirmRes.payload as { status?: string; nextStep?: string };
    expect(payload?.status).toBe("pending-configuration");
    expect(payload?.nextStep).toBe("apply-configuration");
  });
});
