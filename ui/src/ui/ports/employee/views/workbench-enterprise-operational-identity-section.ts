import { html, nothing } from "lit";
import { ENTERPRISE_OPERATIONAL_IDENTITY_SECTION_ID } from "../operational-identity-navigation.ts";
import type { EnterpriseAgentIdentityEntry } from "../semantic/view-controller-facade.ts";
import { ownedWorkbenchRobotEntries } from "./workbench-operational-identity-shared.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

function resolveFocusRobotName(
  settings: SettingsContract,
  focusAgentId: string | null | undefined,
): string | null {
  const agentId = focusAgentId?.trim();
  if (!agentId) {
    return null;
  }
  return (
    ownedWorkbenchRobotEntries(settings).find((robot) => robot.id === agentId)?.name ?? agentId
  );
}

function isRobotPreselected(
  robotId: string,
  enrolledAgentIds: string[],
  focusAgentId: string | null | undefined,
): boolean {
  if (enrolledAgentIds.includes(robotId)) {
    return true;
  }
  const focus = focusAgentId?.trim();
  return Boolean(focus && focus === robotId);
}

function renderEnterpriseIdentityBindingCard(
  settings: SettingsContract,
  params: {
    identity: EnterpriseAgentIdentityEntry;
    enrolledAgentIds: string[];
    ownedRobotIds: string[];
    focusAgentId: string | null | undefined;
    busy: boolean;
    platformReady: boolean;
  },
) {
  const { identity, enrolledAgentIds, ownedRobotIds, focusAgentId, busy, platformReady } = params;
  const robotEntries = ownedWorkbenchRobotEntries(settings).filter((robot) =>
    ownedRobotIds.includes(robot.id),
  );

  const submit = (event: Event) => {
    const root = (event.currentTarget as HTMLElement).closest("[data-enterprise-identity-binding]");
    const checked = Array.from(
      root?.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-enterprise-robot-id]:checked',
      ) ?? [],
    );
    const agentIds = checked
      .map((checkbox) => checkbox.dataset.enterpriseRobotId ?? "")
      .filter(Boolean);
    void settings.onApplyEnterpriseIdentityRobots?.({
      identityId: identity.identityId,
      agentIds,
    });
  };

  return html`
    <article
      class="employee-workbench__identity-card employee-workbench__identity-card--enterprise-binding"
      data-enterprise-identity-binding
    >
      <div class="employee-workbench__identity-card-head">
        <span class="employee-workbench__identity-provider">${identity.providerLabel}</span>
        <span class="employee-workbench__settings-pill">企业</span>
      </div>
      <div class="employee-workbench__identity-name">${identity.displayName}</div>
      ${
        robotEntries.length === 0
          ? html`
              <div class="employee-workbench__settings-personal-empty">暂无旗下机器人</div>
            `
          : html`
              <div class="employee-workbench__enterprise-robot-picks">
                ${robotEntries.map((robot) => {
                  const focused = focusAgentId?.trim() === robot.id;
                  return html`
                    <label
                      class="employee-workbench__robot-identity-option ${focused ? "employee-workbench__robot-identity-option--focus" : ""}"
                    >
                      <input
                        type="checkbox"
                        data-enterprise-robot-id=${robot.id}
                        ?checked=${isRobotPreselected(robot.id, enrolledAgentIds, focusAgentId)}
                        ?disabled=${busy || !platformReady}
                      />
                      <span>${robot.name}</span>
                      ${
                        focused
                          ? html`
                              <span class="employee-workbench__settings-pill">当前机器人</span>
                            `
                          : nothing
                      }
                    </label>
                  `;
                })}
              </div>
              <div class="employee-workbench__settings-auth-actions">
                <button
                  type="button"
                  class="btn btn--sm btn--primary"
                  ?disabled=${busy || !platformReady}
                  @click=${submit}
                >
                  保存绑定
                </button>
              </div>
            `
      }
    </article>
  `;
}

/** 企业岗位授权身份：员工在开放列表中为各身份选择旗下机器人绑定。 */
export function renderEnterpriseOperationalIdentitySection(
  settings: SettingsContract,
  options?: { embedded?: boolean; minimal?: boolean },
) {
  const embedded = Boolean(options?.embedded);
  const snapshot = settings.userOperationalIdentitySnapshot;
  const busy = Boolean(settings.userOperationalIdentityBusy);
  const platformReady = Boolean(settings.platformAuthEnabled && settings.connected);
  const focusAgentId = settings.enterpriseIdentityBindingFocusAgentId ?? null;
  const focusRobotName = resolveFocusRobotName(settings, focusAgentId);
  const ownedRobots = ownedWorkbenchRobotEntries(settings);
  const ownedRobotIds = ownedRobots.map((entry) => entry.id);
  const seatIdentities = snapshot?.enterpriseSeatIdentities ?? [];
  const enrolledByIdentity = snapshot?.enterpriseEnrolledAgentIdsByIdentity ?? {};
  const enrolledBindings = Object.values(enrolledByIdentity).reduce(
    (count, agentIds) => count + agentIds.length,
    0,
  );

  return html`
    <div
      id=${embedded ? ENTERPRISE_OPERATIONAL_IDENTITY_SECTION_ID : nothing}
      class="employee-workbench__settings-section employee-workbench__settings-section--enterprise-identity ${embedded ? "employee-workbench__settings-section--enterprise-identity-embedded" : ""}"
    >
      ${
        embedded
          ? nothing
          : html`
              <div class="employee-workbench__settings-section-head">
                <div class="employee-workbench__settings-section-title">企业身份</div>
              </div>
            `
      }

      ${
        focusRobotName
          ? html`
              <div class="employee-workbench__enterprise-binding-focus">
                <span>正在为「${focusRobotName}」配置企业身份绑定</span>
                <button
                  type="button"
                  class="btn btn--sm"
                  ?disabled=${busy}
                  @click=${() => settings.onReturnToRobotIdentityGrant?.()}
                >
                  返回机器人设置
                </button>
              </div>
            `
          : nothing
      }

      <div class="employee-workbench__settings-auth-toolbar">
        <div class="employee-workbench__settings-kv-strip" role="list">
          <div class="employee-workbench__settings-kv-row" role="listitem">
            <span class="employee-workbench__settings-kv-label">岗位开放</span>
            <span class="employee-workbench__settings-kv-value">${seatIdentities.length}</span>
          </div>
          <div class="employee-workbench__settings-kv-row" role="listitem">
            <span class="employee-workbench__settings-kv-label">已绑定</span>
            <span class="employee-workbench__settings-kv-value">${enrolledBindings}</span>
          </div>
        </div>

        <div class="employee-workbench__settings-auth-actions">
          <button
            type="button"
            class="btn btn--sm btn--primary"
            ?disabled=${busy || !platformReady || ownedRobots.length === 0}
            @click=${() => void settings.onSyncEnterpriseOperationalIdentities?.()}
          >
            ${busy ? "同步中…" : "同步"}
          </button>
        </div>
      </div>

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

      <div class="employee-workbench__settings-auth-identity-list">
        ${
          seatIdentities.length === 0
            ? html`
                <div class="employee-workbench__settings-personal-empty">暂无岗位开放身份</div>
              `
            : seatIdentities.map((identity) =>
                renderEnterpriseIdentityBindingCard(settings, {
                  identity,
                  enrolledAgentIds: enrolledByIdentity[identity.identityId] ?? [],
                  ownedRobotIds,
                  focusAgentId,
                  busy,
                  platformReady,
                }),
              )
        }
      </div>
    </div>
  `;
}
