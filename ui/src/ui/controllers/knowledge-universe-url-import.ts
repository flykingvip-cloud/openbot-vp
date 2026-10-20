import type { AppPortState } from "../app-port-state.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import {
  createEmptyWebUrlImportState,
  parseWebImportUrlLines,
  webUrlSyncScheduleToIntervalMs,
  type WebUrlImportMode,
  type WebUrlSyncSchedule,
} from "../views/knowledge-universe-url-import.ts";
import {
  appendPersonalCompatWarnings,
  personalMessageCollectFailed,
  personalMessageUrlBatchEmpty,
  personalMessageUrlBatchInvalid,
  personalMessageUrlModeComingSoon,
  personalNoticeWebBatchImported,
} from "./knowledge-universe-personal-messages.ts";
import { syncWorkspaceToAppState } from "./knowledge-universe-workspace.ts";
import {
  getKnowledgeUniverseRuntime,
  loadKnowledgeUniverseGovernance,
  refreshKnowledgeUniverseHome,
  requireSelectedKnowledgeBaseId,
  syncKnowledgeBaseAfterPersonalMutation,
  type KnowledgeUniverseControllerState,
} from "./knowledge-universe.ts";

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

function syncUrlImportToAppState(state: AppPortState, runtime: KnowledgeUniverseControllerState) {
  state.knowledgeUniverseLibraryWorkspaceUrlImportMode = runtime.libraryWorkspaceUrlImportMode;
  state.knowledgeUniverseLibraryWorkspaceUrlImportText = runtime.libraryWorkspaceUrlImportText;
  state.knowledgeUniverseLibraryWorkspaceUrlImportAdvancedOpen =
    runtime.libraryWorkspaceUrlImportAdvancedOpen;
  state.knowledgeUniverseLibraryWorkspaceUrlSyncSchedule = runtime.libraryWorkspaceUrlSyncSchedule;
  state.knowledgeUniverseLibraryWorkspaceUrlStripNavAds = runtime.libraryWorkspaceUrlStripNavAds;
  state.knowledgeUniverseLibraryWorkspaceUrlMainContentOnly =
    runtime.libraryWorkspaceUrlMainContentOnly;
  state.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  state.knowledgeUniversePersonalActionError = runtime.personalActionError;
  state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
}

export function resetKnowledgeUniverseUrlImportState(runtime: KnowledgeUniverseControllerState) {
  Object.assign(runtime, createEmptyWebUrlImportState());
}

export function setKnowledgeUniverseLibraryWorkspaceUrlImportMode(
  state: AppPortState,
  mode: WebUrlImportMode,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceUrlImportMode = mode;
  if (mode !== "batch") {
    runtime.libraryWorkspaceUrlImportText = "";
  }
  syncUrlImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceUrlImportText(
  state: AppPortState,
  value: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceUrlImportText = value;
  syncUrlImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceUrlImportAdvancedOpen(
  state: AppPortState,
  open: boolean,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceUrlImportAdvancedOpen = open;
  syncUrlImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceUrlSyncSchedule(
  state: AppPortState,
  schedule: WebUrlSyncSchedule,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceUrlSyncSchedule = schedule;
  syncUrlImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceUrlStripNavAds(
  state: AppPortState,
  enabled: boolean,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceUrlStripNavAds = enabled;
  syncUrlImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceUrlMainContentOnly(
  state: AppPortState,
  enabled: boolean,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceUrlMainContentOnly = enabled;
  syncUrlImportToAppState(state, runtime);
  requestUpdate(state);
}

async function applyWebRefreshPolicyForUrl(
  state: AppPortState,
  kbId: string,
  url: string,
  skillId: string,
  schedule: WebUrlSyncSchedule,
) {
  const intervalMs = webUrlSyncScheduleToIntervalMs(schedule);
  if (!intervalMs || !state.client) {
    return;
  }
  const gateway = createKnowledgeUniverseGateway(state.client);
  await gateway.setWebRefreshPolicy({
    knowledgeBaseId: kbId,
    url,
    docId: skillId,
    enabled: true,
    intervalMs,
  });
}

export async function importWebUrlsToKnowledgeSpace(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (runtime.libraryWorkspaceUrlImportMode !== "batch") {
    runtime.personalActionError = personalMessageUrlModeComingSoon();
    syncUrlImportToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  const parsed = parseWebImportUrlLines(runtime.libraryWorkspaceUrlImportText);
  if (parsed.urls.length === 0) {
    runtime.personalActionError =
      parsed.invalidLines.length > 0
        ? personalMessageUrlBatchInvalid()
        : personalMessageUrlBatchEmpty();
    syncUrlImportToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncUrlImportToAppState(state, runtime);
  requestUpdate(state);
  try {
    const kbId = requireSelectedKnowledgeBaseId(state);
    if (!kbId || !state.client) {
      return;
    }
    const gateway = createKnowledgeUniverseGateway(state.client);
    const schedule = runtime.libraryWorkspaceUrlSyncSchedule;
    let imported = 0;
    let failed = 0;
    const compatWarnings: string[] = [];
    let lastResponse: Awaited<ReturnType<typeof gateway.collectWebPersonal>> | null = null;
    for (const url of parsed.urls) {
      try {
        const response = await gateway.collectWebPersonal({
          url,
          knowledgeBaseId: kbId,
        });
        lastResponse = response;
        imported += 1;
        if (response.compatWarnings?.length) {
          for (const warning of response.compatWarnings) {
            compatWarnings.push(warning.message);
          }
        }
        await applyWebRefreshPolicyForUrl(state, kbId, url, response.skillId, schedule);
      } catch {
        failed += 1;
      }
    }
    if (imported === 0) {
      runtime.personalActionError = personalMessageCollectFailed();
      return;
    }
    runtime.libraryWorkspaceUrlImportText = "";
    runtime.personalActionNotice = appendPersonalCompatWarnings(
      personalNoticeWebBatchImported(imported, failed),
      lastResponse?.compatWarnings,
    );
    if (lastResponse) {
      await syncKnowledgeBaseAfterPersonalMutation(state, lastResponse);
    }
    await refreshKnowledgeUniverseHome(state);
    await loadKnowledgeUniverseGovernance(state);
    syncWorkspaceToAppState(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageCollectFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncUrlImportToAppState(state, runtime);
    requestUpdate(state);
  }
}
