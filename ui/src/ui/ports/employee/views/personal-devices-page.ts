import { html, nothing, type TemplateResult } from "lit";
import { requestOpenBotAppRerender } from "../../../request-app-rerender.ts";
import {
  renderPersonalMetaList,
  renderPersonalSettingsPanel,
  renderPersonalSettingsRow,
  renderPersonalSettingsSection,
  renderPersonalSettingsTabIntro,
} from "./workbench-personal-settings-layout.ts";

/**
 * Shared device list for personal settings「设备与硬件」and digital-human
 * detail「已连接设备」. Both read the same device-platform bindings.
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
  /** Absent or false means the device effect is unconfirmed. */
  deviceEffect?: boolean;
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

export type PersonalDevicesListQuery = {
  digitalHumanId?: string;
};

/** Digital-human detail passes the current human. Personal settings omits it. */
export type PersonalDevicesPanelOptions = {
  digitalHumanId?: string;
  digitalHumanName?: string;
  title?: string;
  surface?: "settings" | "detail";
};

export type PersonalDevicesClient = {
  listDevices(query?: PersonalDevicesListQuery): Promise<PersonalDeviceView[]>;
  listPlatforms(): Promise<PersonalPlatformChoice[]>;
  listHumans(): Promise<PersonalHumanChoice[]>;
  submit(body: Record<string, unknown>): Promise<PersonalDeviceView | null>;
};

type AddDraft = {
  platformId: string;
  displayName: string;
  /** Raw scan box text. Parsed into the pairing fields; not submitted as-is. */
  scan: string;
  deviceId: string;
  challenge: string;
  code: string;
  digitalHumanId: string;
  scopes: string[];
};

/** list is the default. empty is derived when that list has no rows. */
type PanelMode = "list" | "add" | "detail";
type NoticeTone = "" | "info" | "success" | "error";

type PanelState = {
  status: "loading" | "unauthorized" | "failure" | "ready";
  message: string;
  notice: string;
  noticeTone: NoticeTone;
  busy: boolean;
  /** Front-end only. Does not change the device-platform contract. */
  mode: PanelMode;
  devices: PersonalDeviceView[];
  platforms: PersonalPlatformChoice[];
  humans: PersonalHumanChoice[];
  selectedId: string;
  draft: AddDraft;
  rebindHumanId: string;
  rebindScopes: string[];
  confirmRevoke: boolean;
  showTransfer: boolean;
  /** Set on the digital-human detail page. Empty on personal settings. */
  lockedHumanId: string;
  lockedHumanName: string;
};

const EMPTY_DRAFT: AddDraft = {
  platformId: "",
  displayName: "",
  scan: "",
  deviceId: "",
  challenge: "",
  code: "",
  digitalHumanId: "",
  scopes: ["chat"],
};

let loadToken = 0;
let loadStarted = false;
let activeScope = "";
let view: PersonalDevicesPanelOptions = {};
let clientOverride: PersonalDevicesClient | null = null;
let state: PanelState = freshState();

function freshState(): PanelState {
  return {
    status: "loading",
    message: "",
    notice: "",
    noticeTone: "",
    busy: false,
    mode: "list",
    devices: [],
    platforms: [],
    humans: [],
    selectedId: "",
    draft: { ...EMPTY_DRAFT, scopes: ["chat"] },
    rebindHumanId: "",
    rebindScopes: ["chat"],
    confirmRevoke: false,
    showTransfer: false,
    lockedHumanId: "",
    lockedHumanName: "",
  };
}

export function setPersonalDevicesClientForTests(client: PersonalDevicesClient | null): void {
  clientOverride = client;
}

