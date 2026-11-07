/**
 * Enterprise message channels settings surface (card gallery + config workspace).
 *
 * Uses channels.status({ tenantId, probe }), tenant-scoped config.set, and
 * channels.logout({ tenantId }) to clear saved secrets without stopping the global runtime.
 * Soft bridge: Callback URL + sync-to-identity without merging secrets into seat-assets.
 * Spec: `.kiro/specs/enterprise-ai-model-governance/`
 */

import { html, nothing, type TemplateResult } from "lit";
import {
  formatFeishuEmployeeUiHint,
  readFeishuEnterpriseChannelContract,
  type EnterpriseImCapabilityStatus,
  type EnterpriseImEmployeeUiHint,
} from "../../../../../../src/gateway/enterprise-im-channel-contract.js";
import { channelFaultMessage } from "../../../channel-fault-scope.ts";
import { ensureImAccountWebhookPaths } from "../../../controllers/tenant-channel-config.ts";
import {
  describeTenantImCredentialGaps,
  resolveTenantImCallbackEntries,
  resolveTenantImPendingHint,
  summarizeTenantImProbeFromSnapshot,
  type TenantImProbeResult,
} from "../../../controllers/tenant-im-binding.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { renderIcon } from "../../../icons.ts";
import type { ChannelsStatusSnapshot } from "../../../types.ts";
import { localizeEnterpriseGatewayThrown } from "../enterprise-connection-copy.ts";
import {
  ensureEnterpriseImAccountForm,
  enterpriseImNeedsCallbackUrl,
  readEnterpriseImAccountValues,
  renderEnterpriseImChannelForm,
  resolveEnterpriseImConnectionMode,
  resolveEnterpriseImPrimaryAccountId,
  setEnterpriseImAccountFieldValue,
} from "./enterprise-im-channel-form.ts";
import { requestEnterpriseAppRerender, shouldProceed } from "./enterprise-surface-shared.ts";

export type EnterpriseMessageChannelsSurfaceProps = {
  client: GatewayBrowserClient | null;
  tenantId: string | null;
  syncBusy?: boolean;
  identityLinkHint?: string | null;
  onSyncOperationalIdentity?: (channelId: string) => void | Promise<void>;
  onNavigateToIdentities?: () => void;
};

type CardStatus = "not_added" | "draft" | "ready" | "connected" | "test_failed";

type SurfaceState = {
  loading: boolean;
  probing: boolean;
  error: string | null;
  notice: string | null;
  busyId: string | null;
  snapshot: ChannelsStatusSnapshot | null;
  selectedChannelId: EnterpriseMessageChannelId | null;
  workspaceOpen: boolean;
  editorBaseRaw: string | null;
  configRaw: string | null;
  configHash: string | null;
  configDirty: boolean;
  /** Explicit probe outcomes only (never ambient on load). */
  lastProbeByChannel: Partial<Record<EnterpriseMessageChannelId, TenantImProbeResult>>;
};

const stateByOwner = new WeakMap<object, Map<string, SurfaceState>>();

/** Display order: 企业微信 / 飞书 / 钉钉 */
const ENTERPRISE_MESSAGE_CHANNELS = ["wecom", "feishu", "dingtalk"] as const;
type EnterpriseMessageChannelId = (typeof ENTERPRISE_MESSAGE_CHANNELS)[number];

const ENTERPRISE_MESSAGE_CHANNEL_LABELS: Record<EnterpriseMessageChannelId, string> = {
  wecom: "企业微信",
  feishu: "飞书",
  dingtalk: "钉钉",
};

const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  not_added: "未添加",
  draft: "待完善",
  ready: "已保存",
  connected: "连通正常",
  test_failed: "测试未通过",
};

/** Shape + text, so status is not carried by the color dot alone. */
const CARD_STATUS_MARK: Record<CardStatus, string> = {
  not_added: "○",
  draft: "△",
  ready: "●",
  connected: "✓",
  test_failed: "!",
};

