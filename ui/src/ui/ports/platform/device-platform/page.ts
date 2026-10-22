import { html, nothing } from "lit";
import { i18n } from "../../../../i18n/index.ts";
import { formatRelativeTimestamp } from "../../../format.ts";
import { requestOpenBotAppRerender } from "../../../request-app-rerender.ts";
import { dp } from "./copy.ts";
import "./page.css";

/**
 * Platform-admin「设备平台连接」.
 * Manages connector partners (connection + reachability), not device inventory.
 */

export type DevicePlatformEnvironment = "production" | "staging" | "development";

export type DevicePlatformConnectionView = {
  platformId: string;
  displayName: string;
  environment: DevicePlatformEnvironment;
  serviceBaseUrl: string;
  contractVersion: string;
  credentialRef: string;
  clientIdentity: string;
  registrationNotes: string;
  callbackAllowlist: string[];
  serviceClientIds: string[];
  enabled: boolean;
  disabledDisposition: "block_new_keep_existing";
  credentialPresent: boolean;
  credentialRotatedAt?: string;
  health: "unknown" | "ok" | "down";
  healthCheckedAt?: string;
  healthCode?: string;
  healthError?: string;
};

export type DevicePlatformProbeResult = {
  connection: DevicePlatformConnectionView;
  checks: { health: "ok" | "failed"; capabilities: "ok" | "failed" | "skipped" };
  partial: boolean;
};

export class DevicePlatformAdminRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DevicePlatformAdminRequestError";
    this.status = status;
  }
}

export type DevicePlatformAdminClient = {
  list(): Promise<DevicePlatformConnectionView[]>;
  save(platformId: string, body: Record<string, unknown>): Promise<DevicePlatformConnectionView>;
  setCredential(
    platformId: string,
    clientSecret: string,
    rotate: boolean,
  ): Promise<DevicePlatformConnectionView>;
  test(platformId: string): Promise<DevicePlatformProbeResult>;
};

type FilterId = "all" | "enabled" | "abnormal";
type ViewMode = "list" | "form";

type Draft = {
  platformId: string;
  displayName: string;
  environment: DevicePlatformEnvironment;
  serviceBaseUrl: string;
  contractVersion: string;
  credentialRef: string;
  clientIdentity: string;
  serviceClientIds: string;
  registrationNotes: string;
  callbackAllowlist: string;
  enabled: boolean;
  clientSecret: string;
  rotate: boolean;
  overrideClientId: boolean;
};

type PanelState = {
  status: "loading" | "unauthorized" | "failure" | "ready";
  message: string;
  connections: DevicePlatformConnectionView[];
  notice: string;
  partial: string;
  busy: boolean;
  draft: Draft;
  mode: "create" | "edit";
  view: ViewMode;
  filter: FilterId;
};

const DEFAULT_IDENTITY = "device-platform";
const CONTRACT_VERSIONS = ["v1"] as const;

function emptyDraft(): Draft {
  return {
    platformId: "",
    displayName: "",
    environment: "development",
    serviceBaseUrl: "",
    contractVersion: "v1",
    credentialRef: "",
    clientIdentity: DEFAULT_IDENTITY,
    serviceClientIds: DEFAULT_IDENTITY,
    registrationNotes: "",
    callbackAllowlist: "",
    enabled: true,
    clientSecret: "",
    rotate: false,
    overrideClientId: false,
  };
}

let clientOverride: DevicePlatformAdminClient | null = null;
let loadToken = 0;
let state: PanelState = {
  status: "loading",
  message: "",
  connections: [],
  notice: "",
  partial: "",
  busy: false,
  draft: emptyDraft(),
  mode: "create",
  view: "list",
  filter: "all",
};

export function setDevicePlatformAdminClientForTests(
  client: DevicePlatformAdminClient | null,
): void {
  clientOverride = client;
}

export function resetDevicePlatformConnectionPanelForTests(): void {
  loadToken += 1;
  state = {
    status: "loading",
    message: "",
    connections: [],
    notice: "",
    partial: "",
    busy: false,
    draft: emptyDraft(),
    mode: "create",
    view: "list",
    filter: "all",
  };
}