export function resetPersonalDevicesPanelForTests(): void {
  loadToken += 1;
  loadStarted = false;
  activeScope = "";
  view = {};
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

export function renderPersonalDevicesPanel(options?: PersonalDevicesPanelOptions) {
  adoptScope(options);
  ensureLoaded();
  const selected = state.devices.find((device) => device.deviceId === state.selectedId) ?? null;
  const body = html`
    <div
      class="personal-devices__stack"
      data-testid="personal-devices"
      data-personal-devices-view=${currentView(selected)}
      data-personal-devices-human=${state.lockedHumanId}
    >
      ${renderCurrent(selected)}
    </div>
  `;
  if (panelSurface() === "detail") {
    return body;
  }
  return html`
    ${renderPersonalSettingsSection(html`
      ${renderPersonalSettingsTabIntro(view.title?.trim() || "设备与硬件")}
      ${body}
    `)}
  `;
}

function currentView(
  selected: PersonalDeviceView | null,
): "loading" | "error" | "add" | "detail" | "empty" | "list" {
  if (state.status === "loading") {
    return "loading";
  }
  if ((state.status === "unauthorized" || state.status === "failure") && state.mode !== "add") {
    return "error";
  }
  if (state.mode === "add") {
    return "add";
  }
  if (state.mode === "detail" && selected) {
    return "detail";
  }
  if (state.status === "ready" && state.devices.length === 0) {
    return "empty";
  }
  return "list";
}

function renderCurrent(selected: PersonalDeviceView | null) {
  const name = currentView(selected);
  if (name === "loading") {
    return html`
      <p class="personal-devices__note" data-testid="personal-devices-status">正在读取设备</p>
    `;
  }
  if (name === "error") {
    return renderLoadError();
  }
  if (name === "add") {
    return renderBlock("添加设备", renderAddView());
  }
  if (name === "detail" && selected) {
    return renderBlock(selected.displayName, renderDetail(selected));
  }
  if (name === "empty") {
    return renderBlock(listTitle(), renderEmptyState());
  }
  return renderBlock(listTitle(), renderDeviceList());
}

function adoptScope(options?: PersonalDevicesPanelOptions): void {
  const digitalHumanId = options?.digitalHumanId?.trim() ?? "";
  view = {
    ...(options?.title ? { title: options.title } : {}),
    ...(options?.surface ? { surface: options.surface } : {}),
    ...(digitalHumanId ? { digitalHumanId } : {}),
    ...(options?.digitalHumanName?.trim()
      ? { digitalHumanName: options.digitalHumanName.trim() }
      : {}),
  };
  if (digitalHumanId === activeScope) {
    if (view.digitalHumanName && state.lockedHumanName !== view.digitalHumanName) {
      state.lockedHumanName = view.digitalHumanName;
    }
    return;
  }
  activeScope = digitalHumanId;
  loadToken += 1;
  loadStarted = false;
  state = freshState();
  state.lockedHumanId = digitalHumanId;
  state.lockedHumanName = view.digitalHumanName ?? "";
  state.draft = { ...EMPTY_DRAFT, scopes: ["chat"], digitalHumanId };
}

function panelSurface(): "settings" | "detail" {
  if (view.surface) {
    return view.surface;
  }
  return state.lockedHumanId ? "detail" : "settings";
}

function listTitle(): string {
  if (panelSurface() === "detail") {
    return view.title?.trim() || "已连接设备";
  }
  return "我的设备";
}

function renderBlock(title: string, content: TemplateResult) {
  if (panelSurface() === "detail") {
    return html`
      <section class="wb-bots__section">
        <div class="wb-bots__section-head">
          <h3 class="wb-bots__section-title">${title}</h3>
        </div>
        <div class="wb-bots__section-body">${content}</div>
      </section>
    `;
  }
  return renderPersonalSettingsPanel({ title, content });
}

function renderLoadError() {
  return html`
    <div class="callout danger" role="alert" data-testid="personal-devices-status">
      <p class="personal-devices__callout-copy">${loadFailureMessage()}</p>
      <div class="personal-devices__callout-actions">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="personal-devices-retry"
          ?disabled=${state.busy}
          @click=${() => retryLoad()}
        >
          重试
        </button>
        <button
          type="button"
          class="btn"
          data-testid="personal-devices-add"
          @click=${() => openAdd()}
        >
          添加设备
        </button>
      </div>
    </div>
  `;
}

function renderNotice() {
  if (!state.notice) {
    return nothing;
  }
  const tone =
    state.noticeTone === "error" ? "danger" : state.noticeTone === "success" ? "success" : "info";
  return html`
    <div
      class="callout ${tone}"
      role=${state.noticeTone === "error" ? "alert" : "status"}
      data-testid="personal-devices-notice"
    >
      ${state.notice}
    </div>
  `;
}

function renderEmptyState() {
  return html`
    <div class="personal-devices__empty" data-testid="personal-devices-empty">
      <p class="personal-devices__empty-title">还没有设备</p>
      <p class="personal-devices__empty-copy">
        添加一台设备后，可以在这里查看授权、平台接受和真机确认。
      </p>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="personal-devices-add"
        @click=${() => openAdd()}
      >
        添加设备
      </button>
    </div>
  `;
}

function renderDeviceList() {
  const selectedId = state.selectedId;
  return html`
    <div class="personal-devices__toolbar">
      <p class="personal-devices__count">${state.devices.length} 台设备</p>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="personal-devices-add"
        @click=${() => openAdd()}
      >
        添加设备
      </button>
    </div>
    ${renderNotice()}
    <div class="personal-devices__list" data-testid="personal-devices-list">
      ${state.devices.map((device) => {
        const human = humanName(device.binding?.digitalHumanId);
        return html`
          <button
            type="button"
            class="personal-devices__item ${selectedId === device.deviceId ? "is-active" : ""}"
            data-testid="personal-device-row"
            @click=${() => selectDevice(device)}
          >
            <span class="personal-devices__item-title">${device.displayName}</span>
            <span class="personal-devices__item-meta">
              ${device.model?.trim() || "型号未知"} · ${human} · ${scopeText(device.binding?.scopes ?? [])} ·
              ${connectionText(device)}
            </span>
            ${renderEffectChips(device.binding)}
          </button>
        `;
      })}
    </div>
  `;
}

function renderEffectChips(binding: PersonalDeviceBindingView | null) {
  return html`
    <span class="personal-devices__effect" data-testid="personal-device-effect">
      <span class="personal-devices__effect-item">
        <span class="personal-devices__effect-key">授权</span>
        <span data-testid="personal-device-effect-auth">${authorizationText(binding)}</span>
      </span>
      <span class="personal-devices__effect-item">
        <span class="personal-devices__effect-key">平台</span>
        <span data-testid="personal-device-effect-platform">${platformText(binding)}</span>
      </span>
      <span class="personal-devices__effect-item">
        <span class="personal-devices__effect-key">设备</span>
        <span data-testid="personal-device-effect-device">${deviceEffectText(binding)}</span>
      </span>
    </span>
  `;
}

function renderDetail(device: PersonalDeviceView) {
  const binding = device.binding;
  return html`
    <div class="personal-devices__subview" data-testid="personal-device-detail">
      ${renderBackButton()}
      ${renderNotice()}
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
      ${renderEffectState(binding)}
      ${
        binding?.failureCode
          ? html`<div class="callout danger" role="alert">${failureText(binding.failureCode)}</div>`
          : nothing
      }
      <div class="personal-devices__grid">
        ${renderField(
          "更换数字人",
          html`
            <select
              class="employee-workbench__settings-input"
              data-testid="personal-device-rebind-human"
              .value=${state.rebindHumanId}
              @change=${(event: Event) => {
                state.rebindHumanId = (event.target as HTMLSelectElement).value;
              }}
            >
              ${humanChoices().map(
                (human) =>
                  html`<option value=${human.digitalHumanId}>${human.displayName}</option>`,
              )}
            </select>
          `,
        )}
      </div>
      ${renderScopeChecks(state.rebindScopes, (scopes) => {
        state.rebindScopes = scopes;
      })}
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
            state.showTransfer = false;
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
            state.confirmRevoke = false;
            rerender();
          }}
        >
          转移
        </button>
      </div>
      ${
        state.confirmRevoke
          ? html`<div class="callout" data-testid="personal-device-revoke-confirm">
              <p class="personal-devices__callout-copy">
                解除后这台设备不再使用当前授权。只有认领人可以做这一步。
              </p>
              <div class="personal-devices__callout-actions">
                <button
                  type="button"
                  class="btn btn--danger"
                  ?disabled=${state.busy}
                  @click=${() => void revoke(device)}
                >
                  确认解除
                </button>
              </div>
            </div>`
          : nothing
      }
      ${
        state.showTransfer
          ? html`
              <div class="callout info" data-testid="personal-device-transfer-note">
                只有当前认领人可以解除绑定。对方需要用新的配对码重新添加。不会把设备直接改到别人名下。
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function renderAddView() {
  return html`
    <div class="personal-devices__subview">
      ${renderBackButton()}
      ${renderNotice()}
      ${renderAddForm()}
    </div>
  `;
}

function renderBackButton() {
  return html`
    <button
      type="button"
      class="personal-devices__back"
      data-testid="personal-devices-back"
      @click=${() => backToList()}
    >
      返回列表
    </button>
  `;
}

function pairingDetailsVisible(draft: AddDraft): boolean {
  return Boolean(draft.deviceId.trim() || draft.challenge.trim() || draft.code.trim());
}

function renderAddForm() {
  const draft = state.draft;
  const showDetails = pairingDetailsVisible(draft);
  return html`
    <form
      class="personal-devices__form"
      data-testid="personal-device-add"
      @submit=${(event: Event) => void onAdd(event)}
    >
      <div class="personal-devices__grid">
        ${renderField(
          "设备平台",
          html`
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
          `,
        )}
        ${renderField(
          "名称",
          html`
            <input
              class="employee-workbench__settings-input"
              data-testid="personal-device-name"
              placeholder="例如门口相机"
              .value=${draft.displayName}
              @input=${(event: Event) => {
                draft.displayName = (event.target as HTMLInputElement).value;
              }}
            />
          `,
        )}
        <div class="personal-devices__pair">
          ${renderField(
            "粘贴扫描 / 配对码",
            html`
              <textarea
                class="employee-workbench__settings-input personal-devices__scan mono"
                data-testid="personal-device-scan"
                rows="4"
                placeholder="粘贴扫描内容，或只粘贴 6 位配对码；解析成功后会显示明细"
                .value=${draft.scan}
                @input=${(event: Event) => {
                  draft.scan = (event.target as HTMLTextAreaElement).value;
                }}
                @change=${(event: Event) => applyScan((event.target as HTMLTextAreaElement).value)}
              ></textarea>
            `,
            "personal-devices__field--scan",
          )}
          ${
            showDetails
              ? html`
                <div
                  class="personal-devices__pair-details"
                  data-testid="personal-device-pair-details"
                >
                  <p class="personal-devices__pair-hint">已从扫描内容填入，可按需微调。</p>
                  ${renderField(
                    "设备编号",
                    html`
                      <input
                        class="employee-workbench__settings-input mono"
                        data-testid="personal-device-id"
                        .value=${draft.deviceId}
                        @input=${(event: Event) => {
                          draft.deviceId = (event.target as HTMLInputElement).value;
                        }}
                      />
                    `,
                  )}
                  ${renderField(
                    "挑战号",
                    html`
                      <input
                        class="employee-workbench__settings-input mono"
                        data-testid="personal-device-challenge"
                        .value=${draft.challenge}
                        @input=${(event: Event) => {
                          draft.challenge = (event.target as HTMLInputElement).value;
                        }}
                      />
                    `,
                  )}
                  ${renderField(
                    "配对码",
                    html`
                      <input
                        class="employee-workbench__settings-input mono"
                        data-testid="personal-device-code"
                        inputmode="numeric"
                        maxlength="6"
                        autocomplete="one-time-code"
                        .value=${draft.code}
                        @input=${(event: Event) => {
                          draft.code = (event.target as HTMLInputElement).value;
                        }}
                      />
                    `,
                  )}
                </div>
              `
              : nothing
          }
        </div>
        ${renderHumanField(draft)}
      </div>
      ${renderScopeChecks(draft.scopes, (scopes) => {
        draft.scopes = scopes;
      })}
      <div class="personal-devices__form-footer">
        <button
          type="submit"
          class="btn btn--primary"
          data-testid="personal-device-submit"
          ?disabled=${state.busy}
        >
          添加并授权
        </button>
      </div>
    </form>
  `;
}

function renderField(label: string, control: TemplateResult, extraClass = "") {
  return html`
    <label class="personal-devices__field ${extraClass}">
      <span class="personal-devices__label">${label}</span>
      ${control}
    </label>
  `;
}

function renderHumanField(draft: AddDraft) {
  if (state.lockedHumanId) {
    return renderField(
      "数字人",
      html`
        <input
          class="employee-workbench__settings-input"
          data-testid="personal-device-human"
          data-digital-human-id=${state.lockedHumanId}
          .value=${humanName(state.lockedHumanId)}
          readonly
          disabled
        />
      `,
    );
  }
  return renderField(
    "数字人",
    html`
      <select
        class="employee-workbench__settings-input"
        data-testid="personal-device-human"
        .value=${draft.digitalHumanId}
        @change=${(event: Event) => {
          draft.digitalHumanId = (event.target as HTMLSelectElement).value;
        }}
      >
        <option value="">选择数字人</option>
        ${humanChoices().map(
          (human) => html`<option value=${human.digitalHumanId}>${human.displayName}</option>`,
        )}
      </select>
    `,
  );
}

function renderScopeChecks(selected: string[], onChange: (scopes: string[]) => void) {
  return html`
    <div class="personal-devices__scopes">
      <span class="personal-devices__label">权限</span>
      <div class="personal-devices__scope-grid" role="group" aria-label="权限" data-testid="personal-device-scopes">
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
    </div>
  `;
}

function selectDevice(device: PersonalDeviceView): void {
  state.mode = "detail";
  state.selectedId = device.deviceId;
  state.confirmRevoke = false;
  state.showTransfer = false;
  state.notice = "";
  state.noticeTone = "";
  state.rebindHumanId = device.binding?.digitalHumanId || state.humans[0]?.digitalHumanId || "";
  state.rebindScopes = device.binding?.scopes.length ? [...device.binding.scopes] : ["chat"];
  rerender();
}

function openAdd(): void {
  state.mode = "add";
  state.confirmRevoke = false;
  state.showTransfer = false;
  state.notice = "";
  state.noticeTone = "";
  rerender();
}

function backToList(): void {
  state.mode = "list";
  state.confirmRevoke = false;
  state.showTransfer = false;
  state.notice = "";
  state.noticeTone = "";
  rerender();
}

function retryLoad(): void {
  loadToken += 1;
  loadStarted = false;
  state.status = "loading";
  state.message = "";
  state.mode = "list";
  state.notice = "";
  state.noticeTone = "";
  state.busy = false;
  rerender();
  ensureLoaded();
}

function applyScan(raw: string): void {
  const parsed = parsePairingScan(raw);
  if (!parsed) {
    state.draft = { ...state.draft, scan: raw };
    setNotice("没有从扫描内容里读到设备编号或配对码。", "error");
    rerender();
    return;
  }
  state.draft = {
    ...state.draft,
    scan: raw,
    ...(parsed.deviceId ? { deviceId: parsed.deviceId } : {}),
    ...(parsed.challenge ? { challenge: parsed.challenge } : {}),
    ...(parsed.code ? { code: parsed.code } : {}),
  };
  setNotice("已填入配对信息。确认数字人和权限后添加。", "info");
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
    setNotice("请先粘贴扫描内容或配对码并确认平台、数字人；明细不全时请补全后再提交。", "error");
    rerender();
    return;
  }
  if (draft.scopes.length === 0) {
    setNotice("至少选择一项权限。", "error");
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
    // Success here is "submitted". deviceEffect stays false until a real device confirms.
    setNotice("已提交添加。列表会显示授权、平台接受和设备确认。", "success");
    state.mode = "list";
    state.draft = {
      ...EMPTY_DRAFT,
      platformId: draft.platformId,
      scopes: ["chat"],
      digitalHumanId: state.lockedHumanId,
    };
    if (device) {
      state.selectedId = device.deviceId;
    }
  });
}

