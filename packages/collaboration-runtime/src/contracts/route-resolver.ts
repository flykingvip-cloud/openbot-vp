import type { Deliverable, Review, Task } from "@openbot/collaboration-core";
import type { MessageRoute, ObjectSnapshots, RuntimeContext } from "./runtime-coordinator.js";

export interface RouteResolver {
  resolveMessageRoute(ctx: RuntimeContext, objects: ObjectSnapshots): Promise<MessageRoute>;
}

export interface TriggerMatcher {
  matchTaskTrigger(message: string, tasks: Task[]): string | null;
  matchDeliverableTrigger(message: string, deliverables: Deliverable[]): string | null;
  matchReviewTrigger(message: string, reviews: Review[]): string | null;
}
