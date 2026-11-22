/**
 * Flat operational-identity grant panel for My Bot detail drawer.
 * (Formerly a list-row popover under「更多 → 配置可用身份」.)
 */

import { html, nothing } from "lit";
import type { UserOperationalIdentitySnapshot } from "../semantic/view-controller-facade.ts";
import { operationalActionsForProvider } from "./workbench-operational-identity-shared.ts";
import type { WorkbenchSettingsRobotEntry } from "./workbench-types.ts";

export type RobotOperationalIdentityApplyInput = {
  agentId: string;
  agentScope: "owned" | "shared" | "group";
  desired: Array<{ identityId: string; allowedActions: string[] }>;
};

export type RobotOperationalIdentityPanelProps = {
  entry: WorkbenchSettingsRobotEntry;
  snapshot: UserOperationalIdentitySnapshot | null | undefined;
  busy: boolean;
  onApply: (input: RobotOperationalIdentityApplyInput) => void;
  onAddPersonal: () => void;
  onOpenEnterpriseBinding: () => void;
};

export function robotIdentityAgentScope(entry: WorkbenchSettingsRobotEntry): "owned" | "shared" {
  if (entry.operationalAgentScope === "shared") {
    return "shared";
  }
  if (entry.operationalAgentScope === "owned") {
    return "owned";
  }
  // Seat-listed robots may still be config-scope shared; prefer explicit field when present.
  return entry.source === "owned" ? "owned" : "shared";
}

export function renderRobotOperationalIdentityPanel(props: RobotOperationalIdentityPanelProps) {
  const { entry, snapshot, busy, onApply, onAddPersonal, onOpenEnterpriseBinding } = props;
  const agentId = entry.id;
  const isOwnedRobot = entry.source === "owned";
  const allIdentities = snapshot?.identities ?? [];
  const bindableIdentities = allIdentities.filter((identity) => identity.status === "active");
  const catalog = snapshot?.providerCatalog ?? [];
  const grants = (snapshot?.grants ?? []).filter(
    (grant) => grant.agentId === agentId && grant.status === "active",
  );
  const grantedIdentityIds = new Set(
    grants
      .filter((grant) => grant.agentScope === "owned" || grant.agentScope === "shared")
      .map((grant) => grant.identityId),
  );
  const enterpriseEntries = snapshot?.enterpriseAccessByAgent?.[agentId];
  const actionsForProvider = (provider: string): string[] =>
    operationalActionsForProvider(catalog, provider);
  const providerByIdentity = new Map(
    bindableIdentities.map((identity) => [identity.identityId, identity.provider]),
  );

  const submit = (event: Event) => {
    const root = (event.currentTarget as HTMLElement).closest(
      ".employee-workbench__robot-identity-panel",
    );
    const checked = Array.from(
      root?.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-identity-id]:checked',
      ) ?? [],
    );
    const personalDesired = isOwnedRobot
      ? checked
          .filter((checkbox) => checkbox.dataset.kind === "personal")
          .map((checkbox) => {
            const identityId = checkbox.dataset.identityId ?? "";
            const provider = providerByIdentity.get(identityId) ?? "";
            return { identityId, allowedActions: actionsForProvider(provider) };
          })
      : [];
    onApply({ agentId, agentScope: robotIdentityAgentScope(entry), desired: personalDesired });
  };

  return html`
    <div class="employee-workbench__robot-identity-panel" data-agent-id=${agentId}>
      <p class="employee-workbench__mybot-drawer-hint">
        运营身份用于渠道授权；扮演身份（Persona）是对话人格，二者不同。
      </p>

      <div class="employee-workbench__robot-identity-group">
        <div class="employee-workbench__robot-identity-group-head">
          <span class="employee-workbench__settings-field-label">企业身份绑定</span>
          <button
            type="button"
            class="employee-workbench__robot-identity-add"
            ?disabled=${busy}
            @click=${onOpenEnterpriseBinding}
          >
            前往授权页
          </button>
        </div>
        ${
          enterpriseEntries === undefined
            ? html`
                <div class="employee-workbench__settings-section-subtitle">加载中…</div>
              `
            : enterpriseEntries.length === 0
              ? html`
                  <div class="employee-workbench__settings-section-subtitle">
                    岗位暂未开放企业身份；开放后请在「个人设置 → 授权 → 企业」绑定到本机器人。
                  </div>
                `
              : html`
                  ${enterpriseEntries.map(
                    (item) => html`
                      <div
                        class="employee-workbench__robot-identity-option employee-workbench__robot-identity-option--readonly"
                      >
                        <span>${item.providerLabel} · ${item.displayName}</span>
                        <span class="employee-workbench__settings-pill">
                          ${item.enrolled ? "已绑定" : "未绑定"}
                        </span>
                      </div>
                    `,
                  )}
                  <div class="employee-workbench__settings-section-subtitle">
                    企业身份按岗位授权；绑定请在「个人设置 → 授权 → 企业」为各身份选择机器人。
                  </div>
                `
        }
      </div>

      <div class="employee-workbench__robot-identity-group">
        <div class="employee-workbench__robot-identity-group-head">
          <span class="employee-workbench__settings-field-label">我的个人身份</span>
          ${
            isOwnedRobot
              ? html`
                  <button
                    type="button"
                    class="employee-workbench__robot-identity-add"
                    @click=${onAddPersonal}
                  >
                    + 添加个人身份
                  </button>
                `
              : nothing
          }
        </div>
        ${
          !isOwnedRobot
            ? html`
                <div class="employee-workbench__settings-section-subtitle">
                  个人身份仅可授权给你旗下的数字人；非自有数字人请使用企业身份。
                </div>
              `
            : bindableIdentities.length === 0
              ? html`
                  <div class="employee-workbench__settings-section-subtitle">
                    个人身份库为空。添加后仅可授权给旗下数字人。
                  </div>
                `
              : bindableIdentities.map((identity) => {
                  const granted = grantedIdentityIds.has(identity.identityId);
                  return html`
                    <label class="employee-workbench__robot-identity-option">
                      <input
                        type="checkbox"
                        data-kind="personal"
                        data-identity-id=${identity.identityId}
                        ?checked=${granted}
                        ?disabled=${busy}
                      />
                      <span>${identity.providerLabel} · ${identity.displayName}</span>
                    </label>
                  `;
                })
        }
      </div>

      ${
        isOwnedRobot
          ? html`
              <div class="employee-workbench__robot-identity-panel-footer">
                <span class="employee-workbench__settings-section-subtitle">
                  勾选后点击确认，将个人身份授权给该数字人
                </span>
                <button
                  type="button"
                  class="btn btn--sm btn--primary"
                  ?disabled=${busy}
                  @click=${submit}
                >
                  确认授权
                </button>
              </div>
            `
          : nothing
      }
    </div>
  `;
}