export function createDevicePlatformFetchClient(
  fetchImpl: typeof fetch = fetch,
): DevicePlatformAdminClient {
  return {
    list: async () => {
      const body = await request(fetchImpl, "/api/device-platform/v1/admin/connections", {
        method: "GET",
      });
      return asConnections(body.connections);
    },
    save: async (platformId, payload) => {
      const body = await request(
        fetchImpl,
        `/api/device-platform/v1/admin/connections/${encodeURIComponent(platformId)}`,
        { method: "PUT", body: JSON.stringify(payload) },
      );
      return asConnection(body.connection);
    },
    setCredential: async (platformId, clientSecret, rotate) => {
      const body = await request(
        fetchImpl,
        `/api/device-platform/v1/admin/connections/${encodeURIComponent(platformId)}/credential`,
        { method: "PUT", body: JSON.stringify({ clientSecret, rotate }) },
      );
      return asConnection(body.connection);
    },
    test: async (platformId) => {
      const body = await request(
        fetchImpl,
        `/api/device-platform/v1/admin/connections/${encodeURIComponent(platformId)}/test`,
        { method: "POST", body: "{}" },
      );
      return {
        connection: asConnection(body.connection),
        checks: {
          health:
            body.checks && isRecord(body.checks) && body.checks.health === "ok" ? "ok" : "failed",
          capabilities:
            body.checks && isRecord(body.checks) && body.checks.capabilities === "ok"
              ? "ok"
              : body.checks && isRecord(body.checks) && body.checks.capabilities === "skipped"
                ? "skipped"
                : "failed",
        },
        partial: body.partial === true,
      };
    },
  };
}

export function renderDevicePlatformConnectionPanel() {
  ensureLoaded();
  return html`
    <section
      class="device-platform-admin"
      data-testid="device-platform-connection"
      aria-label=${dp((c) => c.title)}
    >
      ${state.view === "list" ? renderListView() : renderFormView()}
    </section>
  `;
}

function renderListView() {
  return html`
    <div class="device-platform-admin__header">
      <div>
        <div class="device-platform-admin__eyebrow">${dp((c) => c.breadcrumb)}</div>
        <h2 class="device-platform-admin__title">${dp((c) => c.title)}</h2>
        <p class="device-platform-admin__subtitle">${dp((c) => c.subtitle)}</p>
      </div>
      <button
        class="btn primary"
        type="button"
        data-testid="device-platform-add"
        ?disabled=${state.status !== "ready" || state.busy}
        @click=${() => startCreate()}
      >
        ${dp((c) => c.add)}
      </button>
    </div>
    ${renderStatus()}
    ${state.status === "ready" ? renderFilters() : nothing}
    ${state.status === "ready" ? renderTable() : nothing}
    <p class="device-platform-admin__footnote" data-testid="device-platform-footnote">
      ${dp((c) => c.footnote)}
    </p>
  `;
}

