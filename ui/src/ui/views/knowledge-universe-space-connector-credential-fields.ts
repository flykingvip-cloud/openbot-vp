import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  DataConnectorCatalogEntry,
  DataConnectorCredentialRecord,
} from "../capability/enterprise-data-capability/types.ts";
import type { HttpRestAuthScheme } from "../capability/enterprise-data-capability/types.ts";
import { showConnectorNewCredentialForm } from "./enterprise-data-connector-credential-helpers.ts";
import type { SpaceConnectorBindDraft } from "./knowledge-universe-space-connector-bind.ts";

type CredentialFieldHandlers = {
  onDraftChange: (field: keyof SpaceConnectorBindDraft, value: string) => void;
  onCredentialSelect: (value: string) => void;
  onStartOAuth?: () => void;
  onSimulateOAuth?: () => void;
};

function renderSecretInput(params: {
  label: string;
  value: string;
  visible: boolean;
  disabled: boolean;
  placeholder?: string;
  hint?: string;
  onInput: (value: string) => void;
  onToggle: () => void;
}) {
  return html`
    <label class="knowledge-universe__field">
      <span>${params.label}</span>
      <div class="ku-space-import__secret-input">
        <input
          type=${params.visible ? "text" : "password"}
          .value=${params.value}
          placeholder=${params.placeholder ?? ""}
          ?disabled=${params.disabled}
          @input=${(event: Event) => params.onInput((event.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="btn btn--sm ku-space-import__secret-toggle"
          ?disabled=${params.disabled}
          @click=${params.onToggle}
        >
          ${
            params.visible
              ? t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.hideSecret")
              : t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.showSecret")
          }
        </button>
      </div>
      ${params.hint ? html`<small class="ku-space-import__hint">${params.hint}</small>` : nothing}
    </label>
  `;
}

