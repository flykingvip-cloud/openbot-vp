import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { formatIsoTimestamp } from "../../../format.ts";
import {
  joinPersonalDisplayLabels,
  renderPersonalMetaList,
  renderPersonalPanel,
  renderPersonalSettingsChipRow,
  renderPersonalSettingsRow,
  renderPersonalSettingsSection,
  renderPersonalTabIntro,
} from "./workbench-personal-settings-layout.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

function renderPendingSeatOfferPanel(
  settings: SettingsContract,
  pendingSeatOffer: NonNullable<SettingsContract["pendingSeatOffer"]>,
) {
  return renderPersonalPanel({
    title: t("frontstage.workbench.settings.pendingSeatOffer.title"),
    subtitle: t("frontstage.workbench.settings.pendingSeatOffer.subtitle"),
    modifier: "employee-workbench__settings-personal-panel--pending-offer",
    content: html`
      ${renderPersonalMetaList([
        renderPersonalSettingsRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.seat"),
          pendingSeatOffer.seatTitle,
        ),
        renderPersonalSettingsRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.defaultAgent"),
          pendingSeatOffer.defaultAgentLabel?.trim() ||
            pendingSeatOffer.defaultAgentId?.trim() ||
            t("frontstage.workbench.settings.noDefaultAgent"),
        ),
        renderPersonalSettingsChipRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.robotTeam"),
          joinPersonalDisplayLabels(pendingSeatOffer.agentToolLabels, pendingSeatOffer.agentIds),
          t("frontstage.workbench.settings.noDefaultAgent"),
        ),
        renderPersonalSettingsChipRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.defaultSpaces"),
          joinPersonalDisplayLabels(
            pendingSeatOffer.defaultSpaceLabels,
            pendingSeatOffer.defaultSpaceIds,
          ),
          t("frontstage.workbench.settings.noDefaultSpaces"),
        ),
        renderPersonalSettingsRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.offeredAt"),
          formatIsoTimestamp(
            pendingSeatOffer.offeredAt,
            settings.currentLocale === "en" ? "en" : "zh-CN",
          ),
        ),
        ...(pendingSeatOffer.reauthorizationRequired
          ? [
              renderPersonalSettingsRow(
                settings.currentLocale === "zh-CN" ? "接手提醒" : "Handover note",
                settings.currentLocale === "zh-CN"
                  ? "接手后部分企业能力需要你重新确认或授权。"
                  : "Some enterprise capabilities will need your confirmation after you accept.",
              ),
            ]
          : []),
      ])}
      ${(() => {
        const omittedLabels = pendingSeatOffer.omittedAgentToolLabels ?? [];
        if (omittedLabels.length === 0) {
          return nothing;
        }
        return html`
          ${renderPersonalMetaList([
            renderPersonalSettingsChipRow(
              settings.currentLocale === "zh-CN" ? "未纳入机器人团队" : "Robot team not included",
              omittedLabels,
              settings.currentLocale === "zh-CN" ? "无" : "None",
            ),
          ])}
          <div class="employee-workbench__settings-personal-hint">
            ${
              settings.currentLocale === "zh-CN"
                ? `每个企业岗位最多绑定 ${String(5)} 个机器人。接受分配后将按上表顺序保留前 ${String(5)} 个；如需包含未纳入项，请让企业管理员调整岗位配置后重新派发。`
                : `Each enterprise position supports at most 5 robots. Accepting keeps the first 5 listed above; ask an admin to rebalance the seat package if you need the omitted robots.`
            }
          </div>
        `;
      })()}
      <div
        class="employee-workbench__settings-password-actions employee-workbench__settings-password-actions--personal"
      >
        <button
          type="button"
          class="btn btn--primary"
          ?disabled=${settings.pendingSeatOfferBusy}
          @click=${() => void settings.onAcceptPendingSeatOffer(pendingSeatOffer.offerId)}
        >
          ${
            settings.pendingSeatOfferBusy
              ? t("common.loading")
              : t("frontstage.workbench.settings.pendingSeatOffer.accept")
          }
        </button>
        <button
          type="button"
          class="btn"
          ?disabled=${settings.pendingSeatOfferBusy}
          @click=${() => void settings.onDeclinePendingSeatOffer(pendingSeatOffer.offerId)}
        >
          ${t("frontstage.workbench.settings.pendingSeatOffer.decline")}
        </button>
      </div>
      ${
        settings.pendingSeatOfferError
          ? html`
            <div class="callout callout--danger employee-workbench__settings-callout">
              ${settings.pendingSeatOfferError}
            </div>
          `
          : nothing
      }
      ${
        settings.pendingSeatOfferNotice
          ? html`
            <div class="callout employee-workbench__settings-callout">
              ${settings.pendingSeatOfferNotice}
            </div>
          `
          : nothing
      }
    `,
  });
}

