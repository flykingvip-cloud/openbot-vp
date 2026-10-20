import { html, nothing } from "lit";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { requestEnterpriseAppRerender } from "./enterprise-surface-shared.ts";

const DISCONNECTED = "网关未连接，这次不会写入。";

type Notice = { tone: "ok" | "danger"; text: string };

const state = {
  idleMinutes: "30",
  cidrs: "",
  budgetCents: "0",
  pauseReason: "",
  roleName: "",
  security: null as Notice | null,
  access: null as Notice | null,
  mesh: null as Notice | null,
  busy: false,
};

export function resetEnterprisePendingControlsForTests(): void {
  state.idleMinutes = "30";
  state.cidrs = "";
  state.budgetCents = "0";
  state.pauseReason = "";
  state.roleName = "";
  state.security = null;
  state.access = null;
  state.mesh = null;
  state.busy = false;
}

function idempotencyKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case "out_of_range":
      return "空闲超时超出 5 到 1440 分钟，没有写入。";
    case "cidr_invalid":
      return "地址格式不正确，没有写入。";
    case "would_lock_out_caller":
      return "这组地址不包含当前来源，没有写入，避免把当前管理员锁在外面。";
    case "range_too_wide":
      return "时间范围超过 31 天或事件过多，没有导出。";
    case "export_unavailable":
      return "审计导出不可用。";
    case "idempotency_conflict":
      return "重复提交的内容不一致，没有写入。";
    case "unknown_permission":
      return "只有 usage:budget 会改变网关鉴权。本次包含未接入的权限，没有写入。";
    case "name_taken":
      return "角色名已被占用，没有创建。";
    case "builtin_role_fixed":
      return "内置 viewer、operator、admin 不能改权限。";
    case "membership_role_fixed":
      return "企业管理员的权限不由这条提交改变。";
    case "unknown_target":
      return "找不到这个角色或成员，没有写入。";
    case "high_risk_confirmation_required":
      return "usage:budget 需要再次确认，没有写入。";
    case "asset_not_found":
      return "当前企业里找不到这个对象，没有写入。";
    case "tenant_mismatch":
      return "这个对象不属于当前企业，没有写入。";
    case "already_in_state":
      return "对象已经是这个状态，没有再次写入。";
    case "spend_not_metered":
      return "用量记录没有协作小组字段，按小组限额不会改变花费，没有写入。";
    default:
      return "没有写入。";
  }
}

async function callControl(
  client: GatewayBrowserClient,
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const body = await client.request<Record<string, unknown>>(method, params);
    return { ok: true, body };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "请求失败。" };
  }
}

function noticeFromBody(body: Record<string, unknown>, success: string): Notice {
  if (body.ok === true) {
    return { tone: "ok", text: success };
  }
  return {
    tone: "danger",
    text: reasonText(typeof body.reason === "string" ? body.reason : undefined),
  };
}

export function renderPendingSecurityNotice() {
  if (!state.security) {
    return nothing;
  }
  return html`<div class="enterprise-settings-empty" data-testid="enterprise-pending-security-notice"
    >${state.security.text}</div
  >`;
}

export function renderSessionPolicyControl(client: GatewayBrowserClient | null | undefined) {
  const connected = client?.connected === true;
  return html`
    <div class="enterprise-settings-row__actions">
      <input
        class="enterprise-settings-input"
        data-testid="enterprise-session-idle-minutes"
        type="number"
        min="5"
        max="1440"
        .value=${state.idleMinutes}
        ?disabled=${!connected || state.busy}
        @input=${(event: Event) => {
          state.idleMinutes = (event.target as HTMLInputElement).value;
        }}
      />
      <button
        class="btn btn--sm"
        type="button"
        ?disabled=${!connected || state.busy}
        title=${connected ? "写入空闲超时。到期的登录会话会被删除。" : DISCONNECTED}
        @click=${() => {
          if (!client?.connected) {
            return;
          }
          void (async () => {
            state.busy = true;
            state.security = null;
            requestEnterpriseAppRerender();
            const minutes = Number(state.idleMinutes);
            const result = await callControl(client, "enterprise.security.session-policy.set", {
              idleTimeoutMinutes: minutes,
              idempotencyKey: idempotencyKey(),
            });
            state.busy = false;
            state.security = result.ok
              ? noticeFromBody(
                  result.body,
                  `空闲超时已设为 ${String(result.body.idleTimeoutMinutes)} 分钟。`,
                )
              : { tone: "danger", text: result.message };
            requestEnterpriseAppRerender();
          })();
        }}
      >
        调整
      </button>
    </div>
  `;
}

