import type { AppPortState } from "../app-port-state.ts";
import type { HttpRestAuthScheme } from "../capability/enterprise-data-capability/types.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import {
  buildConnectorConnectionOptions,
  buildConnectorSecretOptions,
  resetConnectorCredentialDraftForConnectorChange,
  resolveConnectorInstanceUrl,
  shouldCreateConnectorCredential,
} from "../views/enterprise-data-connector-credential-helpers.ts";
import {
  buildApiSourceMetadata,
  buildConnectorKnowledgeSourceBindRequest,
  createEmptySpaceConnectorBindDraft,
  type SpaceConnectorBindDraft,
} from "../views/knowledge-universe-space-connector-bind.ts";
import { buildActiveSourceBindRequest } from "../views/knowledge-universe-space-import.ts";
import { createEnterpriseDataCapabilityGateway } from "./enterprise-data-capability/gateway-client.ts";
import {
  personalMessageActiveSourceEndpointRequired,
  personalMessageBindSourceFailed,
  personalNoticeActiveSourceBound,
} from "./knowledge-universe-personal-messages.ts";
import {
  loadLibraryWorkspaceDocuments,
  syncWorkspaceToAppState,
} from "./knowledge-universe-workspace.ts";
import {
  getKnowledgeUniverseRuntime,
  requireSelectedKnowledgeBaseId,
  type KnowledgeUniverseControllerState,
} from "./knowledge-universe.ts";

const processedKnowledgeUniverseConnectorOAuthReturns = new Set<string>();

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

function syncConnectorBindToAppState(
  state: AppPortState,
  runtime: KnowledgeUniverseControllerState,
) {
  state.knowledgeUniverseLibraryWorkspaceConnectorBindDraft =
    runtime.libraryWorkspaceConnectorBindDraft;
  state.knowledgeUniverseLibraryWorkspaceConnectorCatalog =
    runtime.libraryWorkspaceConnectorCatalog;
  state.knowledgeUniverseLibraryWorkspaceConnectorCatalogLoading =
    runtime.libraryWorkspaceConnectorCatalogLoading;
  state.knowledgeUniverseLibraryWorkspaceConnectorCatalogError =
    runtime.libraryWorkspaceConnectorCatalogError;
  state.knowledgeUniverseLibraryWorkspaceConnectorCredentials =
    runtime.libraryWorkspaceConnectorCredentials;
  state.knowledgeUniverseLibraryWorkspaceConnectorCredentialsLoading =
    runtime.libraryWorkspaceConnectorCredentialsLoading;
  state.knowledgeUniverseLibraryWorkspaceConnectorProbeOk =
    runtime.libraryWorkspaceConnectorProbeOk;
  state.knowledgeUniverseLibraryWorkspaceConnectorProbeMessage =
    runtime.libraryWorkspaceConnectorProbeMessage;
  state.knowledgeUniverseLibraryWorkspaceConnectorProbeBusy =
    runtime.libraryWorkspaceConnectorProbeBusy;
  state.knowledgeUniverseLibraryWorkspaceConnectorOAuthBusy =
    runtime.libraryWorkspaceConnectorOAuthBusy;
  state.knowledgeUniverseLibraryWorkspaceConnectorOAuthNotice =
    runtime.libraryWorkspaceConnectorOAuthNotice;
  state.knowledgeUniverseLibraryWorkspaceConnectorOAuthError =
    runtime.libraryWorkspaceConnectorOAuthError;
  state.knowledgeUniverseLibraryWorkspaceConnectorOAuthSessionId =
    runtime.libraryWorkspaceConnectorOAuthSessionId;
  state.knowledgeUniverseLibraryWorkspaceConnectorOAuthSimulateAllowed =
    runtime.libraryWorkspaceConnectorOAuthSimulateAllowed;
  state.knowledgeUniverseLibraryWorkspaceHttpRestExpanded =
    runtime.libraryWorkspaceHttpRestExpanded;
}

