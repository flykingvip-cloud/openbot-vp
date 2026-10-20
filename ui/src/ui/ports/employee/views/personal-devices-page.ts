import { html, nothing } from "lit";
import { requestOpenBotAppRerender } from "../../../request-app-rerender.ts";
import {
  renderPersonalMetaList,
  renderPersonalSettingsPanel,
  renderPersonalSettingsRow,
  renderPersonalSettingsSection,
  renderPersonalSettingsTabIntro,
} from "./workbench-personal-settings-layout.ts";

/**
 * Personal settings「设备与硬件」.
 * Reads the same device bindings the digital-human page will use.
 * The connector URL and service secrets are not part of this view.
 */

const SCOPES = [
  { id: "chat", label: "对话" },
  { id: "camera.capture", label: "拍照" },
  { id: "media.read", label: "读取媒体" },
] as const;

const BINDING_LABEL: Record<string, string> = {
  pending_pair: "等待配对",
  pending_auth: "等待授权",
  applying: "正在应用",
  active: "已连接",
  error: "应用失败",
  revoking: "正在解除",
};

export type PersonalDeviceBindingView = {
  bindingId: string;
  digitalHumanId: string;
  scopes: string[];
  status: string;
  expectedBindingVersion: number;
  appliedBindingVersion: number;
  authorizationEstablished: boolean;
  platformApplied: boolean;
  failureCode?: string;
};

export type PersonalDeviceView = {
  deviceId: string;
  displayName: string;
  platformId: string;
  externalDeviceId: string;
  model?: string;
  binding: PersonalDeviceBindingView | null;
  status: {
    online: boolean;
    presence: "online" | "offline" | "unknown";
    lastSeen?: string;
    capabilities: string[];
  };
};

export type PersonalPlatformChoice = { platformId: string; displayName: string };
export type PersonalHumanChoice = { digitalHumanId: string; displayName: string };

export class PersonalDevicesRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PersonalDevicesRequestError";
    this.status = status;
    this.code = code;
  }
}

export type PersonalDevicesClient = {
  listDevices(): Promise<PersonalDeviceView[]>;
  listPlatforms(): Promise<PersonalPlatformChoice[]>;
  listHumans(): Promise<PersonalHumanChoice[]>;
  submit(body: Record<string, unknown>): Promise<PersonalDeviceView | null>;
};

type AddDraft = {
  platformId: string;
  displayName: string;
  deviceId: string;
  challenge: string;
  code: string;
  digitalHumanId: string;
  scopes: string[];
};

type PanelState = {
  status: "loading" | "unauthorized" | "failure" | "ready";
  message: string;
  notice: string;
  busy: boolean;
  devices: PersonalDeviceView[];
  platforms: PersonalPlatformChoice[];
  humans: PersonalHumanChoice[];
  selectedId: string;
  draft: AddDraft;
  rebindHumanId: string;
  rebindScopes: string[];
  confirmRevoke: boolean;
  showTransfer: boolean;
};

const EMPTY_DRAFT: AddDraft = {
  platformId: "",
  displayName: "",
  deviceId: "",
  challenge: "",
  code: "",
  digitalHumanId: "",
  scopes: ["chat"],
};

let loadToken = 0;
let loadStarted = false;
let clientOverride: PersonalDevicesClient | null = null;
let state: PanelState = freshState();

function freshState(): PanelState {
  return {
    status: "loading",
    message: "",
    notice: "",
    busy: false,
    devices: [],
    platforms: [],
    humans: [],
    selectedId: "",
    draft: { ...EMPTY_DRAFT, scopes: ["chat"] },
    rebindHumanId: "",
    rebindScopes: ["chat"],
    confirmRevoke: false,
    showTransfer: false,
  };
}

export function setPersonalDevicesClientForTests(client: PersonalDevicesClient | null): void {
  clientOverride = client;
}

export function resetPersonalDevicesPanelForTests(): void {
  loadToken += 1;
  loadStarted = false;
  state = freshState();
}

