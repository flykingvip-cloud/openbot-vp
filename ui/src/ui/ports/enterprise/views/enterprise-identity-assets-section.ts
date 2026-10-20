import { html, nothing } from "lit";
import { renderIcon } from "../../../icons.ts";
import type { OperationalIdentityGovernancePanelProps } from "../../../views/operational-identity-governance-panel.ts";
import {
  filterPolicyActionsToVerified,
  suggestVerifiedPolicyActions,
} from "../semantic/enterprise-identity-policy-actions.ts";
import {
  resolveIdentityGovernanceStats,
  type EnterprisePortReadModel,
} from "../semantic/enterprise-read-model.ts";
import {
  renderEnterpriseIdentityCapabilityPanel,
  renderEnterpriseIdentityConfigChecklist,
} from "./enterprise-identity-provider-config-fields.ts";
import { renderIdentityRegisterProviderPicker } from "./enterprise-identity-register-provider-picker.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

type SettingsStat = {
  label: string;
  value: string;
  tone?: "warn" | "ok";
};

type IdentityDetailTab = "usage" | "policy" | "audit" | "security";

function renderCompactStats(stats: SettingsStat[]) {
  return html`
    <div class="enterprise-identity-compact-stats">
      ${stats.map(
        (stat) => html`
          <span class="enterprise-identity-compact-stat${stat.tone ? ` enterprise-identity-compact-stat--${stat.tone}` : ""}">
            ${stat.tone === "warn" ? "△ " : stat.tone === "ok" ? "● " : ""}${stat.label} ${stat.value}
          </span>
        `,
      )}
    </div>
  `;
}

function renderIdentityVerifyActions(params: {
  tenantId: string;
  identityId: string;
  readModel: EnterprisePortReadModel;
  onVerifyIdentity: (tenantId: string, identityId: string) => unknown;
}) {
  const verify = params.readModel.identityVerify;
  const scoped = Boolean(
    verify && verify.identityId === params.identityId && verify.phase !== "idle",
  );
  const verifying = scoped && verify?.phase === "running";
  return html`
    <button
      class="btn btn--sm btn--primary"
      type="button"
      data-identity-verify=${params.identityId}
      ?disabled=${params.readModel.operationalIdentityBusy}
      @click=${(event: Event) => {
        event.stopPropagation();
        void params.onVerifyIdentity(params.tenantId, params.identityId);
      }}
    >
      ${verifying ? "测试中…" : "测试连接"}
    </button>
    ${
      scoped && verify
        ? html`<span
            class="enterprise-identity-verify-status enterprise-identity-verify-status--${verify.phase}"
            role="status"
            aria-live="polite"
            data-identity-verify-status=${params.identityId}
          >
            ${verify.message}
          </span>`
        : nothing
    }
  `;
}

function renderIdentityStatusBadge(status: "active" | "expired" | "reauth_required") {
  const label = status === "active" ? "正常" : status === "reauth_required" ? "需重授权" : "已过期";
  const tone = status === "active" ? "ok" : status === "reauth_required" ? "warn" : "danger";
  return html`
    <span
      class="enterprise-access-tag enterprise-access-tag--${tone === "danger" ? "danger" : tone === "warn" ? "warn" : "neutral"}"
    >
      ${label}
    </span>
  `;
}