function resetKnowledgeUniverseConnectorOAuthState(runtime: KnowledgeUniverseControllerState) {
  runtime.libraryWorkspaceConnectorOAuthBusy = false;
  runtime.libraryWorkspaceConnectorOAuthNotice = null;
  runtime.libraryWorkspaceConnectorOAuthError = null;
  runtime.libraryWorkspaceConnectorOAuthSessionId = null;
  runtime.libraryWorkspaceConnectorOAuthSimulateAllowed = false;
}

function syncImportUiState(state: AppPortState, runtime: KnowledgeUniverseControllerState) {
  syncWorkspaceToAppState(state);
  state.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  state.knowledgeUniversePersonalActionError = runtime.personalActionError;
  state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
  syncConnectorBindToAppState(state, runtime);
}

export function resetKnowledgeUniverseConnectorBindDraft(
  runtime: KnowledgeUniverseControllerState,
) {
  runtime.libraryWorkspaceConnectorBindDraft = createEmptySpaceConnectorBindDraft();
  runtime.libraryWorkspaceConnectorCatalog = [];
  runtime.libraryWorkspaceConnectorCatalogLoading = false;
  runtime.libraryWorkspaceConnectorCatalogError = null;
  runtime.libraryWorkspaceConnectorCredentials = [];
  runtime.libraryWorkspaceConnectorCredentialsLoading = false;
  runtime.libraryWorkspaceConnectorProbeOk = null;
  runtime.libraryWorkspaceConnectorProbeMessage = null;
  runtime.libraryWorkspaceConnectorProbeBusy = false;
  resetKnowledgeUniverseConnectorOAuthState(runtime);
  runtime.libraryWorkspaceHttpRestExpanded = false;
  runtime.libraryWorkspaceBindSourceKind = "api";
}

export function resolveKnowledgeUniverseEnterpriseTenantId(state: AppPortState): string | null {
  const helloTenant =
    state.hello?.auth?.provider === "trusted-proxy" ? state.hello.auth.tenantId : null;
  return (
    helloTenant?.trim() ||
    state.platformAuthState?.session?.tenantId?.trim() ||
    state.platformAuthState?.enterprise?.id?.trim() ||
    state.bootstrapAuthSession?.tenantId?.trim() ||
    null
  );
}

