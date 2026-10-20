import { describe, expect, it, vi } from "vitest";
import type {
  CredentialResolver,
  PlacementResolver,
  WorkerAuthProbe,
} from "../../fabric/worker/types.js";
import * as localIdeGatewayProbe from "./local-ide-gateway-probe.js";
import { listSupervisorWorkerHealth } from "./worker-health.js";

describe("listSupervisorWorkerHealth", () => {
  it("aggregates identity, placement, and auth without exposing credentialEnv", async () => {
    const credentialResolver: CredentialResolver = {
      resolve: async () => ({
        policy: "enterprise_shared",
        status: "validated",
        credentialId: "cred-abc",
        credentialEnv: { OPENAI_API_KEY: "secret-should-not-leak" },
      }),
    };
    const placementResolver: PlacementResolver = {
      resolve: async () => ({
        placement: "gateway",
        executor: "gateway",
        fallback: "escalate",
      }),
    };
    const authProbe: WorkerAuthProbe = {
      probe: async () => ({
        installed: true,
        authenticated: true,
        status: "validated",
        source: "probe",
      }),
    };

    const rows = await listSupervisorWorkerHealth({
      cfg: undefined,
      backendId: "codex-cli",
      tenantId: "tenant-1",
      credentialResolver,
      placementResolver,
      authProbe,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.backendId).toBe("codex-cli");
    expect(rows[0]?.recommendedPolicy).toBe("enterprise_shared");
    expect(rows[0]?.recommendedPlacement).toBe("gateway");
    expect(rows[0]?.identity.credentialId).toBe("cred-abc");
    expect(rows[0]?.placement.available).toBe(true);
    expect(rows[0]?.auth.authenticated).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain("secret-should-not-leak");
    expect(rows[0]).not.toHaveProperty("identity.credentialEnv");
  });

  it("reports placement unavailable for local IDE workers on gateway-only resolver", async () => {
    vi.spyOn(localIdeGatewayProbe, "probeLocalIdeLoginOnGateway").mockResolvedValue(null);
    for (const backendId of ["cursor-cli", "grok-cli"]) {
      const rows = await listSupervisorWorkerHealth({
        cfg: undefined,
        backendId,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.recommendedPolicy).toBe("local_ide_login");
      expect(rows[0]?.recommendedPlacement).toBe("node_agent");
      expect(rows[0]?.placement.available).toBe(false);
      expect(rows[0]?.auth.source).toBe("declared");
    }
    vi.restoreAllMocks();
  });

  it("surfaces grok-cli login from gateway host when node placement is unavailable", async () => {
    vi.spyOn(localIdeGatewayProbe, "probeLocalIdeLoginOnGateway").mockResolvedValue({
      installed: true,
      authenticated: true,
      status: "validated",
      source: "probe",
      reason: "Gateway 宿主机探测：CLI 已登录（Node 离线时任务仍不可执行）",
    });
    const rows = await listSupervisorWorkerHealth({
      cfg: undefined,
      backendId: "grok-cli",
    });
    expect(rows[0]?.placement.available).toBe(false);
    expect(rows[0]?.auth.authenticated).toBe(true);
    expect(rows[0]?.auth.source).toBe("probe");
    vi.restoreAllMocks();
  });

  it("marks devin-cli placement available when seat-bound node is online", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const storePath = path.join(
      mkdtempSync(path.join(tmpdir(), "worker-health-")),
      "bindings.json",
    );
    try {
      const { upsertNodeSeatBinding } = await import("./node-seat-binding-store.js");
      const { NodeRegistry } = await import("../node-registry.js");
      const { GatewayPlacementResolver } = await import("./execution-context.js");
      const { GatewayNodeAgentRegistry } = await import("./node-agent-registry.js");

      await upsertNodeSeatBinding(
        { tenantId: "t1", seatId: "seat-1", nodeId: "mac-node" },
        storePath,
      );
      const nodeRegistry = new NodeRegistry();
      nodeRegistry.register(
        {
          connId: "node-conn-1",
          connect: {
            client: { id: "node-client", platform: "macos" },
            device: { id: "mac-node" },
            caps: [],
            commands: [
              "supervisor.worker.dispatch",
              "supervisor.worker.probe",
              "supervisor.worker.cancel",
            ],
          },
        } as never,
        {},
      );
      const placementResolver = new GatewayPlacementResolver(
        new GatewayNodeAgentRegistry(nodeRegistry, storePath),
      );
      const authProbe: WorkerAuthProbe = {
        probe: async () => ({
          installed: true,
          authenticated: true,
          status: "validated",
          source: "probe",
        }),
      };
      const rows = await listSupervisorWorkerHealth({
        cfg: undefined,
        tenantId: "t1",
        seatId: "seat-1",
        backendId: "devin-cli",
        placementResolver,
        authProbe,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.placement.available).toBe(true);
      expect(rows[0]?.placement.executor).toBe("node_agent");
      expect(rows[0]?.auth.authenticated).toBe(true);
    } finally {
      rmSync(path.dirname(storePath), { recursive: true, force: true });
    }
  });
});
