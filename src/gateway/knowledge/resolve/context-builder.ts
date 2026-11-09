import type { KnowledgeEvidence } from "../../../retrieval/types.js";
import type { KnowledgeConsumeReceiptItem } from "../consume-ref.js";
import type {
  KnowledgeAgentContext,
  KnowledgeAgentProfile,
  KnowledgeGovernanceSignals,
  KnowledgeObject,
  KnowledgeRecommendation,
  KnowledgeResolveIntent,
  KnowledgeResolveResult,
  RelationshipNode,
} from "../types.js";
import type { KnowledgeRelatedGroups } from "../types.js";
import { formatKnowledgeEvidencePromptLines } from "./evidence-format.js";

function formatObjectLine(object: KnowledgeObject): string {
  const tags = object.tags.length ? ` [${object.tags.join(", ")}]` : "";
  return `- ${object.id} ${object.title} (${object.source}/${object.kind})${tags}: ${object.summary}`;
}

function formatCapabilityLine(object: KnowledgeObject): string {
  const flags: string[] = [];
  const auth = object.scopeLabel?.trim() || object.accessState;
  if (auth) {
    flags.push(auth);
  }
  if (object.freshnessStatus === "stale" || object.freshnessStatus === "expired") {
    flags.push("stale");
  }
  const flagSuffix = flags.length ? ` (${flags.join(", ")})` : "";
  const tags = object.tags.length ? ` [${object.tags.join(", ")}]` : "";
  return `- ${object.title}${flagSuffix}${tags}: ${object.summary}`;
}

function formatNodeLine(node: RelationshipNode): string {
  return `- ${node.title}${node.summary ? `: ${node.summary}` : ""}`;
}

export function computeKnowledgeGovernanceSignals(params: {
  evidence: KnowledgeEvidence[];
  objects: KnowledgeObject[];
}): KnowledgeGovernanceSignals {
  let confirmed = 0;
  let conflicts = 0;
  let suppressed = 0;
  let stale = 0;
  for (const item of params.evidence) {
    if (item.governanceStatus === "confirmed") {
      confirmed += 1;
    } else if (item.governanceStatus === "suppressed") {
      suppressed += 1;
    }
    if (item.governanceConflict || item.governanceClaimConflict) {
      conflicts += 1;
    }
  }
  for (const object of params.objects) {
    if (object.freshnessStatus === "stale" || object.freshnessStatus === "expired") {
      stale += 1;
    }
  }
  return { confirmed, conflicts, suppressed, stale };
}

function formatGovernanceSignalsLine(signals: KnowledgeGovernanceSignals): string | null {
  const parts: string[] = [];
  if (signals.confirmed > 0) {
    parts.push(`${signals.confirmed} verified`);
  }
  if (signals.conflicts > 0) {
    parts.push(`${signals.conflicts} unresolved conflict${signals.conflicts > 1 ? "s" : ""}`);
  }
  if (signals.suppressed > 0) {
    parts.push(`${signals.suppressed} suppressed`);
  }
  if (signals.stale > 0) {
    parts.push(`${signals.stale} stale`);
  }
  if (parts.length === 0) {
    return null;
  }
  const advisory =
    signals.conflicts > 0 || signals.stale > 0
      ? " Treat conflicting or stale knowledge as low confidence and prefer verified sources."
      : "";
  return `- Governance signals: ${parts.join(", ")}.${advisory}`;
}

