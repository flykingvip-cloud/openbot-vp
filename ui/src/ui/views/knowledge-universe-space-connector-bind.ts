import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { DataConnectorCatalogEntry } from "../capability/enterprise-data-capability/types.ts";
import type { KnowledgeSourceBindRequest } from "../capability/knowledge-universe/endpoints.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { createEmptyConnectorCredentialDraft } from "./enterprise-data-connector-credential-helpers.ts";
import { renderKnowledgeUniverseConnectorCredentialFields } from "./knowledge-universe-space-connector-credential-fields.ts";
import { resolveSelectedKb } from "./knowledge-universe-space-import.ts";

export type ActiveSourceBindPath = "http_only" | "connector_plus_http" | "disabled";

export type SpaceConnectorBindDraft = ReturnType<typeof createEmptyConnectorCredentialDraft> & {
  displayName: string;
  sourceKey: string;
  passwordVisible: boolean;
  requestMethod: "GET" | "POST";
};

export function createEmptySpaceConnectorBindDraft(): SpaceConnectorBindDraft {
  return {
    ...createEmptyConnectorCredentialDraft(),
    displayName: "",
    sourceKey: "",
    passwordVisible: false,
    authHeaderName: "X-API-Key",
    requestMethod: "GET",
  };
}

export function buildApiSourceMetadata(draft: SpaceConnectorBindDraft): Record<string, string> {
  return Object.fromEntries(
    [
      ["auth.header", draft.authHeaderName.trim()],
      ["auth.apiKey", draft.apiKey.trim()],
      ["request.method", draft.requestMethod],
    ].filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export function resolveActiveSourceBindPath(params: {
  visibility: KnowledgeBaseSummary["visibility"];
  tenantId: string | null | undefined;
}): ActiveSourceBindPath {
  const tenant = params.tenantId?.trim() || null;
  if (params.visibility === "team" || params.visibility === "enterprise") {
    return tenant ? "connector_plus_http" : "disabled";
  }
  return tenant ? "connector_plus_http" : "http_only";
}

export function buildEnterpriseDataSourceBindEndpoint(params: {
  tenantId: string;
  sourceId: string;
  connectorId: string;
}): string {
  const tenantId = encodeURIComponent(params.tenantId.trim());
  const sourceId = encodeURIComponent(params.sourceId.trim());
  const connectorId = encodeURIComponent(params.connectorId.trim());
  return `enterprise-data://tenant/${tenantId}/source/${sourceId}?connectorId=${connectorId}`;
}

export function buildConnectorKnowledgeSourceBindRequest(params: {
  knowledgeBaseId: string;
  displayName: string;
  tenantId: string;
  sourceId: string;
  connectorId: string;
}): KnowledgeSourceBindRequest {
  const title = params.displayName.trim() || params.connectorId.trim();
  return {
    kind: "external",
    title,
    endpoint: buildEnterpriseDataSourceBindEndpoint({
      tenantId: params.tenantId,
      sourceId: params.sourceId,
      connectorId: params.connectorId,
    }),
    knowledgeBaseId: params.knowledgeBaseId,
  };
}

function selectedConnector(
  catalog: DataConnectorCatalogEntry[],
  connectorId: string,
): DataConnectorCatalogEntry | null {
  const normalized = connectorId.trim();
  if (!normalized) {
    return null;
  }
  return catalog.find((entry) => entry.connectorId === normalized) ?? null;
}

function renderHttpRestQuickBind(surface: WorkbenchKnowledgeSurface, collapsed: boolean) {
  const body = html`
    <p class="ku-space-import__hint">
      ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.httpRestHint")}
    </p>
    <label class="knowledge-universe__field">
      <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.activeTitle")}</span>
      <input
        type="text"
        .value=${surface.libraryWorkspaceBindSourceTitle}
        ?disabled=${surface.personalActionBusy}
        @input=${(event: Event) =>
          surface.onLibraryWorkspaceBindSourceDraftChange(
            "title",
            (event.target as HTMLInputElement).value,
          )}
      />
    </label>
    <div class="ku-space-import__field-row">
      <label class="knowledge-universe__field">
        <span>HTTP</span>
        <select
          data-testid="ku-space-import-http-method"
          .value=${surface.libraryWorkspaceConnectorBindDraft.requestMethod}
          ?disabled=${surface.personalActionBusy}
          @change=${(event: Event) =>
            surface.onLibraryWorkspaceConnectorBindDraftChange(
              "requestMethod",
              (event.target as HTMLSelectElement).value,
            )}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>
      </label>
      <label class="knowledge-universe__field">
        <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.authHeaderName")}</span>
        <input
          type="text"
          .value=${surface.libraryWorkspaceConnectorBindDraft.authHeaderName}
          placeholder="X-API-Key"
          ?disabled=${surface.personalActionBusy}
          @input=${(event: Event) =>
            surface.onLibraryWorkspaceConnectorBindDraftChange(
              "authHeaderName",
              (event.target as HTMLInputElement).value,
            )}
        />
      </label>
    </div>
    <label class="knowledge-universe__field">
      <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.apiKey")}</span>
      <input
        type="password"
        autocomplete="off"
        .value=${surface.libraryWorkspaceConnectorBindDraft.apiKey}
        ?disabled=${surface.personalActionBusy}
        @input=${(event: Event) =>
          surface.onLibraryWorkspaceConnectorBindDraftChange(
            "apiKey",
            (event.target as HTMLInputElement).value,
          )}
      />
    </label>
    <label class="knowledge-universe__field">
      <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.httpRestUrl")}</span>
      <input
        type="url"
        .value=${surface.libraryWorkspaceBindSourceEndpoint}
        placeholder=${t(
          "frontstage.workbench.knowledgeUniverse.importToSpace.activeEndpointPlaceholder",
        )}
        ?disabled=${surface.personalActionBusy}
        @input=${(event: Event) =>
          surface.onLibraryWorkspaceBindSourceDraftChange(
            "endpoint",
            (event.target as HTMLInputElement).value,
          )}
      />
    </label>
    <div class="ku-space-import__actions">
      <button
        type="button"
        class="btn btn--sm btn--primary"
        data-testid="ku-space-import-bind-submit"
        ?disabled=${surface.personalActionBusy || !surface.libraryWorkspaceBindSourceEndpoint.trim()}
        @click=${() => void surface.onBindKnowledgeSource()}
      >
        ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.httpRestAction")}
      </button>
    </div>
  `;

  if (collapsed) {
    return html`
      <details
        class="ku-space-import__fold"
        data-testid="ku-space-import-http-rest-fold"
        ?open=${surface.libraryWorkspaceHttpRestExpanded}
        @toggle=${(event: Event) => {
          const details = event.target as HTMLDetailsElement;
          surface.onLibraryWorkspaceHttpRestExpandedChange(details.open);
        }}
      >
        <summary>
          ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.httpRestFold")}
        </summary>
        ${body}
      </details>
    `;
  }

  return html`
    <div class="ku-space-import__form ku-space-import__channel" data-testid="ku-space-import-http-rest">
      ${body}
    </div>
  `;
}

function renderConnectorWizard(surface: WorkbenchKnowledgeSurface) {
  const draft = surface.libraryWorkspaceConnectorBindDraft;
  const catalog = surface.libraryWorkspaceConnectorCatalog;
  const credentials = surface.libraryWorkspaceConnectorCredentials;
  const connector = selectedConnector(catalog, draft.connectorId);
  const showInstallPackage = connector != null;

  return html`
    <div class="ku-space-import__form ku-space-import__channel" data-testid="ku-space-import-connector-wizard">
      <p class="ku-space-import__hint">
        ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.wizardHint")}
      </p>
      ${
        surface.libraryWorkspaceConnectorCatalogLoading
          ? html`<p class="ku-space-import__hint">${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.catalogLoading")}</p>`
          : nothing
      }
      ${
        surface.libraryWorkspaceConnectorCatalogError
          ? html`<p class="ku-space-import__error">${surface.libraryWorkspaceConnectorCatalogError}</p>`
          : nothing
      }
      <label class="knowledge-universe__field">
        <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.connectorLabel")}</span>
        <select
          data-testid="ku-space-import-connector-select"
          .value=${draft.connectorId}
          ?disabled=${surface.personalActionBusy || surface.libraryWorkspaceConnectorCatalogLoading}
          @change=${(event: Event) =>
            surface.onLibraryWorkspaceConnectorBindDraftChange(
              "connectorId",
              (event.target as HTMLSelectElement).value,
            )}
        >
          <option value="">
            ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.connectorPlaceholder")}
          </option>
          ${catalog.map(
            (entry) => html`
              <option value=${entry.connectorId}>
                ${entry.label}${entry.ready ? "" : ` (${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.needsPackage")})`}
              </option>
            `,
          )}
        </select>
      </label>
      ${
        connector && connector.credentialKind !== "none"
          ? renderKnowledgeUniverseConnectorCredentialFields({
              draft,
              connector,
              credentials,
              busy:
                surface.personalActionBusy || surface.libraryWorkspaceConnectorCredentialsLoading,
              oauthBusy: surface.libraryWorkspaceConnectorOAuthBusy,
              oauthNotice: surface.libraryWorkspaceConnectorOAuthNotice,
              oauthError: surface.libraryWorkspaceConnectorOAuthError,
              oauthSimulateAllowed: surface.libraryWorkspaceConnectorOAuthSimulateAllowed,
              oauthSessionId: surface.libraryWorkspaceConnectorOAuthSessionId,
              handlers: {
                onDraftChange: (field, value) =>
                  surface.onLibraryWorkspaceConnectorBindDraftChange(field, value),
                onCredentialSelect: (value) =>
                  surface.onLibraryWorkspaceConnectorCredentialSelect(value),
                onStartOAuth: () => void surface.onStartConnectorOAuthForImport?.(),
                onSimulateOAuth: () => void surface.onSimulateConnectorOAuthForImport?.(),
              },
            })
          : nothing
      }
      <label class="knowledge-universe__field">
        <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.displayName")}</span>
        <input
          type="text"
          .value=${draft.displayName}
          placeholder=${connector?.label ?? ""}
          ?disabled=${surface.personalActionBusy}
          @input=${(event: Event) =>
            surface.onLibraryWorkspaceConnectorBindDraftChange(
              "displayName",
              (event.target as HTMLInputElement).value,
            )}
        />
      </label>
      ${
        surface.libraryWorkspaceConnectorProbeOk === true
          ? html`<p class="ku-space-import__notice">${surface.libraryWorkspaceConnectorProbeMessage ?? t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.probeOk")}</p>`
          : surface.libraryWorkspaceConnectorProbeOk === false
            ? html`<p class="ku-space-import__error">${surface.libraryWorkspaceConnectorProbeMessage ?? t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.probeFailed")}</p>`
            : nothing
      }
      <div class="ku-space-import__actions">
        ${
          showInstallPackage
            ? html`
                <button
                  type="button"
                  class="btn btn--sm"
                  data-testid="ku-space-import-ensure-package"
                  ?disabled=${surface.personalActionBusy || surface.libraryWorkspaceConnectorProbeBusy}
                  @click=${() => void surface.onEnsureConnectorPackageForImport?.()}
                >
                  ${
                    connector?.ready
                      ? t(
                          "frontstage.workbench.knowledgeUniverse.importToSpace.connector.updatePackage",
                        )
                      : t(
                          "frontstage.workbench.knowledgeUniverse.importToSpace.connector.installPackage",
                        )
                  }
                </button>
              `
            : nothing
        }
        <button
          type="button"
          class="btn btn--sm"
          data-testid="ku-space-import-test-connection"
          ?disabled=${surface.personalActionBusy || surface.libraryWorkspaceConnectorProbeBusy || !draft.connectorId.trim()}
          @click=${() => void surface.onTestConnectorConnectionForImport?.()}
        >
          ${
            surface.libraryWorkspaceConnectorProbeBusy
              ? t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.probeBusy")
              : t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.testConnection")
          }
        </button>
        <button
          type="button"
          class="btn btn--sm btn--primary"
          data-testid="ku-space-import-connector-bind-submit"
          ?disabled=${surface.personalActionBusy || !draft.connectorId.trim() || surface.libraryWorkspaceConnectorProbeOk !== true}
          @click=${() => void surface.onBindConnectorSourceToKnowledgeBase?.()}
        >
          ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.bindAction")}
        </button>
      </div>
    </div>
  `;
}

export function renderActiveSourceBindPanel(surface: WorkbenchKnowledgeSurface) {
  const kb = resolveSelectedKb(surface);
  const path = resolveActiveSourceBindPath({
    visibility: kb?.visibility ?? "private",
    tenantId: surface.enterpriseTenantId,
  });

  if (path === "disabled") {
    return html`
      <div class="ku-space-import__form" data-testid="ku-space-import-form-active-disabled">
        <p class="ku-space-import__hint">
          ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.disabledHint")}
        </p>
      </div>
    `;
  }

  if (path === "http_only") {
    return html`
      <div data-testid="ku-space-import-form-active">
        <p class="ku-space-import__hint">
          ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.privateHttpHint")}
        </p>
        ${renderHttpRestQuickBind(surface, false)}
      </div>
    `;
  }

  return html`
    <div data-testid="ku-space-import-form-active">
      ${renderConnectorWizard(surface)}
      ${renderHttpRestQuickBind(surface, true)}
    </div>
  `;
}