function formatIsoDateTime(value: string | undefined): string {
  if (!value?.trim()) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function formatRelativeZh(value: string | undefined): string {
  if (!value?.trim()) {
    return "暂无记录";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const diffMs = Date.now() - parsed.getTime();
  if (diffMs < 60_000) {
    return "刚刚";
  }
  if (diffMs < 3_600_000) {
    return `${Math.floor(diffMs / 60_000)} 分钟前`;
  }
  if (diffMs < 86_400_000) {
    return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  }
  return formatIsoDateTime(value);
}

/** Usage time only — never fall back to updatedAt (avoids false "刚刚"). */
function formatIdentityLastUsed(lastUsedAt: string | undefined): string {
  return formatRelativeZh(lastUsedAt);
}

function identitySupportsCredentialEdit(
  provider: string,
  catalog: EnterprisePortReadModel["identityProviderCatalog"],
): boolean {
  const entry = catalog.find((item) => item.provider === provider);
  const methods = entry?.registrationProfile?.methods ?? [];
  return methods.includes("manual") || methods.includes("oauth");
}

function identityCanConfigureOpenScope(
  provider: string,
  catalog: EnterprisePortReadModel["identityProviderCatalog"],
): boolean {
  const entry = catalog.find((item) => item.provider === provider);
  return Boolean(entry && (entry.operationalActions?.length ?? 0) > 0);
}

function isCatalogProvider(
  provider: string,
  catalog: EnterprisePortReadModel["identityProviderCatalog"],
): boolean {
  return catalog.some((entry) => entry.provider === provider);
}

type IdentityAsset = EnterprisePortReadModel["identityAssetSummaries"][number];

function countIdentityBindings(asset: IdentityAsset): { employees: number; agents: number } {
  const groups = asset.employeeAgentBindings ?? [];
  return {
    employees: groups.length,
    agents:
      groups.reduce((count, group) => count + group.agents.length, 0) || asset.agentLabels.length,
  };
}

type IdentitySetupProgress = {
  connectionVerified: boolean;
  policyConfigured: boolean;
  readyForAgents: boolean;
  complete: boolean;
};

function resolveIdentitySetupProgress(asset: IdentityAsset): IdentitySetupProgress {
  const connectionVerified = Boolean(asset.lastVerifiedAt?.trim() || asset.agentReady);
  const policyConfigured = asset.policyCount > 0;
  const readyForAgents = policyConfigured && (asset.inUse || asset.allowedActionLabels.length > 0);
  return {
    connectionVerified,
    policyConfigured,
    readyForAgents,
    complete: connectionVerified && policyConfigured && readyForAgents,
  };
}

function suggestPolicyEditorPrefill(
  asset: IdentityAsset,
  readModel: EnterprisePortReadModel,
): { seatIds: string[]; allowedAgentIds: string[]; allowedActions: string[] } {
  const catalogEntry = readModel.identityProviderCatalog.find(
    (entry) => entry.provider === asset.provider,
  );
  let allowedActions = suggestVerifiedPolicyActions({
    readModel,
    identityId: asset.identityId,
    provider: asset.provider,
  });
  if (allowedActions.length === 0) {
    allowedActions = (catalogEntry?.operationalActions ?? [])
      .slice(0, 4)
      .map((entry) => entry.action);
  }
  const identityMeta = readModel.identitySummaries.find(
    (entry) => entry.identityId === asset.identityId,
  );

  let seatIds: string[] = [];
  if (identityMeta?.steward?.kind === "seat") {
    seatIds = [identityMeta.steward.ownerId];
  } else {
    const stewardSeat = readModel.seatSummaries.find(
      (seat) =>
        seat.status === "occupied" &&
        (seat.currentEmployeeLabel === asset.stewardLabel || seat.title === asset.stewardLabel),
    );
    if (stewardSeat) {
      seatIds = [stewardSeat.seatId];
    } else {
      seatIds = readModel.seatSummaries
        .filter((seat) => seat.status === "occupied")
        .slice(0, 1)
        .map((seat) => seat.seatId);
    }
  }

  let allowedAgentIds: string[] = [];
  return { seatIds, allowedAgentIds, allowedActions };
}

type IdentityPolicySummary = EnterprisePortReadModel["identityPolicySummaries"][number];

function openPolicyEditor(
  tenantId: string,
  asset: IdentityAsset,
  readModel: EnterprisePortReadModel,
  onOpen: EnterpriseSurfaceProps["actions"]["settings"]["onOpenIdentityEditor"],
  options?: { existingPolicies?: IdentityPolicySummary[] },
) {
  const existingPolicy = options?.existingPolicies?.[0];
  if (existingPolicy) {
    onOpen(tenantId, {
      mode: "policy",
      identityId: asset.identityId,
      policyId: existingPolicy.policyId,
      seatIds: existingPolicy.seatIds,
      allowedAgentIds: existingPolicy.allowedAgentIds,
      allowedActions: filterPolicyActionsToVerified({
        readModel,
        identityId: asset.identityId,
        actions: existingPolicy.allowedActions,
      }),
    });
    return;
  }
  const prefill = suggestPolicyEditorPrefill(asset, readModel);
  onOpen(tenantId, {
    mode: "policy",
    identityId: asset.identityId,
    ...(prefill.seatIds.length ? { seatIds: prefill.seatIds } : {}),
    ...(prefill.allowedAgentIds.length ? { allowedAgentIds: prefill.allowedAgentIds } : {}),
    ...(prefill.allowedActions.length ? { allowedActions: prefill.allowedActions } : {}),
  });
}

function renderIdentitySetupGuide(params: {
  asset: IdentityAsset;
  progress: IdentitySetupProgress;
  tenantId: string | null;
  busy: boolean;
  readModel: EnterprisePortReadModel;
  editor: EnterpriseSurfaceProps["identityManagementEditor"];
  onOpenPolicy: () => void;
  onVerify: () => void;
  onGoSecurityTab: () => void;
}) {
  const { asset, progress, tenantId, busy, readModel } = params;
  if (progress.complete) {
    return nothing;
  }
  const catalogEntry = readModel.identityProviderCatalog.find(
    (entry) => entry.provider === asset.provider,
  );
  const actionPreview = (catalogEntry?.operationalActions ?? [])
    .slice(0, 3)
    .map((entry) => entry.label)
    .join("、");

  return html`
    <div class="enterprise-identity-setup-guide" role="note">
      <div class="enterprise-identity-setup-guide__title">完成治理配置后即可供机器人调用</div>
      <ol class="enterprise-identity-setup-guide__steps">
        <li
          class="enterprise-identity-setup-guide__step${progress.connectionVerified ? " is-done" : ""}"
        >
          <span class="enterprise-identity-setup-guide__marker">${progress.connectionVerified ? "✓" : "1"}</span>
          <span>
            测试连接并确认凭证有效
            ${
              progress.connectionVerified
                ? html` · ${asset.lastVerifiedAt ? formatRelativeZh(asset.lastVerifiedAt) : "已通过"}`
                : nothing
            }
          </span>
          ${
            !progress.connectionVerified && tenantId
              ? html`<button
                  class="btn btn--sm"
                  type="button"
                  ?disabled=${busy}
                  @click=${params.onVerify}
                >
                  测试连接
                </button>`
              : nothing
          }
        </li>
        <li
          class="enterprise-identity-setup-guide__step${progress.policyConfigured ? " is-done" : ""}"
        >
          <span class="enterprise-identity-setup-guide__marker">${progress.policyConfigured ? "✓" : "2"}</span>
          <span>
            开放给岗位（岗位 + 动作）
            ${
              actionPreview && !progress.policyConfigured
                ? html` · 建议开放：${actionPreview}${(catalogEntry?.operationalActions.length ?? 0) > 3 ? " 等" : ""}`
                : nothing
            }
          </span>
          ${
            !progress.policyConfigured &&
            tenantId &&
            identityCanConfigureOpenScope(asset.provider, readModel.identityProviderCatalog)
              ? html`<button
                  class="btn btn--sm btn--primary"
                  type="button"
                  @click=${params.onOpenPolicy}
                >
                  管理开放范围
                </button>`
              : !progress.policyConfigured
                ? html`
                    <span class="enterprise-identity-setup-guide__hint">此账号已移出目录，不再开放新岗位。</span>
                  `
                : nothing
          }
        </li>
        <li
          class="enterprise-identity-setup-guide__step${progress.readyForAgents ? " is-done" : ""}"
        >
          <span class="enterprise-identity-setup-guide__marker">${progress.readyForAgents ? "✓" : "3"}</span>
          <span>员工在个人设置 → 授权 → 企业 绑定机器人</span>
          ${
            progress.policyConfigured && !progress.readyForAgents
              ? html`
                  <span class="enterprise-identity-setup-guide__hint">开放后由员工自行绑定，企业页只读结果。</span>
                `
              : nothing
          }
        </li>
      </ol>
      ${
        !progress.connectionVerified
          ? html`<button
              class="btn btn--sm btn--ghost enterprise-identity-setup-guide__link"
              type="button"
              ?disabled=${busy}
              @click=${params.onGoSecurityTab}
            >
              查看安全状态与配置清单 →
            </button>`
          : nothing
      }
    </div>
  `;
}

function renderDetailTabs(params: {
  active: IdentityDetailTab;
  onChange: (tab: IdentityDetailTab) => void;
}) {
  const tabs: Array<{ id: IdentityDetailTab; label: string }> = [
    { id: "usage", label: "配置" },
    { id: "security", label: "状态" },
  ];
  return html`
    <div class="enterprise-identity-detail__tabs" role="tablist">
      ${tabs.map((tab) => {
        const active =
          tab.id === "security"
            ? params.active === "audit" || params.active === "security"
            : params.active === "usage" || params.active === "policy";
        return html`
          <button
            class="enterprise-identity-detail__tab${active ? " is-active" : ""}"
            type="button"
            role="tab"
            aria-selected=${active ? "true" : "false"}
            @click=${() => params.onChange(tab.id)}
          >
            ${tab.label}
          </button>
        `;
      })}
    </div>
  `;
}

function renderEmployeeAgentBindings(
  asset: EnterprisePortReadModel["identityAssetSummaries"][number],
) {
  const groups = asset.employeeAgentBindings ?? [];
  if (groups.length === 0) {
    if (asset.agentLabels.length === 0) {
      return html`
        <div class="enterprise-settings-empty">暂无员工绑定。</div>
      `;
    }
    return html`<ul class="enterprise-identity-detail__list">
      ${asset.agentLabels.map((label) => html`<li>${label}</li>`)}
    </ul>`;
  }
  return html`
    <div class="enterprise-identity-detail__employee-bindings">
      ${groups.map(
        (group) => html`
          <div class="enterprise-identity-detail__employee-group">
            <div class="enterprise-identity-detail__employee-name">${group.employeeLabel}</div>
            <ul class="enterprise-identity-detail__agent-list">
              ${group.agents.map((agent) => html`<li>${agent.agentLabel}</li>`)}
            </ul>
          </div>
        `,
      )}
    </div>
  `;
}

function renderIdentityDetailPanel(params: {
  props: EnterpriseSurfaceProps;
  tenantId: string | null;
  asset: EnterprisePortReadModel["identityAssetSummaries"][number] | null;
  tab: IdentityDetailTab;
  onTabChange: (tab: IdentityDetailTab) => void;
  governancePanel?: OperationalIdentityGovernancePanelProps;
}) {
  const { props, tenantId, asset, tab, onTabChange, governancePanel } = params;
  const readModel = props.readModel;
  const editor = props.identityManagementEditor;
  if (!asset) {
    return html`
      <div class="enterprise-identity-detail enterprise-identity-detail--empty">
        <div class="enterprise-settings-empty">
          ${
            readModel.identityAssetSummaries.length === 0
              ? "尚未连接任何企业身份。点击上方「连接身份」开始添加。"
              : "从左侧选择已连接的账号，在右侧查看开放范围与员工绑定。"
          }
        </div>
      </div>
    `;
  }

  const policies = readModel.identityPolicySummaries.filter(
    (policy) => policy.identityId === asset.identityId && policy.enabled,
  );
  const dataSourceBindings = readModel.identityDataSourceBindings.filter(
    (binding) => binding.identityId === asset.identityId,
  );
  const lifecycleEvents =
    governancePanel?.overview?.recentLifecycle.filter(
      (event) => event.identityId === asset.identityId,
    ) ?? [];
  const usageEvents =
    governancePanel?.overview?.recentUsage.filter(
      (event) => event.identityId === asset.identityId,
    ) ?? [];
  const setupProgress = resolveIdentitySetupProgress(asset);
  const canConfigureOpenScope = identityCanConfigureOpenScope(
    asset.provider,
    readModel.identityProviderCatalog,
  );
  const openPolicyManager = () => {
    if (!tenantId || !canConfigureOpenScope) {
      return;
    }
    openPolicyEditor(tenantId, asset, readModel, props.actions.settings.onOpenIdentityEditor, {
      existingPolicies: policies,
    });
  };

  const leftover = !isCatalogProvider(asset.provider, readModel.identityProviderCatalog);
  const bindings = countIdentityBindings(asset);
  const showStatus = tab === "audit" || tab === "security";
  const catalogEntry = readModel.identityProviderCatalog.find(
    (entry) => entry.provider === asset.provider,
  );
  const actionLabels = new Map(
    (catalogEntry?.operationalActions ?? []).map((entry) => [entry.action, entry.label]),
  );

  const configBody = html`
    ${
      !setupProgress.complete
        ? renderIdentitySetupGuide({
            asset,
            progress: setupProgress,
            tenantId,
            busy: readModel.operationalIdentityBusy,
            readModel,
            editor,
            onOpenPolicy: openPolicyManager,
            onVerify: () => editor.onVerifyIdentity(asset.identityId),
            onGoSecurityTab: () => onTabChange("security"),
          })
        : nothing
    }
    <div class="enterprise-identity-detail__section">
      <div class="enterprise-identity-detail__section-title">开放岗位</div>
      ${
        asset.seatTitles.length > 0
          ? html`<ul class="enterprise-identity-detail__list">
              ${asset.seatTitles.map((title) => html`<li>${title}</li>`)}
            </ul>`
          : html`
              <div class="enterprise-settings-empty">尚未开放给任何岗位。</div>
            `
      }
    </div>
    <div class="enterprise-identity-detail__section">
      <div class="enterprise-identity-detail__section-title">开放动作</div>
      ${
        asset.allowedActionLabels.length > 0
          ? html`<ul class="enterprise-identity-detail__list">
              ${asset.allowedActionLabels.map((label) => html`<li>${label}</li>`)}
            </ul>`
          : html`
              <div class="enterprise-settings-empty">尚未开放可用动作。</div>
            `
      }
    </div>
    <div class="enterprise-identity-detail__section">
      <div class="enterprise-identity-detail__section-title">员工绑定</div>
      ${renderEmployeeAgentBindings(asset)}
    </div>
    ${
      dataSourceBindings.length > 0
        ? html`<div class="enterprise-identity-detail__section">
            <div class="enterprise-identity-detail__section-title">数据源连接</div>
            <ul class="enterprise-identity-detail__list">
              ${dataSourceBindings.map((binding) => html`<li>${binding.dataSourceId}</li>`)}
            </ul>
          </div>`
        : nothing
    }
  `;

  const statusBody = html`
    <div class="enterprise-identity-detail__section">
      <div class="enterprise-identity-detail__section-title">生命周期</div>
      ${
        lifecycleEvents.length > 0
          ? html`<ul class="enterprise-settings-row-list">
              ${lifecycleEvents.map(
                (event) => html`
                  <li class="enterprise-settings-row">
                    <div>
                      <strong>${event.action === "created" ? "连接" : event.action === "reauthorized" ? "重授权" : "停用"}</strong>
                      <span>${formatIsoDateTime(event.createdAt)}</span>
                    </div>
                  </li>
                `,
              )}
            </ul>`
          : html`
              <div class="enterprise-settings-empty">暂无审计记录。</div>
            `
      }
    </div>
    <div class="enterprise-identity-detail__section">
      <div class="enterprise-identity-detail__section-title">最近调用</div>
      ${
        usageEvents.length > 0
          ? html`<ul class="enterprise-settings-row-list">
              ${usageEvents.slice(0, 8).map(
                (event) => html`
                  <li class="enterprise-settings-row">
                    <div>
                      <strong>${event.action}</strong>
                      <span>${event.result} · ${formatRelativeZh(event.createdAt)}</span>
                    </div>
                  </li>
                `,
              )}
            </ul>`
          : html`
              <div class="enterprise-settings-empty">暂无调用记录。</div>
            `
      }
    </div>
    ${renderEnterpriseIdentityConfigChecklist({
      profile: catalogEntry?.registrationProfile ?? null,
      externalAccountId: asset.externalAccountId,
      readinessItems: asset.configReadiness?.items,
      probedAt: asset.configReadiness?.probedAt
        ? formatRelativeZh(asset.configReadiness.probedAt)
        : undefined,
    })}
    ${renderEnterpriseIdentityCapabilityPanel({
      capabilities: asset.capabilities,
      capabilityMissing: asset.capabilityMissing,
      capabilityDetails: asset.capabilityDetails,
      actionLabels,
      providerMetadata: asset.providerMetadata,
      discoveredAt: asset.capabilityDiscoveredAt
        ? formatRelativeZh(asset.capabilityDiscoveredAt)
        : undefined,
    })}
    <dl class="enterprise-identity-detail__kv">
      <div>
        <dt>连接状态</dt>
        <dd>${asset.connectionStatusLabel ?? asset.statusLabel}</dd>
      </div>
      <div>
        <dt>最近验证</dt>
        <dd>${asset.lastVerifiedAt ? formatRelativeZh(asset.lastVerifiedAt) : "尚未测试"}</dd>
      </div>
      <div>
        <dt>过期时间</dt>
        <dd>${formatIsoDateTime(asset.expiresAt)}</dd>
      </div>
    </dl>
    ${
      tenantId && asset.status === "reauth_required"
        ? html`<div class="enterprise-settings-actionbar">
            <button
              class="btn btn--sm btn--primary"
              type="button"
              ?disabled=${readModel.operationalIdentityBusy}
              @click=${() => props.actions.settings.onReauthorizeIdentity(tenantId, asset.identityId)}
            >
              重新授权
            </button>
          </div>`
        : nothing
    }
  `;

  return html`
    <article class="enterprise-settings-panel enterprise-settings-panel--flat enterprise-identity-detail">
      <div class="enterprise-settings-panel__head">
        <div>
          <div class="enterprise-settings-panel__title">${asset.displayName}</div>
          <div class="enterprise-settings-panel__sub">
            ${leftover ? "已移出目录" : asset.providerLabel}
            ${
              asset.externalAccountId
                ? html` · <span class="mono">${asset.externalAccountId}</span>`
                : nothing
            }
          </div>
        </div>
        ${renderIdentityStatusBadge(asset.status)}
      </div>
      <dl class="enterprise-identity-detail__kv enterprise-identity-detail__kv--compact">
        <div>
          <dt>负责人</dt>
          <dd>${asset.stewardLabel}</dd>
        </div>
        <div>
          <dt>绑定</dt>
          <dd>${bindings.employees} 名员工 / ${bindings.agents} 个机器人</dd>
        </div>
        <div>
          <dt>最近使用</dt>
          <dd>${formatIdentityLastUsed(asset.lastUsedAt)}</dd>
        </div>
      </dl>
      ${
        tenantId
          ? html`<div class="enterprise-identity-detail__actions">
              ${
                readModel.operationalIdentityError &&
                !(
                  readModel.identityVerify?.identityId === asset.identityId &&
                  readModel.identityVerify.phase !== "idle"
                )
                  ? html`<div class="enterprise-settings-error">${readModel.operationalIdentityError}</div>`
                  : nothing
              }
              <div class="enterprise-identity-detail__actions-row">
                <div class="enterprise-identity-detail__actions-main">
                  ${renderIdentityVerifyActions({
                    tenantId,
                    identityId: asset.identityId,
                    readModel,
                    onVerifyIdentity: props.actions.settings.onVerifyIdentity,
                  })}
                  ${
                    identitySupportsCredentialEdit(
                      asset.provider,
                      readModel.identityProviderCatalog,
                    )
                      ? html`<button
                          class="btn btn--sm"
                          type="button"
                          ?disabled=${readModel.operationalIdentityBusy}
                          @click=${(event: Event) => {
                            event.stopPropagation();
                            const summary = readModel.identitySummaries.find(
                              (entry) => entry.identityId === asset.identityId,
                            );
                            const preview = summary?.credentialEditPreview;
                            const bindingId = summary?.credentialBindingId ?? "";
                            props.actions.settings.onOpenIdentityEditor(tenantId, {
                              mode: "credential",
                              identityId: asset.identityId,
                              provider: asset.provider,
                              displayName: asset.displayName,
                              credentialBindingId: bindingId,
                              credentialFields: {
                                ...preview?.fields,
                                ...(asset.externalAccountId
                                  ? { appId: asset.externalAccountId }
                                  : {}),
                                ...(summary?.externalAccountId && !preview?.fields?.appId
                                  ? { appId: summary.externalAccountId }
                                  : {}),
                              },
                              initialSecretsConfigured: preview?.secretsConfigured ?? [],
                            });
                          }}
                        >
                          编辑凭证
                        </button>`
                      : nothing
                  }
                  ${
                    canConfigureOpenScope
                      ? html`<button
                          class="btn btn--sm"
                          type="button"
                          @click=${(event: Event) => {
                            event.stopPropagation();
                            openPolicyManager();
                          }}
                        >
                          开放范围
                        </button>`
                      : nothing
                  }
                  <button
                    class="btn btn--sm"
                    type="button"
                    ?disabled=${readModel.operationalIdentityBusy}
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      props.actions.settings.onOpenIdentityEditor(tenantId, {
                        mode: "edit",
                        identityId: asset.identityId,
                        displayName: asset.displayName,
                      });
                    }}
                  >
                    重命名
                  </button>
                </div>
                <button
                  class="btn btn--sm btn--danger"
                  type="button"
                  data-identity-detail-delete=${asset.identityId}
                  ?disabled=${readModel.operationalIdentityBusy}
                  @click=${(event: Event) => {
                    event.stopPropagation();
                    props.actions.settings.onOpenIdentityRevokeConfirm(asset.identityId);
                  }}
                >
                  删除
                </button>
              </div>
            </div>`
          : nothing
      }
      ${renderDetailTabs({ active: tab, onChange: onTabChange })}
      <div class="enterprise-identity-detail__body">${showStatus ? statusBody : configBody}</div>
    </article>
  `;
}