export function renderIpAllowlistControl(client: GatewayBrowserClient | null | undefined) {
  const connected = client?.connected === true;
  return html`
    <div class="enterprise-settings-row__actions">
      <input
        class="enterprise-settings-input"
        data-testid="enterprise-ip-allowlist"
        type="text"
        placeholder="10.0.0.0/8"
        .value=${state.cidrs}
        ?disabled=${!connected || state.busy}
        @input=${(event: Event) => {
          state.cidrs = (event.target as HTMLInputElement).value;
        }}
      />
      <button
        class="btn btn--sm"
        type="button"
        ?disabled=${!connected || state.busy}
        title=${connected ? "写入 IP 白名单。登录、会话和网关请求使用同一来源地址。" : DISCONNECTED}
        @click=${() => {
          if (!client?.connected) {
            return;
          }
          void (async () => {
            state.busy = true;
            state.security = null;
            requestEnterpriseAppRerender();
            const cidrs = state.cidrs
              .split(/[\s,]+/)
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0);
            const result = await callControl(client, "enterprise.security.ip-allowlist.set", {
              cidrs,
              idempotencyKey: idempotencyKey(),
            });
            state.busy = false;
            state.security = result.ok
              ? noticeFromBody(result.body, "IP 白名单已写入，并在登录和会话校验时执行。")
              : { tone: "danger", text: result.message };
            requestEnterpriseAppRerender();
          })();
        }}
      >
        配置
      </button>
    </div>
  `;
}

export function renderAuditExportButton(
  client: GatewayBrowserClient | null | undefined,
  label: string,
) {
  const connected = client?.connected === true;
  return html`
    <button
      class="btn btn--sm"
      type="button"
      ?disabled=${!connected || state.busy}
      title=${connected ? "导出本企业安全审计。不会读取跨租户登录日志。" : DISCONNECTED}
      @click=${() => {
        if (!client?.connected) {
          return;
        }
        void (async () => {
          state.busy = true;
          state.security = null;
          requestEnterpriseAppRerender();
          const to = new Date();
          const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
          const result = await callControl(client, "enterprise.security.audit.export", {
            from: from.toISOString(),
            to: to.toISOString(),
            format: "json",
            idempotencyKey: idempotencyKey(),
          });
          state.busy = false;
          if (!result.ok) {
            state.security = { tone: "danger", text: result.message };
            requestEnterpriseAppRerender();
            return;
          }
          if (result.body.ok !== true || typeof result.body.downloadPath !== "string") {
            state.security = noticeFromBody(result.body, "");
            requestEnterpriseAppRerender();
            return;
          }
          try {
            const response = await fetch(result.body.downloadPath, { credentials: "include" });
            if (!response.ok) {
              state.security = { tone: "danger", text: "审计下载失败。" };
            } else {
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = "enterprise-audit.json";
              anchor.click();
              URL.revokeObjectURL(url);
              state.security = { tone: "ok", text: "已开始下载本企业审计。" };
            }
          } catch {
            state.security = { tone: "danger", text: "审计下载失败。" };
          }
          requestEnterpriseAppRerender();
        })();
      }}
    >
      ${label}
    </button>
  `;
}

export function accessCommitNotice() {
  return state.access;
}

