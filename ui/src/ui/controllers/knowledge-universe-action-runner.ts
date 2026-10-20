import type { AppPortState } from "../app-port-state.ts";
import type { KnowledgeActionSuggestion } from "../capability/knowledge-universe/types.ts";
import { runDeliverableGovernanceAction } from "./knowledge-universe-deliverable-actions.ts";
import {
  loadKnowledgeUniverseWorkspace,
  setKnowledgeUniverseSelectedKnowledgeBase,
} from "./knowledge-universe-workspace.ts";
import {
  loadKnowledgeUniverseGovernance,
  selectKnowledgeUniverseGovernanceTask,
  selectKnowledgeUniverseObject,
  setKnowledgeUniversePageTab,
} from "./knowledge-universe.ts";

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

export async function runKnowledgeActionSuggestion(
  state: AppPortState,
  action: KnowledgeActionSuggestion,
) {
  if (!action.executable) {
    return;
  }

  switch (action.actionType) {
    case "archive_deliverable": {
      const deliverableId = action.context.deliverableId;
      if (!deliverableId) {
        return;
      }
      if (action.context.knowledgeBaseId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, action.context.knowledgeBaseId);
      }
      await runDeliverableGovernanceAction(state, deliverableId, "mergeKnowledge");
      await loadKnowledgeUniverseWorkspace(state);
      requestUpdate(state);
      return;
    }
    case "merge_duplicate":
    case "review_conflict":
    case "update_knowledge":
    case "open_governance": {
      if (action.context.knowledgeBaseId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, action.context.knowledgeBaseId);
      }
      setKnowledgeUniversePageTab(state, "governance");
      await loadKnowledgeUniverseGovernance(state);
      if (action.context.governanceTaskId) {
        await selectKnowledgeUniverseGovernanceTask(state, action.context.governanceTaskId);
      }
      requestUpdate(state);
      return;
    }
    case "establish_relation":
    case "open_object": {
      const objectId = action.context.targetObjectId ?? action.context.objectId;
      if (!objectId) {
        return;
      }
      await selectKnowledgeUniverseObject(state, objectId);
      requestUpdate(state);
      return;
    }
    default:
      return;
  }
}
