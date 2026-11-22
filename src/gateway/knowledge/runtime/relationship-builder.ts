import {
  normalizeKnowledgeTitleKey,
  titleKeysForWikilinkTarget,
} from "../document-obsidian-extract.js";
import type { EventLoopYielder } from "../event-loop-yield.js";
import type { ExplicitDocumentMetadataRecord } from "../explicit-metadata-store.js";
import type { DataCapabilityDescriptor, KnowledgeObject, RelationshipEdgeType } from "../types.js";
import type { CandidateRelationship } from "./types.js";

/** Pair iterations between yield checks during a cache-miss graph build. */
export const RELATIONSHIP_CANDIDATE_YIELD_EVERY = 256;

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function sharedTags(left: KnowledgeObject, right: KnowledgeObject): string[] {
  const rightTags = new Set(right.tags.map(normalizeTag));
  return left.tags.map(normalizeTag).filter((tag) => tag && rightTags.has(tag));
}

function isProjectObject(object: KnowledgeObject): boolean {
  return object.kind === "project" || object.tags.some((tag) => normalizeTag(tag).includes("项目"));
}

function isAgentObject(object: KnowledgeObject): boolean {
  return (
    object.id.startsWith("obj:agent:") ||
    object.tags.some((tag) => ["机器人", "agent", "bot"].includes(normalizeTag(tag)))
  );
}

function isOwnerObject(object: KnowledgeObject): boolean {
  return object.tags.some((tag) => ["负责人", "owner"].includes(normalizeTag(tag)));
}

function pushCandidate(
  candidates: CandidateRelationship[],
  seen: Set<string>,
  candidate: CandidateRelationship,
) {
  const key = [candidate.sourceObjectId, candidate.targetObjectId, candidate.relationType].join(
    "::",
  );
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push(candidate);
}

/**
 * Classify an explicit `relatedObjectIds` reference into a relation type + base score.
 *  - `obj:data:*` target → `recommended-for` (a data capability recommended for the object).
 *  - deliverable → knowledge base → `archived-into` (成果 沉淀入 知识库): the archived deliverable
 *    sediments into the KB. Reads correctly in the source→target direction, unlike the generic
 *    `derived-from`, which would read "成果 派生自 知识库" (backwards for sedimentation).
 *  - everything else → `derived-from`.
 */
function classifyExplicitReference(
  sourceId: string,
  targetId: string,
): { relationType: RelationshipEdgeType; baseScore: number } {
  if (targetId.startsWith("obj:data:")) {
    return { relationType: "recommended-for", baseScore: 82 };
  }
  if (sourceId.startsWith("obj:deliverable:") && targetId.startsWith("obj:kb:")) {
    return { relationType: "archived-into", baseScore: 78 };
  }
  return { relationType: "derived-from", baseScore: 76 };
}

export function buildCandidateRelationships(params: {
  objects: KnowledgeObject[];
  dataCapabilities?: DataCapabilityDescriptor[];
  /** P2 Obsidian explicit metadata records (optional). */
  explicitMetadata?: ExplicitDocumentMetadataRecord[];
}): CandidateRelationship[] {
  const candidates: CandidateRelationship[] = [];
  const seen = new Set<string>();
  const byId = new Map(params.objects.map((item) => [item.id, item]));

  for (let index = 0; index < params.objects.length; index += 1) {
    for (let inner = index + 1; inner < params.objects.length; inner += 1) {
      const left = params.objects[index];
      const right = params.objects[inner];
      const overlap = sharedTags(left, right);
      if (overlap.length) {
        pushCandidate(candidates, seen, {
          sourceObjectId: left.id,
          targetObjectId: right.id,
          relationType: "related",
          reasons: [`shared-tags:${overlap.join(",")}`],
          baseScore: 58 + Math.min(overlap.length * 8, 24),
        });
      }
      if (isProjectObject(left) && isProjectObject(right)) {
        pushCandidate(candidates, seen, {
          sourceObjectId: left.id,
          targetObjectId: right.id,
          relationType: "supports",
          reasons: ["shared-project-context"],
          baseScore: 64,
        });
      }
      if (left.scopeLabel && left.scopeLabel === right.scopeLabel) {
        pushCandidate(candidates, seen, {
          sourceObjectId: left.id,
          targetObjectId: right.id,
          relationType: "owned-by",
          reasons: [`shared-scope:${left.scopeLabel}`],
          baseScore: 62,
        });
      }
    }
  }

  addNonPairwiseCandidateRelationships({
    objects: params.objects,
    dataCapabilities: params.dataCapabilities,
    explicitMetadata: params.explicitMetadata,
    candidates,
    seen,
    byId,
  });

  return candidates;
}

