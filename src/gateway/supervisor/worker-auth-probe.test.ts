import { describe, expect, it, vi } from "vitest";
import * as cliBackendProbe from "../../agents/cli-backend-probe.js";
import type { ResolvedIdentity, ResolvedPlacement } from "../../fabric/worker/types.js";
import * as localIdeGatewayProbe from "./local-ide-gateway-probe.js";
import type { NodeInvokePort } from "./node-invoke-port.js";
import { GatewayWorkerAuthProbe } from "./worker-auth-probe.js";

const gatewayPlacement: ResolvedPlacement = {
  placement: "gateway",
  executor: "gateway",
  fallback: "escalate",
};

describe("GatewayWorkerAuthProbe", () => {
  it("returns declared status when node agent is unavailable without gateway fallback", async () => {
    // Isolate from host CLI installs: gateway fallback would return source=probe if cursor-cli exists.
    vi.spyOn(localIdeGatewayProbe, "probeLocalIdeLoginOnGateway").mockResolvedValue(null);
    const authProbe = new GatewayWorkerAuthProbe(undefined);
    const identity: ResolvedIdentity = { policy: "local_ide_login", status: "configured" };
    const nodePlacement: ResolvedPlacement = {
      placement: "node_agent",
      executor: "node_agent",
      fallback: "escalate",
    };
    const result = await authProbe.probe({
      workerId: "cursor-cli",
      placement: nodePlacement,
      identity,
    });
    expect(result.source).toBe("declared");
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain("Node Agent");
    vi.restoreAllMocks();
  });

  it("probes local IDE auth via node agent when command is declared", async () => {
    const nodeInvoke: NodeInvokePort = {
      invoke: async () => ({
        ok: true,
        payloadJSON: JSON.stringify({
          installed: true,
          authenticated: true,
          status: "validated",
        }),
      }),
      getDeclaredCommands: () => ["supervisor.worker.probe"],
      isConnected: () => true,
    };
    const authProbe = new GatewayWorkerAuthProbe(undefined, undefined, nodeInvoke);
    const result = await authProbe.probe({
      workerId: "cursor-cli",
      placement: {
        placement: "node_agent",
        executor: "node_agent",
        nodeAgentId: "mac-node",
        fallback: "escalate",
      },
      identity: { policy: "local_ide_login", status: "configured" },
    });
    expect(result.source).toBe("probe");
    expect(result.authenticated).toBe(true);
  });

  it("probes gateway CLI install + credential status for enterprise_shared workers", async () => {
    vi.spyOn(cliBackendProbe, "probeCliBackendCommand").mockResolvedValue({
      ok: true,
      resolved: true,
    });
    const authProbe = new GatewayWorkerAuthProbe(undefined);
    const identity: ResolvedIdentity = {
      policy: "enterprise_shared",
      status: "validated",
      credentialId: "cred-1",
    };
    const result = await authProbe.probe({
      workerId: "codex-cli",
      placement: gatewayPlacement,
      identity,
    });
    expect(result.source).toBe("probe");
    expect(result.installed).toBe(true);
    expect(result.authenticated).toBe(true);
    vi.restoreAllMocks();
  });

  it("marks unauthenticated when CLI is installed but credential is missing", async () => {
    vi.spyOn(cliBackendProbe, "probeCliBackendCommand").mockResolvedValue({
      ok: true,
      resolved: true,
    });
    const authProbe = new GatewayWorkerAuthProbe(undefined);
    const identity: ResolvedIdentity = { policy: "enterprise_shared", status: "missing" };
    const result = await authProbe.probe({
      workerId: "codex-cli",
      placement: gatewayPlacement,
      identity,
    });
    expect(result.installed).toBe(true);
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain("Credential");
    vi.restoreAllMocks();
  });

  it("falls through to host CLI when node reports unauthenticated", async () => {
    vi.spyOn(localIdeGatewayProbe, "probeLocalIdeLoginOnGateway").mockResolvedValue({
      installed: true,
      authenticated: true,
      status: "validated",
      source: "probe",
      reason: "Gateway host CLI login validated",
    });
    const nodeInvoke: NodeInvokePort = {
      invoke: async () => ({
        ok: true,
        payloadJSON: JSON.stringify({
          installed: true,
          authenticated: false,
          status: "configured",
          reason: "IDE login required for cursor-agent",
        }),
      }),
      getDeclaredCommands: () => ["supervisor.worker.probe"],
      isConnected: () => true,
    };
    const authProbe = new GatewayWorkerAuthProbe(undefined, undefined, nodeInvoke);
    const result = await authProbe.probe({
      workerId: "cursor-cli",
      placement: {
        placement: "node_agent",
        executor: "node_agent",
        nodeAgentId: "mac-node",
        fallback: "escalate",
      },
      identity: { policy: "local_ide_login", status: "configured" },
    });
    expect(result.authenticated).toBe(true);
    expect(result.source).toBe("probe");
    expect(result.reason).toMatch(/host CLI|Gateway/i);
    vi.restoreAllMocks();
  });
});
