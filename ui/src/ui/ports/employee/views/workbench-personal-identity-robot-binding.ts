import { html, nothing } from "lit";
import {
  operationalActionsForProvider,
  ownedWorkbenchRobotEntries,
} from "./workbench-operational-identity-shared.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";
import type { WorkbenchSettingsRobotEntry } from "./workbench-types.ts";

const PERSONAL_GRANT_SCOPES = new Set(["owned", "shared"]);

function activePersonalGrantsForRobot(settings: SettingsContract, agentId: string): Set<string> {
  const grants = settings.userOperationalIdentitySnapshot?.grants ?? [];
  return new Set(
    grants
      .filter(
        (grant) =>
          grant.agentId === agentId &&
          PERSONAL_GRANT_SCOPES.has(grant.agentScope) &&
          grant.status === "active",
      )
      .map((grant) => grant.identityId),
  );
}

function renderOwnedRobotPersonalBinding(
  robot: WorkbenchSettingsRobotEntry,
  settings: SettingsContract,
  bindableIdentities: NonNullable<
    SettingsContract["userOperationalIdentitySnapshot"]
  >["identities"],
  catalog: NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["providerCatalog"],
  busy: boolean,
) {
  const grantedIds = activePersonalGrantsForRobot(settings, robot.id);
  const grantedCount = bindableIdentities.filter((identity) =>
    grantedIds.has(identity.identityId),
  ).length;
  const providerByIdentity = new Map(
    bindableIdentities.map((identity) => [identity.identityId, identity.provider]),
  );

  const submit = (event: Event) => {
    const root = (event.currentTarget as HTMLElement).closest("[data-robot-binding]");
    const checked = Array.from(
      root?.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-personal-identity-id]:checked',
      ) ?? [],
    );
    const desired = checked
      .map((checkbox) => {
        const identityId = checkbox.dataset.personalIdentityId ?? "";
        const provider = providerByIdentity.get(identityId) ?? "";
        return {
          identityId,
          allowedActions: operationalActionsForProvider(catalog, provider),
        };
      })
      .filter((entry) => entry.identityId);
    void settings.onApplyRobotIdentityGrants?.({
      agentId: robot.id,
      agentScope: robot.operationalAgentScope === "shared" ? "shared" : "owned",
      desired,
    });
  };

  return html`
    <details class="employee-workbench__identity-robot-binding" data-robot-binding>
      <summary class="employee-workbench__identity-robot-binding-summary">
        <span class="employee-workbench__identity-robot-binding-name">${robot.name}</span>
        <span class="employee-workbench__identity-robot-binding-meta">${grantedCount}</span>
      </summary>
      <div class="employee-workbench__identity-robot-binding-body">
        ${
          bindableIdentities.length === 0
            ? html`
                <div class="employee-workbench__settings-personal-empty">暂无身份</div>
              `
            : bindableIdentities.map(
                (identity) => html`
                  <label class="employee-workbench__robot-identity-option">
                    <input
                      type="checkbox"
                      data-personal-identity-id=${identity.identityId}
                      ?checked=${grantedIds.has(identity.identityId)}
                      ?disabled=${busy || identity.status !== "active"}
                    />
                    <span>${identity.providerLabel} · ${identity.displayName}</span>
                    <span class="employee-workbench__settings-pill employee-workbench__settings-pill--ok">个人</span>
                  </label>
                `,
              )
        }
        ${
          bindableIdentities.length > 0
            ? html`
                <div class="employee-workbench__settings-password-actions">
                  <button
                    type="button"
                    class="btn btn--sm btn--primary"
                    ?disabled=${busy}
                    @click=${submit}
                  >
                    保存
                  </button>
                </div>
              `
            : nothing
        }
      </div>
    </details>
  `;
}

function activeOwnedAgentsForIdentity(settings: SettingsContract, identityId: string): Set<string> {
  const grants = settings.userOperationalIdentitySnapshot?.grants ?? [];
  return new Set(
    grants
      .filter(
        (grant) =>
          grant.identityId === identityId &&
          PERSONAL_GRANT_SCOPES.has(grant.agentScope) &&
          grant.status === "active",
      )
      .map((grant) => grant.agentId),
  );
}

function activePersonalGrantCountForIdentity(
  settings: SettingsContract,
  identityId: string,
): number {
  const grants = settings.userOperationalIdentitySnapshot?.grants ?? [];
  return grants.filter(
    (grant) =>
      grant.identityId === identityId &&
      PERSONAL_GRANT_SCOPES.has(grant.agentScope) &&
      grant.status === "active",
  ).length;
}

/**
 * 单账号数字人授权面板（账号详情 hub 或列表内嵌）。
 */
export function renderIdentityRobotGrantCard(
  identity: NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["identities"][number],
  settings: SettingsContract,
  options?: { showHeader?: boolean },
) {
  const ownedRobots = ownedWorkbenchRobotEntries(settings);
  const busy = Boolean(settings.userOperationalIdentityBusy);
  return renderIdentityRobotGrantCardInternal(identity, settings, ownedRobots, busy, options);
}