function renderConfiguredIdentityNav(params: {
  assets: EnterprisePortReadModel["identityAssetSummaries"];
  selectedId: string;
  onSelect: (identityId: string) => void;
}) {
  return html`
    <nav class="enterprise-settings-panel enterprise-settings-panel--flat enterprise-identity-nav" aria-label="已连接身份">
      <div class="enterprise-identity-nav__title">已连接身份</div>
      <div class="enterprise-identity-nav__list">
        ${params.assets.map((asset) => {
          const selected = asset.identityId === params.selectedId;
          return html`
            <button
              class="enterprise-identity-nav__item${selected ? " is-selected" : ""}"
              type="button"
              aria-current=${selected ? "page" : nothing}
              @click=${() => params.onSelect(asset.identityId)}
            >
              <span class="enterprise-identity-nav__name">${asset.displayName}</span>
            </button>
          `;
        })}
      </div>
    </nav>
  `;
}

function renderConnectLanding(params: {
  catalog: EnterprisePortReadModel["identityProviderCatalog"];
  tenantId: string | null;
  busy: boolean;
  onSelectProvider: (provider: string, providerLabel: string) => void;
}) {
  return html`
    <article class="enterprise-settings-panel enterprise-settings-panel--flat" data-identity-connect-landing>
      <div class="enterprise-settings-panel__head">
        <div>
          <div class="enterprise-settings-panel__title">选择平台通道</div>
          <div class="enterprise-settings-panel__sub">
            先选平台，再填写凭证或完成该平台要求的授权。同一平台可连接多个账号。
          </div>
        </div>
      </div>
      ${
        params.tenantId
          ? renderIdentityRegisterProviderPicker({
              catalog: params.catalog,
              busy: params.busy,
              onSelect: (provider) => {
                const entry = params.catalog.find((item) => item.provider === provider);
                params.onSelectProvider(provider, entry?.label ?? provider);
              },
            })
          : html`
              <div class="enterprise-settings-empty">
                无法识别当前企业租户。请从企业控制台重新进入，或使用企业管理员账号登录后再试。
              </div>
            `
      }
    </article>
  `;
}

