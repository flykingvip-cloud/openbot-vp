import { describe, expect, it, vi } from "vitest";
import type {
  CredentialResolver,
  PlacementResolver,
  WorkerAuthProbe,
} from "../../fabric/worker/types.js";
import { assertExecutionChainReady, ExecutionChainGateError } from "./execution-chain-gate.js";

vi.mock("./worker-policy-store.js", () => ({
  getWorkerExecutionProfile: vi.fn(async ({ workerId }: { workerId: string }) => {
    const id = workerId.trim().toLowerCase();
    if (
      id === "cursor-cli" ||
      id === "devin-cli" ||
      id === "windsurf-cli" ||
      id === "grok-cli" ||
      id === "kiro-cli"
    ) {
      return { credentialPolicy: "local_ide_login", executionPlacement: "node_agent" };
    }
    if (id === "cursor-misconfigured") {
      // Tenant override mistake: local_ide_login + gateway — must still hard-reject.
      return { credentialPolicy: "local_ide_login", executionPlacement: "gateway" };
    }
    return { credentialPolicy: "enterprise_shared", executionPlacement: "gateway" };
  }),
}));

describe("assertExecutionChainReady (P0-1)", () => {
  it("blocks node_agent worker when Node is offline with node-online check id", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async () => ({
        fallback: "escalate",
        reason: 'Node Agent "mac-1" is offline',
      }),
    };
    await expect(
      assertExecutionChainReady({
        workerBackendId: "cursor-cli",
        tenantId: "t1",
        seatId: "seat-1",
        placementResolver,
        authAuthenticated: true,
      }),
    ).rejects.toMatchObject({
      checkId: "node-online",
      name: "ExecutionChainGateError",
    });
  });

  it("blocks node_agent worker when Node placement is unavailable with node-bound check id", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async () => ({
        fallback: "escalate",
        reason: 'Node Agent placement is not available for worker "cursor-cli"',
      }),
    };
    await expect(
      assertExecutionChainReady({
        workerBackendId: "cursor-cli",
        tenantId: "t1",
        seatId: "seat-1",
        placementResolver,
        authAuthenticated: true,
      }),
    ).rejects.toMatchObject({ checkId: "node-bound" });
  });

  it("hard-rejects node_agent worker when placement silently resolves to gateway", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async () => ({
        placement: "gateway",
        executor: "gateway",
        fallback: "escalate",
      }),
    };
    await expect(
      assertExecutionChainReady({
        workerBackendId: "cursor-cli",
        tenantId: "t1",
        seatId: "seat-1",
        placementResolver,
        authAuthenticated: true,
      }),
    ).rejects.toMatchObject({
      checkId: "node-bound",
      message: expect.stringContaining("refusing gateway fallback"),
    });
  });

  it("hard-rejects local_ide_login even when tenant policy requests gateway placement", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async (input) => {
        // Gate must request node_agent for local_ide; if somehow gateway, still reject.
        expect(input.requested).toBe("node_agent");
        return {
          placement: "gateway",
          executor: "gateway",
          fallback: "escalate",
        };
      },
    };
    await expect(
      assertExecutionChainReady({
        workerBackendId: "cursor-misconfigured",
        tenantId: "t1",
        seatId: "seat-1",
        placementResolver,
        authAuthenticated: true,
      }),
    ).rejects.toBeInstanceOf(ExecutionChainGateError);
  });

  it("requires seatId for node_agent / local_ide workers (does not use userId as seat)", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async () => {
        throw new Error("placement must not be called without seatId");
      },
    };
    await expect(
      assertExecutionChainReady({
        workerBackendId: "cursor-cli",
        tenantId: "t1",
        userId: "user-as-fake-seat",
        placementResolver,
        authAuthenticated: true,
      }),
    ).rejects.toMatchObject({ checkId: "node-bound" });
  });

  it("does not block gateway (codex) worker when Node is offline", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async () => ({
        placement: "gateway",
        executor: "gateway",
        fallback: "escalate",
      }),
    };
    const credentialResolver: CredentialResolver = {
      resolve: async (input) => ({
        policy: input.policy,
        status: "validated",
        credentialId: "corp-key",
      }),
    };
    await expect(
      assertExecutionChainReady({
        workerBackendId: "codex-cli",
        tenantId: "t1",
        placementResolver,
        credentialResolver,
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks gateway worker when enterprise credential is missing with api-key check id", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async () => ({
        placement: "gateway",
        executor: "gateway",
        fallback: "escalate",
      }),
    };
    const credentialResolver: CredentialResolver = {
      resolve: async (input) => ({ policy: input.policy, status: "missing" }),
    };
    await expect(
      assertExecutionChainReady({
        workerBackendId: "codex-cli",
        tenantId: "t1",
        placementResolver,
        credentialResolver,
      }),
    ).rejects.toMatchObject({ checkId: "api-key-codex-cli" });
  });

  it("blocks node_agent worker when local IDE is not authenticated", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async () => ({
        placement: "node_agent",
        executor: "node_agent",
        nodeAgentId: "mac-1",
        fallback: "escalate",
      }),
    };
    await expect(
      assertExecutionChainReady({
        workerBackendId: "cursor-cli",
        tenantId: "t1",
        seatId: "seat-1",
        placementResolver,
        authAuthenticated: false,
      }),
    ).rejects.toBeInstanceOf(ExecutionChainGateError);

    try {
      await assertExecutionChainReady({
        workerBackendId: "cursor-cli",
        tenantId: "t1",
        seatId: "seat-1",
        placementResolver,
        authAuthenticated: false,
      });
    } catch (err) {
      expect(err).toMatchObject({ checkId: "local-ide-cursor-cli" });
    }
  });

  it("allows node_agent worker when Node is online and auth is ready", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async () => ({
        placement: "node_agent",
        executor: "node_agent",
        nodeAgentId: "mac-1",
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
    await expect(
      assertExecutionChainReady({
        workerBackendId: "cursor-cli",
        tenantId: "t1",
        seatId: "seat-1",
        placementResolver,
        authProbe,
      }),
    ).resolves.toBeUndefined();
  });
});