const CARD_CTA_LABEL: Record<CardStatus, string> = {
  not_added: "添加并配置",
  draft: "继续配置",
  ready: "管理",
  connected: "管理",
  test_failed: "管理",
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function getState(host: object, props: EnterpriseMessageChannelsSurfaceProps): SurfaceState {
  const owner = props.client ?? host;
  const tenantKey = props.tenantId?.trim() || "__no_tenant__";
  let states = stateByOwner.get(owner);
  if (!states) {
    states = new Map();
    stateByOwner.set(owner, states);
  }
  let state = states.get(tenantKey);
  if (!state) {
    state = {
      loading: false,
      probing: false,
      error: null,
      notice: null,
      busyId: null,
      snapshot: null,
      selectedChannelId: null,
      workspaceOpen: false,
      editorBaseRaw: null,
      configRaw: null,
      configHash: null,
      configDirty: false,
      lastProbeByChannel: {},
    };
    states.set(tenantKey, state);
  }
  return state;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseConfigRaw(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function channelPresentInForm(
  form: Record<string, unknown> | null | undefined,
  channelId: string,
): boolean {
  return Boolean(asRecord(asRecord(form?.channels)?.[channelId]));
}

function countChannelAccounts(
  form: Record<string, unknown> | null | undefined,
  channelId: string,
  snapshot: ChannelsStatusSnapshot | null,
): number {
  const fromSnap = snapshot?.channelAccounts?.[channelId]?.length ?? 0;
  if (fromSnap > 0) {
    return fromSnap;
  }
  const accounts = asRecord(asRecord(asRecord(form?.channels)?.[channelId])?.accounts);
  if (accounts) {
    return Object.keys(accounts).length;
  }
  return channelPresentInForm(form, channelId) ? 1 : 0;
}

function resolveCardStatus(params: {
  present: boolean;
  form: Record<string, unknown> | null;
  channelId: EnterpriseMessageChannelId;
  accountId?: string;
  lastProbe: TenantImProbeResult | undefined;
}): CardStatus {
  if (!params.present) {
    return "not_added";
  }
  if (
    describeTenantImCredentialGaps(params.form, params.channelId, {
      accountId: params.accountId,
    })
  ) {
    return "draft";
  }
  if (params.lastProbe?.tone === "ok") {
    return "connected";
  }
  if (params.lastProbe?.tone === "fail") {
    return "test_failed";
  }
  return "ready";
}

function resolveCardSummary(params: {
  status: CardStatus;
  accountCount: number;
  enabled: boolean;
}): string {
  switch (params.status) {
    case "not_added":
      return "尚未接入";
    case "draft":
      return params.accountCount > 0 ? `${params.accountCount} 个账号 · 待填凭证` : "待填凭证";
    case "ready":
      return params.enabled ? "已保存 · 可测试连通" : "已停用 · 凭证已保存";
    case "connected":
      return params.enabled ? "已启用 · 最近测试通过" : "已停用 · 最近测试通过";
    case "test_failed":
      return "已保存 · 测试未通过";
  }
}

function requestWithTimeout<T>(
  client: GatewayBrowserClient,
  method: string,
  params: unknown,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${method} 请求超时，请检查 Gateway 后重试`));
    }, timeoutMs);
    client.request<T>(method, params).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function loadTenantConfig(
  client: GatewayBrowserClient,
  tenantId: string,
): Promise<{ raw: string; hash: string }> {
  const res = await requestWithTimeout<{
    config?: unknown;
    hash?: string;
    raw?: string;
  }>(client, "config.get", { tenantId });
  const hash = typeof res.hash === "string" ? res.hash : "";
  if (typeof res.raw === "string" && res.raw.trim()) {
    return { raw: res.raw, hash };
  }
  const config = res.config ?? {};
  return { raw: `${JSON.stringify(config, null, 2)}\n`, hash };
}

async function saveTenantConfigRaw(
  client: GatewayBrowserClient,
  tenantId: string,
  raw: string,
  baseHash: string | null,
): Promise<{ raw: string; hash: string }> {
  const res = await requestWithTimeout<{ config?: unknown; hash?: string }>(client, "config.set", {
    tenantId,
    raw,
    ...(baseHash ? { baseHash } : {}),
  });
  const hash = typeof res.hash === "string" ? res.hash : (baseHash ?? "");
  return { raw, hash };
}

function patchChannelEnabled(raw: string, channelId: string, enabled: boolean): string {
  const parsed = parseConfigRaw(raw);
  const channels = asRecord(parsed.channels) ?? {};
  const entry = asRecord(channels[channelId]) ?? {};
  entry.enabled = enabled;
  channels[channelId] = entry;
  parsed.channels = channels;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function ensureChannelAccountEntry(
  raw: string,
  channelId: EnterpriseMessageChannelId,
  tenantId: string,
): string {
  const parsed = parseConfigRaw(raw);
  const { form } = ensureEnterpriseImAccountForm({
    form: parsed,
    channelId,
    tenantId,
  });
  return `${JSON.stringify(form, null, 2)}\n`;
}

function removeChannelEntry(raw: string, channelId: string): string {
  const parsed = parseConfigRaw(raw);
  const channels = asRecord(parsed.channels) ?? {};
  delete channels[channelId];
  parsed.channels = channels;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function feishuCardContract(params: {
  form: Record<string, unknown> | null;
  accountId?: string;
  snapshot: ChannelsStatusSnapshot | null;
}): {
  childExecutionBlocked: boolean;
  employeeUiHint: EnterpriseImEmployeeUiHint;
  platformEnterpriseId: string | null;
  capabilityStatus: EnterpriseImCapabilityStatus | null;
} {
  const stored = readFeishuEnterpriseChannelContract({
    config: params.form,
    accountId: params.accountId,
  });
  const accounts = params.snapshot?.channelAccounts?.feishu ?? [];
  const live =
    accounts.find((account) => account.accountId === params.accountId) ??
    (accounts.length === 1 ? accounts[0] : undefined);
  if (!live?.enterpriseImEmployeeUiHint && !live?.enterpriseImCapability) {
    return stored;
  }
  return {
    childExecutionBlocked: live.enterpriseImChildExecutionBlocked ?? stored.childExecutionBlocked,
    employeeUiHint: live.enterpriseImEmployeeUiHint ?? stored.employeeUiHint,
    platformEnterpriseId:
      typeof live.platformEnterpriseId === "string"
        ? live.platformEnterpriseId
        : stored.platformEnterpriseId,
    capabilityStatus: live.enterpriseImCapability ?? stored.capabilityStatus,
  };
}

function feishuCapabilityStateLabel(status: string): string {
  switch (status) {
    case "granted":
      return "已开通";
    case "missing":
      return "未开通";
    case "unknown":
      return "未知";
    default:
      return "未检查";
  }
}

function renderFeishuEnterpriseContract(params: {
  channelId: string;
  form: Record<string, unknown> | null;
  accountId?: string;
  snapshot: ChannelsStatusSnapshot | null;
  probe?: { tone: string; summary: string } | null;
}): TemplateResult | typeof nothing {
  if (params.channelId !== "feishu") {
    return nothing;
  }
  const contract = feishuCardContract(params);
  const rows = contract.capabilityStatus;
  const capability = [
    ["projectGroupRead", "群消息读取", rows?.projectGroupRead ?? "not_checked"],
    ["projectDocs", "文档", rows?.projectDocs ?? "not_checked"],
    ["sendAsUser", "以用户身份发送", rows?.sendAsUser ?? "not_checked"],
    ["newMessageTrigger", "新消息", rows?.newMessageTrigger ?? "not_checked"],
  ] as const;
  const probeTone = params.probe?.tone === "ok" ? "is-ok" : params.probe ? "is-warn" : "";
  return html`<section class="enterprise-im-status" data-feishu-enterprise-contract>
    <div class="enterprise-im-status__head">状态</div>
    <div class="enterprise-im-status__chips">
      ${
        params.probe
          ? html`<span class="enterprise-im-status__chip ${probeTone}">${params.probe.summary}</span>`
          : nothing
      }
      <span class="enterprise-im-status__chip"
        >${formatFeishuEmployeeUiHint(contract.employeeUiHint)}</span
      >
    </div>
    <div class="enterprise-im-status__row" data-feishu-enterprise-id>
      <span class="enterprise-im-status__label">平台企业 ID</span>
      <span class="enterprise-im-status__value">
        ${contract.platformEnterpriseId ?? "未探测"}
        ${
          contract.platformEnterpriseId
            ? nothing
            : html`
                <span class="enterprise-im-status__aside">不是账户 ID</span>
              `
        }
      </span>
    </div>
    <ul class="enterprise-im-status__caps">
      ${capability.map(
        ([key, label, status]) => html`
          <li class="enterprise-im-status__cap" data-capability=${key} data-status=${status}>
            <span>${label}</span>
            <span class="enterprise-im-status__state ${status === "granted" ? "is-ok" : status === "missing" ? "is-missing" : ""}"
              >${feishuCapabilityStateLabel(status)}</span
            >
          </li>
        `,
      )}
    </ul>
    <p class="enterprise-im-status__note">连通正常不是员工授权。</p>
  </section>`;
}

function isChannelEnabled(
  form: Record<string, unknown> | null,
  channelId: string,
  snapshot: ChannelsStatusSnapshot | null,
): boolean {
  const list = snapshot?.channelAccounts?.[channelId] ?? [];
  if (list.length > 0) {
    return list.some((a) => a.enabled !== false);
  }
  const entry = asRecord(asRecord(form?.channels)?.[channelId]);
  if (!entry) {
    return true;
  }
  return entry.enabled !== false;
}

function copyText(value: string, onResult?: (ok: boolean) => void) {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clipboard?.writeText) {
    onResult?.(false);
    return;
  }
  void clipboard.writeText(value).then(
    () => onResult?.(true),
    () => onResult?.(false),
  );
}

async function reload(
  host: object,
  props: EnterpriseMessageChannelsSurfaceProps,
  probe: boolean,
): Promise<void> {
  const state = getState(host, props);
  if (!props.client || !props.tenantId) {
    state.error = "需要企业登录上下文";
    state.loading = false;
    return;
  }
  state.loading = true;
  state.probing = probe;
  state.error = null;
  try {
    const statusPromise = requestWithTimeout<ChannelsStatusSnapshot>(
      props.client,
      "channels.status",
      {
        tenantId: props.tenantId,
        probe,
        timeoutMs: probe ? 12_000 : 8_000,
      },
      probe ? 14_000 : 10_000,
    );
    // A probe writes tenant_key onto the tenant config. Read that config after
    // the status call so the card does not keep a pre-probe view.
    let snapshot: ChannelsStatusSnapshot;
    let cfg: { raw: string; hash: string };
    if (probe) {
      snapshot = await statusPromise;
      cfg = await loadTenantConfig(props.client, props.tenantId);
    } else {
      [snapshot, cfg] = await Promise.all([
        statusPromise,
        loadTenantConfig(props.client, props.tenantId),
      ]);
    }
    state.snapshot = snapshot;
    state.configRaw = cfg.raw;
    if (!snapshot) {
      state.error = state.error ?? "通道状态加载失败，请重试。";
    }
    state.configHash = cfg.hash;
    state.editorBaseRaw = cfg.raw;
    state.configDirty = false;
    state.notice = probe ? "已完成通道探测（租户配置视图；运行时仍为全局实例）" : state.notice;
  } catch (error) {
    state.notice = null;
    state.error = localizeEnterpriseGatewayThrown(error, "通道状态加载失败，请重试。");
  } finally {
    state.loading = false;
    state.probing = false;
  }
}

function defaultRequestUpdate(): void {
  requestEnterpriseAppRerender();
}

function renderGalleryCard(params: {
  channelId: EnterpriseMessageChannelId;
  status: CardStatus;
  summary: string;
  fault: string | null;
  capabilityLine: string | null;
  selected: boolean;
  skeleton: boolean;
  disabled: boolean;
  onActivate: () => void;
}): TemplateResult {
  const {
    channelId,
    status,
    summary,
    fault,
    capabilityLine,
    selected,
    skeleton,
    disabled,
    onActivate,
  } = params;
  const label = ENTERPRISE_MESSAGE_CHANNEL_LABELS[channelId];
  return html`
    <div
      class="enterprise-channel-gallery__card enterprise-channel-gallery__card--${status} ${
        selected ? "is-selected" : ""
      } ${skeleton ? "is-skeleton" : ""} ${disabled ? "is-disabled" : ""}"
      role="listitem"
      @click=${() => {
        if (!disabled && !skeleton) {
          onActivate();
        }
      }}
    >
      <div class="enterprise-channel-gallery__card-top">
        <span class="enterprise-channel-gallery__brand enterprise-channel-gallery__brand--${channelId}"></span>
        <strong class="enterprise-channel-gallery__name">${label}</strong>
      </div>
      <div class="enterprise-channel-gallery__badge">
        <span class="enterprise-channel-gallery__dot" aria-hidden="true"></span>
        ${skeleton ? "加载中…" : `${CARD_STATUS_MARK[status]} ${CARD_STATUS_LABEL[status]}`}
      </div>
      <p class="enterprise-channel-gallery__summary">${skeleton ? "…" : summary}</p>
      ${
        !skeleton && capabilityLine
          ? html`<p class="enterprise-channel-gallery__summary" data-enterprise-im-capability>
              ${capabilityLine}
            </p>`
          : nothing
      }
      ${
        !skeleton && fault
          ? html`<p class="enterprise-channel-gallery__summary" data-channel-fault>${fault}</p>`
          : nothing
      }
      <button
        type="button"
        class="enterprise-channel-gallery__cta"
        ?disabled=${disabled || skeleton}
        @click=${(event: Event) => {
          event.stopPropagation();
          if (!disabled && !skeleton) {
            onActivate();
          }
        }}
      >
        ${skeleton ? "…" : CARD_CTA_LABEL[status]}
      </button>
    </div>
  `;
}

function renderWorkspace(params: {
  props: EnterpriseMessageChannelsSurfaceProps;
  state: SurfaceState;
  channelId: EnterpriseMessageChannelId;
  form: Record<string, unknown>;
  enabled: boolean;
  requestUpdate: () => void;
  run: (
    busyId: string,
    fn: () => Promise<void>,
    options?: { probeAfter?: boolean; skipSuccessNotice?: boolean },
  ) => Promise<void>;
}): TemplateResult {
  const { props, state, channelId, form, enabled, requestUpdate, run } = params;
  const label = ENTERPRISE_MESSAGE_CHANNEL_LABELS[channelId];
  const disabled = Boolean(state.busyId) || !props.client || !props.tenantId;
  const channelEntry = asRecord(asRecord(form.channels)?.[channelId]);
  const accountId = props.tenantId
    ? resolveEnterpriseImPrimaryAccountId(asRecord(channelEntry?.accounts) ?? {}, props.tenantId)
    : "default";
  const accountValues = readEnterpriseImAccountValues({ form, channelId, accountId });
  const connectionMode = resolveEnterpriseImConnectionMode({ channelId, values: accountValues });
  const showCallback = enterpriseImNeedsCallbackUrl(channelId, connectionMode);
  const entries = showCallback
    ? resolveTenantImCallbackEntries({ form, channelId, accountId })
    : [];
  const lastProbe = state.lastProbeByChannel[channelId] ?? null;
  const credentialsReady = !describeTenantImCredentialGaps(form, channelId, { accountId });
  const workspaceSub =
    channelId === "feishu"
      ? showCallback
        ? "保存后复制 Callback URL。"
        : ""
      : showCallback
        ? "当前为 URL 回调模式：保存后复制 Callback URL 回填开放平台；凭证仅写入当前企业租户。"
        : "当前为长连接模式（推荐）：填写凭证并保存即可，无需公网回调；凭证仅写入当前企业租户。";

  const runProbe = async () => {
    if (!props.client || !props.tenantId) {
      throw new Error("缺少租户上下文");
    }
    if (state.configDirty) {
      const result: TenantImProbeResult = {
        channelId,
        tone: "fail",
        summary: "测试未通过：还有未保存的修改。请先保存凭证，再测试连通。",
        hint: resolveTenantImPendingHint(channelId),
        accounts: [],
      };
      state.lastProbeByChannel = { ...state.lastProbeByChannel, [channelId]: result };
      state.error = result.summary;
      return;
    }
    const gap = describeTenantImCredentialGaps(form, channelId, { accountId });
    if (gap) {
      const result: TenantImProbeResult = {
        channelId,
        tone: "fail",
        summary: `测试未通过：${gap}`,
        hint: resolveTenantImPendingHint(channelId),
        accounts: [],
      };
      state.lastProbeByChannel = { ...state.lastProbeByChannel, [channelId]: result };
      state.error = result.summary;
      return;
    }
    state.probing = true;
    requestUpdate();
    try {
      const snapshot = await requestWithTimeout<ChannelsStatusSnapshot>(
        props.client,
        "channels.status",
        {
          tenantId: props.tenantId,
          probe: true,
          timeoutMs: 12_000,
        },
        14_000,
      );
      state.snapshot = snapshot;
      const result = summarizeTenantImProbeFromSnapshot(channelId, snapshot);
      state.lastProbeByChannel = { ...state.lastProbeByChannel, [channelId]: result };
      state.notice = result.tone === "ok" && channelId !== "feishu" ? "连通测试通过" : null;
      state.error = result.tone === "fail" ? result.summary : null;
    } finally {
      state.probing = false;
    }
  };

  const formView =
    state.configRaw && props.tenantId
      ? renderEnterpriseImChannelForm({
          channelId,
          form,
          tenantId: props.tenantId,
          disabled,
          onFieldChange: (field, value) => {
            if (!state.configRaw || !props.tenantId) {
              return;
            }
            const next = setEnterpriseImAccountFieldValue({
              form: parseConfigRaw(state.configRaw),
              channelId,
              tenantId: props.tenantId,
              field,
              value,
            });
            state.configRaw = `${JSON.stringify(next, null, 2)}\n`;
            state.configDirty = true;
            state.error = null;
            state.notice = null;
            const { [channelId]: _cleared, ...rest } = state.lastProbeByChannel;
            state.lastProbeByChannel = rest;
            requestUpdate();
          },
        })
      : html`
          <div class="enterprise-channel-workspace__hint">配置未加载</div>
        `;

  const saveButton = html`
    <div class="enterprise-form-actions">
      <button
        class="btn btn--primary"
        type="button"
        ?disabled=${disabled || !state.configDirty || !state.configRaw}
        @click=${() =>
          void run(
            `save:${channelId}`,
            async () => {
              if (!props.client || !props.tenantId || !state.configRaw) {
                throw new Error("配置未加载");
              }
              let formToSave = parseConfigRaw(state.configRaw);
              formToSave = ensureImAccountWebhookPaths(formToSave);
              const gap = describeTenantImCredentialGaps(formToSave, channelId, { accountId });
              if (gap) {
                throw new Error(`保存未通过：${gap}`);
              }
              const raw = `${JSON.stringify(formToSave, null, 2)}\n`;
              const saved = await saveTenantConfigRaw(
                props.client,
                props.tenantId,
                raw,
                state.configHash,
              );
              state.configRaw = saved.raw;
              state.configHash = saved.hash;
              state.editorBaseRaw = saved.raw;
              state.configDirty = false;
            },
            { skipSuccessNotice: false },
          )}
      >
        ${state.busyId?.startsWith("save:") ? "保存中…" : "保存"}
      </button>
    </div>
  `;

  const orderHint = showCallback
    ? "建议顺序：保存凭证 → 复制 Callback URL 回填开放平台 → 向机器人发「你好」→ 测试连通。"
    : "建议顺序：保存凭证 → 在开放平台确认长连接/事件订阅 → 向机器人发「你好」→ 测试连通。";

  const troubleshoot = html`
    <details
      class="enterprise-im-curated__disclosure"
      data-testid=${channelId === "feishu" ? "enterprise-im-troubleshoot" : nothing}
    >
      <summary>排查</summary>
      <p>${resolveTenantImPendingHint(channelId)}</p>
      <p>${orderHint}</p>
    </details>
  `;

  const callbackBlock = showCallback
    ? html`
        <div class="enterprise-channel-workspace__callbacks">
          <div class="enterprise-channel-workspace__section-title">Callback URL（回填到开放平台）</div>
          ${
            entries.length === 0
              ? html`
                  <div class="enterprise-channel-workspace__hint">
                    打开配置后会自动生成账户级回调地址；保存后复制到开放平台即可。
                  </div>
                `
              : html`<ul class="enterprise-im-callback-list">
                  ${entries.map(
                    (entry) => html`
                      <li class="enterprise-im-callback-list__item">
                        <div class="enterprise-im-callback-list__meta">
                          <strong>${entry.accountId}</strong>
                          <code class="enterprise-im-callback-list__url">${entry.url}</code>
                        </div>
                        <button
                          class="btn btn--sm"
                          type="button"
                          ?disabled=${disabled}
                          @click=${() =>
                            copyText(entry.copyText, (ok) => {
                              state.notice = ok ? "已复制 Callback URL" : null;
                              state.error = ok ? null : "复制失败，请手动选择地址。";
                              requestUpdate();
                            })}
                        >
                          复制
                        </button>
                      </li>
                    `,
                  )}
                </ul>`
          }
        </div>
      `
    : nothing;

  const probeButton = html`
    <button
      class=${channelId === "feishu" ? "btn" : "btn btn--sm"}
      type="button"
      data-testid="enterprise-channel-probe"
      ?disabled=${disabled || state.probing}
      @click=${() => {
        void (async () => {
          state.busyId = `probe:${channelId}`;
          state.error = null;
          state.notice = null;
          requestUpdate();
          try {
            await runProbe();
          } catch (error) {
            state.notice = null;
            state.error = localizeEnterpriseGatewayThrown(error, "测试连通失败，请重试。");
          } finally {
            state.busyId = null;
            state.probing = false;
            requestUpdate();
          }
        })();
      }}
    >
      ${state.probing ? "测试中…" : "测试连通"}
    </button>
  `;

  const syncButton = html`
    <button
      class=${channelId === "feishu" ? "btn btn--sm" : "btn btn--sm btn--primary"}
      type="button"
      ?disabled=${
        disabled ||
        props.syncBusy ||
        state.configDirty ||
        !credentialsReady ||
        !props.onSyncOperationalIdentity
      }
      @click=${() => void props.onSyncOperationalIdentity?.(channelId)}
    >
      ${props.syncBusy ? "同步中…" : "同步为运营身份"}
    </button>
  `;

  const identityButton = props.onNavigateToIdentities
    ? html`
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${disabled}
          @click=${props.onNavigateToIdentities}
        >
          打开企业身份
        </button>
      `
    : nothing;

  const statusCard = renderFeishuEnterpriseContract({
    channelId,
    form,
    accountId,
    snapshot: state.snapshot,
    probe: lastProbe,
  });

  return html`
    <section class="enterprise-channel-workspace enterprise-settings-panel enterprise-settings-panel--flat">
      <header class="enterprise-channel-workspace__head">
        <div>
          <div class="enterprise-channel-workspace__title">配置 · ${label}</div>
          ${workspaceSub ? html`<div class="enterprise-channel-workspace__sub">${workspaceSub}</div>` : nothing}
        </div>
        <div class="enterprise-channel-workspace__head-actions">
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${disabled || !state.configRaw}
            @click=${() => {
              if (
                enabled &&
                !shouldProceed(
                  `停用通道 ${label}？已保存的凭证会保留。这只改企业配置里的启用开关，不会停止全局通道运行时。`,
                )
              ) {
                return;
              }
              void run(`toggle:${channelId}`, async () => {
                if (!props.client || !props.tenantId || !state.configRaw) {
                  throw new Error("配置未加载");
                }
                const next = patchChannelEnabled(state.configRaw, channelId, !enabled);
                const saved = await saveTenantConfigRaw(
                  props.client,
                  props.tenantId,
                  next,
                  state.configHash,
                );
                state.configRaw = saved.raw;
                state.configHash = saved.hash;
                state.editorBaseRaw = saved.raw;
              });
            }}
          >
            ${enabled ? "停用" : "启用"}
          </button>
          <button
            class="btn btn--sm"
            type="button"
            data-testid="enterprise-channel-logout"
            ?disabled=${disabled || !state.configRaw}
            title="只清除已保存的企业凭证，不停止全局通道运行时，也不删除通道配置。"
            @click=${() => {
              if (state.configDirty) {
                state.notice = null;
                state.error = "还有未保存的修改。请先保存或放弃后再清除已保存的凭证。";
                requestUpdate();
                return;
              }
              if (
                !shouldProceed(
                  `清除 ${label} 的已保存企业凭证？只删除密钥字段，不停止全局通道运行时，也不删除通道配置。`,
                )
              ) {
                return;
              }
              void run(
                `logout:${channelId}`,
                async () => {
                  if (!props.client || !props.tenantId) {
                    throw new Error("需要企业登录上下文");
                  }
                  const result = await requestWithTimeout<{
                    cleared?: boolean;
                    scope?: string;
                    runtimeStopped?: boolean;
                  }>(props.client, "channels.logout", {
                    channel: channelId,
                    tenantId: props.tenantId,
                    accountId,
                  });
                  if (result.scope !== "tenant" || result.runtimeStopped !== false) {
                    throw new Error("清除结果不是企业凭证范围，未当作成功。");
                  }
                  if (!result.cleared) {
                    throw new Error("没有可清除的企业凭证。");
                  }
                  state.notice = "已清除该账号的企业凭证。全局通道运行时未停止。";
                },
                { skipSuccessNotice: true },
              );
            }}
          >
            清除凭证
          </button>
          <button
            class="btn btn--sm btn--danger"
            type="button"
            ?disabled=${disabled || !state.configRaw}
            @click=${() => {
              const ok = window.confirm(
                `从企业配置移除通道 ${label}？这会删掉该通道的企业配置项，不会停止全局通道运行时。`,
              );
              if (!ok) {
                return;
              }
              void run(`remove:${channelId}`, async () => {
                if (!props.client || !props.tenantId || !state.configRaw) {
                  throw new Error("配置未加载");
                }
                const next = removeChannelEntry(state.configRaw, channelId);
                const saved = await saveTenantConfigRaw(
                  props.client,
                  props.tenantId,
                  next,
                  state.configHash,
                );
                state.configRaw = saved.raw;
                state.configHash = saved.hash;
                state.editorBaseRaw = saved.raw;
                state.workspaceOpen = false;
                state.selectedChannelId = null;
                const { [channelId]: _removed, ...rest } = state.lastProbeByChannel;
                state.lastProbeByChannel = rest;
              });
            }}
          >
            移除
          </button>
        </div>
      </header>

      ${
        state.error
          ? html`<div class="enterprise-channel-workspace__result enterprise-channel-workspace__result--danger">${state.error}</div>`
          : nothing
      }
      ${
        state.notice
          ? html`<div class="enterprise-channel-workspace__result enterprise-channel-workspace__result--ok">${state.notice}</div>`
          : nothing
      }

      ${
        channelId === "feishu"
          ? html`
              <div class="enterprise-im-workspace__columns">
                <div class="enterprise-im-workspace__main">
                  <div class="enterprise-channel-workspace__form">${formView}</div>
                  ${saveButton}
                  ${callbackBlock}
                  ${troubleshoot}
                </div>
                <aside class="enterprise-im-workspace__side">
                  ${statusCard}
                  <div class="enterprise-im-workspace__actions">
                    ${probeButton} ${syncButton} ${identityButton}
                  </div>
                  ${
                    props.identityLinkHint
                      ? html`<div class="enterprise-im-status__note">${props.identityLinkHint}</div>`
                      : nothing
                  }
                </aside>
              </div>
            `
          : html`
              <div class="enterprise-channel-workspace__form">${formView}</div>
              ${saveButton}
              ${callbackBlock}
              <p class="enterprise-channel-workspace__hint">${resolveTenantImPendingHint(channelId)}</p>
              ${
                lastProbe
                  ? html`
                      <div
                        class="enterprise-channel-workspace__result ${
                          lastProbe.tone === "ok"
                            ? "enterprise-channel-workspace__result--ok"
                            : lastProbe.tone === "fail"
                              ? "enterprise-channel-workspace__result--danger"
                              : "enterprise-channel-workspace__result--warn"
                        }"
                      >
                        ${lastProbe.summary}
                        ${lastProbe.hint ? html`<div>${lastProbe.hint}</div>` : nothing}
                      </div>
                    `
                  : nothing
              }
              ${
                props.identityLinkHint
                  ? html`<div class="enterprise-channel-workspace__result">${props.identityLinkHint}</div>`
                  : nothing
              }
              <div class="enterprise-form-actions">
                ${probeButton} ${syncButton} ${identityButton}
              </div>
              <p class="enterprise-channel-workspace__hint">${orderHint}</p>
            `
      }
    </section>
  `;
}

export function renderEnterpriseMessageChannelsSurface(params: {
  host: object;
  props: EnterpriseMessageChannelsSurfaceProps;
  requestUpdate?: () => void;
}): TemplateResult {
  const { host, props } = params;
  const requestUpdate = params.requestUpdate ?? defaultRequestUpdate;
  const state = getState(host, props);

  if (
    !state.loading &&
    !state.busyId &&
    !state.snapshot &&
    !state.error &&
    props.client &&
    props.tenantId
  ) {
    state.loading = true;
    void reload(host, props, false)
      .catch((error: unknown) => {
        state.loading = false;
        state.error = localizeEnterpriseGatewayThrown(error, "通道状态加载失败，请重试。");
      })
      .finally(() => {
        if (state.loading) {
          state.loading = false;
        }
        if (!state.snapshot && !state.error) {
          state.error = "通道状态加载失败，请重试。";
        }
        requestUpdate();
      });
  }

  const form = parseConfigRaw(state.configRaw);
  const skeleton = state.loading && !state.snapshot;
  const controlsDisabled = Boolean(state.busyId) || !props.client || !props.tenantId;

  const run = async (
    busyId: string,
    fn: () => Promise<void>,
    options?: { probeAfter?: boolean; skipSuccessNotice?: boolean; successNotice?: string },
  ) => {
    state.busyId = busyId;
    state.error = null;
    state.notice = null;
    requestUpdate();
    try {
      await fn();
      if (options?.probeAfter) {
        await reload(host, props, true);
      } else if (!busyId.startsWith("probe:")) {
        await reload(host, props, false);
      }
      if (state.error) {
        state.notice = null;
      } else if (options?.successNotice) {
        state.notice = options.successNotice;
      } else if (!options?.skipSuccessNotice) {
        state.notice = "操作成功";
      }
    } catch (error) {
      state.notice = null;
      state.error = localizeEnterpriseGatewayThrown(error, "操作失败，请重试。");
    } finally {
      state.busyId = null;
      requestUpdate();
    }
  };

  const openWorkspace = (channelId: EnterpriseMessageChannelId) => {
    if (!props.client || !props.tenantId) {
      state.notice = null;
      state.error = "需要企业登录上下文";
      requestUpdate();
      return;
    }
    if (!state.configRaw) {
      state.notice = null;
      state.error = null;
      void reload(host, props, false).then(() => {
        if (!state.configRaw) {
          state.notice = null;
          state.error = "配置尚未加载，请重试。";
          requestUpdate();
          return;
        }
        openWorkspace(channelId);
      });
      return;
    }
    const baseRaw = state.editorBaseRaw ?? state.configRaw;
    state.selectedChannelId = channelId;
    state.workspaceOpen = true;
    state.editorBaseRaw = baseRaw;
    state.configRaw = ensureChannelAccountEntry(baseRaw, channelId, props.tenantId);
    // Opening materializes a local account shell for Callback URL preview; not dirty until edited.
    state.configDirty = false;
    state.error = null;
    state.notice = null;
    requestUpdate();
  };

  return html`
    <section class="enterprise-settings-section enterprise-settings-section--flat enterprise-message-channels">
      <header class="enterprise-settings-section__header">
        <div>
          <div class="enterprise-settings-section__title">企业通道</div>
          <div class="enterprise-settings-section__subtitle">
            企业微信 / 飞书 / 钉钉 IM 通道接入与凭证配置
          </div>
        </div>
        <div class="enterprise-settings-actionbar">
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${controlsDisabled}
            @click=${() => void run("refresh", async () => undefined, { successNotice: "已刷新" })}
          >
            ${renderIcon("refreshCw")} ${state.loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

      ${
        state.error && !state.workspaceOpen
          ? html`<div class="enterprise-channel-workspace__result enterprise-channel-workspace__result--danger">${state.error}</div>`
          : nothing
      }
      ${
        state.notice && !state.workspaceOpen
          ? html`<div class="enterprise-channel-workspace__result enterprise-channel-workspace__result--ok">${state.notice}</div>`
          : nothing
      }

      <div class="enterprise-channel-gallery" role="list">
        ${ENTERPRISE_MESSAGE_CHANNELS.map((channelId) => {
          const present = channelPresentInForm(form, channelId);
          const channelEntry = asRecord(asRecord(form.channels)?.[channelId]);
          const accountId = props.tenantId
            ? resolveEnterpriseImPrimaryAccountId(
                asRecord(channelEntry?.accounts) ?? {},
                props.tenantId,
              )
            : undefined;
          const status = resolveCardStatus({
            present,
            form,
            channelId,
            accountId,
            lastProbe: state.lastProbeByChannel[channelId],
          });
          const accountCount = countChannelAccounts(form, channelId, state.snapshot);
          const enabled = isChannelEnabled(form, channelId, state.snapshot);
          const capability =
            channelId === "feishu"
              ? feishuCardContract({ form, accountId, snapshot: state.snapshot })
              : null;
          return renderGalleryCard({
            channelId,
            status,
            summary: resolveCardSummary({ status, accountCount, enabled }),
            fault: channelFaultMessage(state.snapshot, channelId),
            capabilityLine: capability
              ? formatFeishuEmployeeUiHint(capability.employeeUiHint)
              : null,
            selected: state.workspaceOpen && state.selectedChannelId === channelId,
            skeleton,
            disabled: controlsDisabled && !skeleton,
            onActivate: () => openWorkspace(channelId),
          });
        })}
      </div>

      ${
        state.workspaceOpen && state.selectedChannelId
          ? renderWorkspace({
              props,
              state,
              channelId: state.selectedChannelId,
              form,
              enabled: isChannelEnabled(form, state.selectedChannelId, state.snapshot),
              requestUpdate,
              run,
            })
          : html`
              <p class="enterprise-channel-workspace-empty">点击上方通道卡片开始接入</p>
            `
      }
    </section>
  `;
}