export function renderEnterpriseIdentityAssetsSection(params: {
  props: EnterpriseSurfaceProps;
  tenantId: string | null;
  renderIdentityManagementEditor: () => ReturnType<typeof html>;
  renderIdentityRevokeConfirmModal: () => ReturnType<typeof html>;
  omitChrome?: boolean;
  /** @deprecated Settings shell owns the tab title; ignored. */
  embedded?: boolean;
}) {
  const { props, tenantId } = params;
  const readModel = props.readModel;
  const editor = props.identityManagementEditor;
  const governanceStats = resolveIdentityGovernanceStats(readModel);
  const stats: SettingsStat[] = [
    { label: "身份总数", value: `${governanceStats.total}` },
    {
      label: "已连接",
      value: `${governanceStats.connected}`,
      tone: governanceStats.connected > 0 ? "ok" : undefined,
    },
    {
      label: "异常",
      value: `${governanceStats.atRisk}`,
      tone: governanceStats.atRisk > 0 ? "warn" : "ok",
    },
    { label: "使用中", value: `${governanceStats.inUse}` },
    { label: "未使用", value: `${governanceStats.unused}` },
    { label: "员工绑定", value: `${readModel.employeeIdentityBindingRows?.length ?? 0}` },
  ];

  const configuredAssets = readModel.identityAssetSummaries ?? [];
  const selectedId = editor.selectedDetailIdentityId?.trim() ?? "";
  const selectedAsset = configuredAssets.find((asset) => asset.identityId === selectedId) ?? null;
  const showConfiguredNav = configuredAssets.length > 0;
  const awaitingInitialIdentityLoad =
    Boolean(tenantId) &&
    !readModel.operationalIdentityLoaded &&
    !readModel.operationalIdentityError;
  const showIdentityLoading =
    Boolean(tenantId) &&
    (readModel.operationalIdentityBusy || awaitingInitialIdentityLoad) &&
    configuredAssets.length === 0 &&
    (readModel.identityProviderCatalog?.length ?? 0) === 0;

  const selectConfiguredIdentity = (identityId: string) => {
    editor.onSelectDetailIdentity(identityId);
    if (editor.open) {
      editor.onClose();
    }
  };

  const openRegister = (provider?: string, providerLabel?: string) => {
    if (!tenantId) {
      return;
    }
    props.actions.settings.onOpenIdentityEditor(tenantId, {
      mode: "register",
      ...(provider ? { provider, displayName: providerLabel ?? provider } : {}),
    });
  };

  const workspace = editor.open
    ? html`
        <div class="enterprise-identity-editor-pane" data-identity-editor-pane>
          ${params.renderIdentityManagementEditor()}
        </div>
      `
    : selectedAsset
      ? renderIdentityDetailPanel({
          props,
          tenantId,
          asset: selectedAsset,
          tab: editor.detailTab,
          onTabChange: editor.onDetailTabChange,
          governancePanel: props.operationalIdentityGovernancePanel,
        })
      : showIdentityLoading
        ? html`
            <div class="enterprise-settings-empty">正在加载…</div>
          `
        : renderConnectLanding({
            catalog: readModel.identityProviderCatalog ?? [],
            tenantId,
            busy: false,
            onSelectProvider: openRegister,
          });

  const body = html`
    ${
      readModel.operationalIdentityNotice && !params.omitChrome
        ? html`<div class="enterprise-settings-notice">${readModel.operationalIdentityNotice}</div>`
        : nothing
    }
    ${
      readModel.operationalIdentityError
        ? html`<div class="enterprise-settings-error">${readModel.operationalIdentityError}</div>`
        : nothing
    }
    ${
      readModel.identityAlerts.length > 0
        ? html`
            <div class="enterprise-identity-inline-alert">
              ${renderIcon("bell")}
              <span>需要关注 ${readModel.identityAlerts.length} 个身份</span>
              ${
                tenantId
                  ? html`<button
                      class="btn btn--sm"
                      type="button"
                      ?disabled=${readModel.operationalIdentityBusy}
                      @click=${() => {
                        const first = readModel.identityAlerts[0];
                        if (first) {
                          selectConfiguredIdentity(first.identityId);
                          editor.onDetailTabChange("security");
                        }
                      }}
                    >
                      查看
                    </button>`
                  : nothing
              }
            </div>
          `
        : nothing
    }
    <div
      class="enterprise-identity-layout${showConfiguredNav ? "" : " enterprise-identity-layout--solo"}"
    >
      ${
        showConfiguredNav
          ? renderConfiguredIdentityNav({
              assets: configuredAssets,
              selectedId,
              onSelect: selectConfiguredIdentity,
            })
          : nothing
      }
      ${workspace}
    </div>
    ${params.renderIdentityRevokeConfirmModal()}
  `;

  if (params.omitChrome) {
    return body;
  }

  return html`
    <section class="enterprise-settings-section enterprise-settings-section--flat">
      <header class="enterprise-settings-section__header enterprise-settings-section__header--actions">
        <div class="enterprise-settings-actionbar">
          ${
            tenantId
              ? html`<button
                  class="btn btn--sm btn--primary"
                  type="button"
                  @click=${() => openRegister()}
                >
                  ${renderIcon("plus")} 连接身份
                </button>`
              : nothing
          }
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${!tenantId || readModel.operationalIdentityBusy}
            @click=${() => tenantId && props.actions.settings.onRefreshIdentities(tenantId)}
          >
            ${renderIcon("refreshCw")} 同步
          </button>
        </div>
      </header>
      ${renderCompactStats(stats)}
      ${body}
    </section>
  `;
}
