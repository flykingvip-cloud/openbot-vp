import type { DeliverableStatus } from "@openbot/collaboration-core";
import type { SkillLifecycleState } from "../../skill-lifecycle-store.js";

export function mapSkillLifecycleToDeliverableStatus(
  lifecycle: SkillLifecycleState,
): DeliverableStatus {
  switch (lifecycle) {
    case "draft":
    case "private":
      return "draft";
    case "reviewing":
      return "in_review";
    case "approved":
      return "approved";
    case "published":
      return "published";
    case "deprecated":
      return "superseded";
    case "rejected":
    case "retired":
      return "archived";
    default:
      return "published";
  }
}
