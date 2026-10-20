import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import { formatRelativeTimestamp } from "../../../format.ts";
import {
  parseUserOperationalIdentityAddProvider,
  type UserOperationalIdentityNav,
} from "../semantic/view-controller-facade.ts";
import { renderProviderIdentityEditorForm } from "./workbench-operational-identity-forms.ts";
import { scopeOperationalIdentityUsageHistory } from "./workbench-operational-identity-shared.ts";
import { renderOperationalIdentityUsageRecords } from "./workbench-operational-identity-usage.ts";
import { sortReadyCatalog } from "./workbench-personal-authorization-catalog.ts";
import { renderIdentityRobotGrantCard } from "./workbench-personal-identity-robot-binding.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "—";
  }
  return formatRelativeTimestamp(parsed, { dateFallback: true, fallback: "—" });
}

function identityStatusLabel(status: string): { label: string; tone: "ok" | "warn" } {
  if (status === "active") {
    return { label: "已连接", tone: "ok" };
  }
  if (status === "expired") {
    return { label: "已过期", tone: "warn" };
  }
  if (status === "reauth_required") {
    return { label: "需重新认证", tone: "warn" };
  }
  return { label: "已停用", tone: "warn" };
}

function agentScopeLabel(scope: string): string {
  if (scope === "owned") {
    return "自有机器人";
  }
  if (scope === "group") {
    return "协作小组机器人";
  }
  return "共享机器人";
}

function grantScopeHint(scope: string): string {
  if (scope === "owned") {
    return "自有机器人可自动授权";
  }
  if (scope === "group") {
    return "协作小组机器人默认禁止，需手动批准";
  }
  return "共享机器人需二次确认";
}

function resolveActiveNav(settings: SettingsContract): UserOperationalIdentityNav {
  const nav = settings.userOperationalIdentityNav;
  if (nav === "grants") {
    return "bound";
  }
  if (nav) {
    return nav;
  }
  if (
    settings.userOperationalIdentityEditorOpen &&
    settings.userOperationalIdentityEditorProvider
  ) {
    return `add:${settings.userOperationalIdentityEditorProvider}`;
  }
  return "bound";
}

type OperationalIdentitySummary = NonNullable<
  SettingsContract["userOperationalIdentitySnapshot"]
>["identities"][number];

