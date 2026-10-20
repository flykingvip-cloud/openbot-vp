import type { Deliverable, Review, Task } from "@openbot/collaboration-core";
import type {
  MessageRoute,
  ObjectSnapshots,
  RuntimeContext,
} from "../contracts/runtime-coordinator.js";

const REVIEW_TRIGGER_RE = /评审|review|审核|审查/i;
const DELIVERABLE_TRIGGER_RE = /交付|deliverable|提交|成果/i;
const TASK_TRIGGER_RE = /任务|task|工作|todo/i;

export function resolveMessageRoute(ctx: RuntimeContext, objects: ObjectSnapshots): MessageRoute {
  const { message } = ctx;

  if (REVIEW_TRIGGER_RE.test(message)) {
    const activeReview = findActiveReview(objects.reviews ?? []);
    if (activeReview) {
      return {
        target: "review",
        targetId: activeReview.reviewId,
        priority: 4,
        reason: "Active review found",
      };
    }
  }

  if (DELIVERABLE_TRIGGER_RE.test(message)) {
    const activeDeliverable = findActiveDeliverable(objects.deliverables ?? []);
    if (activeDeliverable) {
      return {
        target: "deliverable",
        targetId: activeDeliverable.deliverableId,
        priority: 3,
        reason: "Active deliverable found",
      };
    }
  }

  if (TASK_TRIGGER_RE.test(message)) {
    const activeTask = findActiveTask(objects.tasks ?? []);
    if (activeTask) {
      return {
        target: "task",
        targetId: activeTask.taskId,
        priority: 2,
        reason: "Active task found",
      };
    }
  }

  return {
    target: "group",
    priority: 0,
    reason: "No specific object context",
  };
}

function findActiveReview(reviews: Review[]): Review | null {
  return (
    reviews.find((review) => review.status === "requested" || review.status === "submitted") ?? null
  );
}

function findActiveDeliverable(deliverables: Deliverable[]): Deliverable | null {
  return (
    deliverables.find(
      (deliverable) =>
        deliverable.status === "draft" ||
        deliverable.status === "submitted" ||
        deliverable.status === "in_review" ||
        deliverable.status === "approved",
    ) ?? null
  );
}

function findActiveTask(tasks: Task[]): Task | null {
  return (
    tasks.find(
      (task) =>
        task.status === "ready" ||
        task.status === "in_progress" ||
        task.status === "blocked" ||
        task.status === "review",
    ) ?? null
  );
}
