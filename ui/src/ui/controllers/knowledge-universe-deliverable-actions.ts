import type { AppPortState } from "../app-port-state.ts";
import type { KnowledgeGovernanceTask } from "../capability/knowledge-universe/endpoints.ts";
import type {
  DeliverableDetailFocus,
  DeliverableGovernanceAction,
  WorkspaceDeliverableDto,
  WorkspaceDeliverableTraceDto,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import {
  workspaceNoticeAssignExpert,
  workspaceNoticeMarkInvalid,
  workspaceNoticeMarkInvalidManual,
  workspaceNoticeNoGovernanceTask,
  workspaceNoticeRelationsOpened,
} from "./knowledge-universe-workspace-messages.ts";
import {
  archiveKnowledgeUniverseDeliverable,
  loadKnowledgeUniverseDeliverableTrace,
  loadKnowledgeUniverseWorkspace,
} from "./knowledge-universe-workspace.ts";
import {
  getKnowledgeUniverseRuntime,
  loadKnowledgeUniverseGovernance,
  selectKnowledgeUniverseGovernanceTask,
  setKnowledgeUniversePageTab,
} from "./knowledge-universe.ts";

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

function syncRuntime(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  state.knowledgeUniverseDeliverableDetailFocus = runtime.deliverableDetailFocus;
  state.knowledgeUniverseSelectedWorkspaceSearchDeliverableId =
    runtime.selectedWorkspaceSearchDeliverableId;
  state.knowledgeUniverseSelectedKnowledgeBaseId = runtime.selectedKnowledgeBaseId;
  state.knowledgeUniverseWorkspaceNotice = runtime.workspaceNotice;
  state.knowledgeUniverseWorkspaceError = runtime.workspaceError;
  state.knowledgeUniverseGovernanceSelectedTaskId = runtime.governanceSelectedTaskId;
  state.workbenchPrimaryModule = "knowledge";
}

function resolveDeliverable(
  state: AppPortState,
  deliverableId: string,
): WorkspaceDeliverableDto | null {
  const runtime = getKnowledgeUniverseRuntime(state);
  return (
    runtime.workspaceDeliverables.find((item) => item.deliverableId === deliverableId) ??
    (runtime.workspaceDeliverableTrace?.deliverableId === deliverableId
      ? runtime.workspaceDeliverableTrace.deliverable
      : null)
  );
}

function resolveKbIdForDeliverable(
  item: WorkspaceDeliverableDto,
  trace: WorkspaceDeliverableTraceDto | null,
): string | null {
  return item.relatedKnowledgeBaseId ?? trace?.citedKnowledge?.[0]?.kbId ?? null;
}

function findOpenTaskForKb(
  tasks: KnowledgeGovernanceTask[],
  kbId: string | null,
  preferExpertReview = false,
): KnowledgeGovernanceTask | null {
  if (!kbId) {
    return null;
  }
  const open = tasks.filter((task) => task.status === "open" && task.kbId === kbId);
  if (open.length === 0) {
    return null;
  }
  if (preferExpertReview) {
    return (
      open.find((task) => task.taskType === "conflict" || task.taskType === "claim_conflict") ??
      open[0] ??
      null
    );
  }
  return open[0] ?? null;
}

export function setKnowledgeUniverseDeliverableDetailFocus(
  state: AppPortState,
  focus: DeliverableDetailFocus | null,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.deliverableDetailFocus = focus;
  syncRuntime(state);
  requestUpdate(state);
}

function openDeliverableDetail(
  state: AppPortState,
  deliverableId: string,
  focus?: DeliverableDetailFocus | null,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.selectedWorkspaceSearchDeliverableId = deliverableId;
  if (focus !== undefined) {
    runtime.deliverableDetailFocus = focus;
  }
  setKnowledgeUniversePageTab(state, "deliverableDetail");
  syncRuntime(state);
  requestUpdate(state);
  void loadKnowledgeUniverseDeliverableTrace(state);
}

async function openGovernanceForDeliverable(
  state: AppPortState,
  item: WorkspaceDeliverableDto,
  mode: "viewRelations" | "assignExpert",
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const trace =
    runtime.workspaceDeliverableTrace?.deliverableId === item.deliverableId
      ? runtime.workspaceDeliverableTrace
      : null;
  const kbId = resolveKbIdForDeliverable(item, trace);
  if (kbId) {
    runtime.selectedKnowledgeBaseId = kbId;
  }
  runtime.selectedWorkspaceSearchDeliverableId = item.deliverableId;
  setKnowledgeUniversePageTab(state, "governance");
  syncRuntime(state);
  requestUpdate(state);
  await loadKnowledgeUniverseGovernance(state);
  const task = findOpenTaskForKb(
    runtime.governanceTasks,
    kbId ?? runtime.selectedKnowledgeBaseId,
    mode === "assignExpert",
  );
  if (task) {
    await selectKnowledgeUniverseGovernanceTask(state, task.id);
    runtime.workspaceNotice =
      mode === "assignExpert"
        ? workspaceNoticeAssignExpert(item.title)
        : workspaceNoticeRelationsOpened(item.title);
  } else {
    runtime.workspaceNotice = workspaceNoticeNoGovernanceTask(item.title);
  }
  syncRuntime(state);
  requestUpdate(state);
}

async function markDeliverableInvalid(state: AppPortState, item: WorkspaceDeliverableDto) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const groupId = item.groupId?.trim();
  if (groupId && state.client && state.connected) {
    const toStatus =
      item.status === "published" ? "superseded" : item.status === "superseded" ? "archived" : null;
    if (toStatus) {
      runtime.workspaceBusy = true;
      syncRuntime(state);
      requestUpdate(state);
      try {
        await state.client.request("collaboration.deliverable.transition", {
          groupId,
          deliverableId: item.deliverableId,
          toStatus,
        });
        runtime.workspaceNotice = workspaceNoticeMarkInvalid(item.title);
        runtime.workspaceError = null;
        await loadKnowledgeUniverseWorkspace(state, { deliverablesLimit: 100 });
        return;
      } catch (error) {
        runtime.workspaceError = error instanceof Error ? error.message : String(error);
      } finally {
        runtime.workspaceBusy = false;
      }
    }
  }
  runtime.workspaceNotice = workspaceNoticeMarkInvalidManual(item.title);
  openDeliverableDetail(state, item.deliverableId, "archive");
}