export async function submitAccessPermissionCommit(params: {
  client: GatewayBrowserClient | null | undefined;
  targetKind: "role" | "member";
  targetKey: string;
  permissionIds: string[];
  confirmedHighRiskPermissionIds: string[];
}): Promise<void> {
  if (!params.client?.connected) {
    state.access = { tone: "danger", text: DISCONNECTED };
    requestEnterpriseAppRerender();
    return;
  }
  const unknown = params.permissionIds.filter((id) => id !== "usage:budget");
  if (unknown.length > 0) {
    state.access = {
      tone: "danger",
      text: "只有 usage:budget 会改变网关鉴权。本次包含未接入的权限，没有提交。",
    };
    requestEnterpriseAppRerender();
    return;
  }
  state.busy = true;
  state.access = null;
  requestEnterpriseAppRerender();
  const result = await callControl(params.client, "enterprise.access.permissions.commit", {
    targetKind: params.targetKind,
    targetKey: params.targetKey,
    permissionIds: params.permissionIds,
    confirmedHighRiskPermissionIds: params.confirmedHighRiskPermissionIds,
    idempotencyKey: idempotencyKey(),
  });
  state.busy = false;
  state.access = result.ok
    ? noticeFromBody(result.body, "权限已写入。非管理员的 usage:budget 会改变预算接口。")
    : { tone: "danger", text: result.message };
  requestEnterpriseAppRerender();
}

export function renderCreateRoleControl(client: GatewayBrowserClient | null | undefined) {
  const connected = client?.connected === true;
  if (!connected) {
    return html`
      <button
        class="btn btn--sm"
        type="button"
        disabled
        title="新建角色尚未接入。角色目录只在这台浏览器里，服务端没有可执行的自定义角色。当前只有 viewer、operator、admin。"
      >
        + 新建角色
      </button>
      <p class="enterprise-settings-row__meta">
        尚未接入。角色目录只在这台浏览器里。当前只有 viewer、operator、admin。
      </p>
    `;
  }
  return html`
    <input
      class="enterprise-settings-input"
      data-testid="enterprise-role-name"
      type="text"
      maxlength="64"
      placeholder="角色名"
      .value=${state.roleName}
      @input=${(event: Event) => {
        state.roleName = (event.target as HTMLInputElement).value;
      }}
    />
    <button
      class="btn btn--sm"
      type="button"
      ?disabled=${state.busy}
      title="创建服务端角色。目前只有 usage:budget 会被网关执行。"
      @click=${() => {
        if (!client?.connected) {
          return;
        }
        void (async () => {
          state.busy = true;
          state.access = null;
          requestEnterpriseAppRerender();
          const result = await callControl(client, "enterprise.access.roles.create", {
            name: state.roleName.trim(),
            permissionIds: ["usage:budget"],
            idempotencyKey: idempotencyKey(),
          });
          state.busy = false;
          state.access = result.ok
            ? noticeFromBody(
                result.body,
                `角色已写入${typeof result.body.roleId === "string" ? `（${result.body.roleId}）` : ""}。列表仍只展示内置三角色，把这个角色赋给成员后 usage:budget 才会生效。`,
              )
            : { tone: "danger", text: result.message };
          requestEnterpriseAppRerender();
        })();
      }}
    >
      + 新建角色
    </button>
    <p class="enterprise-settings-row__meta">服务端只执行 usage:budget。内置三角色保持不变。</p>
  `;
}

