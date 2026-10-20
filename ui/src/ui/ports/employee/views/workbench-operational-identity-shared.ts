import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../../../format.ts";
import type {
  UserOperationalIdentityUsageEventSummary,
  UserOperationalIdentityUsageRange,
} from "../semantic/view-controller-facade.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";
import type { WorkbenchSettingsRobotEntry } from "./workbench-types.ts";

export const USER_OPERATIONAL_IDENTITY_USAGE_RANGES: Array<{
  id: UserOperationalIdentityUsageRange;
  label: string;
  days: number | null;
}> = [
  { id: "7d", label: "7 天", days: 7 },
  { id: "30d", label: "30 天", days: 30 },
  { id: "90d", label: "90 天", days: 90 },
  { id: "all", label: "全部", days: null },
];

export function usageRangeSinceIso(
  range: UserOperationalIdentityUsageRange | null | undefined,
  nowMs = Date.now(),
): string | null {
  const days = USER_OPERATIONAL_IDENTITY_USAGE_RANGES.find((entry) => entry.id === range)?.days;
  if (!days) {
    return null;
  }
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

export function filterUsageHistoryByRange<T extends { createdAt: string }>(
  events: T[],
  range: UserOperationalIdentityUsageRange | null | undefined,
  nowMs = Date.now(),
): T[] {
  const since = usageRangeSinceIso(range, nowMs);
  if (!since) {
    return events;
  }
  const sinceMs = Date.parse(since);
  return events.filter((event) => Date.parse(event.createdAt) >= sinceMs);
}

export function operationalIdentityRobotLabel(settings: SettingsContract, agentId: string): string {
  const entry = (settings.robotEntries ?? []).find((robot) => robot.id === agentId);
  const name = entry?.name?.trim();
  return name || agentId;
}

export function usagePublishKindLabel(kind?: string): string {
  if (kind === "draft") {
    return "草稿";
  }
  if (kind === "broadcast") {
    return "群发";
  }
  if (kind === "publish") {
    return "发布";
  }
  return "";
}

export function usageEventHeadline(
  event: UserOperationalIdentityUsageEventSummary,
  actionLabel: string,
): string {
  return event.summary?.headline?.trim() || actionLabel;
}

export function ownedWorkbenchRobotEntries(
  settings: SettingsContract,
): WorkbenchSettingsRobotEntry[] {
  return (settings.robotEntries ?? []).filter((entry) => entry.source === "owned");
}

export function scopeOperationalIdentityUsageHistory<
  T extends { identityId: string; provider: string },
>(events: T[], scope?: { identityId?: string | null; provider?: string | null }): T[] {
  const identityId = scope?.identityId?.trim() || "";
  const provider = scope?.provider?.trim() || "";
  if (!identityId && !provider) {
    return events;
  }
  return events.filter((event) =>
    identityId ? event.identityId === identityId : event.provider === provider,
  );
}

export function operationalIdentityActionLabel(
  catalog: NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["providerCatalog"],
  provider: string,
  action: string,
): string {
  const catalogEntry = catalog.find((item) => item.provider === provider);
  return catalogEntry?.operationalActions.find((item) => item.action === action)?.label ?? action;
}

export function operationalActionsForProvider(
  catalog: NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["providerCatalog"],
  provider: string,
): string[] {
  const catalogEntry = catalog.find((item) => item.provider === provider);
  const actions = catalogEntry?.operationalActions.map((item) => item.action) ?? [];
  return actions.length > 0 ? actions : ["*"];
}

export function formatOperationalIdentityUsageResult(result: string): string {
  if (result === "allowed") {
    return "允许";
  }
  if (result === "reauth_required") {
    return "需重授权";
  }
  return "拒绝";
}

export function formatOperationalIdentityTimestamp(value?: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "—";
  }
  return formatRelativeTimestamp(parsed, { dateFallback: true, fallback: "—" });
}

export function operationalIdentityStatusLabel(status: string): {
  label: string;
  tone: "ok" | "warn";
} {
  if (status === "active") {
    return { label: "已连接", tone: "ok" };
  }
  if (status === "expired") {
    return { label: "已过期", tone: "warn" };
  }
  if (status === "reauth_required") {
    return { label: "需重授权", tone: "warn" };
  }
  return { label: "已停用", tone: "warn" };
}

export function operationalIdentityAgentScopeLabel(scope: string): string {
  if (scope === "owned") {
    return "自有机器人";
  }
  if (scope === "group") {
    return "协作小组机器人";
  }
  return "共享机器人";
}

export function operationalIdentityGrantScopeHint(scope: string): string {
  if (scope === "owned") {
    return "自有机器人可自动授权";
  }
  if (scope === "group") {
    return "协作小组机器人默认禁止，需手动批准";
  }
  return "共享机器人需二次确认";
}

export type OperationalIdentityProviderGroup = {
  provider: string;
  label: string;
  identities: NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["identities"];
};

export function buildOperationalIdentityProviderGroups(params: {
  identities: NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["identities"];
  catalog: NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["providerCatalog"];
}): OperationalIdentityProviderGroup[] {
  const labelByProvider = new Map(params.catalog.map((entry) => [entry.provider, entry.label]));
  const grouped = new Map<string, OperationalIdentityProviderGroup>();
  for (const identity of params.identities) {
    const provider = identity.provider;
    const existing = grouped.get(provider);
    if (existing) {
      existing.identities.push(identity);
      continue;
    }
    grouped.set(provider, {
      provider,
      label: identity.providerLabel || labelByProvider.get(provider) || provider,
      identities: [identity],
    });
  }
  return [...grouped.values()].toSorted((left, right) =>
    left.label.localeCompare(right.label, "zh-CN"),
  );
}

export function renderOperationalIdentityCategoryBadge(kind: "personal" | "enterprise") {
  const label = kind === "personal" ? "个人自有 · 个人资产" : "企业同步 · 岗位授权";
  return html`
    <div
      class="employee-workbench__identity-category-badge employee-workbench__identity-category-badge--${kind}"
    >
      ${label}
    </div>
  `;
}

export function renderOperationalIdentityStatusGrid(params: {
  cards: Array<{ label: string; value: number | string; copy?: string }>;
  embedded?: boolean;
  minimal?: boolean;
}) {
  const embedded = Boolean(params.embedded);
  const minimal = Boolean(params.minimal);
  if (minimal) {
    return html`
      <div class="employee-workbench__settings-kv-strip" role="list">
        ${params.cards.map(
          (card) => html`
            <div class="employee-workbench__settings-kv-row" role="listitem">
              <span class="employee-workbench__settings-kv-label">${card.label}</span>
              <span class="employee-workbench__settings-kv-value">${String(card.value)}</span>
            </div>
          `,
        )}
      </div>
    `;
  }
  return html`
    <div
      class="employee-workbench__settings-status-grid employee-workbench__settings-status-grid--compact ${embedded ? "employee-workbench__settings-status-grid--flat" : ""}"
    >
      ${params.cards.map(
        (card) => html`
          <div class="employee-workbench__settings-status-card">
            <div class="employee-workbench__settings-field-label">${card.label}</div>
            <div class="employee-workbench__settings-title">${String(card.value)}</div>
            ${
              card.copy
                ? html`
                    <div class="employee-workbench__settings-status-copy">${card.copy}</div>
                  `
                : nothing
            }
          </div>
        `,
      )}
    </div>
  `;
}