export function setKnowledgeUniverseLibraryWorkspaceHttpRestExpanded(
  state: AppPortState,
  expanded: boolean,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceHttpRestExpanded = expanded;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceConnectorBindDraft(
  state: AppPortState,
  field: keyof SpaceConnectorBindDraft,
  value: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const draft = runtime.libraryWorkspaceConnectorBindDraft;
  if (field === "saveNewCredential") {
    draft.saveNewCredential = value === "true";
  } else if (field === "passwordVisible") {
    draft.passwordVisible = value === "true";
  } else if (field === "authScheme") {
    draft.authScheme = value as HttpRestAuthScheme;
  } else if (field === "requestMethod") {
    draft.requestMethod = value === "POST" ? "POST" : "GET";
  } else {
    draft[field] = value;
  }
  if (field === "connectorId") {
    resetConnectorCredentialDraftForConnectorChange(draft);
    draft.displayName = "";
    draft.sourceKey = "";
    draft.passwordVisible = false;
    runtime.libraryWorkspaceConnectorProbeOk = null;
    runtime.libraryWorkspaceConnectorProbeMessage = null;
    resetKnowledgeUniverseConnectorOAuthState(runtime);
    const entry = runtime.libraryWorkspaceConnectorCatalog.find(
      (item) => item.connectorId === value.trim(),
    );
    if (entry) {
      draft.sourceKey = entry.defaultSourceKey;
      draft.displayName = entry.label;
    }
    void loadKnowledgeUniverseConnectorCredentials(state);
  }
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceConnectorCredentialSelect(
  state: AppPortState,
  value: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const draft = runtime.libraryWorkspaceConnectorBindDraft;
  if (value === "__new__") {
    draft.saveNewCredential = true;
    draft.credentialId = "";
    draft.credentialLabel = "";
    draft.instanceUrl = "";
    draft.apiKey = "";
    draft.dbHost = "";
    draft.dbPort = "";
    draft.dbName = "";
    draft.basicUsername = "";
    draft.authScheme = "bearer";
    draft.authHeaderName = "";
    draft.authQueryParam = "";
    draft.probePath = "";
    draft.passwordVisible = false;
  } else {
    const selected = runtime.libraryWorkspaceConnectorCredentials.find(
      (item) => item.credentialId === value,
    );
    draft.saveNewCredential = false;
    draft.credentialId = value;
    draft.credentialLabel = selected?.label ?? "";
    draft.instanceUrl = selected?.instanceUrl ?? "";
    draft.apiKey = "";
    draft.dbHost = "";
    draft.dbPort = "";
    draft.dbName = "";
    draft.basicUsername = "";
    draft.passwordVisible = false;
  }
  runtime.libraryWorkspaceConnectorProbeOk = null;
  runtime.libraryWorkspaceConnectorProbeMessage = null;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
}

export async function loadKnowledgeUniverseConnectorCatalog(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const tenantId = resolveKnowledgeUniverseEnterpriseTenantId(state);
  if (!tenantId || !state.client) {
    runtime.libraryWorkspaceConnectorCatalog = [];
    runtime.libraryWorkspaceConnectorCatalogError = null;
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceConnectorCatalogLoading = true;
  runtime.libraryWorkspaceConnectorCatalogError = null;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createEnterpriseDataCapabilityGateway(state.client);
    const result = await gateway.loadConnectorCatalog(tenantId);
    if (!result.ok) {
      runtime.libraryWorkspaceConnectorCatalog = [];
      runtime.libraryWorkspaceConnectorCatalogError = result.error;
    } else {
      runtime.libraryWorkspaceConnectorCatalog = result.data;
      runtime.libraryWorkspaceConnectorCatalogError = null;
    }
  } catch (error) {
    runtime.libraryWorkspaceConnectorCatalog = [];
    runtime.libraryWorkspaceConnectorCatalogError =
      error instanceof Error ? error.message : "Failed to load connector catalog";
  } finally {
    runtime.libraryWorkspaceConnectorCatalogLoading = false;
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
    void tryResumeKnowledgeUniverseConnectorOAuthFromUrl(state);
  }
}

export function maybeResumeKnowledgeUniverseConnectorOAuthFromUrl(state: AppPortState) {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (
    !params.get("dataConnectorOAuth")?.trim() ||
    !params.get("dataConnectorOAuthSessionId")?.trim()
  ) {
    return;
  }
  void tryResumeKnowledgeUniverseConnectorOAuthFromUrl(state);
}

export async function tryResumeKnowledgeUniverseConnectorOAuthFromUrl(
  state: AppPortState,
): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const status = params.get("dataConnectorOAuth")?.trim();
  const sessionId = params.get("dataConnectorOAuthSessionId")?.trim();
  const errorMessage = params.get("dataConnectorOAuthMessage")?.trim();
  if (!status || !sessionId || processedKnowledgeUniverseConnectorOAuthReturns.has(sessionId)) {
    return;
  }
  processedKnowledgeUniverseConnectorOAuthReturns.add(sessionId);
  params.delete("dataConnectorOAuth");
  params.delete("dataConnectorOAuthSessionId");
  params.delete("dataConnectorOAuthMessage");
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);

  const tenantId = resolveKnowledgeUniverseEnterpriseTenantId(state);
  if (!tenantId || !state.client) {
    return;
  }

  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceImportOpen = true;
  runtime.libraryWorkspaceImportKind = "active";
  syncWorkspaceToAppState(state);
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);

  if (status === "error") {
    runtime.libraryWorkspaceConnectorOAuthError = errorMessage || "OAuth authorization failed.";
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
    return;
  }

  const gateway = createEnterpriseDataCapabilityGateway(state.client);
  const oauthStatus = await gateway.getConnectorOAuthStatus(tenantId, sessionId);
  if (
    !oauthStatus.ok ||
    oauthStatus.data.status !== "completed" ||
    !oauthStatus.data.credentialId
  ) {
    runtime.libraryWorkspaceConnectorOAuthError =
      "OAuth authorization is not complete. Retry authorization.";
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
    return;
  }

  if (runtime.libraryWorkspaceConnectorCatalog.length === 0) {
    await loadKnowledgeUniverseConnectorCatalog(state);
  }
  const connectorEntry =
    runtime.libraryWorkspaceConnectorCatalog.find(
      (entry) => entry.connectorId === oauthStatus.data.connectorId,
    ) ?? null;
  runtime.libraryWorkspaceConnectorBindDraft = {
    ...createEmptySpaceConnectorBindDraft(),
    connectorId: oauthStatus.data.connectorId,
    credentialId: oauthStatus.data.credentialId,
    displayName: connectorEntry?.label ?? oauthStatus.data.connectorId,
    sourceKey: connectorEntry?.defaultSourceKey ?? oauthStatus.data.connectorId,
  };
  resetKnowledgeUniverseConnectorOAuthState(runtime);
  runtime.libraryWorkspaceConnectorOAuthNotice =
    "OAuth authorization completed. Test connectivity next.";
  syncWorkspaceToAppState(state);
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
  await loadKnowledgeUniverseConnectorCredentials(state);
}

