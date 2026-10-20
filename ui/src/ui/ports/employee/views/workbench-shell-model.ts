import { t } from "../../../../i18n/index.ts";
import {
  resolveBuiltinStewardSessionKey,
  sessionKeyMatchesBuiltinSteward,
  type StewardSessionDefaults,
} from "../../../builtin-steward-selection.ts";
import {
  formatWorkspaceUpdatedAt,
  initials,
  type WorkbenchHomeModel,
  type WorkbenchSessionSummary,
} from "./workbench-home-model.ts";
import type {
  WorkbenchSignalCard,
  WorkbenchSignalItemRef,
  WorkbenchStewardSuggestionSummary,
} from "./workbench-signals.ts";
import type { WorkbenchPrimaryModule } from "./workbench-types.ts";
const SIGNAL_CARD_FALLBACK_AGE_MS = 2 * 60 * 60 * 1000;

export type WorkbenchShellNavItem = {
  id: string;
  selectionKey: string;
  title: string;
  rawTitle?: string;
  module: WorkbenchPrimaryModule;
  active?: boolean;
};

export type WorkbenchSignalTone = "ready" | "low" | "meeting" | "high";
export type WorkbenchSignalIconKey = "clipboardCheck" | "fileText" | "messageSquare" | "bell";

export type WorkbenchResolvedSignalCard = {
  key: WorkbenchSignalCard["key"];
  title: string;
  badgeCount: number;
  primary: string;
  secondary: string;
  timeLabel: string | null;
  pillLabel: string;
  tone: WorkbenchSignalTone;
  iconKey: WorkbenchSignalIconKey;
  actionId: WorkbenchSignalCard["actionId"];
  /** Auto-extracted clickable item refs for the card body list (forwarded as-is). */
  entries?: WorkbenchSignalItemRef[];
};

export type WorkbenchShellModel = {
  selectedNavKey: string;
  selectedAssistantItem: WorkbenchShellNavItem | null;
  selectedSpaceItem: WorkbenchShellNavItem | null;
  primaryModule: WorkbenchPrimaryModule;
  headerTitle: string;
  profileLabel: string;
  panelBadge: string;
  panelSubtitle: string;
  collaborationCount: string;
  signals: WorkbenchResolvedSignalCard[];
  /** Single steward suggestion line shown above the signal cards (M4). */
  stewardSuggestion: WorkbenchStewardSuggestionSummary | null;
};

type BuildWorkbenchShellModelInput = {
  primaryModule: WorkbenchPrimaryModule;
  teamSelectedKey: string;
  activeSessionKey: string;
  connected: boolean;
  userProfileName: string;
  assistantItems: WorkbenchShellNavItem[];
  spaceItems: WorkbenchShellNavItem[];
  model: WorkbenchHomeModel;
  activeSessionUpdatedAt: number | null;
  sessionDefaults?: StewardSessionDefaults;
};

/** True for managed-space selection keys, including invite-only deep-links not yet in nav. */
function looksLikeSpaceSelectionKey(selectionKey: string): boolean {
  const key = selectionKey.trim();
  return key.startsWith("space:") || key.startsWith("group:");
}

function resolveSelectedNavKey(input: BuildWorkbenchShellModelInput, stewardFallbackKey: string) {
  const normalizedTeamSelectedKey = input.teamSelectedKey.trim();
  const selectedAssistantKey = input.assistantItems.find(
    (item) => item.selectionKey === normalizedTeamSelectedKey,
  )?.selectionKey;
  const selectedSpaceKey = input.spaceItems.find(
    (item) => item.selectionKey === normalizedTeamSelectedKey,
  )?.selectionKey;

  if (input.primaryModule === "assistant") {
    if (selectedAssistantKey) {
      return selectedAssistantKey;
    }
    if (!selectedSpaceKey && normalizedTeamSelectedKey) {
      return normalizedTeamSelectedKey;
    }
    const activeAssistantKey = input.assistantItems.find((item) => item.active)?.selectionKey;
    if (activeAssistantKey) {
      return activeAssistantKey;
    }
  }

  if (input.primaryModule === "collaboration") {
    if (selectedSpaceKey) {
      return selectedSpaceKey;
    }
    // Q2 根因修复：即便 primaryModule 还停留在陈旧的 "collaboration"，只要用户显式选中的是
    // 助手（例如打开大白管家），也必须优先返回该助手键，而不是回退到某个「仍 active 的协作空间」
    // —— 后者正是让 stage 头部误显示「TO: <协作组>」的关键一环。
    if (selectedAssistantKey) {
      return selectedAssistantKey;
    }
    if (normalizedTeamSelectedKey) {
      return normalizedTeamSelectedKey;
    }
    const activeSpaceKey = input.spaceItems.find((item) => item.active)?.selectionKey;
    if (activeSpaceKey) {
      return activeSpaceKey;
    }
  }

  if (selectedAssistantKey || selectedSpaceKey) {
    return normalizedTeamSelectedKey;
  }

  return input.activeSessionKey || normalizedTeamSelectedKey || stewardFallbackKey;
}

