import type {
  Decision,
  Deliverable,
  GroupCapabilityProfile,
  GroupMemory,
  Review,
  Task,
} from "@openbot/collaboration-core";
import {
  DefaultCapabilityComposer,
  type CapabilityComposer,
} from "../contracts/capability-composer.js";
import type {
  CapabilityContext,
  MemorySummary,
  ObjectSummary,
} from "../contracts/context-builder.js";
import type { ParticipationOverlay } from "../contracts/participation-overlay.js";
import type { ObjectSnapshots } from "../contracts/runtime-coordinator.js";

export function buildObjectSummary(
  objects: ObjectSnapshots,
  options: {
    maxObjects?: number;
    relevanceThreshold?: number;
  } = {},
): ObjectSummary[] {
  const { maxObjects = 10, relevanceThreshold = 0 } = options;
  const summaries: ObjectSummary[] = [];

  for (const task of objects.tasks ?? []) {
    summaries.push({
      type: "task",
      id: task.taskId,
      summary: `Task: ${task.title} (${task.status})`,
      relevance: calculateTaskRelevance(task),
    });
  }

  for (const deliverable of objects.deliverables ?? []) {
    summaries.push({
      type: "deliverable",
      id: deliverable.deliverableId,
      summary: `Deliverable: ${deliverable.title} (${deliverable.status})`,
      relevance: calculateDeliverableRelevance(deliverable),
    });
  }

  for (const review of objects.reviews ?? []) {
    summaries.push({
      type: "review",
      id: review.reviewId,
      summary: `Review: ${review.reviewId} (${review.status})`,
      relevance: calculateReviewRelevance(review),
    });
  }

  for (const decision of objects.decisions ?? []) {
    summaries.push({
      type: "decision",
      id: decision.decisionId,
      summary: `Decision: ${decision.title} (${decision.status})`,
      relevance: calculateDecisionRelevance(decision),
    });
  }

  return summaries
    .filter((summary) => (summary.relevance ?? 0) >= relevanceThreshold)
    .sort((left, right) => (right.relevance ?? 0) - (left.relevance ?? 0))
    .slice(0, maxObjects);
}

export function buildMemorySummary(
  memories: GroupMemory[],
  options: {
    maxMemories?: number;
    relevanceThreshold?: number;
  } = {},
): MemorySummary[] {
  const { maxMemories = 5, relevanceThreshold = 0 } = options;
  return memories
    .map((memory) => ({
      id: memory.memoryId,
      content: memory.content,
      timestamp: memory.updatedAt || memory.createdAt,
      relevance: calculateMemoryRelevance(memory),
    }))
    .filter((summary) => (summary.relevance ?? 0) >= relevanceThreshold)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, maxMemories);
}

export function injectTaskMemory(taskId: string, memories: GroupMemory[]): MemorySummary[] {
  return buildMemorySummary(
    memories.filter((memory) => memory.source === "task" && memory.sourceId === taskId),
    { maxMemories: 10 },
  );
}

function toUniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export async function buildCapabilityContext(params: {
  botId: string;
  groupId: string;
  personalCapabilities: string[];
  groupProfile?: GroupCapabilityProfile | null;
  overlay?: ParticipationOverlay | null;
  policyFilters?: string[];
  composer?: CapabilityComposer;
}): Promise<CapabilityContext> {
  const composer = params.composer ?? new DefaultCapabilityComposer();
  const groupProfile = params.groupProfile ?? null;
  const overlay = params.overlay ?? null;
  const policyFilters = toUniqueStrings([
    ...(groupProfile?.blockedSkills ?? []).map((skill) => `!${skill}`),
    ...(overlay?.policyFilters ?? []),
    ...(params.policyFilters ?? []),
  ]);
  const systemInstructions = toUniqueStrings([
    ...(groupProfile?.systemInstructions ?? []),
    ...(overlay?.systemInstructions ?? []),
  ]);

  const capabilitySet = await composer.composeCapabilities({
    botId: params.botId,
    groupId: params.groupId,
    personalCapabilities: params.personalCapabilities,
    groupCapabilities: groupProfile?.enabledSkills ?? [],
    participationOverlay: overlay?.overlayCapabilities ?? [],
    policyFilters,
  });

  return {
    capabilitySet,
    groupProfile,
    participationOverlay: overlay,
    policyFilters,
    systemInstructions,
    ...(overlay?.confidentialityTier
      ? { confidentialityTier: overlay.confidentialityTier }
      : groupProfile?.confidentialityTier
        ? { confidentialityTier: groupProfile.confidentialityTier }
        : {}),
  };
}

function calculateTaskRelevance(task: Task): number {
  if (
    task.status === "ready" ||
    task.status === "in_progress" ||
    task.status === "blocked" ||
    task.status === "review"
  ) {
    return 1;
  }
  if (task.status === "completed") {
    return 0.3;
  }
  return 0.5;
}

function calculateDeliverableRelevance(deliverable: Deliverable): number {
  if (
    deliverable.status === "draft" ||
    deliverable.status === "submitted" ||
    deliverable.status === "in_review" ||
    deliverable.status === "approved"
  ) {
    return 1;
  }
  if (deliverable.status === "published") {
    return 0.3;
  }
  return 0.5;
}

function calculateReviewRelevance(review: Review): number {
  if (review.status === "requested" || review.status === "submitted") {
    return 1;
  }
  if (review.status === "resolved") {
    return 0.2;
  }
  return 0.5;
}

function calculateDecisionRelevance(decision: Decision): number {
  if (decision.status === "draft") {
    return 1;
  }
  if (decision.status === "finalized") {
    return 0.5;
  }
  return 0.2;
}

function calculateMemoryRelevance(memory: GroupMemory): number {
  const age = Date.now() - (memory.updatedAt || memory.createdAt || 0);
  const dayInMs = 24 * 60 * 60 * 1000;
  if (age < dayInMs) {
    return 1;
  }
  if (age < 7 * dayInMs) {
    return 0.7;
  }
  if (age < 30 * dayInMs) {
    return 0.4;
  }
  return 0.2;
}
