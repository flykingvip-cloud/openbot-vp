import type { NodeMatchCandidate } from "../shared/node-match.js";
import { resolveNodeIdFromNodeList } from "../shared/node-resolve.js";

export type ExecNodeCandidate = NodeMatchCandidate & {
  commands?: string[];
  platform?: string;
};

const NO_PAIRED_NODE =
  "exec host=node requires a paired node (none available). This requires a companion app or node host.";
const NO_SYSTEM_RUN =
  "exec host=node requires a node that supports system.run (companion app or node host).";
const MULTIPLE_NODES =
  "exec host=node requires a node id when multiple nodes are available (set tools.exec.node or exec.node).";

function supportsSystemRun(node: ExecNodeCandidate): boolean {
  return Array.isArray(node.commands) && node.commands.includes("system.run");
}

/**
 * Pick the node that will run `host=node` exec.
 *
 * A single system.run node is selected automatically, including when other
 * paired devices are offline. Several online system.run nodes stay explicit:
 * the operator must set `tools.exec.node` (or pass `exec.node`). This does not
 * use the canvas default picker.
 */
export function selectSystemRunNode<TNode extends ExecNodeCandidate>(
  nodes: readonly TNode[],
  query?: string,
): TNode {
  if (nodes.length === 0) {
    throw new Error(NO_PAIRED_NODE);
  }
  const requested = query?.trim() ?? "";
  if (requested) {
    const nodeId = resolveNodeIdFromNodeList([...nodes], requested, { allowDefault: false });
    const node = nodes.find((entry) => entry.nodeId === nodeId);
    if (!node || !supportsSystemRun(node)) {
      throw new Error(NO_SYSTEM_RUN);
    }
    return node;
  }

  const runnable = nodes.filter(supportsSystemRun);
  if (runnable.length === 0) {
    throw new Error(NO_SYSTEM_RUN);
  }
  const online = runnable.filter((node) => node.connected !== false);
  const pool = online.length > 0 ? online : runnable;
  const selected = pool.length === 1 ? pool[0] : undefined;
  if (!selected) {
    throw new Error(MULTIPLE_NODES);
  }
  return selected;
}
