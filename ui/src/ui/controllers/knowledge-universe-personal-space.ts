import type { AppPortState } from "../app-port-state.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import { writeKnowledgeUniverseUiPrefs } from "../views/knowledge-universe-ui-prefs.ts";
import { withBrowserOperationLock } from "./browser-operation-lock.ts";
import { libraryCreateDefaultQuickTitle } from "./knowledge-universe-personal-messages.ts";
import { syncWorkspaceToAppState } from "./knowledge-universe-workspace.ts";
import { getKnowledgeUniverseRuntime } from "./knowledge-universe.ts";

const pendingPersonalSpaces = new WeakMap<AppPortState, Promise<string>>();

function findPrivateKnowledgeBase(
  knowledgeBases: KnowledgeBaseSummary[],
  selectedKnowledgeBaseId: string | null,
): KnowledgeBaseSummary | undefined {
  const selected = selectedKnowledgeBaseId
    ? knowledgeBases.find((knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseId)
    : undefined;
  return selected?.visibility === "private"
    ? selected
    : knowledgeBases.find((knowledgeBase) => knowledgeBase.visibility === "private");
}

function selectPersonalKnowledgeBase(
  state: AppPortState,
  knowledgeBase: KnowledgeBaseSummary,
): string {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.selectedKnowledgeBaseId = knowledgeBase.id;
  writeKnowledgeUniverseUiPrefs({ selectedKnowledgeBaseId: knowledgeBase.id });
  syncWorkspaceToAppState(state);
  state.requestUpdate?.();
  return knowledgeBase.id;
}

async function materializePersonalKnowledgeBase(state: AppPortState): Promise<string> {
  if (!state.client) {
    throw new Error("The gateway is offline. Reconnect before importing knowledge.");
  }

  const runtime = getKnowledgeUniverseRuntime(state);
  const gateway = createKnowledgeUniverseGateway(state.client);
  // Re-list immediately before creation so concurrent clients do not create duplicate defaults.
  const listed = await gateway.listKnowledgeBases();
  runtime.knowledgeBases = listed.knowledgeBases;
  const existing = findPrivateKnowledgeBase(
    runtime.knowledgeBases,
    runtime.selectedKnowledgeBaseId,
  );
  if (existing) {
    return selectPersonalKnowledgeBase(state, existing);
  }

  const created = await gateway.createKnowledgeBase({
    title: libraryCreateDefaultQuickTitle(),
    visibility: "private",
  });
  runtime.knowledgeBases = [...runtime.knowledgeBases, created.knowledgeBase];
  return selectPersonalKnowledgeBase(state, created.knowledgeBase);
}

/** Resolve the selected private space, creating one exactly once when necessary. */
export async function ensurePersonalKnowledgeBase(state: AppPortState): Promise<string> {
  const runtime = getKnowledgeUniverseRuntime(state);
  const existing = findPrivateKnowledgeBase(
    runtime.knowledgeBases,
    runtime.selectedKnowledgeBaseId,
  );
  if (existing) {
    return selectPersonalKnowledgeBase(state, existing);
  }

  const pending = pendingPersonalSpaces.get(state);
  if (pending) {
    return pending;
  }

  // Re-list and create under a cross-tab lock so two browser surfaces cannot create defaults.
  const created = withBrowserOperationLock("openbot:knowledge:personal-space:default", () =>
    materializePersonalKnowledgeBase(state),
  ).finally(() => {
    pendingPersonalSpaces.delete(state);
  });
  pendingPersonalSpaces.set(state, created);
  return created;
}
