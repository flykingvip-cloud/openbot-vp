import type { AppPortState } from "../app-port-state.ts";
import type { KnowledgeDiscoveryEvent } from "../capability/knowledge-universe/types.ts";
import { resolveDiscoveryEventDestination } from "../views/knowledge-universe-discovery-nav.ts";
import { runKnowledgeActionSuggestion } from "./knowledge-universe-action-runner.ts";
import { setKnowledgeUniverseDeliverableDetailFocus } from "./knowledge-universe-deliverable-actions.ts";
import {
  loadKnowledgeUniverseDeliverableTrace,
  loadKnowledgeUniverseWorkspace,
  setKnowledgeUniverseSelectedKnowledgeBase,
} from "./knowledge-universe-workspace.ts";
import {
  loadKnowledgeUniverseGovernance,
  setKnowledgeUniversePageTab,
} from "./knowledge-universe.ts";

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

export async function applyDiscoveryEventNavigation(
  state: AppPortState,
  event: KnowledgeDiscoveryEvent,
) {
  const destination = resolveDiscoveryEventDestination(event);

  switch (destination.kind) {
    case "governance": {
      if (destination.governanceTaskId) {
        await runKnowledgeActionSuggestion(state, {
          actionId: `discovery:${event.eventId}`,
          actionType: destination.actionType,
          title: event.title,
          reason: event.summary,
          score: 100,
          context: {
            governanceTaskId: destination.governanceTaskId,
            deliverableId: event.relatedKnowledge.deliverableId,
            knowledgeBaseId: destination.kbId,
          },
          executable: true,
        });
        return;
      }
      if (destination.kbId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, destination.kbId);
      }
      setKnowledgeUniversePageTab(state, "governance");
      await loadKnowledgeUniverseGovernance(state);
      return;
    }
    case "workbench": {
      if (destination.kbId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, destination.kbId);
      }
      setKnowledgeUniversePageTab(state, "workbench");
      await loadKnowledgeUniverseWorkspace(state);
      return;
    }
    case "deliverableDetail": {
      if (destination.kbId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, destination.kbId);
      }
      setKnowledgeUniverseDeliverableDetailFocus(state, null);
      state.knowledgeUniverseSelectedWorkspaceSearchDeliverableId = destination.deliverableId;
      setKnowledgeUniversePageTab(state, "deliverableDetail");
      await loadKnowledgeUniverseDeliverableTrace(state);
      return;
    }
    case "deliverables": {
      setKnowledgeUniversePageTab(state, "workbench");
      await loadKnowledgeUniverseWorkspace(state);
      return;
    }
    default:
      return;
  }
}

export async function navigateDiscoveryEvent(state: AppPortState, event: KnowledgeDiscoveryEvent) {
  await applyDiscoveryEventNavigation(state, event);
  requestUpdate(state);
}