export function formatKnowledgeContextPromptBlock(params: {
  intent: KnowledgeResolveIntent;
  profile: KnowledgeAgentProfile;
  primaryObjects: KnowledgeObject[];
  relatedObjects: KnowledgeObject[];
  recommendedCapabilities: KnowledgeObject[];
  recommendedAgents: RelationshipNode[];
  recommendedOwners: RelationshipNode[];
  memoryHints?: string[];
  evidence?: KnowledgeEvidence[];
  receipts?: KnowledgeConsumeReceiptItem[];
  governanceSignals?: KnowledgeGovernanceSignals;
}): string {
  const lines = [
    "Knowledge Universe context",
    `- Intent: ${params.intent.intentType} (confidence ${Math.round(params.intent.confidence * 100)}%)`,
    `- Enabled sources: ${params.profile.enabledSources.join(", ")}`,
    `- Retrieval mode: ${params.profile.retrievalMode}`,
    "Consume knowledge through the Knowledge Universe layer only. Do not call external CRM/ERP/Connector APIs directly.",
    "Search ingested documents with knowledge_search; follow objectId or ku:// sourceUri with knowledge_get. Materialized enterprise feed objects (用友 T+ 仓库/存货 and other data products) are knowledge objects too: cite their title and summary rows. The summary is a preview; knowledge_get offset pages the rest of the materialized payload under a character budget. Do not tell the user to click 立即物化 when the excerpt is short or a default connector product looks stale — connect and the gateway sync schedule refresh those feeds. A missing seat grant is the authorization gate. memory_search is workspace/session/runtime memory only. knowledge_source is API source bind/invoke, not document body. data_capability action=invoke does not return connector rows. Do not open 云电脑 for these rows. Do not exec find or invent a local path.",
    "The same consume path applies to every robot and collaboration group. Recent-visit titles are not document body.",
  ];

  if (params.governanceSignals) {
    const governanceLine = formatGovernanceSignalsLine(params.governanceSignals);
    if (governanceLine) {
      lines.push(governanceLine);
    }
  }

  if (params.memoryHints?.length) {
    lines.push(
      `- Recent knowledge visits (titles only, not body): ${params.memoryHints.join("; ")}`,
    );
  }

  const failedReceipts = (params.receipts ?? []).filter(
    (receipt) => receipt.status === "unavailable" || receipt.status === "denied",
  );
  if (failedReceipts.length) {
    lines.push("Knowledge consume receipts:");
    for (const receipt of failedReceipts) {
      const reason = receipt.reasonCode ? ` (${receipt.reasonCode})` : "";
      lines.push(`- ${receipt.ref.type}:${receipt.ref.id} ${receipt.status}${reason}`);
    }
    lines.push(
      "If a receipt is not_indexed, the selected library has no searchable chunks. If it is no_match, the library is indexed but this question retrieved no passage — do not invent content. If it is not_found, the catalog entry is missing. Do not search the filesystem or invent a local path.",
    );
  }

  if (params.primaryObjects.length) {
    lines.push("Primary knowledge objects:");
    for (const object of params.primaryObjects) {
      lines.push(formatObjectLine(object));
    }
  }

  if (params.relatedObjects.length) {
    lines.push("Related knowledge:");
    for (const object of params.relatedObjects.slice(0, 6)) {
      lines.push(formatObjectLine(object));
    }
  }

  if (params.recommendedCapabilities.length) {
    lines.push(
      "Recommended data capabilities (auth/freshness shown; consume via the Knowledge Universe layer, never call connectors directly):",
    );
    for (const object of params.recommendedCapabilities) {
      lines.push(formatCapabilityLine(object));
    }
  }

  if (params.recommendedAgents.length) {
    lines.push("Related agents:");
    for (const node of params.recommendedAgents) {
      lines.push(formatNodeLine(node));
    }
  }

  if (params.recommendedOwners.length) {
    lines.push("Related owners:");
    for (const node of params.recommendedOwners) {
      lines.push(formatNodeLine(node));
    }
  }

  if (params.evidence?.length) {
    lines.push(...formatKnowledgeEvidencePromptLines(params.evidence));
  }

  return lines.join("\n");
}

export function buildKnowledgeAgentContext(params: {
  resolveResult: KnowledgeResolveResult;
  relatedGroups: KnowledgeRelatedGroups | null;
  recommendations: KnowledgeRecommendation[];
  memoryHints?: string[];
  evidence?: KnowledgeEvidence[];
  receipts?: KnowledgeConsumeReceiptItem[];
}): KnowledgeAgentContext {
  const primaryObjects = params.resolveResult.objects.slice(0, 3);
  const relatedObjects = params.relatedGroups
    ? [
        ...params.relatedGroups.knowledge,
        ...params.relatedGroups.dataCapabilities,
        ...params.relatedGroups.conflicts,
      ]
    : [];

  const recommendedCapabilities = params.recommendations
    .filter((item) => item.object.source === "data")
    .map((item) => item.object);

  const recommendedAgents = params.relatedGroups?.agents ?? [];
  const recommendedOwners = params.relatedGroups?.owners ?? [];

  const governanceSignals = computeKnowledgeGovernanceSignals({
    evidence: params.evidence ?? [],
    objects: [...primaryObjects, ...relatedObjects],
  });

  const promptBlock = formatKnowledgeContextPromptBlock({
    intent: params.resolveResult.intent,
    profile: params.resolveResult.profile,
    primaryObjects,
    relatedObjects,
    recommendedCapabilities,
    recommendedAgents,
    recommendedOwners,
    memoryHints: params.memoryHints,
    evidence: params.evidence,
    receipts: params.receipts,
    governanceSignals,
  });

  return {
    primaryObjects,
    relatedObjects,
    recommendedCapabilities,
    recommendedAgents,
    recommendedOwners,
    graph: params.resolveResult.graph,
    evidence: params.evidence ?? [],
    promptBlock,
    governanceSignals,
  };
}