export function parsePairingScan(
  raw: string,
): Partial<Pick<AddDraft, "deviceId" | "challenge" | "code">> | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return {
        ...(typeof parsed.deviceId === "string" ? { deviceId: parsed.deviceId.trim() } : {}),
        ...(typeof parsed.challenge === "string"
          ? { challenge: parsed.challenge.trim() }
          : typeof parsed.pairChallenge === "string"
            ? { challenge: parsed.pairChallenge.trim() }
            : {}),
        ...(typeof parsed.code === "string"
          ? { code: parsed.code.trim() }
          : typeof parsed.proof === "string"
            ? { code: parsed.proof.trim() }
            : typeof parsed.pairingCode === "string"
              ? { code: parsed.pairingCode.trim() }
              : {}),
      };
    } catch {
      return null;
    }
  }
  if (/^[0-9]{6}$/.test(text)) {
    return { code: text };
  }
  const found: Partial<Pick<AddDraft, "deviceId" | "challenge" | "code">> = {};
  for (const line of text.split(/\r?\n/)) {
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const name = key?.trim().toLowerCase();
    if (!value) {
      continue;
    }
    if (name === "deviceid" || name === "device") {
      found.deviceId = value;
    }
    if (name === "challenge" || name === "pairchallenge") {
      found.challenge = value;
    }
    if (name === "code" || name === "pairingcode" || name === "proof") {
      found.code = value;
    }
  }
  return found.deviceId || found.challenge || found.code ? found : null;
}

export function renderPersonalDevicesPanel() {
  ensureLoaded();
  const selected = state.devices.find((device) => device.deviceId === state.selectedId) ?? null;
  return html`
    ${renderPersonalSettingsSection(html`
      ${renderPersonalSettingsTabIntro("设备与硬件")}
      <div class="personal-devices__stack" data-testid="personal-devices">
        ${renderBanner()}
        ${renderPersonalSettingsPanel({
          title: "我的设备",
          content: renderDeviceList(selected),
        })}
        ${
          selected
            ? renderPersonalSettingsPanel({
                title: selected.displayName,
                content: renderDetail(selected),
              })
            : nothing
        }
        ${renderPersonalSettingsPanel({
          title: "添加设备",
          content: renderAddForm(),
        })}
      </div>
    `)}
  `;
}

function renderBanner() {
  if (state.status === "loading") {
    return html`
      <p class="personal-devices__note" data-testid="personal-devices-status">正在读取设备</p>
    `;
  }
  if (state.status === "unauthorized") {
    return html`
      <p class="personal-devices__note" data-testid="personal-devices-status">请先登录后再管理设备。</p>
    `;
  }
  if (state.status === "failure") {
    return html`<p class="personal-devices__note" data-testid="personal-devices-status">${state.message}</p>`;
  }
  if (state.notice) {
    return html`<p class="personal-devices__note" data-testid="personal-devices-notice">${state.notice}</p>`;
  }
  return nothing;
}

function renderDeviceList(selected: PersonalDeviceView | null) {
  if (state.status === "ready" && state.devices.length === 0) {
    return html`
      <p class="personal-devices__note" data-testid="personal-devices-empty">
        还没有设备。填写下面的配对信息后添加。
      </p>
    `;
  }
  return html`
    <div class="personal-devices__list" data-testid="personal-devices-list">
      ${state.devices.map((device) => {
        const human = humanName(device.binding?.digitalHumanId);
        return html`
          <button
            type="button"
            class="personal-devices__item ${selected?.deviceId === device.deviceId ? "is-active" : ""}"
            data-testid="personal-device-row"
            @click=${() => selectDevice(device)}
          >
            <span class="personal-devices__item-title">${device.displayName}</span>
            <span class="personal-devices__item-meta">
              ${device.model?.trim() || "型号未知"} · ${human} · ${scopeText(device.binding?.scopes ?? [])} ·
              ${connectionText(device)}
            </span>
          </button>
        `;
      })}
    </div>
  `;
}

