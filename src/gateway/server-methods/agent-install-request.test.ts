import { describe, expect, it } from "vitest";
import { agentInstallRequestHandlers } from "./agent-install-request.js";

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

async function invoke(method: string, params: Record<string, unknown>): Promise<HandlerResponse> {
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

describe("agent-install-request handlers", () => {
  it("request-send creates a pending install request", async () => {
    const res = await invoke("agent-install.request-send", {
      targetRobotId: "robot-1",
      capabilityId: "cap-1",
      actorType: "dabai-proxy",
      actorId: "dabai-session-1",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as {
      requestId?: string;
      status?: string;
      targetReviewStatus?: string;
    };
    expect(payload?.requestId).toBeTruthy();
    expect(payload?.status).toBe("pending-target-review");
    expect(payload?.targetReviewStatus).toBe("sent");
  });

  it("request-review returns pending requests for a target robot", async () => {
    await invoke("agent-install.request-send", {
      targetRobotId: "robot-review",
      capabilityId: "cap-review",
      actorType: "robot-self",
      actorId: "robot-review",
    });

    const res = await invoke("agent-install.request-review", { targetRobotId: "robot-review" });
    expect(res.ok).toBe(true);
    const payload = res.payload as { pendingRequests?: unknown[]; totalPending?: number };
    expect(payload?.totalPending).toBeGreaterThan(0);
    expect(payload?.pendingRequests?.length).toBeGreaterThan(0);
  });

  it("request-accept routes into unified install service and produces installed status", async () => {
    const sendRes = await invoke("agent-install.request-send", {
      targetRobotId: "robot-accept",
      capabilityId: "cap-accept",
      actorType: "dabai-proxy",
      actorId: "dabai-session-2",
    });
    const requestId = (sendRes.payload as { requestId: string }).requestId;

    const res = await invoke("agent-install.request-accept", { requestId });
    expect(res.ok).toBe(true);
    const payload = res.payload as {
      status?: string;
      targetReviewStatus?: string;
      installRequestId?: string;
    };
    expect(payload?.status).toBe("installed");
    expect(payload?.targetReviewStatus).toBe("accepted");
    expect(payload?.installRequestId).toBeTruthy();
  });

  it("request-reject transitions request to rejected", async () => {
    const sendRes = await invoke("agent-install.request-send", {
      targetRobotId: "robot-reject",
      capabilityId: "cap-reject",
      actorType: "robot-self",
      actorId: "robot-reject",
    });
    const requestId = (sendRes.payload as { requestId: string }).requestId;

    const res = await invoke("agent-install.request-reject", {
      requestId,
      rejectionReason: "不信任该来源",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as {
      status?: string;
      targetReviewStatus?: string;
      rejectionReason?: string;
    };
    expect(payload?.status).toBe("rejected");
    expect(payload?.targetReviewStatus).toBe("rejected");
    expect(payload?.rejectionReason).toBe("不信任该来源");
  });

  it("request-suggest-alternative sets alternative suggestion", async () => {
    const sendRes = await invoke("agent-install.request-send", {
      targetRobotId: "robot-alt",
      capabilityId: "cap-alt",
      actorType: "dabai-proxy",
      actorId: "dabai-session-3",
    });
    const requestId = (sendRes.payload as { requestId: string }).requestId;

    const res = await invoke("agent-install.request-suggest-alternative", {
      requestId,
      alternativeCapabilityId: "cap-alt-better",
      alternativeCapabilityName: "更好的能力",
      reason: "原能力权限过高",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as {
      targetReviewStatus?: string;
      alternativeSuggestion?: { capabilityId: string };
    };
    expect(payload?.targetReviewStatus).toBe("alternative-suggested");
    expect(payload?.alternativeSuggestion?.capabilityId).toBe("cap-alt-better");
  });
});
