import { t } from "../../i18n/index.ts";
import type { AppPortState } from "../app-port-state.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import type { SpaceImportKind } from "../ports/employee/views/home-page-contracts.ts";
import {
  loadLibraryWorkspaceDocuments,
  syncWorkspaceToAppState,
} from "./knowledge-universe-workspace.ts";
import {
  getKnowledgeUniverseRuntime,
  requireSelectedKnowledgeBaseId,
  type KnowledgeUniverseControllerState,
} from "./knowledge-universe.ts";

type ConnectorKind = Extract<SpaceImportKind, "gitRepo" | "cloudDrive" | "mailAttachment">;

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

function syncPassiveToAppState(state: AppPortState, runtime: KnowledgeUniverseControllerState) {
  state.knowledgeUniverseLibraryWorkspacePassiveConnectorLocator =
    runtime.libraryWorkspacePassiveConnectorLocator;
  state.knowledgeUniverseLibraryWorkspacePassiveConnectorLabel =
    runtime.libraryWorkspacePassiveConnectorLabel;
  state.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  state.knowledgeUniversePersonalActionError = runtime.personalActionError;
  state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
}

export function setKnowledgeUniversePassiveConnectorLocator(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspacePassiveConnectorLocator = value;
  if (!runtime.libraryWorkspacePassiveConnectorLabel.trim() && value.trim()) {
    runtime.libraryWorkspacePassiveConnectorLabel =
      value.trim().split("/").filter(Boolean).at(-1) ?? value.trim();
  }
  syncPassiveToAppState(state, runtime);
}

export function setKnowledgeUniversePassiveConnectorLabel(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspacePassiveConnectorLabel = value;
  syncPassiveToAppState(state, runtime);
}

export async function bindKnowledgeUniversePassiveConnector(
  state: AppPortState,
  kind: ConnectorKind,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = requireSelectedKnowledgeBaseId(state);
  if (!kbId || !state.client) {
    return;
  }
  const locator = runtime.libraryWorkspacePassiveConnectorLocator.trim();
  if (!locator) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.passiveConnector.errors.locatorRequired",
    );
    syncPassiveToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  const label =
    runtime.libraryWorkspacePassiveConnectorLabel.trim() ||
    locator.split("/").filter(Boolean).at(-1) ||
    kind;

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncPassiveToAppState(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    if (!gateway.bindPassiveConnector) {
      throw new Error("bindPassiveConnector is unavailable");
    }
    const result = await gateway.bindPassiveConnector({
      kind,
      knowledgeBaseId: kbId,
      label,
      locator,
      deletePolicy: "snapshot",
    });
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.passiveConnector.notices.bound",
      {
        label: result.label ?? label,
        ready: result.providerReady
          ? t("frontstage.workbench.knowledgeUniverse.importToSpace.passiveConnector.readyYes")
          : t("frontstage.workbench.knowledgeUniverse.importToSpace.passiveConnector.readyNo"),
      },
    );
    runtime.libraryWorkspacePassiveConnectorLocator = "";
    runtime.libraryWorkspacePassiveConnectorLabel = "";
    runtime.libraryWorkspaceImportOpen = false;
    runtime.libraryWorkspaceImportKind = null;
    state.knowledgeUniverseLibraryWorkspaceImportOpen = false;
    state.knowledgeUniverseLibraryWorkspaceImportKind = null;
    await loadLibraryWorkspaceDocuments(state);
    syncWorkspaceToAppState(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.passiveConnector.errors.bindFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncPassiveToAppState(state, runtime);
    requestUpdate(state);
  }
}