function renderIdentityRobotGrantCardInternal(
  identity: NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["identities"][number],
  settings: SettingsContract,
  ownedRobots: WorkbenchSettingsRobotEntry[],
  busy: boolean,
  options?: { showHeader?: boolean },
) {
  const showHeader = options?.showHeader !== false;
  const grantedAgentIds = activeOwnedAgentsForIdentity(settings, identity.identityId);
  // Prefer snapshot grant count so status matches metrics even if roster IDs drift.
  const grantedCount = activePersonalGrantCountForIdentity(settings, identity.identityId);
  const canGrant = identity.status === "active";

  const submit = (event: Event) => {
    const root = (event.currentTarget as HTMLElement).closest("[data-identity-grant]");
    const checked = Array.from(
      root?.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-owned-robot-id]:checked',
      ) ?? [],
    );
    const desiredAgentIds = checked
      .map((checkbox) => checkbox.dataset.ownedRobotId ?? "")
      .filter(Boolean);
    const agentScopesById = Object.fromEntries(
      ownedRobots.map((robot) => [
        robot.id,
        robot.operationalAgentScope === "shared" ? ("shared" as const) : ("owned" as const),
      ]),
    );
    void settings.onApplyIdentityRobotGrants?.({
      identityId: identity.identityId,
      desiredAgentIds,
      agentScopesById,
    });
  };

  // Always-visible grant panel (no <details>): "未授权" was a non-clickable pill and
  // folding hid the only place to pick robots — users thought they could not enter auth.
  return html`
    <section
      class="employee-workbench__identity-robot-binding employee-workbench__identity-robot-binding--grant-panel"
      data-identity-grant
      data-identity-id=${identity.identityId}
    >
      ${
        showHeader
          ? html`
              <div class="employee-workbench__identity-robot-binding-summary">
                <span class="employee-workbench__identity-robot-binding-name">
                  ${identity.providerLabel} · ${identity.displayName}
                </span>
                ${
                  grantedCount > 0
                    ? html`
                        <span class="employee-workbench__settings-pill employee-workbench__settings-pill--ok">
                          已授权 ${String(grantedCount)}
                        </span>
                      `
                    : html`
                        <span class="employee-workbench__settings-pill employee-workbench__settings-pill--warn">
                          未授权
                        </span>
                      `
                }
              </div>
            `
          : nothing
      }
      <div class="employee-workbench__identity-robot-binding-body">
        ${
          !canGrant
            ? html`
                <div class="employee-workbench__identity-grant-copy">账户需处于已连接状态后才能授权。</div>
              `
            : ownedRobots.length === 0
              ? html`
                  <div class="employee-workbench__identity-grant-copy">
                    ${
                      grantedCount > 0
                        ? `已有 ${String(grantedCount)} 条数字人授权，但当前列表未加载到自有数字人，请稍后刷新或先到「我的数字人」确认旗下机器人。`
                        : "请先创建自有数字人，再回来勾选授权。"
                    }
                  </div>
                `
              : html`
                  <div class="employee-workbench__identity-grant-copy">
                    勾选要使用该账户的数字人，然后保存。
                  </div>
                  <div class="employee-workbench__identity-grant-robots" data-identity-grant-robots>
                    ${ownedRobots.map(
                      (robot) => html`
                        <label class="employee-workbench__robot-identity-option">
                          <input
                            type="checkbox"
                            data-owned-robot-id=${robot.id}
                            ?checked=${grantedAgentIds.has(robot.id)}
                            ?disabled=${busy}
                          />
                          <span>${robot.name}</span>
                          ${
                            robot.operationalAgentScope === "shared"
                              ? html`
                                  <span class="employee-workbench__settings-pill employee-workbench__settings-pill--warn"
                                    >席位共享 · 需确认</span
                                  >
                                `
                              : nothing
                          }
                        </label>
                      `,
                    )}
                  </div>
                `
        }
        ${
          canGrant && ownedRobots.length > 0
            ? html`
                <div class="employee-workbench__settings-password-actions">
                  <button
                    type="button"
                    class="btn btn--sm btn--primary"
                    ?disabled=${busy}
                    @click=${submit}
                  >
                    保存授权
                  </button>
                </div>
              `
            : nothing
        }
      </div>
    </section>
  `;
}

/**
 * 授权管理：按绑定账户勾选旗下自有数字人并保存。
 * 返回 null 表示无绑定账户（由调用方渲染空态）。
 */
export function renderIdentityRobotGrantCards(settings: SettingsContract) {
  const identities = settings.userOperationalIdentitySnapshot?.identities ?? [];

  if (identities.length === 0) {
    return null;
  }

  return html`
    <div class="employee-workbench__identity-robot-binding-list" data-identity-grant-cards>
      ${identities.map((identity) => renderIdentityRobotGrantCard(identity, settings))}
    </div>
  `;
}

/** 个人身份仅授权给旗下自有数字人（与企业按岗位授权不同）。 */
export function renderPersonalIdentityRobotBindings(settings: SettingsContract) {
  const ownedRobots = ownedWorkbenchRobotEntries(settings);
  const snapshot = settings.userOperationalIdentitySnapshot;
  const bindableIdentities = (snapshot?.identities ?? []).filter(
    (identity) => identity.status === "active",
  );
  const catalog = snapshot?.providerCatalog ?? [];
  const busy = Boolean(settings.userOperationalIdentityBusy);

  if (ownedRobots.length === 0) {
    return nothing;
  }

  if (bindableIdentities.length === 0) {
    return nothing;
  }

  return html`
    <div class="employee-workbench__settings-auth-bindings">
      <div class="employee-workbench__settings-auth-bindings-title">数字人授权</div>
      <div class="employee-workbench__identity-robot-binding-list">
        ${ownedRobots.map((robot) =>
          renderOwnedRobotPersonalBinding(robot, settings, bindableIdentities, catalog, busy),
        )}
      </div>
    </div>
  `;
}