function renderDetail(device: PersonalDeviceView) {
  const binding = device.binding;
  return html`
    <div data-testid="personal-device-detail">
      ${renderPersonalMetaList([
        renderPersonalSettingsRow("名称", device.displayName),
        renderPersonalSettingsRow("型号", device.model?.trim() || "未知"),
        renderPersonalSettingsRow("绑定的数字人", humanName(binding?.digitalHumanId)),
        renderPersonalSettingsRow("权限", scopeText(binding?.scopes ?? [])),
        renderPersonalSettingsRow("连接状态", connectionText(device)),
        renderPersonalSettingsRow("在线", presenceText(device.status.presence)),
        renderPersonalSettingsRow("最近出现", device.status.lastSeen || "未知"),
        renderPersonalSettingsRow(
          "绑定进度",
          binding ? `${binding.appliedBindingVersion}/${binding.expectedBindingVersion}` : "未绑定",
        ),
      ])}
      ${
        binding?.failureCode
          ? html`<p class="personal-devices__note">${failureText(binding.failureCode)}</p>`
          : nothing
      }
      <div class="personal-devices__fields">
        <label>
          更换数字人
          <select
            class="employee-workbench__settings-input"
            data-testid="personal-device-rebind-human"
            .value=${state.rebindHumanId}
            @change=${(event: Event) => {
              state.rebindHumanId = (event.target as HTMLSelectElement).value;
            }}
          >
            ${state.humans.map(
              (human) => html`<option value=${human.digitalHumanId}>${human.displayName}</option>`,
            )}
          </select>
        </label>
        ${renderScopeChecks(state.rebindScopes, (scopes) => {
          state.rebindScopes = scopes;
        })}
      </div>
      <div class="personal-devices__actions">
        <button type="button" class="btn btn--primary" ?disabled=${state.busy} @click=${() => void rebind(device)}>
          保存绑定
        </button>
        <button
          type="button"
          class="btn btn--danger"
          data-testid="personal-device-revoke"
          ?disabled=${state.busy || !binding}
          @click=${() => {
            state.confirmRevoke = true;
            rerender();
          }}
        >
          解除绑定
        </button>
        <button
          type="button"
          class="btn"
          data-testid="personal-device-transfer"
          @click=${() => {
            state.showTransfer = true;
            rerender();
          }}
        >
          转移
        </button>
      </div>
      ${
        state.confirmRevoke
          ? html`<div class="personal-devices__actions">
              <p class="personal-devices__note">解除后这台设备不再使用当前授权。只有认领人可以做这一步。</p>
              <button type="button" class="btn btn--danger" ?disabled=${state.busy} @click=${() => void revoke(device)}>
                确认解除
              </button>
            </div>`
          : nothing
      }
      ${
        state.showTransfer
          ? html`
              <p class="personal-devices__note" data-testid="personal-device-transfer-note">
                只有当前认领人可以解除绑定。对方需要用新的配对码重新添加。不会把设备直接改到别人名下。
              </p>
            `
          : nothing
      }
    </div>
  `;
}

