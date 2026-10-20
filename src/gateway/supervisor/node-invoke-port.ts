/**
 * supervisor/node-invoke-port.ts — thin adapter over NodeRegistry.invoke (M5).
 */

import type { NodeInvokeResult, NodeRegistry } from "../node-registry.js";

export interface NodeInvokePort {
  invoke(input: {
    nodeId: string;
    command: string;
    params: Record<string, unknown>;
    timeoutMs?: number;
    idempotencyKey?: string;
  }): Promise<NodeInvokeResult>;
  getDeclaredCommands(nodeId: string): string[];
  isConnected(nodeId: string): boolean;
}

export class NodeRegistryInvokePort implements NodeInvokePort {
  constructor(private readonly nodeRegistry: NodeRegistry) {}

  invoke(input: {
    nodeId: string;
    command: string;
    params: Record<string, unknown>;
    timeoutMs?: number;
    idempotencyKey?: string;
  }): Promise<NodeInvokeResult> {
    return this.nodeRegistry.invoke(input);
  }

  getDeclaredCommands(nodeId: string): string[] {
    return this.nodeRegistry.get(nodeId)?.commands ?? [];
  }

  isConnected(nodeId: string): boolean {
    return Boolean(this.nodeRegistry.get(nodeId));
  }
}

export class UnavailableNodeInvokePort implements NodeInvokePort {
  invoke(): Promise<NodeInvokeResult> {
    return Promise.resolve({
      ok: false,
      error: { code: "NOT_CONNECTED", message: "node registry unavailable" },
    });
  }

  getDeclaredCommands(): string[] {
    return [];
  }

  isConnected(): boolean {
    return false;
  }
}

function parseInvokePayloadJSON(payloadJSON?: string | null): Record<string, unknown> | null {
  if (!payloadJSON?.trim()) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(payloadJSON);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readNodeInvokePayload(result: NodeInvokeResult): Record<string, unknown> | null {
  if (result.payload && typeof result.payload === "object") {
    return result.payload as Record<string, unknown>;
  }
  return parseInvokePayloadJSON(result.payloadJSON);
}
