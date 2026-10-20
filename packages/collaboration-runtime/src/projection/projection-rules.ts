import type { Deliverable, Review, Task } from "@openbot/collaboration-core";
import type {
  ObjectSnapshots,
  RuntimePhase,
  RuntimeProjection,
  SessionProjectionMetadata,
} from "../contracts/runtime-coordinator.js";

const REVIEW_TRIGGER_RE = /评审|review|审核|审查/i;
const OWNER_TIMEOUT_MS = 10 * 60 * 1000;

export interface ProjectionInput {
  groupId: string;
  sessionId: string;
  sessionMetadata: SessionProjectionMetadata;
  storageSnapshots: ObjectSnapshots;
  actorId: string;
  message?: string;
  wasMentioned?: boolean;
  timestamp: number;
}

export function createRuntimeProjection(input: ProjectionInput): RuntimeProjection {
  const {
    groupId,
    sessionId,
    sessionMetadata,
    storageSnapshots,
    actorId,
    message = "",
    wasMentioned = false,
    timestamp,
  } = input;
  const currentTask = findActiveTask(storageSnapshots.tasks ?? []);
  const currentDeliverable = findActiveDeliverable(storageSnapshots.deliverables ?? []);
  const currentReview = findActiveReview(storageSnapshots.reviews ?? []);
  const phase = derivePhase(currentDeliverable) ?? sessionMetadata.collaborationPhase;
  const ownerTimedOut = isOwnerTimedOut(sessionMetadata.collaborationOwnerLastActiveAt, timestamp);
  const role = deriveRole({
    actorId,
    activeTask: currentTask,
    projectedOwner: sessionMetadata.collaborationOwnerAgentId,
    projectedPhase: sessionMetadata.collaborationPhase,
    ownerTimedOut,
    wasMentioned,
    message,
  });
  const needsReview =
    currentDeliverable?.status === "submitted" ||
    currentDeliverable?.status === "in_review" ||
    currentReview?.status === "requested" ||
    currentReview?.status === "submitted";
  const reviewDispositioned =
    currentReview?.status === "acknowledged" ||
    currentReview?.status === "resolved" ||
    (!currentReview &&
      typeof sessionMetadata.collaborationReviewDispositionRecordedAt === "number" &&
      sessionMetadata.collaborationReviewDispositionRecordedAt > 0);
  const canPublishFinal =
    role === "owner" &&
    (phase === "final" ||
      currentDeliverable?.status === "approved" ||
      (phase === "review" &&
        (currentReview?.status === "acknowledged" || currentReview?.status === "resolved")));

  return {
    groupId,
    sessionId,
    role,
    ...(phase ? { phase } : {}),
    ...(currentTask ? { currentTask } : {}),
    ...(currentDeliverable ? { currentDeliverable } : {}),
    ...(currentReview ? { currentReview } : {}),
    ownerTimedOut,
    canPublishFinal,
    needsReview,
    reviewDispositioned,
    projectedAt: timestamp,
    metadata: {
      ...sessionMetadata,
      ...(currentDeliverable?.deliverableId
        ? { collaborationDeliverableId: currentDeliverable.deliverableId }
        : {}),
    },
  };
}

export function validateProjectionPriority(
  projection: RuntimeProjection,
  storageData: Pick<
    RuntimeProjection,
    | "phase"
    | "currentTask"
    | "currentDeliverable"
    | "currentReview"
    | "needsReview"
    | "reviewDispositioned"
  >,
): boolean {
  return (
    projection.phase === storageData.phase &&
    projection.currentTask === storageData.currentTask &&
    projection.currentDeliverable === storageData.currentDeliverable &&
    projection.currentReview === storageData.currentReview &&
    projection.needsReview === storageData.needsReview &&
    projection.reviewDispositioned === storageData.reviewDispositioned
  );
}

export function isProjectionStale(projection: RuntimeProjection, maxAgeMs = 60_000): boolean {
  return Date.now() - projection.projectedAt > maxAgeMs;
}

function findActiveTask(tasks: Task[]): Task | undefined {
  return tasks.find(
    (task) =>
      task.status === "ready" ||
      task.status === "in_progress" ||
      task.status === "blocked" ||
      task.status === "review",
  );
}

function findActiveDeliverable(deliverables: Deliverable[]): Deliverable | undefined {
  return deliverables.find(
    (deliverable) =>
      deliverable.status === "draft" ||
      deliverable.status === "submitted" ||
      deliverable.status === "in_review" ||
      deliverable.status === "approved",
  );
}

function findActiveReview(reviews: Review[]): Review | undefined {
  return reviews.find((review) => review.status === "requested" || review.status === "submitted");
}

function derivePhase(deliverable?: Deliverable): RuntimePhase | undefined {
  if (!deliverable) {
    return undefined;
  }
  if (deliverable.status === "draft") {
    return "draft";
  }
  if (deliverable.status === "submitted" || deliverable.status === "in_review") {
    return "review";
  }
  if (deliverable.status === "approved") {
    return "final";
  }
  return undefined;
}

function isOwnerTimedOut(lastActiveAt: number | undefined, now: number): boolean {
  if (typeof lastActiveAt !== "number" || !Number.isFinite(lastActiveAt)) {
    return false;
  }
  return now - lastActiveAt >= OWNER_TIMEOUT_MS;
}

function deriveRole(params: {
  actorId: string;
  activeTask?: Task;
  projectedOwner?: string;
  projectedPhase?: RuntimePhase;
  ownerTimedOut: boolean;
  wasMentioned: boolean;
  message: string;
}): RuntimeProjection["role"] {
  const owner = params.activeTask?.ownerMemberId ?? params.projectedOwner;
  if (owner && owner === params.actorId) {
    return "owner";
  }
  if (
    params.projectedPhase === "review" &&
    params.wasMentioned &&
    REVIEW_TRIGGER_RE.test(params.message)
  ) {
    return "reviewer";
  }
  if (owner && params.ownerTimedOut && params.wasMentioned) {
    return "support";
  }
  return "participant";
}