async function rebind(device: PersonalDeviceView): Promise<void> {
  if (!state.rebindHumanId || state.rebindScopes.length === 0) {
    setNotice("选择要绑定的数字人和权限。", "error");
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
    setNotice("已更换数字人。", "success");
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
    setNotice("已解除绑定。", "success");
  });
}

async function run(work: (api: PersonalDevicesClient) => Promise<void>): Promise<void> {
  state.busy = true;
  state.notice = "";
  state.noticeTone = "";
  rerender();
  try {
    await work(client());
    await reload();
  } catch (error) {
    setNotice(presentFailure(error instanceof Error ? error.message : ""), "error");
    state.busy = false;
    rerender();
  }
}

function setNotice(message: string, tone: NoticeTone): void {
  state.notice = message;
  state.noticeTone = tone;
}

function presentFailure(message: string): string {
  const text = message.trim();
  if (!text || text === "设备请求失败" || text === "设备请求失败。") {
    return "设备请求失败。请检查填写内容后重试。";
  }
  return text;
}

function loadFailureMessage(): string {
  if (state.status === "unauthorized") {
    return "登录已失效，暂时读不到已连接设备。请重新登录后再试。";
  }
  if (!state.message || state.message === "设备请求失败。" || state.message === "读取设备失败") {
    return "暂时读不到已连接设备。请重试；若仍失败，请确认当前员工会话仍然有效。";
  }
  return state.message;
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
    const locked = state.lockedHumanId;
    const [listed, platforms, humans] = await Promise.all([
      api.listDevices(locked ? { digitalHumanId: locked } : undefined),
      api.listPlatforms(),
      api.listHumans(),
    ]);
    if (token !== loadToken) {
      return;
    }
    const devices = locked
      ? listed.filter((device) => device.binding?.digitalHumanId === locked)
      : listed;
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
        digitalHumanId: locked || state.draft.digitalHumanId || humans[0]?.digitalHumanId || "",
      },
    };
    const selectedStillVisible = devices.some((device) => device.deviceId === state.selectedId);
    if (state.selectedId && !selectedStillVisible) {
      state.selectedId = "";
      state.confirmRevoke = false;
      state.showTransfer = false;
      if (state.mode === "detail") {
        state.mode = "list";
      }
    }
  } catch (error) {
    if (token !== loadToken) {
      return;
    }
    const status = error instanceof PersonalDevicesRequestError ? error.status : 0;
    const code = error instanceof PersonalDevicesRequestError ? error.code : "";
    state = {
      ...state,
      status: status === 401 || code === "UNAUTHENTICATED" ? "unauthorized" : "failure",
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
    listDevices: async (query) =>
      asDevices(
        (
          await request(
            fetchImpl,
            query?.digitalHumanId
              ? `/api/device-platform/v1/me/digital-humans/${encodeURIComponent(query.digitalHumanId)}/devices`
              : "/api/device-platform/v1/me/devices",
            "GET",
          )
        ).devices,
      ),
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
          deviceEffect: binding.deviceEffect === true,
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

function humanChoices(): PersonalHumanChoice[] {
  const humans = [...state.humans];
  if (
    state.lockedHumanId &&
    !humans.some((human) => human.digitalHumanId === state.lockedHumanId)
  ) {
    humans.unshift({
      digitalHumanId: state.lockedHumanId,
      displayName: state.lockedHumanName || state.lockedHumanId,
    });
  }
  return humans;
}

function humanName(digitalHumanId: string | undefined): string {
  if (!digitalHumanId) {
    return "未绑定";
  }
  return (
    humanChoices().find((human) => human.digitalHumanId === digitalHumanId)?.displayName ||
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

/** Additive tri-state. Connection status stays on BINDING_LABEL and is not reused here. */
function renderEffectState(binding: PersonalDeviceBindingView | null) {
  return html`
    <div data-testid="personal-device-effect">
      ${renderPersonalMetaList([
        renderPersonalSettingsRow(
          "授权",
          html`<span data-testid="personal-device-effect-auth">${authorizationText(binding)}</span>`,
        ),
        renderPersonalSettingsRow(
          "平台",
          html`<span data-testid="personal-device-effect-platform">${platformText(binding)}</span>`,
        ),
        renderPersonalSettingsRow(
          "设备",
          html`<span data-testid="personal-device-effect-device">${deviceEffectText(binding)}</span>`,
        ),
      ])}
    </div>
  `;
}

function authorizationText(binding: PersonalDeviceBindingView | null): string {
  return binding?.authorizationEstablished === true ? "已授权" : "未授权";
}

function platformText(binding: PersonalDeviceBindingView | null): string {
  if (binding?.platformApplied === true) {
    return "平台已接受";
  }
  if (binding?.status === "applying") {
    return "应用中";
  }
  return "未接受";
}

function deviceEffectText(binding: PersonalDeviceBindingView | null): string {
  return binding?.deviceEffect === true ? "设备已应用" : "未确认·JOINT_PENDING";
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