export function renderMeshAssetControls(params: {
  client: GatewayBrowserClient | null | undefined;
  assetType: "agent" | "group";
  assetId: string;
}) {
  const connected = params.client?.connected === true;
  const groupBudgetTitle = "用量记录没有协作小组字段，按小组限额不会改变花费。";
  return html`
    <div class="enterprise-mesh-governance-card">
      <span>${params.assetType === "agent" ? "限制这个机器人的月度预算" : "限制这个小组的月度预算"}</span>
      <p>
        ${
          params.assetType === "agent"
            ? "写入后，商业运行闸口按该机器人本账期花费拦截。这不是企业月度 budget.set。治理徽标仍由用量推算。"
            : groupBudgetTitle
        }
      </p>
      ${
        params.assetType === "agent"
          ? html`
            <input
              data-testid="enterprise-asset-budget-cents"
              type="number"
              min="0"
              .value=${state.budgetCents}
              ?disabled=${!connected || state.busy}
              @input=${(event: Event) => {
                state.budgetCents = (event.target as HTMLInputElement).value;
              }}
            />
            <button
              class="btn btn--sm"
              type="button"
              ?disabled=${!connected || state.busy}
              title=${connected ? "按机器人写入月度限额（分）。" : DISCONNECTED}
              @click=${() => {
                const client = params.client;
                if (!client?.connected) {
                  return;
                }
                void (async () => {
                  state.busy = true;
                  state.mesh = null;
                  requestEnterpriseAppRerender();
                  const result = await callControl(client, "enterprise.mesh.asset-budget.set", {
                    assetType: "agent",
                    assetId: params.assetId,
                    monthlyLimitCents: Number(state.budgetCents),
                    idempotencyKey: idempotencyKey(),
                  });
                  state.busy = false;
                  state.mesh = result.ok
                    ? noticeFromBody(
                        result.body,
                        "机器人月度限额已写入运行闸口。治理徽标不会因此改变。",
                      )
                    : { tone: "danger", text: result.message };
                  requestEnterpriseAppRerender();
                })();
              }}
            >
              写入限额
            </button>
          `
          : html`<button class="btn btn--sm" type="button" disabled title=${groupBudgetTitle}>
            写入限额
          </button>`
      }
    </div>
    <div class="enterprise-mesh-governance-card">
      <span>暂停或恢复运行</span>
      <p>暂停写入后，新的商业运行会被闸口拒绝。治理徽标仍由创建人和用量推算，不会因为这次写入改徽标。</p>
      <input
        data-testid="enterprise-asset-pause-reason"
        type="text"
        placeholder="原因"
        .value=${state.pauseReason}
        ?disabled=${!connected || state.busy}
        @input=${(event: Event) => {
          state.pauseReason = (event.target as HTMLInputElement).value;
        }}
      />
      <button
        class="btn btn--sm btn--danger"
        type="button"
        ?disabled=${!connected || state.busy}
        title=${connected ? "暂停该对象的新运行。" : DISCONNECTED}
        @click=${() => {
          void pauseAsset(params, "pause");
        }}
      >
        暂停运行
      </button>
      <button
        class="btn btn--sm"
        type="button"
        ?disabled=${!connected || state.busy}
        title=${connected ? "恢复该对象的新运行。" : DISCONNECTED}
        @click=${() => {
          void pauseAsset(params, "resume");
        }}
      >
        恢复运行
      </button>
    </div>
    ${
      state.mesh
        ? html`<div data-testid="enterprise-mesh-control-notice">${state.mesh.text}</div>`
        : nothing
    }
  `;
}

async function pauseAsset(
  params: {
    client: GatewayBrowserClient | null | undefined;
    assetType: "agent" | "group";
    assetId: string;
  },
  action: "pause" | "resume",
): Promise<void> {
  if (!params.client?.connected) {
    return;
  }
  state.busy = true;
  state.mesh = null;
  requestEnterpriseAppRerender();
  const result = await callControl(params.client, "enterprise.mesh.asset.pause", {
    assetType: params.assetType,
    assetId: params.assetId,
    action,
    reason: state.pauseReason.trim() || "enterprise mesh control",
    idempotencyKey: idempotencyKey(),
  });
  state.busy = false;
  state.mesh = result.ok
    ? noticeFromBody(
        result.body,
        action === "pause"
          ? "运行闸口已暂停该对象。治理徽标不会因此改变。"
          : "运行闸口已恢复该对象。治理徽标不会因此改变。",
      )
    : { tone: "danger", text: result.message };
  requestEnterpriseAppRerender();
}