function renderFormView() {
  const draft = state.draft;
  const editing = state.mode === "edit";
  const connection = currentConnection();
  const showSecret = !editing || !connection?.credentialPresent || draft.rotate;
  return html`
    ${editing ? renderStatusBanner(connection) : nothing}
    ${state.partial ? html`<p class="callout" data-testid="device-platform-partial">${state.partial}</p>` : nothing}
    ${state.notice ? html`<p class="callout success" data-testid="device-platform-notice">${state.notice}</p>` : nothing}
    <form
      class="card device-platform-admin__section"
      data-testid="device-platform-form"
      @submit=${(event: Event) => void onSubmit(event)}
    >
      <div class="device-platform-admin__section">
        <div class="device-platform-admin__section-title">${dp((c) => c.sectionBasic)}</div>
        <div class="device-platform-admin__grid">
          ${textField({
            label: dp((c) => c.fields.displayName),
            key: "displayName",
            value: draft.displayName,
            required: true,
            placeholder: dp((c) => c.placeholders.displayName),
          })}
          ${
            editing
              ? html`
                  <label class="device-platform-admin__field">
                    <span>${dp((c) => c.fields.platformId)}</span>
                    <input type="text" .value=${draft.platformId} disabled />
                  </label>
                `
              : textField({
                  label: dp((c) => c.fields.platformId),
                  key: "platformId",
                  value: draft.platformId,
                  required: true,
                  placeholder: dp((c) => c.placeholders.platformId),
                  onInput: (value) =>
                    patchDraft({
                      platformId: value,
                      credentialRef: value.trim() ? `cred://device-platform/${value.trim()}` : "",
                    }),
                })
          }
          <label class="device-platform-admin__field">
            <span>${dp((c) => c.fields.environment)}</span>
            <select
              .value=${draft.environment}
              ?disabled=${state.busy}
              @change=${(event: Event) =>
                patchDraft({
                  environment: (event.target as HTMLSelectElement)
                    .value as DevicePlatformEnvironment,
                })}
            >
              <option value="development">development</option>
              <option value="staging">staging</option>
              <option value="production">production</option>
            </select>
          </label>
          <label class="device-platform-admin__field" style="grid-column: 1 / -1">
            <span>${dp((c) => c.fields.registrationNotes)}</span>
            <textarea
              rows="3"
              placeholder=${dp((c) => c.placeholders.registrationNotes)}
              .value=${draft.registrationNotes}
              ?disabled=${state.busy}
              @input=${(event: Event) =>
                patchDraft({ registrationNotes: (event.target as HTMLTextAreaElement).value })}
            ></textarea>
          </label>
        </div>
      </div>

      <div class="device-platform-admin__section card-follow--sm">
        <div class="device-platform-admin__section-title">${dp((c) => c.sectionIntegration)}</div>
        <div class="device-platform-admin__grid">
          ${textField({
            label: dp((c) => c.fields.serviceBaseUrl),
            key: "serviceBaseUrl",
            value: draft.serviceBaseUrl,
            required: true,
            placeholder: dp((c) => c.placeholders.serviceBaseUrl),
            testId: "device-platform-service-url",
          })}
          <label class="device-platform-admin__field">
            <span>${dp((c) => c.fields.contractVersion)}</span>
            <select
              .value=${draft.contractVersion}
              ?disabled=${state.busy}
              @change=${(event: Event) =>
                patchDraft({ contractVersion: (event.target as HTMLSelectElement).value })}
            >
              ${CONTRACT_VERSIONS.map((version) => html`<option value=${version}>${version}</option>`)}
            </select>
          </label>
          <label class="device-platform-admin__field">
            <span>${dp((c) => c.fields.clientIdentity)}</span>
            <select
              .value=${identitySelectValue(draft.clientIdentity)}
              ?disabled=${state.busy}
              @change=${(event: Event) => {
                const value = (event.target as HTMLSelectElement).value;
                patchDraft({ clientIdentity: value, serviceClientIds: value });
              }}
            >
              ${identityOptions(draft.clientIdentity).map(
                (value) => html`<option value=${value}>${value}</option>`,
              )}
            </select>
          </label>
          <label class="device-platform-admin__field">
            <span>${dp((c) => c.fields.credentialRef)}</span>
            <input
              type="text"
              .value=${draft.credentialRef}
              disabled
              readonly
              aria-readonly="true"
              data-testid="device-platform-credential-ref"
            />
            <small class="device-platform-admin__hint" data-testid="device-platform-credential-ref-hint">
              ${dp((c) => c.credentialRefHint)}
            </small>
          </label>
        </div>
        <details class="device-platform-admin__advanced card-follow--sm">
          <summary class="device-platform-admin__advanced-summary">
            ${dp((c) => c.advancedAllowlist)}
          </summary>
          <div class="device-platform-admin__advanced-body">
            <label class="device-platform-admin__field">
              <span>${dp((c) => c.fields.callbackAllowlist)}</span>
              <textarea
                rows="3"
                placeholder=${dp((c) => c.placeholders.callbackAllowlist)}
                .value=${draft.callbackAllowlist}
                ?disabled=${state.busy}
                @input=${(event: Event) =>
                  patchDraft({ callbackAllowlist: (event.target as HTMLTextAreaElement).value })}
              ></textarea>
            </label>
          </div>
        </details>
      </div>

      <div class="device-platform-admin__section card-follow--sm">
        <div class="device-platform-admin__section-title">${dp((c) => c.sectionSecurity)}</div>
        ${
          editing && connection?.credentialPresent
            ? html`
                <label class="device-platform-admin__field">
                  <span>
                    <input
                      type="checkbox"
                      data-testid="device-platform-rotate"
                      .checked=${draft.rotate}
                      ?disabled=${state.busy}
                      @change=${(event: Event) =>
                        patchDraft({
                          rotate: (event.target as HTMLInputElement).checked,
                          clientSecret: "",
                        })}
                    />
                    ${dp((c) => c.fields.rotateSecret)}
                  </span>
                </label>
              `
            : nothing
        }
        ${
          showSecret
            ? html`
                <label class="device-platform-admin__field">
                  <span>
                    ${dp((c) => c.fields.serviceSecret)}
                    <span class="device-platform-admin__req" aria-hidden="true">*</span>
                  </span>
                  <input
                    type="password"
                    autocomplete="new-password"
                    data-testid="device-platform-secret"
                    placeholder=${
                      editing && connection?.credentialPresent
                        ? dp((c) => c.placeholders.secretRotate)
                        : dp((c) => c.placeholders.secretNew)
                    }
                    .value=${draft.clientSecret}
                    ?disabled=${state.busy}
                    @input=${(event: Event) =>
                      patchDraft({ clientSecret: (event.target as HTMLInputElement).value })}
                  />
                </label>
              `
            : html`
                <label class="device-platform-admin__field">
                  <span>${dp((c) => c.fields.serviceSecret)}</span>
                  <input
                    type="password"
                    disabled
                    placeholder=${dp((c) => c.placeholders.secretSaved)}
                    value=""
                  />
                </label>
              `
        }
      </div>

      <div class="device-platform-admin__footer card-follow--sm">
        <button class="btn" type="button" ?disabled=${state.busy} @click=${() => backToList()}>
          ${dp((c) => c.cancel)}
        </button>
        <button class="btn primary" type="submit" ?disabled=${state.busy}>
          ${dp((c) => c.save)}
        </button>
        ${
          editing
            ? html`
                <button
                  class="device-platform-admin__link device-platform-admin__link--danger"
                  type="button"
                  data-testid="device-platform-disable"
                  ?disabled=${state.busy || !draft.enabled}
                  @click=${() => void onDisable()}
                >
                  ${dp((c) => c.disable)}
                </button>
              `
            : nothing
        }
      </div>
    </form>
  `;
}

function renderStatusBanner(connection: DevicePlatformConnectionView | undefined) {
  const draft = state.draft;
  return html`
    <div class="device-platform-admin__status" data-testid="device-platform-status-bar">
      <div class="device-platform-admin__status-meta">
        <label class="device-platform-admin__toggle">
          <input
            type="checkbox"
            data-testid="device-platform-enabled"
            .checked=${draft.enabled}
            ?disabled=${state.busy}
            @change=${(event: Event) =>
              patchDraft({ enabled: (event.target as HTMLInputElement).checked })}
          />
          ${draft.enabled ? dp((c) => c.enabled) : dp((c) => c.disabled)}
        </label>
        <span class=${healthClass(connection?.health)}>
          health ${connection?.health ?? "unknown"}
        </span>
        <span>maturity ${maturityLabel(connection)}</span>
        <span>
          ${dp((c) => c.lastProbe)}
          ${probeLabel(connection?.healthCheckedAt)}
        </span>
        <span>
          error ${connection?.healthError?.trim() ? connection.healthError : "—"}
        </span>
      </div>
      ${
        state.mode === "edit"
          ? html`
              <button
                class="btn"
                type="button"
                data-testid="device-platform-test"
                ?disabled=${state.busy}
                @click=${() => void onTest()}
              >
                ${dp((c) => c.test)}
              </button>
            `
          : nothing
      }
    </div>
  `;
}

function renderStatus() {
  if (state.status === "loading") {
    return html`
      <p class="muted" data-testid="device-platform-status">${dp((c) => c.loading)}</p>
    `;
  }
  if (state.status === "unauthorized") {
    return html`
      <p class="callout danger" data-testid="device-platform-status">
        ${dp((c) => c.unauthorized)}
      </p>
    `;
  }
  if (state.status === "failure") {
    return html`
      <p class="callout danger" data-testid="device-platform-status">
        ${dp((c) => c.loadFailed)} ${state.message}
        <button class="btn btn--sm" type="button" @click=${() => void reload()}>
          ${dp((c) => c.retry)}
        </button>
      </p>
    `;
  }
  if (state.partial) {
    return html`<p class="callout" data-testid="device-platform-partial">${state.partial}</p>`;
  }
  if (state.notice) {
    return html`<p class="callout success" data-testid="device-platform-notice">${state.notice}</p>`;
  }
  return nothing;
}

function renderFilters() {
  const counts = filterCounts(state.connections);
  const filters: Array<{ id: FilterId; label: string; count: number }> = [
    { id: "all", label: dp((c) => c.filters.all), count: counts.all },
    { id: "enabled", label: dp((c) => c.filters.enabled), count: counts.enabled },
    { id: "abnormal", label: dp((c) => c.filters.abnormal), count: counts.abnormal },
  ];
  return html`
    <div class="device-platform-admin__filters" role="tablist" aria-label=${dp((c) => c.filtersLabel)}>
      ${filters.map(
        (filter) => html`
          <button
            class="device-platform-admin__filter ${state.filter === filter.id ? "is-active" : ""}"
            type="button"
            role="tab"
            aria-selected=${state.filter === filter.id ? "true" : "false"}
            data-testid=${`device-platform-filter-${filter.id}`}
            @click=${() => {
              state = { ...state, filter: filter.id };
              rerender();
            }}
          >
            ${filter.label} ${filter.count}
          </button>
        `,
      )}
    </div>
  `;
}

function renderTable() {
  const rows = filteredConnections();
  if (rows.length === 0) {
    return html`
      <p class="muted" data-testid="device-platform-status">
        ${state.connections.length === 0 ? dp((c) => c.empty) : dp((c) => c.emptyFilter)}
      </p>
    `;
  }
  return html`
    <div class="device-platform-admin__table-wrap" data-testid="device-platform-list">
      <table class="device-platform-admin__table">
        <thead>
          <tr>
            <th>${dp((c) => c.columns.name)}</th>
            <th>${dp((c) => c.columns.id)}</th>
            <th>${dp((c) => c.columns.environment)}</th>
            <th>${dp((c) => c.columns.enabled)}</th>
            <th>${dp((c) => c.columns.health)}</th>
            <th>${dp((c) => c.columns.maturity)}</th>
            <th>${dp((c) => c.columns.lastProbe)}</th>
            <th>${dp((c) => c.columns.actions)}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (connection) => html`
              <tr data-platform-id=${connection.platformId}>
                <td><div class="device-platform-admin__name">${connection.displayName}</div></td>
                <td><div class="device-platform-admin__id">${connection.platformId}</div></td>
                <td>${connection.environment}</td>
                <td>
                  <span class=${connection.enabled ? "device-platform-admin__chip-ok" : "device-platform-admin__chip-off"}>
                    ${connection.enabled ? dp((c) => c.enabled) : dp((c) => c.disabled)}
                  </span>
                </td>
                <td class=${healthClass(connection.health)}>${healthText(connection.health)}</td>
                <td>${maturityLabel(connection)}</td>
                <td>${probeLabel(connection.healthCheckedAt)}</td>
                <td>
                  <div class="device-platform-admin__actions">
                    <button
                      class="device-platform-admin__link"
                      type="button"
                      data-testid=${`device-platform-test-row-${connection.platformId}`}
                      ?disabled=${state.busy}
                      @click=${() => void onTestRow(connection.platformId)}
                    >
                      ${dp((c) => c.test)}
                    </button>
                    <span class="device-platform-admin__sep">|</span>
                    <button
                      class="device-platform-admin__link"
                      type="button"
                      data-testid=${`device-platform-edit-${connection.platformId}`}
                      @click=${() => selectConnection(connection)}
                    >
                      ${dp((c) => c.edit)}
                    </button>
                  </div>
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function textField(params: {
  label: string;
  key: keyof Draft;
  value: string;
  required?: boolean;
  placeholder: string;
  testId?: string;
  onInput?: (value: string) => void;
}) {
  return html`
    <label class="device-platform-admin__field">
      <span>
        ${params.label}
        ${
          params.required
            ? html`
                <span class="device-platform-admin__req" aria-hidden="true">*</span>
              `
            : nothing
        }
      </span>
      <input
        type="text"
        placeholder=${params.placeholder}
        data-testid=${params.testId ?? nothing}
        .value=${params.value}
        ?disabled=${state.busy}
        @input=${(event: Event) => {
          const value = (event.target as HTMLInputElement).value;
          if (params.onInput) {
            params.onInput(value);
            return;
          }
          patchDraft({ [params.key]: value });
        }}
      />
    </label>
  `;
}

function ensureLoaded(): void {
  if (state.status !== "loading" || state.busy) {
    return;
  }
  const token = loadToken;
  state.busy = true;
  void client()
    .list()
    .then((connections) => {
      if (token !== loadToken) {
        return;
      }
      state = {
        ...state,
        status: "ready",
        busy: false,
        connections,
        message: "",
        view: "list",
      };
      rerender();
    })
    .catch((error: unknown) => {
      if (token !== loadToken) {
        return;
      }
      const status = error instanceof DevicePlatformAdminRequestError ? error.status : 0;
      state = {
        ...state,
        busy: false,
        status: status === 401 || status === 403 ? "unauthorized" : "failure",
        message: error instanceof Error ? error.message : dp((c) => c.requestFailed),
      };
      rerender();
    });
}

async function reload(): Promise<void> {
  state = {
    ...state,
    status: "loading",
    busy: false,
    notice: "",
    partial: "",
    message: "",
    view: "list",
  };
  rerender();
}

async function onSubmit(event: Event): Promise<void> {
  event.preventDefault();
  const draft = state.draft;
  const platformId = draft.platformId.trim();
  const displayName = draft.displayName.trim();
  const serviceBaseUrl = draft.serviceBaseUrl.trim();
  if (!displayName) {
    state = { ...state, notice: "", partial: dp((c) => c.validation.displayName) };
    rerender();
    return;
  }
  if (!platformId) {
    state = { ...state, notice: "", partial: dp((c) => c.validation.platformId) };
    rerender();
    return;
  }
  if (!serviceBaseUrl) {
    state = { ...state, notice: "", partial: dp((c) => c.validation.serviceBaseUrl) };
    rerender();
    return;
  }
  const needsSecret =
    state.mode === "create" || !currentConnection()?.credentialPresent || draft.rotate;
  if (needsSecret && !draft.clientSecret.trim()) {
    state = { ...state, notice: "", partial: dp((c) => c.validation.secret) };
    rerender();
    return;
  }
  const credentialRef = draft.credentialRef.trim() || `cred://device-platform/${platformId}`;
  const identity = (draft.clientIdentity.trim() || DEFAULT_IDENTITY).trim();
  const serviceClientIds = draft.overrideClientId
    ? draft.serviceClientIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [identity];
  state = { ...state, busy: true, notice: "", partial: "" };
  rerender();
  try {
    const saved = await client().save(platformId, {
      displayName,
      environment: draft.environment,
      serviceBaseUrl,
      contractVersion: draft.contractVersion || "v1",
      credentialRef,
      clientIdentity: identity,
      registrationNotes: draft.registrationNotes,
      callbackAllowlist: draft.callbackAllowlist
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      serviceClientIds,
      enabled: draft.enabled,
    });
    let connection = saved;
    if (draft.clientSecret.trim()) {
      connection = await client().setCredential(
        platformId,
        draft.clientSecret.trim(),
        draft.rotate,
      );
    }
    replaceConnection(connection);
    state = {
      ...state,
      busy: false,
      status: "ready",
      mode: "edit",
      view: "form",
      notice: dp((c) => c.saved),
      partial: "",
      draft: { ...draftFrom(connection), clientSecret: "", rotate: false },
    };
  } catch (error) {
    state = {
      ...state,
      busy: false,
      partial: error instanceof Error ? error.message : dp((c) => c.saveFailed),
      notice: "",
    };
  }
  rerender();
}