function addNonPairwiseCandidateRelationships(params: {
  objects: KnowledgeObject[];
  dataCapabilities?: DataCapabilityDescriptor[];
  explicitMetadata?: ExplicitDocumentMetadataRecord[];
  candidates: CandidateRelationship[];
  seen: Set<string>;
  byId: Map<string, KnowledgeObject>;
}): void {
  const { candidates, seen, byId } = params;
  for (const object of params.objects) {
    for (const relatedId of object.relatedObjectIds ?? []) {
      if (!byId.has(relatedId)) {
        continue;
      }
      const { relationType, baseScore } = classifyExplicitReference(object.id, relatedId);
      pushCandidate(candidates, seen, {
        sourceObjectId: object.id,
        targetObjectId: relatedId,
        relationType,
        reasons: ["explicit-reference"],
        baseScore,
      });
    }
  }

  // P2: Obsidian [[wikilink]] edges — resolve *source* by docId first (never title-first).
  // Targets still resolve by title keys within the same object set.
  if (params.explicitMetadata?.length) {
    const byTitle = new Map<string, string[]>();
    for (const object of params.objects) {
      const key = normalizeKnowledgeTitleKey(object.title);
      if (!key) {
        continue;
      }
      const list = byTitle.get(key) ?? [];
      list.push(object.id);
      byTitle.set(key, list);
    }
    const objectByDocId = new Map<string, string>();
    for (const object of params.objects) {
      objectByDocId.set(object.id, object.id);
      const personal = object.id.replace(/^obj:personal:/, "");
      if (personal !== object.id) {
        objectByDocId.set(personal, object.id);
      }
      const bare = object.id.replace(/^obj:/, "");
      if (bare !== object.id) {
        objectByDocId.set(bare, object.id);
      }
    }
    for (const record of params.explicitMetadata) {
      // Prefer exact docId match; only then consider unique title within this set.
      let sourceId =
        objectByDocId.get(record.docId) ??
        params.objects.find((item) => item.id === record.docId || item.id.endsWith(record.docId))
          ?.id;
      if (!sourceId) {
        const titleKey = normalizeKnowledgeTitleKey(record.title);
        const titleMatches = titleKey ? (byTitle.get(titleKey) ?? []) : [];
        // Only use title when unambiguous (single match) — never pick first of many.
        if (titleMatches.length === 1) {
          sourceId = titleMatches[0];
        }
      }
      if (!sourceId) {
        continue;
      }
      for (const link of record.wikilinks) {
        for (const key of titleKeysForWikilinkTarget(link.target)) {
          for (const targetId of byTitle.get(key) ?? []) {
            if (targetId === sourceId) {
              continue;
            }
            pushCandidate(candidates, seen, {
              sourceObjectId: sourceId,
              targetObjectId: targetId,
              relationType: "related",
              reasons: [`explicit-wikilink:${link.target}`],
              baseScore: 88,
            });
          }
        }
      }
    }
  }

  for (const capability of params.dataCapabilities ?? []) {
    const capabilityObjectId = `obj:data:${capability.id}`;
    if (!byId.has(capabilityObjectId)) {
      continue;
    }
    for (const object of params.objects) {
      if (object.source !== "enterprise") {
        continue;
      }
      if (object.relatedObjectIds?.includes(capabilityObjectId)) {
        pushCandidate(candidates, seen, {
          sourceObjectId: object.id,
          targetObjectId: capabilityObjectId,
          relationType: "recommended-for",
          reasons: [`capability-scenario:${capability.scenarios[0] ?? capability.title}`],
          baseScore: capability.accessState === "granted" ? 86 : 70,
        });
      }
    }
    for (const agentId of capability.visibleAgents) {
      const agentObjectId = `obj:agent:${agentId}`;
      if (!byId.has(agentObjectId)) {
        continue;
      }
      pushCandidate(candidates, seen, {
        sourceObjectId: capabilityObjectId,
        targetObjectId: agentObjectId,
        relationType: "used-by",
        reasons: [`visible-agent:${agentId}`],
        baseScore: 80,
      });
    }
  }

  for (const object of params.objects) {
    if (!isAgentObject(object)) {
      continue;
    }
    for (const other of params.objects) {
      if (other.source === "data" && sharedTags(object, other).length) {
        pushCandidate(candidates, seen, {
          sourceObjectId: other.id,
          targetObjectId: object.id,
          relationType: "used-by",
          reasons: ["agent-topic-overlap"],
          baseScore: 74,
        });
      }
    }
  }

  for (const object of params.objects) {
    if (!isOwnerObject(object)) {
      continue;
    }
    for (const other of params.objects) {
      if (other.id === object.id) {
        continue;
      }
      if (sharedTags(object, other).length || object.scopeLabel === other.scopeLabel) {
        pushCandidate(candidates, seen, {
          sourceObjectId: other.id,
          targetObjectId: object.id,
          relationType: "owned-by",
          reasons: ["owner-link"],
          baseScore: 72,
        });
      }
    }
  }
}