function derivePrimaryModule(
  preferredModule: WorkbenchPrimaryModule,
  sessionInCollaboration: boolean,
): WorkbenchPrimaryModule {
  // Module VIEWS (knowledge/settings/tasks) are sticky — they persist until the
  // user explicitly leaves them.
  if (
    preferredModule === "knowledge" ||
    preferredModule === "settings" ||
    preferredModule === "tasks"
  ) {
    return preferredModule;
  }
  // Q2 根因修复：assistant ↔ collaboration 是「对话面」的选择，必须跟随**实际选中/激活的会话**
  // (sessionInCollaboration)，绝不能让持久化的陈旧 "collaboration" 反过来盖住选择 —— 否则打开
  // 大白管家时若还残留着协作组的 primaryModule，stage 头部就会显示「TO: <协作组>」。
  return sessionInCollaboration ? "collaboration" : "assistant";
}

function resolveSignalTone(card: WorkbenchSignalCard, connected: boolean): WorkbenchSignalTone {
  if (card.key === "schedule") {
    return "ready";
  }
  if (card.key === "todos") {
    return (card.badgeCount ?? 0) > 0 ? "meeting" : "low";
  }
  return connected ? "low" : "high";
}

function resolveSignalPillLabel(card: WorkbenchSignalCard, tone: WorkbenchSignalTone) {
  if (tone === "meeting") {
    return card.actionLabel;
  }
  if (tone === "ready") {
    return t("frontstage.workbench.surface.signalReady");
  }
  if (tone === "high") {
    return t("frontstage.workbench.surface.signalHigh");
  }
  return t("frontstage.workbench.surface.signalLow");
}

function resolveSignalIconKey(card: WorkbenchSignalCard): WorkbenchSignalIconKey {
  if (card.key === "schedule") {
    return "clipboardCheck";
  }
  if (card.key === "todos") {
    return "fileText";
  }
  return "bell";
}

function normalizeSignalValue(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  if (
    /^(common|frontstage|overview|chat)\./.test(normalized) ||
    /^(agent|space|group|channel|session):/.test(normalized)
  ) {
    const translated = t(normalized);
    return translated !== normalized ? translated : fallback;
  }

  return normalized;
}

function resolveSignalPrimary(
  card: WorkbenchSignalCard,
  sessionTitle: string,
  _spaceTitle: string,
  _connected: boolean,
) {
  if (card.key === "todos") {
    if ((card.badgeCount ?? 0) === 0) {
      return normalizeSignalValue(card.items[0], card.subtitle);
    }
    return normalizeSignalValue(card.items[0] ?? sessionTitle, card.subtitle);
  }
  if (card.key === "schedule") {
    return normalizeSignalValue(card.items[0], t("frontstage.workbench.cards.scheduleEmpty"));
  }
  return normalizeSignalValue(card.items[0], card.subtitle);
}

function resolveSignalSecondary(card: WorkbenchSignalCard) {
  return normalizeSignalValue(card.items[1], card.subtitle);
}

function resolveSignalTimeLabel(card: WorkbenchSignalCard) {
  if (card.key !== "schedule") {
    return null;
  }
  return formatWorkspaceUpdatedAt(Date.now() - SIGNAL_CARD_FALLBACK_AGE_MS);
}

function resolveHeaderTitle(params: {
  primaryModule: WorkbenchPrimaryModule;
  selectedAssistantItem: WorkbenchShellNavItem | null;
  selectedSpaceItem: WorkbenchShellNavItem | null;
}) {
  if (
    params.primaryModule === "knowledge" ||
    params.primaryModule === "settings" ||
    params.primaryModule === "tasks"
  ) {
    return "";
  }
  if (params.primaryModule === "collaboration" || params.primaryModule === "assistant") {
    return t("frontstage.workbench.overview.title");
  }
  return "";
}