async function onDisable(): Promise<void> {
  const draft = state.draft;
  const platformId = draft.platformId.trim();
  if (!platformId || !draft.enabled) {
    return;
  }
  state = { ...state, busy: true, notice: "", partial: "", draft: { ...draft, enabled: false } };
  rerender();
  try {
    const connection = await client().save(platformId, {
      displayName: draft.displayName,
      environment: draft.environment,
      serviceBaseUrl: draft.serviceBaseUrl,
      contractVersion: draft.contractVersion || "v1",
      credentialRef: draft.credentialRef || `cred://device-platform/${platformId}`,
      clientIdentity: draft.clientIdentity || DEFAULT_IDENTITY,
      registrationNotes: draft.registrationNotes,
      callbackAllowlist: draft.callbackAllowlist
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      serviceClientIds: draft.serviceClientIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      enabled: false,
    });
    replaceConnection(connection);
    state = {
      ...state,
      busy: false,
      notice: dp((c) => c.disabledNotice),
      draft: { ...draftFrom(connection), clientSecret: "", rotate: false },
    };
  } catch (error) {
    state = {
      ...state,
      busy: false,
      draft: { ...draft, enabled: true },
      partial: error instanceof Error ? error.message : dp((c) => c.saveFailed),
    };
  }
  rerender();
}