export async function loadKnowledgeUniverseConnectorCredentials(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const tenantId = resolveKnowledgeUniverseEnterpriseTenantId(state);
  const connectorId = runtime.libraryWorkspaceConnectorBindDraft.connectorId.trim();
  if (!tenantId || !connectorId || !state.client) {
    runtime.libraryWorkspaceConnectorCredentials = [];
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceConnectorCredentialsLoading = true;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createEnterpriseDataCapabilityGateway(state.client);
    const result = await gateway.listConnectorCredentials(tenantId, connectorId);
    runtime.libraryWorkspaceConnectorCredentials = result.ok ? result.data : [];
  } finally {
    runtime.libraryWorkspaceConnectorCredentialsLoading = false;
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
  }
}

function deriveSourceStatusFromProbe(probe: {
  ok: boolean;
  mode: string;
}): "connected" | "error" | "disconnected" {
  if (probe.ok) {
    return "connected";
  }
  return probe.mode === "live_probe_failed" || probe.mode === "handler_error"
    ? "error"
    : "disconnected";
}

async function resolveConnectorCredentialId(
  state: AppPortState,
  runtime: KnowledgeUniverseControllerState,
  tenantId: string,
): Promise<string | undefined> {
  const draft = runtime.libraryWorkspaceConnectorBindDraft;
  const gateway = createEnterpriseDataCapabilityGateway(state.client!);
  if (shouldCreateConnectorCredential(draft)) {
    const credentialResult = await gateway.upsertConnectorCredential(tenantId, {
      connectorId: draft.connectorId.trim(),
      label: draft.credentialLabel.trim(),
      instanceUrl: resolveConnectorInstanceUrl(draft),
      apiKey: draft.apiKey.trim() || undefined,
      ...buildConnectorSecretOptions(draft),
    });
    if (!credentialResult.ok) {
      throw new Error(credentialResult.error);
    }
    return credentialResult.data.credentialId;
  }
  const selected = draft.credentialId.trim();
  return selected || undefined;
}

