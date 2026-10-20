import { html, nothing } from "lit";
import { requestOpenBotAppRerender } from "../../../request-app-rerender.ts";

/**
 * Platform-admin「设备平台连接」.
 * Configures the device-platform connector. It does not bind a user's device.
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
};

const DISPOSITION =
  "停用后立即拒绝新的授权和执行。已经建立的设备关系会保留，直到用户自己解除。本阶段只在这里手工配置和验证，不会把密钥推送到其他地址。";

const HOST_BOUNDARY =
  "控制地址是设备平台自己的源（协议、主机、端口）。测试连接会在该主机上请求 /api/device-platform/v1/health 和 /capabilities。OpenBot 上的同名路径只给平台管理员配置连接，不是设备平台。";

function emptyDraft(): Draft {
  return {
    platformId: "",
    displayName: "",
    environment: "production",
    serviceBaseUrl: "",
    contractVersion: "v1-draft",
    credentialRef: "",
    clientIdentity: "",
    serviceClientIds: "",
    registrationNotes: "",
    callbackAllowlist: "",
    enabled: true,
    clientSecret: "",
    rotate: false,
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
    <section class="device-platform-admin" data-testid="device-platform-connection" aria-label="设备平台连接">
      <p class="muted">${HOST_BOUNDARY}</p>
      <p class="callout info">${DISPOSITION}</p>
      ${renderStatus()}
      ${state.status === "ready" ? renderList() : nothing}
      ${state.status === "ready" ? renderForm() : nothing}
    </section>
  `;
}

function renderStatus() {
  if (state.status === "loading") {
    return html`
      <p class="muted" data-testid="device-platform-status">正在读取设备平台连接</p>
    `;
  }
  if (state.status === "unauthorized") {
    return html`
      <p class="callout danger" data-testid="device-platform-status">
        仅平台管理员可以配置设备平台连接。企业管理员和普通用户没有这个入口。
      </p>
    `;
  }
  if (state.status === "failure") {
    return html`
      <p class="callout danger" data-testid="device-platform-status">
        读取设备平台连接失败。${state.message}
        <button class="btn btn--sm" type="button" @click=${() => void reload()}>重试</button>
      </p>
    `;
  }
  if (state.partial) {
    return html`<p class="callout" data-testid="device-platform-partial">${state.partial}</p>`;
  }
  if (state.notice) {
    return html`<p class="callout success" data-testid="device-platform-notice">${state.notice}</p>`;
  }
  if (state.connections.length === 0) {
    return html`
      <p class="muted" data-testid="device-platform-status">还没有设备平台连接。填写下面的表单后保存。</p>
    `;
  }
  return nothing;
}

function renderList() {
  if (state.connections.length === 0) {
    return nothing;
  }
  return html`
    <div class="list" data-testid="device-platform-list">
      ${state.connections.map(
        (connection) => html`
          <button
            class="list-item"
            type="button"
            data-platform-id=${connection.platformId}
            @click=${() => selectConnection(connection)}
          >
            <div class="list-main">
              <div class="list-title">${connection.displayName}</div>
              <div class="list-sub">${connection.platformId} · ${connection.environment}</div>
            </div>
            <div class="list-meta">
              <span class="chip">${healthLabel(connection)}</span>
              <span class="chip">${connection.enabled ? "已启用" : "已停用"}</span>
            </div>
          </button>
        `,
      )}
    </div>
  `;
}

function renderForm() {
  const draft = state.draft;
  const editing = state.mode === "edit";
  return html`
    <form class="card" data-testid="device-platform-form" @submit=${(event: Event) => void onSubmit(event)}>
      <div class="card-title">${editing ? "编辑设备平台连接" : "新建设备平台连接"}</div>
      <div class="form-grid card-follow--sm">
        ${field("平台名称", "displayName", draft.displayName, "例如 生产设备平台")}
        ${field("稳定 ID", "platformId", draft.platformId, "创建后不可修改", editing)}
        <label class="field">
          <span>环境</span>
          <select
            .value=${draft.environment}
            @change=${(event: Event) =>
              patchDraft({
                environment: (event.target as HTMLSelectElement).value as DevicePlatformEnvironment,
              })}
          >
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="development">development</option>
          </select>
        </label>
        ${field("契约版本", "contractVersion", draft.contractVersion, "v1-draft")}
        ${field("控制 API 源地址", "serviceBaseUrl", draft.serviceBaseUrl, "https://device.example")}
        ${field("客户端身份", "clientIdentity", draft.clientIdentity, "service Basic 用户名")}
        ${field("服务客户端 ID", "serviceClientIds", draft.serviceClientIds, "逗号分隔")}
        ${field("凭证引用", "credentialRef", draft.credentialRef, "cred://device-platform/...")}
      </div>
      <label class="field card-follow--sm">
        <span>能力 API 登记说明</span>
        <textarea
          rows="3"
          placeholder="OpenBot 能力 API 的客户端登记说明。不要填写密钥。"
          .value=${draft.registrationNotes}
          @input=${(event: Event) =>
            patchDraft({ registrationNotes: (event.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>
      <label class="field">
        <span>回调允许列表</span>
        <textarea
          rows="3"
          placeholder="每行一个 https 回调地址"
          .value=${draft.callbackAllowlist}
          @input=${(event: Event) =>
            patchDraft({ callbackAllowlist: (event.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>
      <label class="field">
        <span>服务密钥</span>
        <input
          type="password"
          autocomplete="new-password"
          data-testid="device-platform-secret"
          placeholder=${
            editing && currentConnection()?.credentialPresent
              ? "已保存。留空不会改动。轮换时填写新密钥。"
              : "只写入一次，保存后不再显示"
          }
          .value=${draft.clientSecret}
          @input=${(event: Event) =>
            patchDraft({ clientSecret: (event.target as HTMLInputElement).value })}
        />
      </label>
      ${
        editing && currentConnection()?.credentialPresent
          ? html`
              <label class="field">
                <span>轮换密钥</span>
                <input
                  type="checkbox"
                  .checked=${draft.rotate}
                  @change=${(event: Event) =>
                    patchDraft({ rotate: (event.target as HTMLInputElement).checked })}
                />
              </label>
            `
          : nothing
      }
      <label class="field">
        <span>启用</span>
        <input
          type="checkbox"
          data-testid="device-platform-enabled"
          .checked=${draft.enabled}
          @change=${(event: Event) =>
            patchDraft({ enabled: (event.target as HTMLInputElement).checked })}
        />
      </label>
      ${
        currentConnection()?.healthError
          ? html`<p class="callout danger" data-testid="device-platform-health-error">
              最近一次检查未通过：${currentConnection()?.healthError}
              ${
                currentConnection()?.healthCheckedAt
                  ? html`<span class="muted"> ${currentConnection()?.healthCheckedAt}</span>`
                  : nothing
              }
            </p>`
          : nothing
      }
      <div class="row card-follow--sm">
        <button class="btn primary" type="submit" ?disabled=${state.busy}>保存</button>
        ${
          editing
            ? html`
                <button
                  class="btn"
                  type="button"
                  data-testid="device-platform-test"
                  ?disabled=${state.busy}
                  @click=${() => void onTest()}
                >
                  测试连接
                </button>
                <button class="btn" type="button" @click=${() => startCreate()}>新建</button>
              `
            : nothing
        }
      </div>
    </form>
  `;
}

function field(
  label: string,
  key: keyof Draft,
  value: string,
  placeholder: string,
  disabled = false,
) {
  return html`
    <label class="field">
      <span>${label}</span>
      <input
        type="text"
        placeholder=${placeholder}
        .value=${value}
        ?disabled=${disabled || state.busy}
        @input=${(event: Event) => patchDraft({ [key]: (event.target as HTMLInputElement).value })}
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
      };
      if (connections[0] && state.mode === "create" && !state.draft.platformId) {
        selectConnection(connections[0]);
        return;
      }
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
        message: error instanceof Error ? error.message : "请求失败",
      };
      rerender();
    });
}

async function reload(): Promise<void> {
  state = { ...state, status: "loading", busy: false, notice: "", partial: "", message: "" };
  rerender();
}

async function onSubmit(event: Event): Promise<void> {
  event.preventDefault();
  const draft = state.draft;
  const platformId = draft.platformId.trim();
  if (!platformId) {
    state = { ...state, notice: "", partial: "请填写稳定 ID。" };
    rerender();
    return;
  }
  state = { ...state, busy: true, notice: "", partial: "" };
  rerender();
  try {
    const saved = await client().save(platformId, {
      displayName: draft.displayName,
      environment: draft.environment,
      serviceBaseUrl: draft.serviceBaseUrl,
      contractVersion: draft.contractVersion,
      credentialRef: draft.credentialRef,
      clientIdentity: draft.clientIdentity,
      registrationNotes: draft.registrationNotes,
      callbackAllowlist: draft.callbackAllowlist
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      serviceClientIds: draft.serviceClientIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
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
      notice: "已保存。密钥不会回显。",
      partial: "",
      draft: { ...draftFrom(connection), clientSecret: "", rotate: false },
    };
  } catch (error) {
    state = {
      ...state,
      busy: false,
      partial: error instanceof Error ? error.message : "保存失败",
      notice: "",
    };
  }
  rerender();
}

async function onTest(): Promise<void> {
  const platformId = state.draft.platformId.trim();
  if (!platformId) {
    return;
  }
  state = { ...state, busy: true, notice: "", partial: "" };
  rerender();
  try {
    const result = await client().test(platformId);
    replaceConnection(result.connection);
    const partial = result.partial
      ? "健康检查已通过，但能力或契约不兼容。连接没有标记为健康。"
      : result.connection.health === "ok"
        ? ""
        : result.connection.healthError || "测试未通过。连接没有标记为健康。";
    state = {
      ...state,
      busy: false,
      notice: result.connection.health === "ok" ? "连接可用。" : "",
      partial,
      draft: { ...draftFrom(result.connection), clientSecret: "", rotate: false },
    };
  } catch (error) {
    state = {
      ...state,
      busy: false,
      partial: error instanceof Error ? error.message : "测试失败",
    };
  }
  rerender();
}

function selectConnection(connection: DevicePlatformConnectionView): void {
  state = {
    ...state,
    mode: "edit",
    draft: { ...draftFrom(connection), clientSecret: "", rotate: false },
    notice: "",
    partial: "",
  };
  rerender();
}

function startCreate(): void {
  state = { ...state, mode: "create", draft: emptyDraft(), notice: "", partial: "" };
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
  return {
    platformId: connection.platformId,
    displayName: connection.displayName,
    environment: connection.environment,
    serviceBaseUrl: connection.serviceBaseUrl,
    contractVersion: connection.contractVersion,
    credentialRef: connection.credentialRef,
    clientIdentity: connection.clientIdentity,
    serviceClientIds: connection.serviceClientIds.join(", "),
    registrationNotes: connection.registrationNotes,
    callbackAllowlist: connection.callbackAllowlist.join("\n"),
    enabled: connection.enabled,
    clientSecret: "",
    rotate: false,
  };
}

function healthLabel(connection: DevicePlatformConnectionView): string {
  if (connection.health === "ok") {
    return "健康";
  }
  if (connection.health === "down") {
    return "未通过";
  }
  return "未检查";
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
        : "设备平台请求失败";
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
  if (value === "staging" || value === "development") {
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