function buildResolvedSignals(
  cards: WorkbenchSignalCard[],
  connected: boolean,
  sessionTitle: string,
  spaceTitle: string,
): WorkbenchResolvedSignalCard[] {
  return cards.map((card) => {
    const tone = resolveSignalTone(card, connected);
    return {
      key: card.key,
      title: card.title,
      badgeCount: card.badgeCount ?? 0,
      primary: resolveSignalPrimary(card, sessionTitle, spaceTitle, connected),
      secondary: resolveSignalSecondary(card),
      timeLabel: resolveSignalTimeLabel(card),
      pillLabel: resolveSignalPillLabel(card, tone),
      tone,
      iconKey: resolveSignalIconKey(card),
      actionId: card.actionId,
      ...(card.entries ? { entries: card.entries } : {}),
    };
  });
}

export function buildWorkbenchShellModel(
  input: BuildWorkbenchShellModelInput,
): WorkbenchShellModel {
  const sessionDefaults = input.sessionDefaults ?? {};
  const stewardFallbackKey = resolveBuiltinStewardSessionKey(sessionDefaults);
  const selectedNavKey = resolveSelectedNavKey(input, stewardFallbackKey);
  const selectedKeyIsAssistant = input.assistantItems.some(
    (item) => item.selectionKey === selectedNavKey,
  );
  const selectedKeyIsSpace = input.spaceItems.some((item) => item.selectionKey === selectedNavKey);
  // Invite-only / owned-bot-approval deep-links use `space:<groupId>` even when the
  // space is intentionally absent from chat-ready nav (`spaceItems`). Treat those
  // keys as collaboration so members-approval can open; do not fall back to another
  // active space (that would open the wrong group's 待确认 page).
  const selectedKeyIsSpaceDeepLink =
    !selectedKeyIsAssistant && !selectedKeyIsSpace && looksLikeSpaceSelectionKey(selectedNavKey);
  const selectedAssistantItem = selectedKeyIsSpaceDeepLink
    ? null
    : (input.assistantItems.find((item) => item.selectionKey === selectedNavKey) ??
      input.assistantItems.find((item) => item.active) ??
      input.assistantItems.find((item) => item.id === "daibai") ??
      input.assistantItems[0] ??
      null);
  const selectedSpaceItem = selectedKeyIsSpace
    ? (input.spaceItems.find((item) => item.selectionKey === selectedNavKey) ?? null)
    : selectedKeyIsSpaceDeepLink
      ? null
      : (input.spaceItems.find((item) => item.active) ?? input.spaceItems[0] ?? null);
  // The conversation module must follow the *explicitly selected* nav item so
  // the sidebar highlight and the "TO:" header never disagree. If the selected
  // key resolves to an assistant, stay in assistant mode even when a space is
  // flagged "active" (a space can share a session key with the steward, which
  // would otherwise hijack the stage header). Only fall back to the
  // active-session heuristic when the selection matches neither list.
  const sessionInCollaboration = selectedKeyIsAssistant
    ? false
    : selectedKeyIsSpace || selectedKeyIsSpaceDeepLink
      ? true
      : input.spaceItems.some((item) => item.active);
  const primaryModule = derivePrimaryModule(input.primaryModule, sessionInCollaboration);
  const sessionSummary: WorkbenchSessionSummary = input.model.activeSession;
  const preferredAssistantTitle =
    selectedAssistantItem?.rawTitle ?? selectedAssistantItem?.title ?? sessionSummary.title;
  const primarySpaceTitle =
    selectedSpaceItem?.rawTitle ??
    selectedSpaceItem?.title ??
    input.spaceItems[0]?.title ??
    t("frontstage.workbench.nav.collaborationSpaces");

  return {
    selectedNavKey,
    selectedAssistantItem,
    selectedSpaceItem,
    primaryModule,
    headerTitle: resolveHeaderTitle({
      primaryModule,
      selectedAssistantItem,
      selectedSpaceItem,
    }),
    // Human monogram only — never borrow the active agent/session title (e.g. 大白管家 → 大).
    profileLabel: initials(input.userProfileName.trim() || "U"),
    panelBadge: sessionKeyMatchesBuiltinSteward(input.activeSessionKey, sessionDefaults)
      ? "AI"
      : sessionSummary.badge,
    panelSubtitle: [
      input.activeSessionUpdatedAt
        ? formatWorkspaceUpdatedAt(input.activeSessionUpdatedAt)
        : formatWorkspaceUpdatedAt(Date.now() - SIGNAL_CARD_FALLBACK_AGE_MS),
      t("frontstage.workbench.team.activity.idle"),
    ].join(" · "),
    collaborationCount: String(input.spaceItems.length),
    signals: buildResolvedSignals(
      input.model.signals.cards,
      input.connected,
      preferredAssistantTitle,
      primarySpaceTitle,
    ),
    stewardSuggestion: input.model.signals.stewardSuggestion ?? null,
  };
}