function findConfiguredIdentityForProvider(
  identities: OperationalIdentitySummary[],
  provider: string,
): OperationalIdentitySummary | null {
  const normalized = provider.trim();
  if (!normalized) {
    return null;
  }
  const candidates = identities.filter(
    (identity) =>
      identity.provider === normalized &&
      (identity.status === "active" ||
        identity.status === "reauth_required" ||
        identity.status === "expired"),
  );
  if (candidates.length === 0) {
    return null;
  }
  const rank = (status: OperationalIdentitySummary["status"]) =>
    status === "active" ? 0 : status === "reauth_required" ? 1 : 2;
  return [...candidates].toSorted((left, right) => {
    const statusDelta = rank(left.status) - rank(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  })[0];
}

function renderIdentityCredentialActions(
  settings: SettingsContract,
  identity: OperationalIdentitySummary,
  busy: boolean,
): TemplateResult {
  return html`
    <div class="employee-workbench__settings-password-actions">
      <button
        type="button"
        class="btn btn--sm btn--primary"
        ?disabled=${busy}
        @click=${() => settings.onOpenUserOperationalIdentityEditor?.(identity.provider)}
      >
        编辑配置
      </button>
      ${
        identity.provider === "wechat-official" || identity.provider === "personal-email"
          ? html`
              <button
                type="button"
                class="btn btn--sm"
                ?disabled=${busy}
                @click=${() =>
                  void settings.onVerifyUserOperationalIdentityCredentials?.(identity.identityId)}
              >
                验证凭证
              </button>
            `
          : nothing
      }
      <button
        type="button"
        class="btn btn--sm"
        ?disabled=${busy}
        @click=${() => void settings.onReauthorizeUserOperationalIdentity?.(identity.identityId)}
      >
        重新认证
      </button>
      <button
        type="button"
        class="btn btn--sm"
        ?disabled=${busy}
        @click=${() => void settings.onRevokeUserOperationalIdentity?.(identity.identityId)}
      >
        停用
      </button>
    </div>
  `;
}

function renderNotices(settings: SettingsContract, platformReady: boolean): TemplateResult {
  return html`
    ${
      !platformReady
        ? html`
            <div class="callout employee-workbench__settings-callout">登录平台账号后可绑定运营身份。</div>
          `
        : nothing
    }
    ${
      settings.userOperationalIdentityError
        ? html`<div class="callout callout--danger employee-workbench__settings-callout">${settings.userOperationalIdentityError}</div>`
        : nothing
    }
    ${
      settings.userOperationalIdentityNotice
        ? html`<div class="callout employee-workbench__settings-callout">${settings.userOperationalIdentityNotice}</div>`
        : nothing
    }
    ${
      settings.userOperationalIdentityContinuationNotice
        ? html`<div class="callout employee-workbench__settings-callout">${settings.userOperationalIdentityContinuationNotice}</div>`
        : nothing
    }
    ${
      settings.userOperationalIdentityReturnSessionKey
        ? html`
            <div class="callout employee-workbench__settings-callout">绑定完成后可返回原任务界面继续。</div>
          `
        : nothing
    }
  `;
}

export function renderOperationalIdentitySection(
  settings: SettingsContract,
  options?: { embedded?: boolean },
) {
  const embedded = Boolean(options?.embedded);
  const snapshot = settings.userOperationalIdentitySnapshot;
  const identities = snapshot?.identities ?? [];
  const catalog = snapshot?.providerCatalog ?? [];
  const readyCatalog = sortReadyCatalog(catalog.filter((entry) => entry.registrationReady));
  const activeNav = resolveActiveNav(settings);
  const addProvider = parseUserOperationalIdentityAddProvider(activeNav);
  const grants = snapshot?.grants ?? [];
  const usageHistory = snapshot?.usageHistory ?? [];
  const pendingRequests = snapshot?.pendingBindingRequests ?? [];
  const pendingContinuations = snapshot?.pendingContinuations ?? [];
  const busy = Boolean(settings.userOperationalIdentityBusy);
  const platformReady = Boolean(settings.platformAuthEnabled && settings.connected);
  const hubIdentity = addProvider
    ? findConfiguredIdentityForProvider(identities, addProvider)
    : null;
  const visibleUsageHistory = scopeOperationalIdentityUsageHistory(
    usageHistory,
    hubIdentity
      ? { identityId: hubIdentity.identityId, provider: hubIdentity.provider }
      : undefined,
  );
  const visiblePendingRequests = hubIdentity
    ? pendingRequests.filter((request) => request.provider === hubIdentity.provider)
    : pendingRequests;
  const visiblePendingContinuations = hubIdentity
    ? pendingContinuations.filter((continuation) => continuation.provider === hubIdentity.provider)
    : pendingContinuations;

  const activeGrants = grants.filter((grant) => grant.status === "active");
  const pendingReauths = identities.filter(
    (identity) => identity.status === "reauth_required" || identity.status === "expired",
  ).length;
  const authorizedAgents = new Set(activeGrants.map((grant) => grant.agentId)).size;

  const latestUsageByIdentity = new Map<string, string>();
  for (const event of usageHistory) {
    const current = latestUsageByIdentity.get(event.identityId);
    if (!current || Date.parse(event.createdAt) > Date.parse(current)) {
      latestUsageByIdentity.set(event.identityId, event.createdAt);
    }
  }
  const activeGrantCountByIdentity = new Map<string, number>();
  for (const grant of activeGrants) {
    activeGrantCountByIdentity.set(
      grant.identityId,
      (activeGrantCountByIdentity.get(grant.identityId) ?? 0) + 1,
    );
  }
  const identityById = new Map(identities.map((identity) => [identity.identityId, identity]));

  const expiryWindowMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const attentionIdentities = identities
    .map((identity) => {
      if (identity.status === "expired") {
        return { identity, reason: "已过期" };
      }
      if (identity.status === "reauth_required") {
        return { identity, reason: "需重新认证" };
      }
      if (identity.expiresAt) {
        const expiresAt = Date.parse(identity.expiresAt);
        if (!Number.isNaN(expiresAt) && expiresAt - now <= expiryWindowMs) {
          return {
            identity,
            reason:
              expiresAt < now ? "已过期" : `即将过期（${formatTimestamp(identity.expiresAt)}）`,
          };
        }
      }
      return null;
    })
    .filter((entry): entry is { identity: (typeof identities)[number]; reason: string } =>
      Boolean(entry),
    );

  const metricsLine = html`
    <div class="employee-workbench__auth-metrics">
      <span>身份 ${String(identities.length)}</span>
      <span>已授权数字人 ${String(authorizedAgents)}</span>
      <span>待续期 ${String(pendingReauths)}</span>
      <span>使用记录 ${String(visibleUsageHistory.length)}</span>
      <button
        type="button"
        class="btn btn--sm"
        ?disabled=${busy || !platformReady}
        @click=${() => void settings.onRefreshUserOperationalIdentities?.()}
      >
        ${busy ? "加载中…" : "刷新"}
      </button>
    </div>
  `;

  const boundPane = html`
    <div class="employee-workbench__auth-pane-head">
      <div class="employee-workbench__settings-section-title">已绑定账户</div>
      ${metricsLine}
    </div>
    <div class="employee-workbench__auth-config-callout">
      绑定后可在账号详情页把使用权授给旗下数字人。
    </div>
    ${
      attentionIdentities.length > 0
        ? html`
            <div class="employee-workbench__auth-attention">
              ${attentionIdentities.map(
                (entry) => html`
                  <div class="employee-workbench__settings-row">
                    <div>
                      <strong>${entry.identity.providerLabel} · ${entry.identity.displayName}</strong>
                      <span class="employee-workbench__settings-section-subtitle">
                        ${entry.reason}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="btn btn--sm btn--primary"
                      ?disabled=${busy}
                      @click=${() =>
                        void settings.onReauthorizeUserOperationalIdentity?.(
                          entry.identity.identityId,
                        )}
                    >
                      重新认证
                    </button>
                  </div>
                `,
              )}
            </div>
          `
        : nothing
    }
    <div class="employee-workbench__identity-grid">
      ${
        identities.length === 0
          ? html`
              <div class="employee-workbench__settings-section-subtitle">
                尚未绑定身份。请从左侧选择要添加的身份。
              </div>
            `
          : identities.map((identity) => {
              const statusInfo = identityStatusLabel(identity.status);
              const grantCount =
                activeGrantCountByIdentity.get(identity.identityId) ?? identity.grantCount;
              const lastUsed = latestUsageByIdentity.get(identity.identityId);
              const openHub = () =>
                settings.onUserOperationalIdentityNavChange?.(
                  `add:${identity.provider}` as UserOperationalIdentityNav,
                );
              return html`
                <div
                  class="employee-workbench__identity-card employee-workbench__identity-card--clickable"
                  role="button"
                  tabindex="0"
                  @click=${openHub}
                  @keydown=${(event: KeyboardEvent) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openHub();
                    }
                  }}
                >
                  <div class="employee-workbench__identity-card-head">
                    <span class="employee-workbench__identity-provider">${identity.providerLabel}</span>
                    <span
                      class="employee-workbench__settings-pill employee-workbench__settings-pill--${statusInfo.tone}"
                    >
                      ${statusInfo.label}
                    </span>
                  </div>
                  <div class="employee-workbench__identity-name">${identity.displayName}</div>
                  ${
                    identity.externalAccountId
                      ? html`<div class="employee-workbench__identity-account mono">${identity.externalAccountId}</div>`
                      : nothing
                  }
                  <div class="employee-workbench__identity-meta">
                    <div>
                      <span class="employee-workbench__identity-meta-label">最近使用</span>
                      <span class="employee-workbench__identity-meta-value">${formatTimestamp(lastUsed)}</span>
                    </div>
                    <div>
                      <span class="employee-workbench__identity-meta-label">授权机器人</span>
                      <span class="employee-workbench__identity-meta-value">${String(grantCount)}</span>
                    </div>
                  </div>
                  <div
                    class="employee-workbench__identity-card-actions"
                    @click=${(event: Event) => event.stopPropagation()}
                  >
                    ${renderIdentityCredentialActions(settings, identity, busy)}
                  </div>
                </div>
              `;
            })
      }
    </div>
  `;

  const sharedOrGroupGrants = activeGrants.filter((grant) => {
    if (grant.agentScope !== "shared" && grant.agentScope !== "group") {
      return false;
    }
    return !hubIdentity || grant.identityId === hubIdentity.identityId;
  });

  const ancillarySections = html`
    ${
      sharedOrGroupGrants.length > 0
        ? html`
            <div class="employee-workbench__auth-subpane">
              <div class="employee-workbench__settings-section-title">共享与协作授权</div>
              <div class="employee-workbench__identity-scope-legend">
                <span><i class="employee-workbench__identity-dot employee-workbench__identity-dot--shared"></i>共享</span>
                <span><i class="employee-workbench__identity-dot employee-workbench__identity-dot--group"></i>协作小组</span>
              </div>
              ${sharedOrGroupGrants.map(
                (grant) => html`
                  <div class="employee-workbench__settings-row">
                    <div>
                      <strong>
                        <i
                          class="employee-workbench__identity-dot employee-workbench__identity-dot--${grant.agentScope}"
                        ></i>
                        ${grant.agentId}
                      </strong>
                      <div class="employee-workbench__settings-section-subtitle">
                        ${agentScopeLabel(grant.agentScope)} · ${grant.allowedActions.join(", ")}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn btn--sm"
                      ?disabled=${busy}
                      @click=${() =>
                        void settings.onRevokeUserOperationalIdentityGrant?.(grant.grantId)}
                    >
                      撤销授权
                    </button>
                  </div>
                `,
              )}
            </div>
          `
        : nothing
    }
    ${
      visiblePendingContinuations.length > 0
        ? html`
            <div class="employee-workbench__auth-subpane">
              <div class="employee-workbench__settings-section-title">待恢复任务</div>
              ${visiblePendingContinuations.map(
                (continuation) => html`
                  <div class="employee-workbench__settings-row">
                    <div>
                      <strong>${continuation.provider} · ${continuation.requestedAction}</strong>
                      <div class="employee-workbench__settings-section-subtitle">
                        ${continuation.status}
                      </div>
                    </div>
                    ${
                      continuation.status === "ready_to_resume"
                        ? html`
                            <button
                              type="button"
                              class="btn btn--sm btn--primary"
                              ?disabled=${busy}
                              @click=${() =>
                                void settings.onResumeUserOperationalIdentityContinuation?.(
                                  continuation.continuationToken,
                                )}
                            >
                              继续任务
                            </button>
                          `
                        : continuation.status === "pending_oauth"
                          ? html`
                              <button
                                type="button"
                                class="btn btn--sm btn--primary"
                                ?disabled=${busy}
                                @click=${() =>
                                  void settings.onCompleteUserOperationalIdentityOAuthForContinuation?.(
                                    {
                                      continuationToken: continuation.continuationToken,
                                      provider: continuation.provider,
                                    },
                                  )}
                              >
                                完成 OAuth
                              </button>
                            `
                          : continuation.status === "pending_binding"
                            ? html`
                                <button
                                  type="button"
                                  class="btn btn--sm btn--primary"
                                  ?disabled=${busy}
                                  @click=${() =>
                                    void settings.onOpenUserOperationalIdentityBindingFlow?.()}
                                >
                                  去绑定
                                </button>
                              `
                            : nothing
                    }
                  </div>
                `,
              )}
            </div>
          `
        : nothing
    }
    ${
      visiblePendingRequests.length > 0
        ? html`
            <div class="employee-workbench__auth-subpane">
              <div class="employee-workbench__settings-section-title">待绑定请求</div>
              ${visiblePendingRequests.map((request) => {
                const matchingIdentity = identities.find(
                  (identity) => identity.provider === request.provider,
                );
                const needsExplicitGrant =
                  request.agentScope === "shared" || request.agentScope === "group";
                const hasActiveGrant = grants.some(
                  (grant) =>
                    grant.status === "active" &&
                    grant.agentId === request.agentId &&
                    grant.identityId === matchingIdentity?.identityId &&
                    grant.allowedActions.includes(request.requestedAction),
                );
                const canComplete =
                  matchingIdentity?.status === "active" && (!needsExplicitGrant || hasActiveGrant);
                return html`
                  <div class="employee-workbench__settings-row">
                    <div>
                      <strong>${request.provider} · ${request.requestedAction}</strong>
                      <div class="employee-workbench__settings-section-subtitle">
                        ${agentScopeLabel(request.agentScope)} ${request.agentId}
                      </div>
                      ${
                        needsExplicitGrant
                          ? html`
                              <div class="employee-workbench__settings-section-subtitle">
                                ${grantScopeHint(request.agentScope)}
                              </div>
                            `
                          : nothing
                      }
                    </div>
                    <div class="employee-workbench__settings-password-actions">
                      ${
                        needsExplicitGrant && matchingIdentity
                          ? html`
                              <button
                                type="button"
                                class="btn btn--sm btn--primary"
                                ?disabled=${busy}
                                @click=${() =>
                                  void settings.onConfirmUserOperationalIdentityGrant?.({
                                    identityId: matchingIdentity.identityId,
                                    agentId: request.agentId,
                                    agentScope: request.agentScope,
                                    allowedActions: [request.requestedAction],
                                    sessionKey: request.sessionKey,
                                  })}
                              >
                                确认授权
                              </button>
                            `
                          : nothing
                      }
                      ${
                        canComplete
                          ? html`
                              <button
                                type="button"
                                class="btn btn--sm"
                                ?disabled=${busy}
                                @click=${() =>
                                  void settings.onCompleteUserOperationalIdentityBindingRequest?.(
                                    request.requestId,
                                  )}
                              >
                                标记完成并返回
                              </button>
                            `
                          : html`
                              <div class="employee-workbench__settings-section-subtitle">
                                请先完成身份绑定${needsExplicitGrant ? "并确认授权" : ""}。
                              </div>
                            `
                      }
                    </div>
                  </div>
                `;
              })}
            </div>
          `
        : nothing
    }
    ${
      hubIdentity || visibleUsageHistory.length > 0
        ? renderOperationalIdentityUsageRecords({
            settings,
            events: visibleUsageHistory,
            catalog,
            identityById,
            scoped: Boolean(hubIdentity),
          })
        : nothing
    }
  `;

  const providerHubPane = hubIdentity
    ? html`
      <div class="employee-workbench__auth-pane-head">
        <div class="employee-workbench__settings-section-title">${hubIdentity.providerLabel}</div>
        ${metricsLine}
      </div>
      <div class="employee-workbench__identity-hub">
        <div class="employee-workbench__identity-card employee-workbench__identity-card--hub">
          <div class="employee-workbench__identity-card-head">
            <span class="employee-workbench__identity-provider">${hubIdentity.providerLabel}</span>
            <span
              class="employee-workbench__settings-pill employee-workbench__settings-pill--${identityStatusLabel(hubIdentity.status).tone}"
            >
              ${identityStatusLabel(hubIdentity.status).label}
            </span>
          </div>
          <div class="employee-workbench__identity-name">${hubIdentity.displayName}</div>
          ${
            hubIdentity.externalAccountId
              ? html`<div class="employee-workbench__identity-account mono">${hubIdentity.externalAccountId}</div>`
              : nothing
          }
          <div class="employee-workbench__identity-meta">
            <div>
              <span class="employee-workbench__identity-meta-label">授权机器人</span>
              <span class="employee-workbench__identity-meta-value"
                >${String(activeGrantCountByIdentity.get(hubIdentity.identityId) ?? hubIdentity.grantCount)}</span
              >
            </div>
            <div>
              <span class="employee-workbench__identity-meta-label">最近使用</span>
              <span class="employee-workbench__identity-meta-value"
                >${formatTimestamp(latestUsageByIdentity.get(hubIdentity.identityId))}</span
              >
            </div>
          </div>
        </div>
        <div class="employee-workbench__auth-subpane">
          <div class="employee-workbench__settings-section-title">数字人授权</div>
          ${renderIdentityRobotGrantCard(hubIdentity, settings, { showHeader: false })}
        </div>
        <div class="employee-workbench__auth-subpane">
          <div class="employee-workbench__settings-section-title">凭证与账户</div>
          ${renderIdentityCredentialActions(settings, hubIdentity, busy)}
        </div>
      </div>
      ${ancillarySections}
    `
    : nothing;

  const boundPaneWithExtras = html`${boundPane}${ancillarySections}`;

  const paneContent =
    settings.userOperationalIdentityEditorOpen && (addProvider || !embedded)
      ? renderProviderIdentityEditorForm(settings)
      : addProvider
        ? hubIdentity
          ? providerHubPane
          : renderProviderIdentityEditorForm(settings)
        : boundPaneWithExtras;

  // Non-embedded fallback: keep a compact self-contained page with quick nav.
  if (!embedded) {
    return html`
      <div class="employee-workbench__settings-section employee-workbench__settings-section--operational-identity">
        <div class="employee-workbench__settings-section-head">
          <div class="employee-workbench__settings-section-title">
            ${t("frontstage.workbench.settings.sections.operationalIdentityTitle")}
          </div>
        </div>
        ${renderNotices(settings, platformReady)}
        <div class="employee-workbench__settings-password-actions">
          ${readyCatalog.map(
            (entry) => html`
              <button
                type="button"
                class="btn"
                ?disabled=${busy || !platformReady}
                @click=${() =>
                  settings.onUserOperationalIdentityNavChange?.(
                    `add:${entry.provider}` as UserOperationalIdentityNav,
                  )}
              >
                ${entry.label}
              </button>
            `,
          )}
          <button
            type="button"
            class="btn"
            ?disabled=${busy || !platformReady}
            @click=${() => settings.onUserOperationalIdentityNavChange?.("bound")}
          >
            已绑定
          </button>
        </div>
        ${paneContent}
      </div>
    `;
  }

  return html`
    <div
      class="employee-workbench__settings-section employee-workbench__settings-section--operational-identity employee-workbench__settings-section--operational-identity-embedded"
    >
      ${renderNotices(settings, platformReady)}
      ${paneContent}
    </div>
  `;
}