export async function ensureKnowledgeUniverseConnectorPackageForImport(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const tenantId = resolveKnowledgeUniverseEnterpriseTenantId(state);
  const connectorId = runtime.libraryWorkspaceConnectorBindDraft.connectorId.trim();
  if (!tenantId || !connectorId || !state.client) {
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createEnterpriseDataCapabilityGateway(state.client);
    const result = await gateway.ensureConnectorPackage(tenantId, connectorId);
    if (!result.ok) {
      runtime.personalActionError = result.error;
    } else {
      runtime.personalActionNotice = result.data.installed
        ? "Connector package installed."
        : "Connector package already installed.";
      await loadKnowledgeUniverseConnectorCatalog(state);
    }
  } catch (error) {
    runtime.personalActionError = error instanceof Error ? error.message : "Install failed";
  } finally {
    runtime.personalActionBusy = false;
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function testKnowledgeUniverseConnectorConnectionForImport(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const tenantId = resolveKnowledgeUniverseEnterpriseTenantId(state);
  const connectorId = runtime.libraryWorkspaceConnectorBindDraft.connectorId.trim();
  if (!tenantId || !connectorId || !state.client) {
    return;
  }
  runtime.libraryWorkspaceConnectorProbeBusy = true;
  runtime.personalActionError = null;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createEnterpriseDataCapabilityGateway(state.client);
    const draft = runtime.libraryWorkspaceConnectorBindDraft;
    const result = await gateway.testSourceConnection(
      tenantId,
      connectorId,
      buildConnectorConnectionOptions(draft),
    );
    if (!result.ok) {
      runtime.libraryWorkspaceConnectorProbeOk = false;
      runtime.libraryWorkspaceConnectorProbeMessage = result.error;
    } else {
      runtime.libraryWorkspaceConnectorProbeOk = result.data.ok;
      runtime.libraryWorkspaceConnectorProbeMessage = result.data.message;
    }
  } catch (error) {
    runtime.libraryWorkspaceConnectorProbeOk = false;
    runtime.libraryWorkspaceConnectorProbeMessage =
      error instanceof Error ? error.message : "Connection test failed";
  } finally {
    runtime.libraryWorkspaceConnectorProbeBusy = false;
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
  }
}

async function finishKnowledgeUniverseConnectorOAuth(
  state: AppPortState,
  runtime: KnowledgeUniverseControllerState,
  tenantId: string,
  credentialId: string,
  connectorId: string,
) {
  runtime.libraryWorkspaceConnectorBindDraft.credentialId = credentialId;
  runtime.libraryWorkspaceConnectorBindDraft.saveNewCredential = false;
  runtime.libraryWorkspaceConnectorOAuthBusy = false;
  runtime.libraryWorkspaceConnectorOAuthNotice =
    "OAuth authorization completed. You can test connectivity next.";
  runtime.libraryWorkspaceConnectorOAuthError = null;
  runtime.libraryWorkspaceConnectorOAuthSessionId = null;
  runtime.libraryWorkspaceConnectorOAuthSimulateAllowed = false;
  runtime.libraryWorkspaceConnectorProbeOk = null;
  runtime.libraryWorkspaceConnectorProbeMessage = null;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
  await loadKnowledgeUniverseConnectorCredentials(state);
  if (runtime.libraryWorkspaceConnectorBindDraft.connectorId.trim() !== connectorId) {
    runtime.libraryWorkspaceConnectorBindDraft.connectorId = connectorId;
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function pollKnowledgeUniverseConnectorOAuthStatus(
  state: AppPortState,
  sessionId: string,
  attempts = 120,
): Promise<{ credentialId: string; connectorId: string } | null> {
  const tenantId = resolveKnowledgeUniverseEnterpriseTenantId(state);
  if (!tenantId || !state.client || !sessionId.trim()) {
    return null;
  }
  const gateway = createEnterpriseDataCapabilityGateway(state.client);
  for (let index = 0; index < attempts; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    try {
      const status = await gateway.getConnectorOAuthStatus(tenantId, sessionId);
      if (!status.ok) {
        continue;
      }
      if (status.data.status === "completed" && status.data.credentialId) {
        return {
          credentialId: status.data.credentialId,
          connectorId: status.data.connectorId,
        };
      }
      if (status.data.status === "expired" || status.data.status === "failed") {
        return null;
      }
    } catch {
      // Keep polling until timeout.
    }
  }
  return null;
}

export async function simulateCompleteKnowledgeUniverseConnectorOAuth(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const tenantId = resolveKnowledgeUniverseEnterpriseTenantId(state);
  const sessionId = runtime.libraryWorkspaceConnectorOAuthSessionId?.trim() ?? "";
  const connectorId = runtime.libraryWorkspaceConnectorBindDraft.connectorId.trim();
  const label = runtime.libraryWorkspaceConnectorBindDraft.credentialLabel.trim();
  if (!tenantId || !sessionId || !connectorId || !label || !state.client) {
    runtime.libraryWorkspaceConnectorOAuthError = "Complete OAuth authorization first.";
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceConnectorOAuthBusy = true;
  runtime.libraryWorkspaceConnectorOAuthError = null;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createEnterpriseDataCapabilityGateway(state.client);
    const simulated = await gateway.simulateCompleteConnectorOAuth(tenantId, sessionId, label);
    if (!simulated.ok) {
      runtime.libraryWorkspaceConnectorOAuthError = simulated.error;
      return;
    }
    await finishKnowledgeUniverseConnectorOAuth(
      state,
      runtime,
      tenantId,
      simulated.data.credentialId,
      connectorId,
    );
    runtime.libraryWorkspaceConnectorOAuthNotice = "Simulated OAuth completed (demo mode).";
  } catch (error) {
    runtime.libraryWorkspaceConnectorOAuthError =
      error instanceof Error ? error.message : "OAuth simulation failed";
  } finally {
    runtime.libraryWorkspaceConnectorOAuthBusy = false;
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function startKnowledgeUniverseConnectorOAuth(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const tenantId = resolveKnowledgeUniverseEnterpriseTenantId(state);
  const connectorId = runtime.libraryWorkspaceConnectorBindDraft.connectorId.trim();
  const label = runtime.libraryWorkspaceConnectorBindDraft.credentialLabel.trim();
  if (!tenantId || !connectorId || !label || !state.client || typeof window === "undefined") {
    runtime.libraryWorkspaceConnectorOAuthError = "Enter a credential label before authorizing.";
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceConnectorOAuthBusy = true;
  runtime.libraryWorkspaceConnectorOAuthError = null;
  runtime.libraryWorkspaceConnectorOAuthNotice = null;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createEnterpriseDataCapabilityGateway(state.client);
    const started = await gateway.startConnectorOAuth(tenantId, {
      connectorId,
      label,
      callbackOrigin: window.location.origin,
      basePath: state.basePath,
      returnPath: window.location.pathname + window.location.search,
    });
    if (!started.ok) {
      runtime.libraryWorkspaceConnectorOAuthError = started.error;
      return;
    }
    runtime.libraryWorkspaceConnectorOAuthSessionId = started.data.sessionId;
    runtime.libraryWorkspaceConnectorOAuthSimulateAllowed = started.data.simulateAllowed;
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
    if (started.data.authorizeUrl) {
      openExternalUrlSafe(started.data.authorizeUrl);
      runtime.libraryWorkspaceConnectorOAuthNotice =
        "Authorization page opened. Complete sign-in in the new window.";
      syncConnectorBindToAppState(state, runtime);
      requestUpdate(state);
      const completed = await pollKnowledgeUniverseConnectorOAuthStatus(
        state,
        started.data.sessionId,
      );
      if (!completed) {
        runtime.libraryWorkspaceConnectorOAuthError =
          "OAuth callback timed out. Retry authorization or use simulate complete.";
        return;
      }
      await finishKnowledgeUniverseConnectorOAuth(
        state,
        runtime,
        tenantId,
        completed.credentialId,
        completed.connectorId,
      );
      return;
    }
    if (started.data.simulateAllowed) {
      await simulateCompleteKnowledgeUniverseConnectorOAuth(state);
      return;
    }
    runtime.libraryWorkspaceConnectorOAuthError =
      "This connector does not support OAuth authorization.";
  } catch (error) {
    runtime.libraryWorkspaceConnectorOAuthError =
      error instanceof Error ? error.message : "OAuth authorization failed";
  } finally {
    runtime.libraryWorkspaceConnectorOAuthBusy = false;
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function bindKnowledgeUniverseConnectorSource(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = requireSelectedKnowledgeBaseId(state);
  const tenantId = resolveKnowledgeUniverseEnterpriseTenantId(state);
  const connectorId = runtime.libraryWorkspaceConnectorBindDraft.connectorId.trim();
  if (!kbId || !tenantId || !connectorId || !state.client) {
    return;
  }
  if (runtime.libraryWorkspaceConnectorProbeOk !== true) {
    runtime.personalActionError = "Test connection before binding.";
    syncConnectorBindToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncConnectorBindToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createEnterpriseDataCapabilityGateway(state.client);
    const draft = runtime.libraryWorkspaceConnectorBindDraft;
    const credentialId = await resolveConnectorCredentialId(state, runtime, tenantId);
    const probe = await gateway.testSourceConnection(
      tenantId,
      connectorId,
      buildConnectorConnectionOptions(draft, credentialId),
    );
    const status = probe.ok ? deriveSourceStatusFromProbe(probe.data) : "disconnected";
    const connector = runtime.libraryWorkspaceConnectorCatalog.find(
      (entry) => entry.connectorId === connectorId,
    );
    const displayName = draft.displayName.trim() || connector?.label || connectorId;
    const sourceKey = draft.sourceKey.trim() || connector?.defaultSourceKey || connectorId;
    const sourceResult = await gateway.upsertSource(tenantId, {
      sourceKey,
      displayName,
      category: connector?.category ?? "external",
      status,
      connectorId,
      credentialId,
    });
    if (!sourceResult.ok) {
      throw new Error(sourceResult.error);
    }
    const knowledgeGateway = createKnowledgeUniverseGateway(state.client);
    await knowledgeGateway.bindSource(
      buildConnectorKnowledgeSourceBindRequest({
        knowledgeBaseId: kbId,
        displayName,
        tenantId,
        sourceId: sourceResult.data.sourceId,
        connectorId,
      }),
    );
    resetKnowledgeUniverseConnectorBindDraft(runtime);
    runtime.libraryWorkspaceBindSourceTitle = "";
    runtime.libraryWorkspaceBindSourceEndpoint = "";
    runtime.libraryWorkspaceImportOpen = false;
    runtime.libraryWorkspaceImportKind = null;
    runtime.libraryWorkspaceContentTab = "documents";
    runtime.personalActionNotice = personalNoticeActiveSourceBound();
    await loadLibraryWorkspaceDocuments(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageBindSourceFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncImportUiState(state, runtime);
    requestUpdate(state);
  }
}

export async function bindKnowledgeUniverseHttpRestSource(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = requireSelectedKnowledgeBaseId(state);
  if (!kbId || !state.client) {
    return;
  }
  const endpoint = runtime.libraryWorkspaceBindSourceEndpoint.trim();
  if (!endpoint) {
    runtime.personalActionError = personalMessageActiveSourceEndpointRequired();
    syncImportUiState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncImportUiState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.bindSource({
      ...buildActiveSourceBindRequest({
        knowledgeBaseId: kbId,
        kind: "api",
        title: runtime.libraryWorkspaceBindSourceTitle,
        endpoint,
      }),
      metadata: buildApiSourceMetadata(runtime.libraryWorkspaceConnectorBindDraft),
    });
    runtime.libraryWorkspaceBindSourceTitle = "";
    runtime.libraryWorkspaceBindSourceEndpoint = "";
    runtime.libraryWorkspaceConnectorBindDraft.apiKey = "";
    runtime.libraryWorkspaceImportOpen = false;
    runtime.libraryWorkspaceImportKind = null;
    runtime.libraryWorkspaceContentTab = "documents";
    runtime.libraryWorkspaceSourcesPlaneFilter = "active";
    runtime.personalActionNotice = personalNoticeActiveSourceBound();
    await loadLibraryWorkspaceDocuments(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageBindSourceFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncImportUiState(state, runtime);
    requestUpdate(state);
  }
}