export function renderKnowledgeUniverseConnectorCredentialFields(params: {
  draft: SpaceConnectorBindDraft;
  connector: DataConnectorCatalogEntry;
  credentials: DataConnectorCredentialRecord[];
  busy: boolean;
  oauthBusy: boolean;
  oauthNotice: string | null;
  oauthError: string | null;
  oauthSimulateAllowed: boolean;
  oauthSessionId: string | null;
  handlers: CredentialFieldHandlers;
}) {
  const {
    draft,
    connector,
    credentials,
    busy,
    oauthBusy,
    oauthNotice,
    oauthError,
    oauthSimulateAllowed,
    oauthSessionId,
    handlers,
  } = params;
  const isOAuthConnector = connector.credentialKind === "oauth2";
  const isApiKeyConnector = connector.credentialKind === "api_key";
  const isHttpRest = connector.connectorId === "http-rest";
  const isPostgres = connector.connectorId === "db-postgres";
  const showNewCredentialForm = showConnectorNewCredentialForm(draft);
  const credentialSelectValue = draft.saveNewCredential ? "__new__" : draft.credentialId;

  return html`
    <label class="knowledge-universe__field">
      <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.credentialLabel")}</span>
      <select
        data-testid="ku-space-import-credential-select"
        .value=${credentialSelectValue}
        ?disabled=${busy || oauthBusy}
        @change=${(event: Event) =>
          handlers.onCredentialSelect((event.target as HTMLSelectElement).value)}
      >
        <option value="">
          ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.credentialPlaceholder")}
        </option>
        ${credentials.map(
          (entry) => html`
            <option value=${entry.credentialId}>
              ${entry.label}${entry.secretHint ? ` (${entry.secretHint})` : ""}
            </option>
          `,
        )}
        <option value="__new__">
          ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.createCredential")}
        </option>
      </select>
      ${
        connector.description
          ? html`<small class="ku-space-import__hint">${connector.description}</small>`
          : nothing
      }
    </label>
  ${
    showNewCredentialForm && isApiKeyConnector
      ? html`
          <label class="knowledge-universe__field">
            <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.newCredentialLabel")}</span>
            <input
              type="text"
              data-testid="ku-space-import-credential-label"
              .value=${draft.credentialLabel}
              ?disabled=${busy}
              @input=${(event: Event) =>
                handlers.onDraftChange("credentialLabel", (event.target as HTMLInputElement).value)}
            />
          </label>
        `
      : nothing
  }
  ${
    showNewCredentialForm && isApiKeyConnector && !isPostgres
      ? html`
          <label class="knowledge-universe__field">
            <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.instanceUrl")}</span>
            <input
              type="url"
              .value=${draft.instanceUrl}
              placeholder=${
                isHttpRest
                  ? t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.connector.httpRestInstancePlaceholder",
                    )
                  : t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.connector.instanceUrlPlaceholder",
                    )
              }
              ?disabled=${busy}
              @input=${(event: Event) =>
                handlers.onDraftChange("instanceUrl", (event.target as HTMLInputElement).value)}
            />
          </label>
          ${renderSecretInput({
            label: t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.apiKey"),
            value: draft.apiKey,
            visible: draft.passwordVisible,
            disabled: busy,
            hint: t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.apiKeyHint"),
            onInput: (value) => handlers.onDraftChange("apiKey", value),
            onToggle: () =>
              handlers.onDraftChange("passwordVisible", draft.passwordVisible ? "false" : "true"),
          })}
        `
      : nothing
  }
  ${
    showNewCredentialForm && isHttpRest
      ? html`
          <label class="knowledge-universe__field">
            <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.authScheme")}</span>
            <select
              data-testid="ku-space-import-auth-scheme"
              .value=${draft.authScheme}
              ?disabled=${busy}
              @change=${(event: Event) =>
                handlers.onDraftChange(
                  "authScheme",
                  (event.target as HTMLSelectElement).value as HttpRestAuthScheme,
                )}
            >
              <option value="bearer">${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.authBearer")}</option>
              <option value="header">${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.authHeader")}</option>
              <option value="query">${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.authQuery")}</option>
              <option value="basic">${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.authBasic")}</option>
              <option value="none">${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.authNone")}</option>
            </select>
          </label>
          ${
            draft.authScheme === "header"
              ? html`
                  <label class="knowledge-universe__field">
                    <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.authHeaderName")}</span>
                    <input
                      .value=${draft.authHeaderName}
                      placeholder="X-API-Key"
                      ?disabled=${busy}
                      @input=${(event: Event) =>
                        handlers.onDraftChange(
                          "authHeaderName",
                          (event.target as HTMLInputElement).value,
                        )}
                    />
                  </label>
                `
              : nothing
          }
          ${
            draft.authScheme === "query"
              ? html`
                  <label class="knowledge-universe__field">
                    <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.authQueryParam")}</span>
                    <input
                      .value=${draft.authQueryParam}
                      placeholder="api_key"
                      ?disabled=${busy}
                      @input=${(event: Event) =>
                        handlers.onDraftChange(
                          "authQueryParam",
                          (event.target as HTMLInputElement).value,
                        )}
                    />
                  </label>
                `
              : nothing
          }
          ${
            draft.authScheme === "basic"
              ? html`
                  <label class="knowledge-universe__field">
                    <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.basicUsername")}</span>
                    <input
                      .value=${draft.basicUsername}
                      ?disabled=${busy}
                      @input=${(event: Event) =>
                        handlers.onDraftChange(
                          "basicUsername",
                          (event.target as HTMLInputElement).value,
                        )}
                    />
                  </label>
                `
              : nothing
          }
          <label class="knowledge-universe__field">
            <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.probePath")}</span>
            <input
              .value=${draft.probePath}
              placeholder="/health"
              ?disabled=${busy}
              @input=${(event: Event) =>
                handlers.onDraftChange("probePath", (event.target as HTMLInputElement).value)}
            />
          </label>
        `
      : nothing
  }
  ${
    showNewCredentialForm && isPostgres
      ? html`
          <label class="knowledge-universe__field">
            <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.dbHost")}</span>
            <input
              .value=${draft.dbHost}
              placeholder="192.168.1.100"
              ?disabled=${busy}
              @input=${(event: Event) =>
                handlers.onDraftChange("dbHost", (event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="knowledge-universe__field">
            <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.dbPort")}</span>
            <input
              .value=${draft.dbPort}
              placeholder="5432"
              ?disabled=${busy}
              @input=${(event: Event) =>
                handlers.onDraftChange("dbPort", (event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="knowledge-universe__field">
            <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.dbName")}</span>
            <input
              .value=${draft.dbName}
              placeholder="enterprise_prod"
              ?disabled=${busy}
              @input=${(event: Event) =>
                handlers.onDraftChange("dbName", (event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="knowledge-universe__field">
            <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.dbUsername")}</span>
            <input
              .value=${draft.basicUsername}
              ?disabled=${busy}
              @input=${(event: Event) =>
                handlers.onDraftChange("basicUsername", (event.target as HTMLInputElement).value)}
            />
          </label>
          ${renderSecretInput({
            label: t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.dbPassword"),
            value: draft.apiKey,
            visible: draft.passwordVisible,
            disabled: busy,
            hint: t(
              "frontstage.workbench.knowledgeUniverse.importToSpace.connector.dbPasswordHint",
            ),
            onInput: (value) => handlers.onDraftChange("apiKey", value),
            onToggle: () =>
              handlers.onDraftChange("passwordVisible", draft.passwordVisible ? "false" : "true"),
          })}
        `
      : nothing
  }
  ${
    showNewCredentialForm && isOAuthConnector
      ? html`
          <label class="knowledge-universe__field">
            <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.oauthCredentialLabel")}</span>
            <input
              type="text"
              data-testid="ku-space-import-oauth-credential-label"
              .value=${draft.credentialLabel}
              ?disabled=${busy || oauthBusy}
              @input=${(event: Event) =>
                handlers.onDraftChange("credentialLabel", (event.target as HTMLInputElement).value)}
            />
          </label>
          <div class="ku-space-import__actions ku-space-import__actions--inline">
            <button
              type="button"
              class="btn btn--sm btn--primary"
              data-testid="ku-space-import-oauth-authorize"
              ?disabled=${busy || oauthBusy || !draft.credentialLabel.trim()}
              @click=${() => void handlers.onStartOAuth?.()}
            >
              ${
                oauthBusy
                  ? t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.oauthBusy")
                  : t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.connector.oauthAuthorize",
                    )
              }
            </button>
            ${
              oauthSimulateAllowed && oauthSessionId
                ? html`
                    <button
                      type="button"
                      class="btn btn--sm"
                      data-testid="ku-space-import-oauth-simulate"
                      ?disabled=${busy || oauthBusy}
                      @click=${() => void handlers.onSimulateOAuth?.()}
                    >
                      ${t("frontstage.workbench.knowledgeUniverse.importToSpace.connector.oauthSimulate")}
                    </button>
                  `
                : nothing
            }
          </div>
          ${oauthNotice ? html`<p class="ku-space-import__notice">${oauthNotice}</p>` : nothing}
          ${oauthError ? html`<p class="ku-space-import__error">${oauthError}</p>` : nothing}
        `
      : nothing
  }
  `;
}