async function onTest(): Promise<void> {
  const platformId = state.draft.platformId.trim();
  if (!platformId) {
    return;
  }
  await runProbe(platformId, true);
}

async function onTestRow(platformId: string): Promise<void> {
  await runProbe(platformId, false);
}

async function runProbe(platformId: string, syncDraft: boolean): Promise<void> {
  state = { ...state, busy: true, notice: "", partial: "" };
  rerender();
  try {
    const result = await client().test(platformId);
    replaceConnection(result.connection);
    const partial = result.partial
      ? dp((c) => c.probePartial)
      : result.connection.health === "ok"
        ? ""
        : result.connection.healthError || dp((c) => c.probeFailed);
    state = {
      ...state,
      busy: false,
      notice: result.connection.health === "ok" ? dp((c) => c.probeOk) : "",
      partial,
      ...(syncDraft
        ? { draft: { ...draftFrom(result.connection), clientSecret: "", rotate: false } }
        : {}),
    };
  } catch (error) {
    state = {
      ...state,
      busy: false,
      partial: error instanceof Error ? error.message : dp((c) => c.probeError),
    };
  }
  rerender();
}

function selectConnection(connection: DevicePlatformConnectionView): void {
  state = {
    ...state,
    mode: "edit",
    view: "form",
    draft: { ...draftFrom(connection), clientSecret: "", rotate: false },
    notice: "",
    partial: "",
  };
  rerender();
}