function renderAddForm() {
  const draft = state.draft;
  return html`
    <form class="personal-devices__fields" data-testid="personal-device-add" @submit=${(event: Event) => void onAdd(event)}>
      <label>
        设备平台
        <select
          class="employee-workbench__settings-input"
          data-testid="personal-device-platform"
          .value=${draft.platformId}
          @change=${(event: Event) => {
            draft.platformId = (event.target as HTMLSelectElement).value;
          }}
        >
          <option value="">选择平台</option>
          ${state.platforms.map(
            (platform) =>
              html`<option value=${platform.platformId}>${platform.displayName}</option>`,
          )}
        </select>
      </label>
      <label>
        名称
        <input
          class="employee-workbench__settings-input"
          data-testid="personal-device-name"
          .value=${draft.displayName}
          @input=${(event: Event) => {
            draft.displayName = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      <label>
        扫描结果
        <textarea
          class="employee-workbench__settings-input"
          data-testid="personal-device-scan"
          placeholder="粘贴扫描内容，或只粘贴 6 位配对码"
          @change=${(event: Event) => applyScan((event.target as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
      <label>
        设备编号
        <input
          class="employee-workbench__settings-input"
          data-testid="personal-device-id"
          .value=${draft.deviceId}
          @input=${(event: Event) => {
            draft.deviceId = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      <label>
        挑战号
        <input
          class="employee-workbench__settings-input"
          data-testid="personal-device-challenge"
          .value=${draft.challenge}
          @input=${(event: Event) => {
            draft.challenge = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      <label>
        配对码
        <input
          class="employee-workbench__settings-input"
          data-testid="personal-device-code"
          inputmode="numeric"
          maxlength="6"
          .value=${draft.code}
          @input=${(event: Event) => {
            draft.code = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      <label>
        数字人
        <select
          class="employee-workbench__settings-input"
          data-testid="personal-device-human"
          .value=${draft.digitalHumanId}
          @change=${(event: Event) => {
            draft.digitalHumanId = (event.target as HTMLSelectElement).value;
          }}
        >
          <option value="">选择数字人</option>
          ${state.humans.map(
            (human) => html`<option value=${human.digitalHumanId}>${human.displayName}</option>`,
          )}
        </select>
      </label>
      ${renderScopeChecks(draft.scopes, (scopes) => {
        draft.scopes = scopes;
      })}
      <button type="submit" class="btn btn--primary" data-testid="personal-device-submit" ?disabled=${state.busy}>
        添加并授权
      </button>
    </form>
  `;
}

function renderScopeChecks(selected: string[], onChange: (scopes: string[]) => void) {
  return html`
    <div>
      ${SCOPES.map(
        (scope) => html`
          <label class="personal-devices__check">
            <input
              type="checkbox"
              .checked=${selected.includes(scope.id)}
              @change=${(event: Event) => {
                const checked = (event.target as HTMLInputElement).checked;
                const next = checked
                  ? [...selected, scope.id]
                  : selected.filter((item) => item !== scope.id);
                onChange(next);
                rerender();
              }}
            />
            <span>${scope.label}</span>
          </label>
        `,
      )}
    </div>
  `;
}

function selectDevice(device: PersonalDeviceView): void {
  state.selectedId = device.deviceId;
  state.confirmRevoke = false;
  state.showTransfer = false;
  state.rebindHumanId = device.binding?.digitalHumanId || state.humans[0]?.digitalHumanId || "";
  state.rebindScopes = device.binding?.scopes.length ? [...device.binding.scopes] : ["chat"];
  rerender();
}

function applyScan(raw: string): void {
  const parsed = parsePairingScan(raw);
  if (!parsed) {
    state.notice = "没有从扫描内容里读到设备编号或配对码。";
    rerender();
    return;
  }
  state.draft = {
    ...state.draft,
    ...(parsed.deviceId ? { deviceId: parsed.deviceId } : {}),
    ...(parsed.challenge ? { challenge: parsed.challenge } : {}),
    ...(parsed.code ? { code: parsed.code } : {}),
  };
  state.notice = "已填入配对信息。确认数字人和权限后添加。";
  rerender();
}

async function onAdd(event: Event): Promise<void> {
  event.preventDefault();
  const draft = state.draft;
  if (
    !draft.platformId ||
    !draft.deviceId ||
    !draft.challenge ||
    !draft.code ||
    !draft.digitalHumanId
  ) {
    state.notice = "请补全平台、设备编号、挑战号、配对码和数字人。";
    rerender();
    return;
  }
  if (draft.scopes.length === 0) {
    state.notice = "至少选择一项权限。";
    rerender();
    return;
  }
  await run(async (api) => {
    const device = await api.submit({
      operationId: operationId(),
      kind: "add",
      platformId: draft.platformId,
      externalDeviceId: draft.deviceId.trim(),
      digitalHumanId: draft.digitalHumanId,
      displayName: draft.displayName.trim() || undefined,
      scopes: draft.scopes,
      pairing: { challenge: draft.challenge.trim(), proof: draft.code.trim() },
    });
    state.notice =
      device?.binding?.status === "active" ? "设备已连接。" : "授权已提交，正在等待设备平台应用。";
    state.draft = { ...EMPTY_DRAFT, platformId: draft.platformId, scopes: ["chat"] };
    if (device) {
      state.selectedId = device.deviceId;
    }
  });
}

