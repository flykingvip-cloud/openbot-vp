import { parseAgentSessionKey } from "../../../../src/sessions/session-key-utils.ts";
import { t } from "../../i18n/index.ts";
import type { AppPortState } from "../app-port-state.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import { suggestNoteMetadataWithAi } from "../views/knowledge-universe-note-ai.ts";
import {
  addNoteTag,
  createEmptyNoteImportState,
  extractNoteTitleFromContent,
  parseNoteTagsInput,
  readNoteTagHistory,
  rememberNoteTags,
  removeNoteTag,
  serializeNoteTags,
} from "../views/knowledge-universe-note-import.ts";
import {
  appendPersonalCompatWarnings,
  personalMessageCollectFailed,
  personalMessageNoteContentRequired,
  personalNoticeCollected,
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

function resolveKnowledgeAgentId(state: AppPortState): string {
  const parsed = parseAgentSessionKey(state.sessionKey);
  return parsed?.agentId ?? "main";
}

function syncNoteImportToAppState(state: AppPortState, runtime: KnowledgeUniverseControllerState) {
  state.knowledgeUniverseLibraryWorkspaceNoteTags = runtime.libraryWorkspaceNoteTags;
  state.knowledgeUniverseLibraryWorkspaceNoteTagDraft = runtime.libraryWorkspaceNoteTagDraft;
  state.knowledgeUniverseLibraryWorkspaceNoteTagSuggestionsOpen =
    runtime.libraryWorkspaceNoteTagSuggestionsOpen;
  state.knowledgeUniverseLibraryWorkspaceNoteTagHistory = runtime.libraryWorkspaceNoteTagHistory;
  state.knowledgeUniverseLibraryWorkspaceNoteAiBusy = runtime.libraryWorkspaceNoteAiBusy;
  state.knowledgeUniversePersonalCollectTitle = runtime.personalCollectTitle;
  state.knowledgeUniversePersonalCollectSummary = runtime.personalCollectSummary;
  state.knowledgeUniversePersonalCollectTags = runtime.personalCollectTags;
  state.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  state.knowledgeUniversePersonalActionError = runtime.personalActionError;
  state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
}

export function resetKnowledgeUniverseNoteImportState(runtime: KnowledgeUniverseControllerState) {
  Object.assign(runtime, createEmptyNoteImportState());
  runtime.libraryWorkspaceNoteTagHistory = readNoteTagHistory();
  runtime.personalCollectTitle = "";
  runtime.personalCollectSummary = "";
  runtime.personalCollectTags = "";
}

export function ensureKnowledgeUniverseNoteImportReady(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceNoteTagHistory = readNoteTagHistory();
  if (runtime.libraryWorkspaceNoteTags.length === 0 && runtime.personalCollectTags.trim()) {
    runtime.libraryWorkspaceNoteTags = parseNoteTagsInput(runtime.personalCollectTags);
  }
  syncNoteImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceNoteTagDraft(
  state: AppPortState,
  value: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceNoteTagDraft = value;
  syncNoteImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceNoteTagSuggestionsOpen(
  state: AppPortState,
  open: boolean,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceNoteTagSuggestionsOpen = open;
  syncNoteImportToAppState(state, runtime);
  requestUpdate(state);
}

export function addKnowledgeUniverseLibraryWorkspaceNoteTag(state: AppPortState, raw: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceNoteTags = addNoteTag(runtime.libraryWorkspaceNoteTags, raw);
  runtime.personalCollectTags = serializeNoteTags(runtime.libraryWorkspaceNoteTags);
  runtime.libraryWorkspaceNoteTagDraft = "";
  syncNoteImportToAppState(state, runtime);
  requestUpdate(state);
}

export function removeKnowledgeUniverseLibraryWorkspaceNoteTag(state: AppPortState, tag: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceNoteTags = removeNoteTag(runtime.libraryWorkspaceNoteTags, tag);
  runtime.personalCollectTags = serializeNoteTags(runtime.libraryWorkspaceNoteTags);
  syncNoteImportToAppState(state, runtime);
  requestUpdate(state);
}

export function commitKnowledgeUniverseLibraryWorkspaceNoteTagDraft(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const draft = runtime.libraryWorkspaceNoteTagDraft.trim();
  if (!draft) {
    return;
  }
  runtime.libraryWorkspaceNoteTags = addNoteTag(runtime.libraryWorkspaceNoteTags, draft);
  runtime.personalCollectTags = serializeNoteTags(runtime.libraryWorkspaceNoteTags);
  runtime.libraryWorkspaceNoteTagDraft = "";
  syncNoteImportToAppState(state, runtime);
  requestUpdate(state);
}

export async function generateKnowledgeUniverseNoteMetadataFromContent(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const content = runtime.personalCollectSummary.trim();
  if (!content || runtime.libraryWorkspaceNoteAiBusy) {
    return;
  }
  runtime.libraryWorkspaceNoteAiBusy = true;
  runtime.personalActionError = null;
  syncNoteImportToAppState(state, runtime);
  requestUpdate(state);
  try {
    const suggested = await suggestNoteMetadataWithAi({
      client: state.client,
      sessionKey: state.sessionKey,
      content,
    });
    runtime.personalCollectTitle = suggested.title;
    runtime.libraryWorkspaceNoteTags = suggested.tags;
    runtime.personalCollectTags = serializeNoteTags(suggested.tags);
    runtime.libraryWorkspaceNoteTagDraft = "";
    runtime.personalActionNotice =
      suggested.source === "llm"
        ? t("frontstage.workbench.knowledgeUniverse.importToSpace.note.aiGeneratedLlm")
        : t("frontstage.workbench.knowledgeUniverse.importToSpace.note.aiGeneratedRules");
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageCollectFailed();
  } finally {
    runtime.libraryWorkspaceNoteAiBusy = false;
    syncNoteImportToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function importNoteToKnowledgeSpace(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const summary = runtime.personalCollectSummary.trim();
  if (!summary) {
    runtime.personalActionError = personalMessageNoteContentRequired();
    syncNoteImportToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  const title =
    runtime.personalCollectTitle.trim() || extractNoteTitleFromContent(summary) || "未命名摘录";
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncNoteImportToAppState(state, runtime);
  requestUpdate(state);
  try {
    const kbId = requireSelectedKnowledgeBaseId(state);
    if (!kbId || !state.client) {
      return;
    }
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.collectPersonal({
      title,
      summary,
      tags: runtime.libraryWorkspaceNoteTags,
      sourceAgentId: resolveKnowledgeAgentId(state),
      contextId: state.sessionKey,
      knowledgeBaseId: kbId,
    });
    rememberNoteTags(runtime.libraryWorkspaceNoteTags);
    resetKnowledgeUniverseNoteImportState(runtime);
    runtime.personalActionNotice = appendPersonalCompatWarnings(
      personalNoticeCollected(),
      response.compatWarnings,
    );
    await syncKnowledgeBaseAfterPersonalMutation(state, response);
    await refreshKnowledgeUniverseHome(state);
    await loadKnowledgeUniverseGovernance(state);
    syncWorkspaceToAppState(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageCollectFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncNoteImportToAppState(state, runtime);
    requestUpdate(state);
  }
}