function startCreate(): void {
  state = {
    ...state,
    mode: "create",
    view: "form",
    draft: emptyDraft(),
    notice: "",
    partial: "",
  };
  rerender();
}

function backToList(): void {
  state = {
    ...state,
    view: "list",
    mode: "create",
    draft: emptyDraft(),
    notice: "",
    partial: "",
  };
  rerender();
}

function patchDraft(patch: Partial<Draft>): void {
  state = { ...state, draft: { ...state.draft, ...patch } };
  rerender();
}

function replaceConnection(connection: DevicePlatformConnectionView): void {
  const others = state.connections.filter((item) => item.platformId !== connection.platformId);
  state = { ...state, connections: [...others, connection] };
}

function currentConnection(): DevicePlatformConnectionView | undefined {
  return state.connections.find((item) => item.platformId === state.draft.platformId);
}

function draftFrom(connection: DevicePlatformConnectionView): Draft {
  const identity = connection.clientIdentity || connection.serviceClientIds[0] || DEFAULT_IDENTITY;
  const joinedIds = connection.serviceClientIds.join(", ");
  const overrideClientId =
    connection.serviceClientIds.length !== 1 || connection.serviceClientIds[0] !== identity;
  return {
    platformId: connection.platformId,
    displayName: connection.displayName,
    environment: connection.environment,
    serviceBaseUrl: connection.serviceBaseUrl,
    contractVersion: connection.contractVersion || "v1",
    credentialRef: connection.credentialRef || `cred://device-platform/${connection.platformId}`,
    clientIdentity: identity,
    serviceClientIds: joinedIds || identity,
    registrationNotes: connection.registrationNotes,
    callbackAllowlist: connection.callbackAllowlist.join("\n"),
    enabled: connection.enabled,
    clientSecret: "",
    rotate: false,
    overrideClientId,
  };
}

