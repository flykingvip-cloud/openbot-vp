import { loadNodes, type NodesLoadState } from "../../controllers/nodes.ts";

export type NodesCapabilityLoadState = NodesLoadState;

export const nodesCapability = {
  load: loadNodes,
} as const;
