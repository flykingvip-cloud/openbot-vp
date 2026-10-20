import { html, nothing } from "lit";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { shouldProceed } from "./enterprise-surface-shared.ts";
import { requestEnterpriseAppRerender } from "./enterprise-surface-shared.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

const DISCONNECTED_TITLE = "网关未连接，不能启用双因素或下线登录会话。";

type LoginSessionRow = {
  sessionId: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

type MfaResult = {
  ok?: boolean;
  enabled?: boolean;
  reason?: string;
  otpAuthUrl?: string;
  recoveryCodes?: string[];
};

type RevokeResult = {
  ok?: boolean;
  revoked?: string[];
  reason?: string;
};

type PanelState = {
  busy: boolean;
  mfaFailure: string | null;
  mfaNotice: string | null;
  otpAuthUrl: string | null;
  recoveryCodes: string[];
  code: string;
  sessions: LoginSessionRow[] | null;
  sessionsFailure: string | null;
  sessionsNotice: string | null;
};

function emptyPanel(): PanelState {
  return {
    busy: false,
    mfaFailure: null,
    mfaNotice: null,
    otpAuthUrl: null,
    recoveryCodes: [],
    code: "",
    sessions: null,
    sessionsFailure: null,
    sessionsNotice: null,
  };
}

const panel = emptyPanel();

export function resetEnterpriseSecurityPanelStateForTests(): void {
  Object.assign(panel, emptyPanel());
}

function newIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function reasonText(reason: string | undefined, fallback: string): string {
  switch (reason) {
    case "already_enabled":
      return "双因素已经启用。";
    case "code_invalid":
      return "验证码不正确。";
    case "enrollment_expired":
      return "注册已过期，请重新开始。";
    case "idempotency_conflict":
      return "重复提交的内容不一致，没有写入。";
    case "current_session_protected":
      return "不能下线当前登录，本次没有改动会话。";
    case "session_not_found":
      return "会话不存在或不属于当前企业，没有下线。";
    default:
      return fallback;
  }
}

async function callGateway<T>(
  client: GatewayBrowserClient,
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; body: T } | { ok: false; message: string }> {
  try {
    const body = await client.request<T>(method, params);
    return { ok: true, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求失败。";
    return { ok: false, message };
  }
}

function rerender(): void {
  requestEnterpriseAppRerender();
}

async function startMfa(client: GatewayBrowserClient): Promise<void> {
  panel.busy = true;
  panel.mfaFailure = null;
  panel.mfaNotice = null;
  rerender();
  const result = await callGateway<MfaResult>(client, "enterprise.security.mfa.enroll", {
    action: "start",
    idempotencyKey: newIdempotencyKey(),
  });
  panel.busy = false;
  if (!result.ok) {
    panel.mfaFailure = result.message;
    rerender();
    return;
  }
  if (result.body.ok !== true) {
    panel.otpAuthUrl = null;
    panel.recoveryCodes = [];
    panel.mfaFailure = reasonText(result.body.reason, "没有开始双因素注册。");
    rerender();
    return;
  }
  panel.otpAuthUrl = result.body.otpAuthUrl ?? null;
  panel.recoveryCodes = result.body.recoveryCodes ?? [];
  panel.mfaNotice = "验证码确认前，登录还不会要求双因素。";
  rerender();
}

async function confirmMfa(client: GatewayBrowserClient): Promise<void> {
  const code = panel.code.trim();
  if (!code) {
    panel.mfaFailure = "请先输入验证码。";
    rerender();
    return;
  }
  panel.busy = true;
  panel.mfaFailure = null;
  rerender();
  const result = await callGateway<MfaResult>(client, "enterprise.security.mfa.enroll", {
    action: "confirm",
    code,
    idempotencyKey: newIdempotencyKey(),
  });
  panel.busy = false;
  if (!result.ok) {
    panel.mfaFailure = result.message;
    rerender();
    return;
  }
  if (result.body.ok !== true || result.body.enabled !== true) {
    panel.mfaFailure = reasonText(result.body.reason, "双因素没有启用。");
    rerender();
    return;
  }
  panel.otpAuthUrl = null;
  panel.recoveryCodes = [];
  panel.code = "";
  panel.mfaNotice = "双因素已启用。下次登录需要验证码。";
  rerender();
}

async function loadSessions(
  client: GatewayBrowserClient,
  options?: { keepNotice?: boolean },
): Promise<void> {
  panel.busy = true;
  panel.sessionsFailure = null;
  if (!options?.keepNotice) {
    panel.sessionsNotice = null;
  }
  rerender();
  const result = await callGateway<{ sessions?: LoginSessionRow[] }>(
    client,
    "enterprise.security.sessions.list",
    { limit: 50 },
  );
  panel.busy = false;
  if (!result.ok || !Array.isArray(result.body.sessions)) {
    panel.sessions = null;
    panel.sessionsFailure = result.ok ? "没有返回登录会话。" : result.message;
    rerender();
    return;
  }
  panel.sessions = result.body.sessions;
  if (!options?.keepNotice) {
    panel.sessionsNotice =
      result.body.sessions.length === 0 ? "当前企业没有可列出的登录会话。" : null;
  }
  rerender();
}

async function revokeOthers(client: GatewayBrowserClient): Promise<void> {
  if (!shouldProceed("确认下线除当前登录以外的企业登录会话？当前登录会保留。")) {
    return;
  }
  panel.busy = true;
  panel.sessionsFailure = null;
  panel.sessionsNotice = null;
  rerender();
  const result = await callGateway<RevokeResult>(client, "enterprise.security.sessions.revoke", {
    allExceptCurrent: true,
    idempotencyKey: newIdempotencyKey(),
  });
  panel.busy = false;
  if (!result.ok) {
    panel.sessionsFailure = result.message;
    rerender();
    return;
  }
  if (result.body.ok !== true) {
    panel.sessionsFailure = reasonText(result.body.reason, "没有下线会话。");
    rerender();
    return;
  }
  const count = result.body.revoked?.length ?? 0;
  panel.sessionsNotice =
    count === 0 ? "没有其他登录需要下线。" : `已下线 ${count} 个其他登录。当前登录保留。`;
  rerender();
  await loadSessions(client, { keepNotice: true });
}

function wiredButton(params: {
  label: string;
  tone?: "primary" | "danger";
  testId: string;
  enabled: boolean;
  title: string;
  onClick: () => void;
}) {
  const toneClass =
    params.tone === "danger" ? " btn--danger" : params.tone === "primary" ? " btn--primary" : "";
  return html`
    <button
      class="btn btn--sm${toneClass}"
      type="button"
      data-testid=${params.testId}
      ?disabled=${!params.enabled || panel.busy}
      title=${params.title}
      @click=${params.onClick}
    >
      ${params.label}
    </button>
  `;
}

export function renderEnterpriseSecurityControlRows(props: EnterpriseSurfaceProps) {
  const client = props.client ?? null;
  const connected = Boolean(client?.connected);
  const title = connected ? "" : DISCONNECTED_TITLE;
  return html`
    <li class="enterprise-settings-row">
      <div class="enterprise-settings-row__main">
        <div class="enterprise-settings-row__title">双因素认证 (2FA)</div>
        <div class="enterprise-settings-row__meta" data-testid="enterprise-security-mfa-status">
          ${
            panel.mfaFailure
              ? html`<span class="enterprise-settings-kv__error">${panel.mfaFailure}</span>`
              : panel.mfaNotice
                ? panel.mfaNotice
                : "只给当前登录用户注册。确认成功后，下次登录才要求验证码。"
          }
        </div>
        ${
          panel.otpAuthUrl
            ? html`
              <div class="enterprise-settings-row__meta" data-testid="enterprise-security-mfa-otp">
                ${panel.otpAuthUrl}
              </div>
            `
            : nothing
        }
        ${
          panel.recoveryCodes.length > 0
            ? html`
              <div
                class="enterprise-settings-row__meta"
                data-testid="enterprise-security-mfa-recovery"
              >
                恢复码：${panel.recoveryCodes.join(" ")}
              </div>
            `
            : nothing
        }
        ${
          panel.otpAuthUrl
            ? html`
              <div class="enterprise-settings-gap-sm">
                <input
                  data-testid="enterprise-security-mfa-code"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  .value=${panel.code}
                  @input=${(event: Event) => {
                    panel.code = (event.target as HTMLInputElement).value;
                  }}
                />
                ${wiredButton({
                  label: "确认",
                  tone: "primary",
                  testId: "enterprise-security-mfa-confirm",
                  enabled: connected,
                  title,
                  onClick: () => {
                    if (client) {
                      void confirmMfa(client);
                    }
                  },
                })}
              </div>
            `
            : nothing
        }
      </div>
      <div class="enterprise-settings-row__actions">
        ${wiredButton({
          label: "启用",
          tone: "primary",
          testId: "enterprise-security-mfa-start",
          enabled: connected,
          title,
          onClick: () => {
            if (client) {
              void startMfa(client);
            }
          },
        })}
      </div>
    </li>
    <li class="enterprise-settings-row">
      <div class="enterprise-settings-row__main">
        <div class="enterprise-settings-row__title">活动会话</div>
        <div class="enterprise-settings-row__meta" data-testid="enterprise-security-sessions-status">
          ${
            panel.sessionsFailure
              ? html`<span class="enterprise-settings-kv__error">${panel.sessionsFailure}</span>`
              : panel.sessionsNotice
                ? panel.sessionsNotice
                : "这里列出的是登录会话。全部下线会保留当前登录。"
          }
        </div>
        ${
          panel.sessions && panel.sessions.length > 0
            ? html`
              <ul data-testid="enterprise-security-sessions">
                ${panel.sessions.map(
                  (session) => html`
                    <li>
                      ${session.sessionId} · ${session.userId} · ${session.lastSeenAt}
                      ${session.current ? " · 当前" : ""}
                    </li>
                  `,
                )}
              </ul>
            `
            : nothing
        }
      </div>
      <div class="enterprise-settings-row__actions">
        ${wiredButton({
          label: "查看",
          testId: "enterprise-security-sessions-list",
          enabled: connected,
          title,
          onClick: () => {
            if (client) {
              void loadSessions(client);
            }
          },
        })}
        ${wiredButton({
          label: "全部下线",
          tone: "danger",
          testId: "enterprise-security-sessions-revoke",
          enabled: connected,
          title,
          onClick: () => {
            if (client) {
              void revokeOthers(client);
            }
          },
        })}
      </div>
    </li>
  `;
}