function filteredConnections(): DevicePlatformConnectionView[] {
  return state.connections.filter((connection) => {
    if (state.filter === "enabled") {
      return connection.enabled;
    }
    if (state.filter === "abnormal") {
      return isAbnormal(connection);
    }
    return true;
  });
}

function filterCounts(connections: DevicePlatformConnectionView[]) {
  return {
    all: connections.length,
    enabled: connections.filter((item) => item.enabled).length,
    abnormal: connections.filter((item) => isAbnormal(item)).length,
  };
}

function isAbnormal(connection: DevicePlatformConnectionView): boolean {
  return connection.health === "down" || Boolean(connection.healthError?.trim());
}

function maturityLabel(connection: DevicePlatformConnectionView | undefined): string {
  if (!connection) {
    return "—";
  }
  if (connection.health === "ok") {
    return "v1-frozen";
  }
  if (connection.contractVersion === "v1-draft") {
    return "v1-draft";
  }
  return "—";
}

function healthText(health: DevicePlatformConnectionView["health"]): string {
  if (health === "ok") {
    return "ok";
  }
  if (health === "down") {
    return "down";
  }
  return "unknown";
}

function healthClass(health: DevicePlatformConnectionView["health"] | undefined): string {
  if (health === "ok") {
    return "device-platform-admin__health-ok";
  }
  if (health === "down") {
    return "device-platform-admin__health-down";
  }
  return "muted";
}