export async function runDeliverableGovernanceAction(
  state: AppPortState,
  deliverableId: string,
  action: DeliverableGovernanceAction,
) {
  const item = resolveDeliverable(state, deliverableId);
  if (!item) {
    return;
  }
  const runtime = getKnowledgeUniverseRuntime(state);

  switch (action) {
    case "viewCitations":
      openDeliverableDetail(state, deliverableId, "citations");
      return;
    case "viewSource":
      openDeliverableDetail(state, deliverableId, "source");
      return;
    case "mergeKnowledge":
      if (item.relatedKnowledgeBaseId) {
        runtime.selectedKnowledgeBaseId = item.relatedKnowledgeBaseId;
        setKnowledgeUniversePageTab(state, "workbench");
        syncRuntime(state);
        requestUpdate(state);
        return;
      }
      openDeliverableDetail(state, deliverableId, "archive");
      if (runtime.selectedKnowledgeBaseId) {
        await archiveKnowledgeUniverseDeliverable(state, deliverableId);
        syncRuntime(state);
        requestUpdate(state);
      }
      return;
    case "markInvalid":
      await markDeliverableInvalid(state, item);
      syncRuntime(state);
      requestUpdate(state);
      return;
    case "assignExpert":
      await openGovernanceForDeliverable(state, item, "assignExpert");
      return;
    case "viewRelations":
      await openGovernanceForDeliverable(state, item, "viewRelations");
      return;
  }
}