async function rebind(device: PersonalDeviceView): Promise<void> {
  if (!state.rebindHumanId || state.rebindScopes.length === 0) {
    state.notice = "选择要绑定的数字人和权限。";
    rerender();
    return;
  }
  await run(async (api) => {
    await api.submit({
      operationId: operationId(),
      kind: "rebind",
      deviceId: device.deviceId,
      digitalHumanId: state.rebindHumanId,
      scopes: state.rebindScopes,
    });
    state.notice = "已更换数字人。";
  });
}

async function revoke(device: PersonalDeviceView): Promise<void> {
  await run(async (api) => {
    await api.submit({
      operationId: operationId(),
      kind: "revoke",
      deviceId: device.deviceId,
    });
    state.confirmRevoke = false;
    state.notice = "已解除绑定。";
  });
}

async function run(work: (api: PersonalDevicesClient) => Promise<void>): Promise<void> {
  state.busy = true;
  state.notice = "";
  rerender();
  try {
    await work(client());
    await reload();
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "设备请求失败";
    state.busy = false;
    rerender();
  }
}

function ensureLoaded(): void {
  if (state.status !== "loading" || loadStarted) {
    return;
  }
  loadStarted = true;
  const token = loadToken;
  void reload(token);
}

async function reload(token = loadToken): Promise<void> {
  try {
    const api = client();
    const [devices, platforms, humans] = await Promise.all([
      api.listDevices(),
      api.listPlatforms(),
      api.listHumans(),
    ]);
    if (token !== loadToken) {
      return;
    }
    state = {
      ...state,
      status: "ready",
      message: "",
      busy: false,
      devices,
      platforms,
      humans,
      draft: {
        ...state.draft,
        platformId: state.draft.platformId || platforms[0]?.platformId || "",
        digitalHumanId: state.draft.digitalHumanId || humans[0]?.digitalHumanId || "",
      },
    };
    if (!state.selectedId && devices[0]) {
      state.selectedId = devices[0].deviceId;
      state.rebindHumanId = devices[0].binding?.digitalHumanId || humans[0]?.digitalHumanId || "";
      state.rebindScopes = devices[0].binding?.scopes.length
        ? [...devices[0].binding.scopes]
        : ["chat"];
    }
  } catch (error) {
    if (token !== loadToken) {
      return;
    }
    const status = error instanceof PersonalDevicesRequestError ? error.status : 0;
    state = {
      ...state,
      status: status === 401 || status === 403 ? "unauthorized" : "failure",
      message: error instanceof Error ? error.message : "读取设备失败",
      busy: false,
    };
  }
  rerender();
}

function client(): PersonalDevicesClient {
  return clientOverride ?? createPersonalDevicesFetchClient();
}

export function createPersonalDevicesFetchClient(
  fetchImpl: typeof fetch = fetch,
): PersonalDevicesClient {
  return {
    listDevices: async () =>
      asDevices((await request(fetchImpl, "/api/device-platform/v1/me/devices", "GET")).devices),
    listPlatforms: async () =>
      asPlatforms(
        (await request(fetchImpl, "/api/device-platform/v1/me/platforms", "GET")).platforms,
      ),
    listHumans: async () =>
      asHumans(
        (await request(fetchImpl, "/api/device-platform/v1/me/digital-humans", "GET"))
          .digitalHumans,
      ),
    submit: async (body) => {
      const payload = await request(
        fetchImpl,
        "/api/device-platform/v1/me/operations",
        "POST",
        body,
      );
      return payload.device ? asDevice(payload.device) : null;
    },
  };
}

