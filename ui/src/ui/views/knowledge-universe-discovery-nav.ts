import type {
  KnowledgeActionType,
  KnowledgeDiscoveryEvent,
} from "../capability/knowledge-universe/types.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { openKnowledgeSpaceCreatePage } from "./knowledge-universe-create-entry.ts";

export type DiscoveryEventDestination =
  | {
      kind: "governance";
      kbId?: string;
      governanceTaskId?: string;
      actionType: KnowledgeActionType;
    }
  | { kind: "workbench"; kbId?: string }
  | { kind: "deliverables" }
  | { kind: "deliverableDetail"; deliverableId: string; kbId?: string };

/**
 * Map a discovery feed item to the secondary page the user should land on.
 * Governance signals go to the governance center; lineage / relation / usage
 * signals go to the home cockpit.
 */
export function resolveDiscoveryEventDestination(
  event: KnowledgeDiscoveryEvent,
): DiscoveryEventDestination {
  const related = event.relatedKnowledge;

  if (related.governanceTaskId) {
    return {
      kind: "governance",
      kbId: related.kbId,
      governanceTaskId: related.governanceTaskId,
      actionType:
        event.eventType === "new_duplicate"
          ? "merge_duplicate"
          : event.eventType === "deliverable_completed"
            ? "archive_deliverable"
            : "open_governance",
    };
  }

  if (event.eventSource === "deliverable" || event.eventType === "deliverable_completed") {
    if (related.deliverableId) {
      return {
        kind: "deliverableDetail",
        deliverableId: related.deliverableId,
        kbId: related.kbId,
      };
    }
    return { kind: "workbench", kbId: related.kbId };
  }

  if (event.eventSource === "governance") {
    return { kind: "governance", kbId: related.kbId, actionType: "open_governance" };
  }

  if (event.eventSource === "relation" && related.relationType === "conflict") {
    return { kind: "governance", kbId: related.kbId, actionType: "open_governance" };
  }

  if (
    event.eventSource === "lineage" ||
    event.eventSource === "relation" ||
    event.eventSource === "usage"
  ) {
    return { kind: "workbench", kbId: related.kbId };
  }

  if (related.kbId) {
    return { kind: "workbench", kbId: related.kbId };
  }

  return { kind: "workbench", kbId: related.kbId };
}

/**
 * Open the home cockpit. Do not hijack the header link into space import —
 * empty-state ingest CTA remains on the home card body.
 */
export function enterKnowledgeUniverseDiscovery(surface: WorkbenchKnowledgeSurface) {
  if (surface.knowledgeBases.length === 0) {
    openKnowledgeSpaceCreatePage(surface);
    return;
  }
  if (!surface.selectedKnowledgeBaseId) {
    const firstKbId = surface.knowledgeBases[0]?.id;
    if (firstKbId) {
      surface.onSelectKnowledgeBase(firstKbId);
    }
  }
  surface.onPageTabChange("workbench");
}