export async function buildCandidateRelationshipsAsync(
  params: {
    objects: KnowledgeObject[];
    dataCapabilities?: DataCapabilityDescriptor[];
    explicitMetadata?: ExplicitDocumentMetadataRecord[];
  },
  options?: { yieldFn?: EventLoopYielder; yieldEvery?: number },
): Promise<CandidateRelationship[]> {
  const yieldEvery = Math.max(1, options?.yieldEvery ?? RELATIONSHIP_CANDIDATE_YIELD_EVERY);
  const yieldFn = options?.yieldFn;
  const candidates: CandidateRelationship[] = [];
  const seen = new Set<string>();
  const byId = new Map(params.objects.map((item) => [item.id, item]));
  let steps = 0;

  for (let index = 0; index < params.objects.length; index += 1) {
    for (let inner = index + 1; inner < params.objects.length; inner += 1) {
      const left = params.objects[index];
      const right = params.objects[inner];
      const overlap = sharedTags(left, right);
      if (overlap.length) {
        pushCandidate(candidates, seen, {
          sourceObjectId: left.id,
          targetObjectId: right.id,
          relationType: "related",
          reasons: [`shared-tags:${overlap.join(",")}`],
          baseScore: 58 + Math.min(overlap.length * 8, 24),
        });
      }
      if (isProjectObject(left) && isProjectObject(right)) {
        pushCandidate(candidates, seen, {
          sourceObjectId: left.id,
          targetObjectId: right.id,
          relationType: "supports",
          reasons: ["shared-project-context"],
          baseScore: 64,
        });
      }
      if (left.scopeLabel && left.scopeLabel === right.scopeLabel) {
        pushCandidate(candidates, seen, {
          sourceObjectId: left.id,
          targetObjectId: right.id,
          relationType: "owned-by",
          reasons: [`shared-scope:${left.scopeLabel}`],
          baseScore: 62,
        });
      }
      steps += 1;
      if (yieldFn && steps % yieldEvery === 0) {
        await yieldFn();
      }
    }
  }

  addNonPairwiseCandidateRelationships({
    objects: params.objects,
    dataCapabilities: params.dataCapabilities,
    explicitMetadata: params.explicitMetadata,
    candidates,
    seen,
    byId,
  });
  if (yieldFn) {
    await yieldFn();
  }
  return candidates;
}
