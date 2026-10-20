import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import {
  buildFrontstagePersonaCards,
  flattenChannelAccounts,
} from "../data/frontstage-overview.ts";
import {
  buildContactCards,
  buildGroupCards,
  type FrontstageContactCard,
  type FrontstageGroupCard,
} from "../data/frontstage-session-cards.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type { ControlSectionTab } from "../navigation.ts";
import type {
  AgentsListResult,
  ChannelsStatusSnapshot,
  PresenceEntry,
  SessionsListResult,
} from "../types.ts";

type FrontstageSharedProps = {
  connected: boolean;
  agentsList: AgentsListResult | null;
  sessionsResult: SessionsListResult | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  presenceEntries: PresenceEntry[];
  activeSessionKey: string;
  onOpenChat: (sessionKey: string) => void;
  onOpenControlSection: (section: ControlSectionTab) => void;
};

function renderStat(label: string, value: string | number, tone: "default" | "ok" = "default") {
  return html`
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${tone === "ok" ? "ok" : ""}">${value}</div>
    </div>
  `;
}

function renderContactRow(
  entry: FrontstageContactCard,
  props: Pick<FrontstageSharedProps, "activeSessionKey" | "onOpenChat">,
) {
  const isActive = entry.sessionKeys.includes(props.activeSessionKey);
  const updatedAt = entry.latestUpdatedAt
    ? formatRelativeTimestamp(entry.latestUpdatedAt)
    : t("common.na");
  const details = [
    entry.surfaces.length > 0
      ? t("frontstage.contacts.surfaces", { count: String(entry.surfaces.length) })
      : null,
    t("frontstage.contacts.personaRoutes", { count: String(entry.personaIds.length) }),
    t("frontstage.contacts.sessions", { count: String(entry.sessionCount) }),
  ]
    .filter(Boolean)
    .join(" · ");
  return html`
    <div class="list-item ${isActive ? "list-item-selected" : ""}">
      <div class="list-main">
        <div class="list-title">${entry.title}</div>
        <div class="list-sub">${details}</div>
        <div class="chip-row">
          ${entry.surfaces.map((surface) => html`<span class="chip">${surface}</span>`)}
          ${entry.personaIds.map((personaId) => html`<span class="chip">agent:${personaId}</span>`)}
        </div>
      </div>
      <div class="list-meta">
        <div>${updatedAt}</div>
        <button class="btn btn--sm" @click=${() => props.onOpenChat(entry.latestSessionKey)}>
          ${t("frontstage.contacts.openLatest")}
        </button>
      </div>
    </div>
  `;
}

function renderGroupRow(
  entry: FrontstageGroupCard,
  props: Pick<FrontstageSharedProps, "activeSessionKey" | "onOpenChat">,
) {
  const isActive = entry.sessionKeys.includes(props.activeSessionKey);
  const updatedAt = entry.latestUpdatedAt
    ? formatRelativeTimestamp(entry.latestUpdatedAt)
    : t("common.na");
  const details = [
    entry.chatType === "group"
      ? t("frontstage.groups.groupType")
      : t("frontstage.groups.channelType"),
    t("frontstage.groups.personaRoutes", { count: String(entry.personaIds.length) }),
    t("frontstage.groups.sessions", { count: String(entry.sessionCount) }),
  ].join(" · ");
  return html`
    <div class="list-item ${isActive ? "list-item-selected" : ""}">
      <div class="list-main">
        <div class="list-title">${entry.title}</div>
        <div class="list-sub">${details}</div>
        <div class="chip-row">
          ${entry.surfaces.map((surface) => html`<span class="chip">${surface}</span>`)}
          ${entry.personaIds.map((personaId) => html`<span class="chip">agent:${personaId}</span>`)}
        </div>
      </div>
      <div class="list-meta">
        <div>${updatedAt}</div>
        <button class="btn btn--sm" @click=${() => props.onOpenChat(entry.latestSessionKey)}>
          ${t("frontstage.groups.openLatest")}
        </button>
      </div>
    </div>
  `;
}