function probeLabel(iso: string | undefined): string {
  if (!iso) {
    return dp((c) => c.probeNever);
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "—";
  }
  const relative = formatRelativeTimestamp(ms, { fallback: "—" });
  if (relative === "just now") {
    return dp((c) => c.justNow);
  }
  if (i18n.getLocale() === "zh-CN") {
    const ago = /^(\d+)([mhd]) ago$/.exec(relative);
    if (ago) {
      const amount = ago[1];
      if (ago[2] === "m") {
        return dp((c) => c.minutesAgo, { count: amount });
      }
      if (ago[2] === "h") {
        return dp((c) => c.hoursAgo, { count: amount });
      }
      return dp((c) => c.daysAgo, { count: amount });
    }
  }
  return relative;
}

function identityOptions(current: string): string[] {
  const values = new Set<string>([DEFAULT_IDENTITY]);
  if (current.trim()) {
    values.add(current.trim());
  }
  return [...values];
}

function identitySelectValue(current: string): string {
  return current.trim() || DEFAULT_IDENTITY;
}

function client(): DevicePlatformAdminClient {
  return clientOverride ?? createDevicePlatformFetchClient();
}

function rerender(): void {
  requestOpenBotAppRerender();
}

async function request(
  fetchImpl: typeof fetch,
  path: string,
  init: { method: string; body?: string },
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(path, {
    method: init.method,
    credentials: "include",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    const message =
      isRecord(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message
        : dp((c) => c.requestFailed);
    throw new DevicePlatformAdminRequestError(response.status, message);
  }
  return payload;
}

function asConnections(value: unknown): DevicePlatformConnectionView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asConnection(item));
}

function asConnection(value: unknown): DevicePlatformConnectionView {
  const record = isRecord(value) ? value : {};
  return {
    platformId: stringField(record, "platformId"),
    displayName: stringField(record, "displayName"),
    environment: environmentField(record.environment),
    serviceBaseUrl: stringField(record, "serviceBaseUrl"),
    contractVersion: stringField(record, "contractVersion"),
    credentialRef: stringField(record, "credentialRef"),
    clientIdentity: stringField(record, "clientIdentity"),
    registrationNotes: stringField(record, "registrationNotes"),
    callbackAllowlist: stringArray(record.callbackAllowlist),
    serviceClientIds: stringArray(record.serviceClientIds),
    enabled: record.enabled !== false,
    disabledDisposition: "block_new_keep_existing",
    credentialPresent: record.credentialPresent === true,
    ...(typeof record.credentialRotatedAt === "string"
      ? { credentialRotatedAt: record.credentialRotatedAt }
      : {}),
    health: record.health === "ok" || record.health === "down" ? record.health : "unknown",
    ...(typeof record.healthCheckedAt === "string"
      ? { healthCheckedAt: record.healthCheckedAt }
      : {}),
    ...(typeof record.healthCode === "string" ? { healthCode: record.healthCode } : {}),
    ...(typeof record.healthError === "string" ? { healthError: record.healthError } : {}),
  };
}

function environmentField(value: unknown): DevicePlatformEnvironment {
  if (value === "staging" || value === "development" || value === "production") {
    return value;
  }
  return "production";
}

function stringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? record[key] : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