async function request(
  fetchImpl: typeof fetch,
  path: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(path, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    const error = isRecord(payload.error) ? payload.error : {};
    const code = typeof error.code === "string" ? error.code : "REQUEST_FAILED";
    throw new PersonalDevicesRequestError(response.status, code, failureText(code));
  }
  return payload;
}

function asDevices(value: unknown): PersonalDeviceView[] {
  return Array.isArray(value) ? value.map((item) => asDevice(item)) : [];
}

function asDevice(value: unknown): PersonalDeviceView {
  const record = isRecord(value) ? value : {};
  const binding = isRecord(record.binding) ? record.binding : null;
  const status = isRecord(record.status) ? record.status : {};
  const presence =
    status.presence === "online" || status.presence === "offline" || status.presence === "unknown"
      ? status.presence
      : "unknown";
  return {
    deviceId: stringField(record, "deviceId"),
    displayName: stringField(record, "displayName"),
    platformId: stringField(record, "platformId"),
    externalDeviceId: stringField(record, "externalDeviceId"),
    ...(typeof record.model === "string" && record.model.trim() ? { model: record.model } : {}),
    binding: binding
      ? {
          bindingId: stringField(binding, "bindingId"),
          digitalHumanId: stringField(binding, "digitalHumanId"),
          scopes: stringArray(binding.scopes),
          status: stringField(binding, "status"),
          expectedBindingVersion: numberField(binding.expectedBindingVersion),
          appliedBindingVersion: numberField(binding.appliedBindingVersion),
          authorizationEstablished: binding.authorizationEstablished === true,
          platformApplied: binding.platformApplied === true,
          ...(typeof binding.failureCode === "string" ? { failureCode: binding.failureCode } : {}),
        }
      : null,
    status: {
      online: presence === "online" && status.online === true,
      presence,
      ...(typeof status.lastSeen === "string" ? { lastSeen: status.lastSeen } : {}),
      capabilities: stringArray(status.capabilities),
    },
  };
}

function asPlatforms(value: unknown): PersonalPlatformChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((item) => ({
    platformId: stringField(item, "platformId"),
    displayName: stringField(item, "displayName") || stringField(item, "platformId"),
  }));
}

function asHumans(value: unknown): PersonalHumanChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((item) => ({
    digitalHumanId: stringField(item, "digitalHumanId"),
    displayName: stringField(item, "displayName") || stringField(item, "digitalHumanId"),
  }));
}

function humanName(digitalHumanId: string | undefined): string {
  if (!digitalHumanId) {
    return "未绑定";
  }
  return (
    state.humans.find((human) => human.digitalHumanId === digitalHumanId)?.displayName ||
    digitalHumanId
  );
}

function scopeText(scopes: string[]): string {
  if (scopes.length === 0) {
    return "无";
  }
  return scopes.map((scope) => SCOPES.find((item) => item.id === scope)?.label || scope).join("、");
}

function connectionText(device: PersonalDeviceView): string {
  if (!device.binding) {
    return "未绑定";
  }
  return BINDING_LABEL[device.binding.status] ?? device.binding.status;
}

function presenceText(presence: PersonalDeviceView["status"]["presence"]): string {
  if (presence === "online") {
    return "在线";
  }
  if (presence === "offline") {
    return "离线";
  }
  return "未知";
}

function failureText(code: string): string {
  if (code === "PAIRING_WRONG") {
    return "配对码不正确。";
  }
  if (code === "PAIRING_EXPIRED") {
    return "配对码已过期。";
  }
  if (code === "PAIRING_REPLAY") {
    return "配对码已经使用过。";
  }
  if (code === "PAIRING_MISMATCH") {
    return "配对码和这台设备不一致。";
  }
  if (code === "PAIRING_PENDING") {
    return "请在设备上确认配对后再试。";
  }
  if (code === "USE_DENIED") {
    return "你没有使用这个数字人的权限。";
  }
  if (code === "UNAUTHENTICATED") {
    return "请先登录。";
  }
  return "设备请求失败。";
}

function operationId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `op${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function rerender(): void {
  requestOpenBotAppRerender();
}

function stringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? record[key] : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function numberField(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
