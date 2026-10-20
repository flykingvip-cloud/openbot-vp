import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeRegistry } from "../node-registry.js";
import { GatewayPlacementResolver } from "./execution-context.js";
import { EnvStubNodeAgentRegistry, GatewayNodeAgentRegistry } from "./node-agent-registry.js";
import { upsertNodeSeatBinding } from "./node-seat-binding-store.js";

describe("NodeAgentRegistry", () => {
  it("env stub returns online agent when OPENBOT_NODE_AGENT_STUB_ONLINE=1", async () => {
    const prev = process.env.OPENBOT_NODE_AGENT_STUB_ONLINE;
    process.env.OPENBOT_NODE_AGENT_STUB_ONLINE = "1";
    process.env.OPENBOT_NODE_AGENT_STUB_ID = "dev-node";
    try {
      await expect(new EnvStubNodeAgentRegistry().resolveNodeAgent({})).resolves.toEqual({
        nodeAgentId: "dev-node",
        online: true,
        supportsSupervisorWorker: true,
      });
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_NODE_AGENT_STUB_ONLINE;
      } else {
        process.env.OPENBOT_NODE_AGENT_STUB_ONLINE = prev;
      }
      delete process.env.OPENBOT_NODE_AGENT_STUB_ID;
    }
  });
});

describe("GatewayNodeAgentRegistry", () => {
  let storePath: string;
  let nodeRegistry: NodeRegistry;

  beforeEach(() => {
    storePath = path.join(mkdtempSync(path.join(tmpdir(), "node-agent-reg-")), "bindings.json");
    nodeRegistry = new NodeRegistry();
  });

  afterEach(() => {
    rmSync(path.dirname(storePath), { recursive: true, force: true });
  });

  it("returns offline record when seat is bound but node is disconnected", async () => {
    await upsertNodeSeatBinding(
      { tenantId: "t1", seatId: "seat-1", nodeId: "mac-node" },
      storePath,
    );
    const registry = new GatewayNodeAgentRegistry(nodeRegistry, storePath);
    await expect(registry.resolveNodeAgent({ tenantId: "t1", seatId: "seat-1" })).resolves.toEqual({
      nodeAgentId: "mac-node",
      online: false,
      supportsSupervisorWorker: false,
    });
  });
});

describe("GatewayPlacementResolver + NodeAgentRegistry", () => {
  it("returns node_agent placement when registry reports online", async () => {
    const resolver = new GatewayPlacementResolver({
      resolveNodeAgent: async () => ({ nodeAgentId: "seat-node", online: true }),
    });
    await expect(
      resolver.resolve({
        workerId: "cursor-cli",
        requested: "node_agent",
        tenantId: "t1",
      }),
    ).resolves.toMatchObject({
      placement: "node_agent",
      executor: "node_agent",
      nodeAgentId: "seat-node",
    });
  });

  it("escalates when bound node is offline", async () => {
    const resolver = new GatewayPlacementResolver({
      resolveNodeAgent: async () => ({ nodeAgentId: "seat-node", online: false }),
    });
    await expect(
      resolver.resolve({
        workerId: "cursor-cli",
        requested: "node_agent",
        tenantId: "t1",
      }),
    ).resolves.toEqual({
      fallback: "escalate",
      reason: 'Node Agent "seat-node" is offline',
    });
  });

  it("escalates when node is online but lacks supervisor worker support", async () => {
    const resolver = new GatewayPlacementResolver({
      resolveNodeAgent: async () => ({
        nodeAgentId: "seat-node",
        online: true,
        supportsSupervisorWorker: false,
      }),
    });
    await expect(
      resolver.resolve({
        workerId: "cursor-cli",
        requested: "node_agent",
        tenantId: "t1",
        seatId: "seat-1",
      }),
    ).resolves.toEqual({
      fallback: "escalate",
      reason: 'Node Agent "seat-node" does not support supervisor workers',
    });
  });
});
