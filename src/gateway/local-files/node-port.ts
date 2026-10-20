/**
 * `NodeInvokePort` over the existing node registry.
 *
 * Thin by design: it maps our command and params onto `nodeRegistry.invoke` and
 * unwraps the node's reply. It performs no authorization — the node command
 * allowlist (`resolveNodeCommandAllowlist`) and the node-side profile guard already
 * gate the command, and the capability in the params gates the read.
 *
 * Note it does NOT route through the `node.invoke` gateway RPC. That method exists
 * for operator-initiated invokes; going through it would require an operator
 * connection and would also be reachable by the generic `nodes` tool, which is
 * exactly the second door the design closes (design 4.6).
 */

import type { LocalFilesOperation } from "../../local-files/types.js";
import type { NodeRegistry } from "../node-registry.js";
import type { NodeInvokeOutcome, NodeInvokePort } from "./service.js";

/** Per-call timeout. A read that cannot complete in this window is a failure. */
const NODE_INVOKE_TIMEOUT_MS = 20_000;

function decodePayload(raw: { payload?: unknown; payloadJSON?: string | null }): unknown {
  if (raw.payload !== undefined) {
    return raw.payload;
  }
  if (typeof raw.payloadJSON === "string" && raw.payloadJSON.length > 0) {
    try {
      return JSON.parse(raw.payloadJSON);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function createNodeInvokePort(
  nodeRegistry: Pick<NodeRegistry, "invoke">,
  opts?: { timeoutMs?: number },
): NodeInvokePort {
  return {
    async invoke(params: {
      nodeId: string;
      command: LocalFilesOperation;
      params: Record<string, unknown>;
    }): Promise<NodeInvokeOutcome> {
      const res = await nodeRegistry.invoke({
        nodeId: params.nodeId,
        command: params.command,
        params: params.params,
        timeoutMs: opts?.timeoutMs ?? NODE_INVOKE_TIMEOUT_MS,
      });
      if (!res.ok) {
        return { ok: false, error: res.error ?? null };
      }
      return { ok: true, payload: decodePayload(res) };
    },
  };
}