export function renderMe(props: FrontstageSharedProps) {
  const personas = buildFrontstagePersonaCards(props);
  const primaryPersona =
    personas.find((entry) => entry.id === props.agentsList?.defaultId) ?? personas[0];
  const contacts = buildContactCards(props.sessionsResult);
  const groups = buildGroupCards(props.sessionsResult);
  const connectedAccounts = flattenChannelAccounts(props.channelsSnapshot).filter(
    (entry) => entry.account.connected || entry.account.running || entry.account.configured,
  );

  return html`
    <section class="stack frontstage-stack">
      <div class="grid grid-cols-3">
        ${renderStat(t("frontstage.me.personas"), personas.length || "0")}
        ${renderStat(t("frontstage.me.contacts"), contacts.length || "0")}
        ${renderStat(
          t("frontstage.me.groups"),
          groups.length || "0",
          props.connected ? "ok" : "default",
        )}
      </div>

      <div class="grid grid-cols-2">
        <div class="card frontstage-hero">
          <div class="frontstage-identity">
            <div class="frontstage-avatar">${primaryPersona?.emoji ?? "🙂"}</div>
            <div class="frontstage-identity__body">
              <div class="card-title">${primaryPersona?.title ?? t("tabs.me")}</div>
              <div class="card-sub">${t("frontstage.me.primarySubtitle")}</div>
              <div class="chip-row" style="margin-top: 12px;">
                <span class="chip">${props.connected ? t("common.ok") : t("common.offline")}</span>
                ${
                  primaryPersona
                    ? html`<span class="chip">agent:${primaryPersona.id}</span>`
                    : nothing
                }
                <span class="chip">${t("frontstage.me.relationships", {
                  count: String(primaryPersona?.relationshipCount ?? 0),
                })}</span>
              </div>
            </div>
          </div>
          <div class="frontstage-actions">
            <button
              class="btn primary"
              ?disabled=${!primaryPersona}
              @click=${() => primaryPersona && props.onOpenChat(`agent:${primaryPersona.id}:main`)}
            >
              ${t("frontstage.openPrimaryChat")}
            </button>
            <button class="btn" @click=${() => props.onOpenControlSection("platformAgents")}>
              ${t("frontstage.managePersonas")}
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">${t("frontstage.me.reachabilityTitle")}</div>
          <div class="card-sub">${t("frontstage.me.reachabilitySubtitle")}</div>
          <div class="list" style="margin-top: 16px;">
            ${
              connectedAccounts.length === 0
                ? html`<div class="muted">${t("frontstage.me.noChannels")}</div>`
                : connectedAccounts.slice(0, 6).map(
                    ({ channelLabel, account }) => html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">${account.name?.trim() || account.accountId}</div>
                          <div class="list-sub">${channelLabel}</div>
                        </div>
                        <div class="list-meta">
                          <div>${account.connected ? t("common.ok") : t("common.disabled")}</div>
                          <div class="muted">${account.mode ?? account.tokenSource ?? "ready"}</div>
                        </div>
                      </div>
                    `,
                  )
            }
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2">
        <div class="card">
          <div class="card-title">${t("frontstage.me.recentContacts")}</div>
          <div class="card-sub">${t("frontstage.me.recentContactsSubtitle")}</div>
          <div class="list" style="margin-top: 16px;">
            ${
              contacts.length === 0
                ? html`<div class="muted">${t("frontstage.contacts.empty")}</div>`
                : contacts.slice(0, 4).map((entry) => renderContactRow(entry, props))
            }
          </div>
        </div>
        <div class="card">
          <div class="card-title">${t("frontstage.me.recentGroups")}</div>
          <div class="card-sub">${t("frontstage.me.recentGroupsSubtitle")}</div>
          <div class="list" style="margin-top: 16px;">
            ${
              groups.length === 0
                ? html`<div class="muted">${t("frontstage.groups.empty")}</div>`
                : groups.slice(0, 4).map((entry) => renderGroupRow(entry, props))
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

export function renderPersonas(props: FrontstageSharedProps) {
  const personas = buildFrontstagePersonaCards(props);
  return html`
    <section class="stack frontstage-stack">
      <div class="callout info">${t("frontstage.personas.note")}</div>
      <div class="grid grid-cols-2">
        ${
          personas.length === 0
            ? html`<div class="card"><div class="muted">${t("frontstage.personas.empty")}</div></div>`
            : personas.map(
                (persona) => html`
                  <div class="card frontstage-persona-card">
                    <div class="frontstage-identity">
                      <div class="frontstage-avatar">${persona.emoji}</div>
                      <div class="frontstage-identity__body">
                        <div class="card-title">${persona.title}</div>
                        <div class="card-sub">${persona.subtitle}</div>
                        <div class="chip-row" style="margin-top: 12px;">
                          <span class="chip">agent:${persona.id}</span>
                          <span class="chip">${t("frontstage.personas.sessions", {
                            count: String(persona.sessionsCount),
                          })}</span>
                          <span class="chip">${t("frontstage.personas.relationships", {
                            count: String(persona.relationshipCount),
                          })}</span>
                        </div>
                      </div>
                    </div>
                    <div class="frontstage-actions">
                      <button class="btn primary" @click=${() => props.onOpenChat(`agent:${persona.id}:main`)}>
                        ${t("frontstage.openChatAsPersona")}
                      </button>
                      <button class="btn" @click=${() => props.onOpenControlSection("platformAgents")}>
                        ${t("frontstage.manageInConsole")}
                      </button>
                    </div>
                  </div>
                `,
              )
        }
      </div>
    </section>
  `;
}

export function renderContacts(props: FrontstageSharedProps) {
  const contacts = buildContactCards(props.sessionsResult);
  const onlineInstances = props.presenceEntries.length;
  return html`
    <section class="stack frontstage-stack">
      <div class="grid grid-cols-3">
        ${renderStat(t("frontstage.contacts.count"), contacts.length || "0")}
        ${renderStat(t("frontstage.contacts.personas"), props.agentsList?.agents.length || "0")}
        ${renderStat(t("frontstage.contacts.instances"), onlineInstances || "0", props.connected ? "ok" : "default")}
      </div>

      <div class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">${t("tabs.contacts")}</div>
            <div class="card-sub">${t("subtitles.contacts")}</div>
          </div>
          <button class="btn" @click=${() => props.onOpenControlSection("channels")}>
            ${t("frontstage.contacts.openConsole")}
          </button>
        </div>
        <div class="list" style="margin-top: 16px;">
          ${
            contacts.length === 0
              ? html`<div class="muted">${t("frontstage.contacts.empty")}</div>`
              : contacts.map((entry) => renderContactRow(entry, props))
          }
        </div>
      </div>

      <div class="card">
        <div class="card-title">${t("frontstage.contacts.howTitle")}</div>
        <div class="card-sub">${t("frontstage.contacts.howSubtitle")}</div>
        <div class="chip-row" style="margin-top: 12px;">
          <span class="chip">${t("frontstage.contacts.howRecent")}</span>
          <span class="chip">${t("frontstage.contacts.howDirectory")}</span>
          <span class="chip">${t("frontstage.contacts.howPersona")}</span>
        </div>
      </div>
    </section>
  `;
}

export function renderGroups(props: FrontstageSharedProps) {
  const groups = buildGroupCards(props.sessionsResult);
  const grouped = groups.filter((entry) => entry.chatType === "group");
  const channels = groups.filter((entry) => entry.chatType === "channel");
  return html`
    <section class="stack frontstage-stack">
      <div class="grid grid-cols-3">
        ${renderStat(t("frontstage.groups.count"), groups.length || "0")}
        ${renderStat(t("frontstage.groups.rooms"), grouped.length || "0")}
        ${renderStat(t("frontstage.groups.channels"), channels.length || "0")}
      </div>

      <div class="grid grid-cols-2">
        <div class="card">
          <div class="card-title">${t("frontstage.groups.roomsTitle")}</div>
          <div class="card-sub">${t("frontstage.groups.roomsSubtitle")}</div>
          <div class="list" style="margin-top: 16px;">
            ${
              grouped.length === 0
                ? html`<div class="muted">${t("frontstage.groups.empty")}</div>`
                : grouped.map((entry) => renderGroupRow(entry, props))
            }
          </div>
        </div>
        <div class="card">
          <div class="card-title">${t("frontstage.groups.channelsTitle")}</div>
          <div class="card-sub">${t("frontstage.groups.channelsSubtitle")}</div>
          <div class="list" style="margin-top: 16px;">
            ${
              channels.length === 0
                ? html`<div class="muted">${t("frontstage.groups.emptyChannels")}</div>`
                : channels.map((entry) => renderGroupRow(entry, props))
            }
          </div>
        </div>
      </div>

      <div class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">${t("frontstage.groups.consoleBridgeTitle")}</div>
            <div class="card-sub">${t("frontstage.groups.consoleBridgeSubtitle")}</div>
          </div>
          <div class="frontstage-actions">
            <button class="btn" @click=${() => props.onOpenControlSection("channels")}>
              ${t("frontstage.contacts.openConsole")}
            </button>
            <button class="btn" @click=${() => props.onOpenControlSection("sessions")}>
              ${t("frontstage.openSessions")}
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}
