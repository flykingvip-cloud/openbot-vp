/**
 * supervisor/node-agent-registry.ts — Node Agent availability lookup (M5).
 *
 * Pure port consumed by PlacementResolver. Binds seats to connected nodes via
 * node-seat-binding-store; dev override via OPENBOT_NODE_AGENT_STUB_* env.
 */

import { SUPERVISOR_WORKER_DISPATCH_COMMAND } from "../../infra/node-commands.js";
import type { NodeRegistry } from "../node-registry.js";
import { getNodeSeatBinding } from "./node-seat-binding-store.js";

export type NodeAgentRecord = {
  nodeAgentId: string;
  online: boolean;
  /** False when connected but missing supervisor.worker.dispatch. Undefined = unknown/stub. */
  supportsSupervisorWorker?: boolean;
};

export interface NodeAgentRegistry {
  resolveNodeAgent(input?: { tenantId?: string; seatId?: string }): Promise<NodeAgentRecord | null>;
}

/** Default: no Node Agent registered. */
export class StubNodeAgentRegistry implements NodeAgentRegistry {
  async resolveNodeAgent(_input?: {
    tenantId?: string;
    seatId?: string;
  }): Promise<NodeAgentRecord | null> {
    return null;
  }
}

/** Dev stub: OPENBOT_NODE_AGENT_STUB_ONLINE=1 simulates an online agent. */
export class EnvStubNodeAgentRegistry implements NodeAgentRegistry {
  async resolveNodeAgent(_input?: {
    tenantId?: string;
    seatId?: string;
  }): Promise<NodeAgentRecord | null> {
    if (process.env.OPENBOT_NODE_AGENT_STUB_ONLINE !== "1") {
      return null;
    }
    const nodeAgentId = process.env.OPENBOT_NODE_AGENT_STUB_ID?.trim() || "stub-node";
    return { nodeAgentId, online: true, supportsSupervisorWorker: true };
  }
}

/** Production registry backed by gateway NodeRegistry + seat bindings. */
export class GatewayNodeAgentRegistry implements NodeAgentRegistry {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly storePath?: string,
  ) {}

  async resolveNodeAgent(input: {
    tenantId?: string;
    seatId?: string;
  }): Promise<NodeAgentRecord | null> {
    if (process.env.OPENBOT_NODE_AGENT_STUB_ONLINE === "1") {
      return new EnvStubNodeAgentRegistry().resolveNodeAgent(input);
    }

    const tenantId = input.tenantId?.trim();
    const seatId = input.seatId?.trim();
    if (tenantId && seatId) {
      const binding = await getNodeSeatBinding(tenantId, seatId, this.storePath);
      if (binding) {
        const session = this.nodeRegistry.get(binding.nodeId);
        const online = Boolean(session);
        const supportsSupervisorWorker = session
          ? session.commands.includes(SUPERVISOR_WORKER_DISPATCH_COMMAND)
          : false;
        return { nodeAgentId: binding.nodeId, online, supportsSupervisorWorker };
      }
    }

    return null;
  }
}

export function createDefaultNodeAgentRegistry(nodeRegistry?: NodeRegistry): NodeAgentRegistry {
  if (nodeRegistry) {
    return new GatewayNodeAgentRegistry(nodeRegistry);
  }
  if (process.env.OPENBOT_NODE_AGENT_STUB_ONLINE === "1") {
    return new EnvStubNodeAgentRegistry();
  }
  return new StubNodeAgentRegistry();
}
