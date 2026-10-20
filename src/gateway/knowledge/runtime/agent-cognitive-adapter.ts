import { getAgent } from "../../agent-runtime-store.js";
import type { KnowledgeAgentType } from "../../enterprise-data/types.js";
import type { GatewayClient } from "../../server-methods/types.js";
import { loadKnowledgeSourceBundle } from "../source-bundle.js";
import type { KnowledgeSourceBundle } from "../sources/types.js";
import type {
  DataCapabilityDescriptor,
  KnowledgeAgentProfile,
  KnowledgeObject,
  KnowledgeSource,
  KnowledgeTaskContext,
  RelationshipGraph,
} from "../types.js";

/** Placeholder written over an unauthorized capability title on the agent surface. */
export const UNAUTHORIZED_CAPABILITY_TITLE = "未授权能力";

type CapabilityTitleRef = Pick<DataCapabilityDescriptor, "id" | "title" | "accessState">;

const DEFAULT_AGENT_TYPE: KnowledgeAgentType = "employee-agent";

export function resolveAgentKnowledgeType(params: {
  agentId?: string | null;
  taskContext?: KnowledgeTaskContext | null;
}): KnowledgeAgentType {
  if (params.taskContext?.agentType) {
    return params.taskContext.agentType;
  }
  if (params.agentId) {
    const agent = getAgent(params.agentId);
    if (agent?.name.toLowerCase().includes("platform")) {
      return "platform-agent";
    }
    if (agent?.name.toLowerCase().includes("position")) {
      return "position-agent";
    }
  }
  return DEFAULT_AGENT_TYPE;
}

export function filterObjectsForAgentConsumption(objects: KnowledgeObject[]): KnowledgeObject[] {
  return objects.filter((item) => item.accessState !== "restricted");
}

function unauthorizedCapabilities(
  capabilities: readonly CapabilityTitleRef[],
): CapabilityTitleRef[] {
  return capabilities.filter(
    (item) => item.accessState !== "granted" && item.title.trim().length > 0,
  );
}

function redactCapabilityTitles(
  value: string | undefined,
  titles: readonly string[],
): string | undefined {
  if (!value) {
    return value;
  }
  let next = value;
  for (const title of titles) {
    if (next.includes(title)) {
      next = next.split(title).join(UNAUTHORIZED_CAPABILITY_TITLE);
    }
  }
  return next;
}

/**
 * Agent cognitive graphs must not carry titles of capabilities the seat is not
 * granted. Restricted-object filtering stays separate. Authorized knowledge
 * object titles are left in place; only capability nodes, embedded summaries,
 * and edge reasons are stripped or redacted.
 */
export function stripUnauthorizedCapabilitySurface(params: {
  graph: RelationshipGraph;
  objects: KnowledgeObject[];
  capabilities: readonly CapabilityTitleRef[];
}): { graph: RelationshipGraph; objects: KnowledgeObject[] } {
  const unauthorized = unauthorizedCapabilities(params.capabilities);
  if (unauthorized.length === 0) {
    return { graph: params.graph, objects: params.objects };
  }
  const titles = [...new Set(unauthorized.map((item) => item.title))].toSorted(
    (left, right) => right.length - left.length,
  );
  const dropObjectIds = new Set(unauthorized.map((item) => `obj:data:${item.id}`));
  const droppedNodeIds = new Set(
    params.graph.nodes
      .filter((node) => node.objectId != null && dropObjectIds.has(node.objectId))
      .map((node) => node.id),
  );
  const nodes = params.graph.nodes.flatMap((node) => {
    if (droppedNodeIds.has(node.id)) {
      return [];
    }
    const summary = redactCapabilityTitles(node.summary, titles);
    const title =
      node.kind === "data-capability" && node.id !== "node:hub:data"
        ? (redactCapabilityTitles(node.title, titles) ?? node.title)
        : node.title;
    if (summary === node.summary && title === node.title) {
      return [node];
    }
    return [{ ...node, title, summary }];
  });
  const edges = params.graph.edges
    .filter((edge) => !droppedNodeIds.has(edge.sourceId) && !droppedNodeIds.has(edge.targetId))
    .map((edge) => {
      if (!edge.reasons?.length) {
        return edge;
      }
      const reasons = edge.reasons.map(
        (reason) => redactCapabilityTitles(reason, titles) ?? reason,
      );
      if (reasons.every((reason, index) => reason === edge.reasons?.[index])) {
        return edge;
      }
      return { ...edge, reasons };
    });
  const objects = params.objects.flatMap((object) => {
    if (dropObjectIds.has(object.id)) {
      return [];
    }
    const summary = redactCapabilityTitles(object.summary, titles) ?? object.summary;
    if (summary === object.summary) {
      return [object];
    }
    return [{ ...object, summary }];
  });
  return { graph: { nodes, edges }, objects };
}

export function buildAgentKnowledgeProfile(params: {
  bundle: KnowledgeSourceBundle;
  agentId: string;
  agentType: KnowledgeAgentType;
  taskContext?: KnowledgeTaskContext | null;
}): KnowledgeAgentProfile {
  const grantedCapabilities = params.bundle.dataCapabilities
    .filter((item) => item.accessState === "granted")
    .map((item) => item.id);
  const enabledSources: KnowledgeSource[] = ["personal"];
  if (params.bundle.sourceBrowse.enterprise.length > 0) {
    enabledSources.push("enterprise");
  }
  if (params.bundle.dataCapabilities.length > 0) {
    enabledSources.push("data");
  }
  const requestedSources = params.taskContext?.requestedSourceHints;
  const resolvedSources = requestedSources?.length
    ? enabledSources.filter((source) => requestedSources.includes(source))
    : enabledSources;
  const requestedCapabilities = params.taskContext?.requestedCapabilities ?? [];
  // Allow list is the granted set only. An empty grant does not fall back to
  // customer.profile, and a request cannot admit a capability that is not granted.
  const allowDataCapabilities = requestedCapabilities.length
    ? grantedCapabilities.filter((id) => requestedCapabilities.includes(id))
    : grantedCapabilities;
  return {
    agentId: params.agentId,
    enabledSources: resolvedSources.length ? resolvedSources : enabledSources,
    preferredKnowledgeKinds: params.taskContext?.requestedKinds ?? [
      "document",
      "policy",
      "insight",
      "project",
    ],
    retrievalMode: "balanced",
    allowDataCapabilities,
    confidenceThreshold: params.agentType === "platform-agent" ? 0.75 : 0.65,
  };
}

export async function resolveAgentKnowledgeProfile(
  client: GatewayClient | null,
  params: { agentId?: string; taskContext?: KnowledgeTaskContext | null },
): Promise<KnowledgeAgentProfile> {
  const agentId = params.agentId ?? params.taskContext?.agentId ?? "default-agent";
  const agentType = resolveAgentKnowledgeType({
    agentId,
    taskContext: params.taskContext ?? null,
  });
  const bundle = await loadKnowledgeSourceBundle(client);
  return buildAgentKnowledgeProfile({
    bundle,
    agentId,
    agentType,
    taskContext: params.taskContext ?? null,
  });
}