export function renderPersonalAccountPanel(settings: SettingsContract) {
  const displayName = settings.userProfileName.trim() || "OpenBot";
  const profileNote = settings.userProfileSignature.trim() || "";
  const tenantLabel =
    settings.tenantLabel.trim() || t("frontstage.workbench.settings.localWorkspace");
  const statusLabel = settings.connected ? t("common.ok") : t("common.offline");
  const currentSeatLabel =
    settings.currentSeatTitle?.trim() || t("frontstage.workbench.settings.noSeatBound");
  const currentSeatStatusLabel =
    settings.currentSeatStatusLabel?.trim() || t("frontstage.workbench.settings.seatStatusUnbound");
  const pendingSeatOffer = settings.pendingSeatOffer ?? null;
  const defaultAgentLabel =
    settings.defaultAgentLabel?.trim() ||
    settings.defaultAgentId?.trim() ||
    t("frontstage.workbench.settings.noDefaultAgent");
  const robotTeamLabels = joinPersonalDisplayLabels(settings.robotTeamLabels, settings.agentIds);
  const defaultSpaceLabels = joinPersonalDisplayLabels(
    settings.defaultSpaceLabels,
    settings.defaultSpaceIds,
  );

  return renderPersonalSettingsSection(html`
    ${renderPersonalTabIntro(
      t("frontstage.workbench.settings.personalModules.account.title"),
      t("frontstage.workbench.settings.personalModules.account.subtitle"),
    )}
    <div class="employee-workbench__settings-personal-stack">
      ${renderPersonalPanel({
        title: t("frontstage.workbench.settings.personalModules.account.profile.title"),
        subtitle: t("frontstage.workbench.settings.personalModules.account.profile.subtitle"),
        modifier: "employee-workbench__settings-personal-panel--profile",
        content: html`
          <div
            class="employee-workbench__settings-form-grid employee-workbench__settings-form-grid--personal"
          >
            <label class="employee-workbench__settings-field">
              <span class="employee-workbench__settings-field-label">
                ${t("frontstage.workbench.settings.fields.displayName")}
              </span>
              <input
                class="employee-workbench__settings-input"
                type="text"
                maxlength="60"
                .value=${displayName}
                @input=${(event: Event) =>
                  settings.onUserProfileNameChange((event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="employee-workbench__settings-field">
              <span class="employee-workbench__settings-field-label">
                ${t("frontstage.workbench.settings.fields.profileNote")}
              </span>
              <input
                class="employee-workbench__settings-input"
                type="text"
                maxlength="120"
                .value=${profileNote}
                placeholder=${t("frontstage.workbench.settings.profileNotePlaceholder")}
                @input=${(event: Event) =>
                  settings.onUserProfileSignatureChange(
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
          </div>
        `,
      })}
      ${renderPersonalPanel({
        title: t("frontstage.workbench.settings.personalModules.account.enterprise.title"),
        subtitle: t("frontstage.workbench.settings.personalModules.account.enterprise.subtitle"),
        modifier: "employee-workbench__settings-personal-panel--enterprise",
        content: renderPersonalMetaList([
          renderPersonalSettingsRow(t("frontstage.workbench.settings.fields.tenant"), tenantLabel),
          renderPersonalSettingsRow(t("frontstage.workbench.settings.fields.status"), statusLabel),
          renderPersonalSettingsRow(
            t("frontstage.workbench.settings.fields.currentSeat"),
            currentSeatLabel,
          ),
          renderPersonalSettingsRow(
            t("frontstage.workbench.settings.fields.seatStatus"),
            currentSeatStatusLabel,
          ),
        ]),
      })}
      ${renderPersonalPanel({
        title: t("frontstage.workbench.settings.personalModules.account.resources.title"),
        subtitle: t("frontstage.workbench.settings.personalModules.account.resources.subtitle"),
        modifier: "employee-workbench__settings-personal-panel--resources",
        content: renderPersonalMetaList([
          renderPersonalSettingsRow(
            t("frontstage.workbench.settings.fields.defaultAgent"),
            defaultAgentLabel,
          ),
          renderPersonalSettingsChipRow(
            t("frontstage.workbench.settings.fields.robotTeam"),
            robotTeamLabels,
            t("frontstage.workbench.settings.noDefaultAgent"),
          ),
          renderPersonalSettingsChipRow(
            t("frontstage.workbench.settings.fields.defaultSpaces"),
            defaultSpaceLabels,
            t("frontstage.workbench.settings.noDefaultSpaces"),
          ),
        ]),
      })}
      ${pendingSeatOffer ? renderPendingSeatOfferPanel(settings, pendingSeatOffer) : nothing}
    </div>
    ${
      settings.workspaceNotice
        ? html`
          <div class="callout employee-workbench__settings-callout">${settings.workspaceNotice}</div>
        `
        : nothing
    }
  `);
}
