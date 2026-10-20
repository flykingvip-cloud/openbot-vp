/**
 * Seats workspace — seat UI state and rendering (shared by v2 seats page).
 */

import { html, nothing, type TemplateResult } from "lit";
import { i18n, t } from "../../../i18n/index.ts";
import { createCostBudgetGateway } from "../../capability/cost-budget-billing/gateway-client.ts";
import type {
  AllocationOverviewResponse,
  AnalyticsResponse,
  DashboardResponse,
  PositionAttributionResponse,
  SeatAttributionResponse,
  SeatListResponse,
  SeatRole,
  SeatWithGrantSummary,
  SubscriptionProvisioning,
} from "../../capability/cost-budget-billing/index.ts";
import { createModelAuthorizationGateway } from "../../capability/model-authorization/gateway-client.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import type { CostBudgetV2NavigateTarget } from "../cost-budget-v2/shell/cost-budget-v2-routes.ts";
import {
  parseSeatsGovernanceDrilldownFromHash,
  type SeatsGovernanceDrilldownFocus,
} from "./cost-budget-drilldown.ts";
import {
  parseAllocationSeatModelGrants,
  positionModelBindingIsDirty,
  resolveEntitledModelIds,
  resolveSavedPositionModelIds,
  togglePositionModelDraft,
  type SelectedOrgPosition,
} from "./cost-budget-position-model-binding.ts";
import { exportPositionReportCsv } from "./cost-budget-position-report-export.ts";
import {
  resolvePositionReportWindow,
  type PositionReportPeriodPreset,
} from "./cost-budget-position-report-period.ts";
import {
  loadSeatRoleTemplateStore,
  resolveAggregatedSuggestedRole,
  saveSeatRoleTemplateStore,
  type SeatRoleTemplateStore,
} from "./cost-budget-seat-role-templates.ts";
import {
  buildAssignedSeatUserIdSet,
  isSeatMemberAssignable,
  parseSeatAssignUserIds,
} from "./cost-budget-seat-selection.ts";
import { renderCostBudgetSeatsPanel, type SeatFormState } from "./cost-budget-seats-panel.ts";

export type SeatsWorkspaceSnapshot = {
  loading: boolean;
  allocation: AllocationOverviewResponse | null;
  seats: SeatListResponse | null;
  analytics: AnalyticsResponse | null;
  attribution: SeatAttributionResponse | null;
  positionAttribution: PositionAttributionResponse | null;
  dashboard: DashboardResponse | null;
  hasActiveSubscription: boolean;
};

export type SeatsDataSource = {
  getSnapshot(): SeatsWorkspaceSnapshot;
  getBootstrapGuide(): SubscriptionProvisioning | null;
  setBootstrapGuide(value: SubscriptionProvisioning | null): void;
  setPositionAttribution(value: PositionAttributionResponse | null): void;
  reload(client: GatewayBrowserClient): Promise<void>;
  ensureDashboard?(client: GatewayBrowserClient): Promise<void>;
  reloadPositionAttribution?(
    client: GatewayBrowserClient,
    startTime: string,
    endTime: string,
    options?: { fetchDashboardIfNeeded?: boolean },
  ): Promise<void>;
};

export type CostBudgetSeatsWorkspaceProps = {
  client: GatewayBrowserClient | null;
  readModel: EnterprisePortReadModel | null | undefined;
  tenantId: string;
  rerender: () => void;
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
  dataSource: SeatsDataSource;
};

const seatForm: SeatFormState = {
  userId: "",
  role: "viewer",
  botQuota: "0",
};

let seatOrgTreeQuery = "";
let seatSelectedMembers = new Map<string, string>();
let seatRoleTemplates: SeatRoleTemplateStore = { prefixRules: {}, positionOverrides: {} };
let seatRoleTemplatesTenantId = "";
let seatRoleManuallySet = false;
let seatSelectedOrgPosition: SelectedOrgPosition | null = null;
let seatPositionModelDraftIds = new Set<string>();

let seatActionBusy = false;
let seatActionError: string | null = null;

let seatsInnerTab: "assign" | "list" | "report" = "assign";
let positionReportPreset: PositionReportPeriodPreset = "cycle";
let positionReportCustomStart = "";
let positionReportCustomEnd = "";
let positionReportLoading = false;
let positionReportExportBusy = false;
let positionReportError: string | null = null;
let positionReportCollapsedRows = new Set<string>();
let seatsGovernanceFocus: SeatsGovernanceDrilldownFocus | null = null;
let seatBotQuotaAdvancedOpen = false;
let seatToast: { kind: "success" | "error"; message: string; actionLabel?: string } | null = null;
let seatToastTimer: ReturnType<typeof setTimeout> | null = null;

let subscriptionSeatBootstrapGuide: SubscriptionProvisioning | null = null;

let seatsHashChangeHooked = false;
let seatsI18nHooked = false;
let seatsWorkspaceRerenderFn: (() => void) | null = null;

function tb(key: string, fallback: string, params?: Record<string, string | number>): string {
  const value = t(key, params);
  return value === key ? fallback : value;
}

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) {
    return "—";
  }
  return `¥${(cents / 100).toFixed(2)}`;
}

function gatewayOf(client: GatewayBrowserClient) {
  return createCostBudgetGateway(client);
}

export function syncSeatsGovernanceFocusFromHash(): void {
  if (typeof window === "undefined") {
    return;
  }
  const focus = parseSeatsGovernanceDrilldownFromHash(window.location.hash);
  seatsGovernanceFocus = focus;
  if (focus) {
    seatsInnerTab = "list";
  }
}

function clearSeatsGovernanceDrilldown(rerender: () => void): void {
  seatsGovernanceFocus = null;
  if (typeof window !== "undefined" && window.location.hash.includes("governance")) {
    const url = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState({}, "", url);
  }
  rerender();
}

function ensureSeatsHashChangeRerender(rerender: () => void): void {
  if (seatsHashChangeHooked || typeof window === "undefined") {
    return;
  }
  seatsHashChangeHooked = true;
  window.addEventListener("hashchange", () => {
    syncSeatsGovernanceFocusFromHash();
    rerender();
  });
}

function ensureSeatsI18nRerender(rerender: () => void): void {
  if (seatsI18nHooked) {
    return;
  }
  seatsI18nHooked = true;
  i18n.subscribe(() => {
    rerender();
  });
  void i18n.setLocale(i18n.getLocale());
}

export function ensureCostBudgetSeatsWorkspaceHooks(rerender: () => void): void {
  seatsWorkspaceRerenderFn = rerender;
  ensureSeatsHashChangeRerender(rerender);
  ensureSeatsI18nRerender(rerender);
}

export function getCostBudgetSeatsInnerTab(): "assign" | "list" | "report" {
  return seatsInnerTab;
}

export function setCostBudgetSeatsInnerTab(tab: "assign" | "list" | "report"): void {
  seatsInnerTab = tab;
}

export function getCostBudgetSeatBootstrapGuide(): SubscriptionProvisioning | null {
  return subscriptionSeatBootstrapGuide;
}

export function setCostBudgetSeatBootstrapGuide(
  provisioning: SubscriptionProvisioning | null,
): void {
  subscriptionSeatBootstrapGuide = provisioning;
  seatsWorkspaceRerenderFn?.();
}

function resolvePositionReportRequestTimes(snapshot: SeatsWorkspaceSnapshot): {
  startTime: string;
  endTime: string;
} {
  return resolvePositionReportWindow({
    preset: positionReportPreset,
    cycleStart: snapshot.dashboard?.cycleStart ?? snapshot.positionAttribution?.cycleStart,
    cycleEnd: snapshot.dashboard?.cycleEnd ?? snapshot.positionAttribution?.cycleEnd,
    customStart: positionReportCustomStart,
    customEnd: positionReportCustomEnd,
  });
}

async function loadPositionAttribution(
  client: GatewayBrowserClient,
  dataSource: SeatsDataSource,
  rerender: () => void,
): Promise<void> {
  positionReportLoading = true;
  positionReportError = null;
  rerender();
  let snapshot = dataSource.getSnapshot();
  if (positionReportPreset === "cycle" && !snapshot.dashboard && dataSource.ensureDashboard) {
    await dataSource.ensureDashboard(client);
    snapshot = dataSource.getSnapshot();
  }
  const { startTime, endTime } = resolvePositionReportRequestTimes(snapshot);
  try {
    if (dataSource.reloadPositionAttribution) {
      await dataSource.reloadPositionAttribution(client, startTime, endTime, {
        fetchDashboardIfNeeded: positionReportPreset === "cycle",
      });
    } else {
      const gw = gatewayOf(client);
      const result = await gw.attributionByPosition({ startTime, endTime });
      dataSource.setPositionAttribution(result);
    }
  } catch (err) {
    dataSource.setPositionAttribution(null);
    positionReportError = err instanceof Error ? err.message : String(err);
  }
  positionReportLoading = false;
  rerender();
}

function roleLabel(role: SeatRole): string {
  switch (role) {
    case "viewer":
      return t("costBudget.allocation.roleViewer");
    case "creator":
      return t("costBudget.allocation.roleCreator");
    case "admin":
      return t("costBudget.allocation.roleAdmin");
  }
}

function showSeatToast(
  kind: "success" | "error",
  message: string,
  rerender: () => void,
  actionLabel?: string,
): void {
  seatToast = { kind, message, ...(actionLabel ? { actionLabel } : {}) };
  if (seatToastTimer) {
    clearTimeout(seatToastTimer);
  }
  seatToastTimer = setTimeout(() => {
    seatToast = null;
    seatToastTimer = null;
    rerender();
  }, 4500);
  rerender();
}

async function runSeatAction(
  client: GatewayBrowserClient,
  action: () => Promise<void>,
  rerender: () => void,
): Promise<void> {
  seatActionBusy = true;
  seatActionError = null;
  rerender();
  try {
    await action();
  } catch (err) {
    seatActionError = err instanceof Error ? err.message : "操作失败";
    showSeatToast("error", seatActionError, rerender);
  } finally {
    seatActionBusy = false;
    rerender();
  }
}

function resolveAssignedSeatUserIds(snapshot: SeatsWorkspaceSnapshot): ReadonlySet<string> {
  const seatRows = snapshot.allocation?.seats ?? snapshot.seats?.seats ?? [];
  return buildAssignedSeatUserIdSet(seatRows);
}

function resolveSeatAssignTargets(
  readModel: EnterprisePortReadModel | null | undefined,
  snapshot: SeatsWorkspaceSnapshot,
): string[] {
  const assignedSeatUserIds = resolveAssignedSeatUserIds(snapshot);
  if (readModel) {
    return [...seatSelectedMembers.keys()].filter((userId) =>
      isSeatMemberAssignable(userId, assignedSeatUserIds),
    );
  }
  return parseSeatAssignUserIds(seatForm.userId, assignedSeatUserIds);
}

function canSubmitSeatAssign(
  readModel: EnterprisePortReadModel | null | undefined,
  snapshot: SeatsWorkspaceSnapshot,
): boolean {
  return resolveSeatAssignTargets(readModel, snapshot).length > 0;
}

function resolveSeatsWithGrants(snapshot: SeatsWorkspaceSnapshot): SeatWithGrantSummary[] {
  if (snapshot.allocation?.seats) {
    return snapshot.allocation.seats;
  }
  return (snapshot.seats?.seats ?? []).map((seat) => ({
    ...seat,
    grantedModelCount: 0,
  }));
}

function ensureSeatRoleTemplates(tenantId: string): void {
  if (!tenantId || seatRoleTemplatesTenantId === tenantId) {
    return;
  }
  seatRoleTemplates = loadSeatRoleTemplateStore(tenantId);
  seatRoleTemplatesTenantId = tenantId;
}

function persistSeatRoleTemplates(tenantId: string): void {
  if (!tenantId) {
    return;
  }
  saveSeatRoleTemplateStore(tenantId, seatRoleTemplates);
}

function applySuggestedRoleIfAuto(readModel: EnterprisePortReadModel | null | undefined): void {
  if (seatRoleManuallySet || seatSelectedMembers.size === 0) {
    return;
  }
  seatForm.role = resolveAggregatedSuggestedRole({
    userIds: [...seatSelectedMembers.keys()],
    readModel,
    templates: seatRoleTemplates,
  });
}

export function renderSubscriptionSeatBootstrapGuide(params: {
  provisioning: SubscriptionProvisioning;
  allocation: AllocationOverviewResponse | null;
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
}): TemplateResult {
  const prov = params.provisioning;
  const bootstrap = prov.seatBootstrap;
  const entitledModelCount = params.allocation?.ceiling.entitledModelCount ?? 0;
  const assignedSeatCount = params.allocation?.seats.length ?? 0;
  const stepAssignDone = assignedSeatCount > 0;
  const stepVerifyDone =
    stepAssignDone &&
    entitledModelCount > 0 &&
    (params.allocation?.seats.every((seat) => seat.grantedModelCount > 0) ?? false);

  return html`
    <div class="callout success cost-budget-seat-bootstrap-guide" data-testid="seat-bootstrap-guide">
      <strong>${t("costBudget.allocation.seatBootstrapTitle")}</strong>
      <p>${t("costBudget.allocation.seatBootstrapIntro")}</p>
      <ol class="cost-budget-seat-bootstrap-guide__steps">
        <li class="is-done">${t("costBudget.allocation.seatBootstrapStepSubscribe")}</li>
        <li class=${stepAssignDone ? "is-done" : "is-active"}>
          ${t("costBudget.allocation.seatBootstrapStepAssign")}
        </li>
        <li class=${stepVerifyDone ? "is-done" : ""}>
          ${t("costBudget.allocation.seatBootstrapStepVerify")}
        </li>
      </ol>
      ${
        bootstrap && bootstrap.assigned > 0
          ? html`
              <p>
                ${t("costBudget.allocation.seatBootstrapAutoAssigned", {
                  count: String(bootstrap.assigned),
                })}
              </p>
              <ul class="cost-budget-alert-list">
                ${bootstrap.results.map(
                  (row) => html`
                    <li>
                      ${t("costBudget.allocation.seatBootstrapAssignedRow", {
                        email: row.userEmail,
                        role: row.role,
                        count: String(row.modelCount),
                      })}
                    </li>
                  `,
                )}
              </ul>
            `
          : html`<p>${t("costBudget.allocation.seatBootstrapManual")}</p>`
      }
      ${
        entitledModelCount === 0
          ? html`<p class="enterprise-hint">${t("costBudget.allocation.seatBootstrapNoModels")}</p>`
          : nothing
      }
      <div class="enterprise-page__actions cost-budget-actions--spaced">
        <button
          type="button"
          class="btn btn--sm btn--primary"
          data-testid="seat-bootstrap-goto-seats"
          @click=${() => params.onNavigate({ route: "seats" })}
        >
          ${t("costBudget.allocation.seatBootstrapGotoSeats")}
        </button>
      </div>
    </div>
  `;
}

export function renderCostBudgetSeatsWorkspace(
  props: CostBudgetSeatsWorkspaceProps,
): TemplateResult {
  const { client, readModel, tenantId, rerender, onNavigate, dataSource } = props;
  ensureCostBudgetSeatsWorkspaceHooks(rerender);
  ensureSeatRoleTemplates(tenantId);
  syncSeatsGovernanceFocusFromHash();

  const snapshot = dataSource.getSnapshot();
  const bootstrapGuide = dataSource.getBootstrapGuide() ?? subscriptionSeatBootstrapGuide;
  const allocation = snapshot.allocation;
  const seats = resolveSeatsWithGrants(snapshot);
  const assignedSeatUserIds = buildAssignedSeatUserIdSet(seats);

  if (!allocation) {
    return html`
      <div class="enterprise-empty" data-testid="seats-allocation-unavailable">
        席位分配数据加载失败。请重启 Gateway 后重试，或前往「套餐与订阅」确认是否已完成订阅。
        ${
          client
            ? html`
                <div class="enterprise-page__actions cost-budget-actions--spaced">
                  <button
                    type="button"
                    class="btn btn--sm"
                    ?disabled=${snapshot.loading}
                    @click=${() => {
                      void dataSource.reload(client);
                    }}
                  >
                    重试加载
                  </button>
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  if (!allocation.subscribed) {
    return html`
      <div class="enterprise-empty" data-testid="seats-no-subscription">
        <p>
          ${tb("costBudget.allocation.needSubscription", t("costBudget.emptyNoSubscription"))}
        </p>
        <div class="enterprise-page__actions cost-budget-actions--spaced">
          <button
            type="button"
            class="btn primary btn--sm"
            @click=${() => onNavigate({ route: "plan-orders", planOrdersPanel: "catalog" })}
          >
            前往套餐与订阅
          </button>
        </div>
      </div>
    `;
  }

  const assignTargetCount = resolveSeatAssignTargets(readModel, snapshot).length;
  const selectedRoleProfile =
    allocation.roleProfiles.find((profile) => profile.role === seatForm.role) ?? null;
  const entitledModelIds = resolveEntitledModelIds(allocation);
  const positionModelSavedIds = seatSelectedOrgPosition
    ? resolveSavedPositionModelIds(
        parseAllocationSeatModelGrants(allocation.grants),
        seatSelectedOrgPosition.orgSeatId,
      )
    : [];
  const positionModelBindingDirty = positionModelBindingIsDirty(positionModelSavedIds, [
    ...seatPositionModelDraftIds,
  ]);

  return html`
    ${
      bootstrapGuide
        ? renderSubscriptionSeatBootstrapGuide({
            provisioning: bootstrapGuide,
            allocation,
            onNavigate,
          })
        : nothing
    }
    ${renderCostBudgetSeatsPanel({
      client,
      readModel,
      allocation,
      seats,
      seatForm,
      seatSelectedMembers,
      seatOrgTreeQuery,
      seatActionBusy,
      innerTab: seatsInnerTab,
      botQuotaAdvancedOpen: seatBotQuotaAdvancedOpen,
      toast: seatToast,
      analytics: snapshot.analytics,
      attribution: snapshot.attribution,
      positionAttribution: snapshot.positionAttribution,
      positionReportLoading,
      positionReportExportBusy,
      positionReportError,
      hasActiveSubscription: snapshot.hasActiveSubscription,
      positionReportPreset,
      positionReportCustomStart,
      positionReportCustomEnd,
      positionReportCollapsedRows,
      fmtMoney,
      roleLabel,
      assignedSeatUserIds,
      canSubmit: canSubmitSeatAssign(readModel, snapshot),
      assignTargetCount,
      selectedRoleProfile,
      seatRoleTemplates,
      seatRoleManuallySet,
      selectedOrgPosition: seatSelectedOrgPosition,
      positionModelDraftIds: seatPositionModelDraftIds,
      positionModelSavedIds,
      positionModelBindingDirty,
      entitledModelIds,
      governanceFocus: seatsGovernanceFocus,
      onInnerTabChange: (tab) => {
        seatsInnerTab = tab;
        if (tab === "report" && client) {
          void loadPositionAttribution(client, dataSource, rerender);
        }
        rerender();
      },
      onBotQuotaAdvancedToggle: () => {
        seatBotQuotaAdvancedOpen = !seatBotQuotaAdvancedOpen;
        rerender();
      },
      onQueryChange: (value) => {
        seatOrgTreeQuery = value;
        rerender();
      },
      onSelectedMembersChange: (selected) => {
        seatSelectedMembers = selected;
        if (selected.size === 0) {
          seatRoleManuallySet = false;
        }
        rerender();
      },
      onRoleChange: (role) => {
        seatForm.role = role;
        seatRoleManuallySet = true;
        rerender();
      },
      onSuggestedRoleChange: (role) => {
        if (!seatRoleManuallySet) {
          seatForm.role = role;
          rerender();
        }
      },
      onPrefixRuleChange: (prefix, role) => {
        seatRoleTemplates = {
          ...seatRoleTemplates,
          prefixRules: { ...seatRoleTemplates.prefixRules, [prefix]: role },
        };
        persistSeatRoleTemplates(tenantId);
        applySuggestedRoleIfAuto(readModel);
        rerender();
      },
      onPositionOverrideChange: (orgSeatId, role) => {
        const nextOverrides = { ...seatRoleTemplates.positionOverrides };
        if (role) {
          nextOverrides[orgSeatId] = role;
        } else {
          delete nextOverrides[orgSeatId];
        }
        seatRoleTemplates = {
          ...seatRoleTemplates,
          positionOverrides: nextOverrides,
        };
        persistSeatRoleTemplates(tenantId);
        applySuggestedRoleIfAuto(readModel);
        rerender();
      },
      onSelectedOrgPositionChange: (position) => {
        seatSelectedOrgPosition = position;
        if (position && allocation) {
          const saved = resolveSavedPositionModelIds(
            parseAllocationSeatModelGrants(allocation.grants),
            position.orgSeatId,
          );
          seatPositionModelDraftIds = new Set(saved);
        } else {
          seatPositionModelDraftIds = new Set();
        }
        rerender();
      },
      onPositionModelToggle: (modelId, selected) => {
        seatPositionModelDraftIds = togglePositionModelDraft(
          seatPositionModelDraftIds,
          modelId,
          selected,
        );
        rerender();
      },
      onPositionModelCancel: () => {
        if (!seatSelectedOrgPosition || !allocation) {
          return;
        }
        const saved = resolveSavedPositionModelIds(
          parseAllocationSeatModelGrants(allocation.grants),
          seatSelectedOrgPosition.orgSeatId,
        );
        seatPositionModelDraftIds = new Set(saved);
        rerender();
      },
      onPositionModelSave: () => {
        if (!client || !seatSelectedOrgPosition) {
          return;
        }
        const position = seatSelectedOrgPosition;
        void runSeatAction(
          client,
          async () => {
            const authGw = createModelAuthorizationGateway(client);
            await authGw.grant({
              subjectType: "seat",
              subjectId: position.orgSeatId,
              seatId: position.orgSeatId,
              grantedModelIds: [...seatPositionModelDraftIds],
            });
            showSeatToast(
              "success",
              t("costBudget.allocation.positionModelSaveSuccess", {
                title: position.title,
                count: String(seatPositionModelDraftIds.size),
              }),
              rerender,
            );
            await dataSource.reload(client);
            const refreshed = dataSource.getSnapshot().allocation;
            if (refreshed) {
              const saved = resolveSavedPositionModelIds(
                parseAllocationSeatModelGrants(refreshed.grants),
                position.orgSeatId,
              );
              seatPositionModelDraftIds = new Set(saved);
            }
          },
          rerender,
        );
      },
      onClearGovernanceFocus: () => clearSeatsGovernanceDrilldown(rerender),
      onPositionReportPresetChange: (preset) => {
        positionReportPreset = preset;
        if (client) {
          void loadPositionAttribution(client, dataSource, rerender);
        } else {
          rerender();
        }
      },
      onPositionReportCustomPeriodChange: (start, end) => {
        positionReportCustomStart = start;
        positionReportCustomEnd = end;
        if (positionReportPreset === "custom" && client && start && end) {
          void loadPositionAttribution(client, dataSource, rerender);
        } else {
          rerender();
        }
      },
      onReloadPositionReport: () => {
        if (!client) {
          return;
        }
        void loadPositionAttribution(client, dataSource, rerender);
      },
      onExportPositionReportSummary: () => {
        if (!client) {
          return;
        }
        const { startTime, endTime } = resolvePositionReportRequestTimes(snapshot);
        positionReportExportBusy = true;
        rerender();
        void exportPositionReportCsv(client, { startTime, endTime, variant: "summary" })
          .catch(() => undefined)
          .finally(() => {
            positionReportExportBusy = false;
            rerender();
          });
      },
      onExportPositionReportDaily: () => {
        if (!client) {
          return;
        }
        const { startTime, endTime } = resolvePositionReportRequestTimes(snapshot);
        positionReportExportBusy = true;
        rerender();
        void exportPositionReportCsv(client, { startTime, endTime, variant: "daily" })
          .catch(() => undefined)
          .finally(() => {
            positionReportExportBusy = false;
            rerender();
          });
      },
      onTogglePositionReportRowCollapse: (orgSeatId) => {
        const next = new Set(positionReportCollapsedRows);
        if (next.has(orgSeatId)) {
          next.delete(orgSeatId);
        } else {
          next.add(orgSeatId);
        }
        positionReportCollapsedRows = next;
        rerender();
      },
      onBotQuotaChange: (value) => {
        seatForm.botQuota = value;
        rerender();
      },
      onUserIdChange: (value) => {
        seatForm.userId = value;
        rerender();
      },
      onToastAction: () => {
        seatsInnerTab = "list";
        seatToast = null;
        rerender();
      },
      onSyncAllSeats: () => {
        if (!client) {
          return;
        }
        void runSeatAction(
          client,
          async () => {
            const gw = gatewayOf(client);
            const result = await gw.syncAllSeatGrants();
            showSeatToast(
              "success",
              `${t("costBudget.allocation.syncAllDone")} · ${result.applied}/${seats.length}`,
              rerender,
            );
            await dataSource.reload(client);
          },
          rerender,
        );
      },
      onAssignSubmit: () => {
        if (!client) {
          return;
        }
        const targets = resolveSeatAssignTargets(readModel, snapshot);
        if (targets.length === 0) {
          return;
        }
        void runSeatAction(
          client,
          async () => {
            const gw = gatewayOf(client);
            const botQuota = Number.parseInt(seatForm.botQuota, 10);
            const normalizedBotQuota = Number.isFinite(botQuota) ? botQuota : 0;
            let applied = 0;
            let failed = 0;
            let lastModelCount: number | null = null;
            const errors: string[] = [];
            for (const userId of targets) {
              try {
                const result = await gw.assignSeat({
                  userId,
                  role: seatForm.role,
                  botQuota: normalizedBotQuota,
                  applyModelGrant: true,
                });
                applied += 1;
                if (result.modelGrant?.profile?.modelCount != null) {
                  lastModelCount = result.modelGrant.profile.modelCount;
                }
              } catch (err) {
                failed += 1;
                const label = seatSelectedMembers.get(userId) ?? userId;
                errors.push(`${label}: ${err instanceof Error ? err.message : "分配失败"}`);
              }
            }
            seatForm.userId = "";
            seatSelectedMembers = new Map();
            seatOrgTreeQuery = "";
            seatRoleManuallySet = false;
            if (failed === 0) {
              const successMessage =
                applied === 1
                  ? lastModelCount != null
                    ? `${t("costBudget.allocation.assignSuccess")} · ${lastModelCount} ${t("costBudget.allocation.modelsGranted")}`
                    : t("costBudget.allocation.assignSuccess")
                  : `已成功为 ${applied} 名成员分配席位${
                      lastModelCount != null
                        ? ` · 每人 ${lastModelCount} ${t("costBudget.allocation.modelsGranted")}`
                        : ""
                    }`;
              showSeatToast(
                "success",
                successMessage,
                rerender,
                t("costBudget.allocation.toastViewList"),
              );
            } else {
              const partial =
                applied > 0
                  ? `已成功分配 ${applied} 人，另有 ${failed} 人失败`
                  : errors.slice(0, 3).join("；");
              showSeatToast("error", partial, rerender);
            }
            await dataSource.reload(client);
          },
          rerender,
        );
      },
      onSeatRoleChange: (seatId, role) => {
        if (!client) {
          return;
        }
        void runSeatAction(
          client,
          async () => {
            const gw = gatewayOf(client);
            const result = await gw.setSeatRole({
              seatId,
              role,
              applyModelGrant: true,
            });
            const message = result.modelGrant?.profile
              ? `${t("costBudget.allocation.roleUpdated")} · ${result.modelGrant.profile.modelCount} ${t("costBudget.allocation.modelsGranted")}`
              : t("costBudget.allocation.roleUpdated");
            showSeatToast("success", message, rerender);
            await dataSource.reload(client);
          },
          rerender,
        );
      },
      onReapplyProfile: (seatId, role) => {
        if (!client) {
          return;
        }
        void runSeatAction(
          client,
          async () => {
            const gw = gatewayOf(client);
            const result = await gw.applyAllocationProfile({ seatId, role });
            const message = result.profile
              ? `${t("costBudget.allocation.profileReapplied")} · ${result.profile.modelCount} ${t("costBudget.allocation.modelsGranted")}`
              : t("costBudget.allocation.profileReapplied");
            showSeatToast("success", message, rerender);
            await dataSource.reload(client);
          },
          rerender,
        );
      },
    })}
  `;
}

export function resetCostBudgetSeatUiStateForTests(): void {
  seatForm.userId = "";
  seatForm.role = "viewer";
  seatForm.botQuota = "0";
  seatSelectedMembers = new Map();
  seatOrgTreeQuery = "";
  seatRoleManuallySet = false;
  seatSelectedOrgPosition = null;
  seatPositionModelDraftIds = new Set();
  seatRoleTemplates = { prefixRules: {}, positionOverrides: {} };
  seatRoleTemplatesTenantId = "";
  seatsInnerTab = "assign";
  seatsGovernanceFocus = null;
  positionReportPreset = "cycle";
  positionReportCustomStart = "";
  positionReportCustomEnd = "";
  positionReportLoading = false;
  positionReportExportBusy = false;
  positionReportError = null;
  positionReportCollapsedRows = new Set();
  seatBotQuotaAdvancedOpen = false;
  seatToast = null;
  seatToastTimer = null;
  subscriptionSeatBootstrapGuide = null;
  seatActionBusy = false;
  seatActionError = null;
  seatsHashChangeHooked = false;
  seatsI18nHooked = false;
  seatsWorkspaceRerenderFn = null;
}

export async function reloadCostBudgetSeatsPositionAttribution(
  client: GatewayBrowserClient,
  dataSource: SeatsDataSource,
  rerender: () => void,
): Promise<void> {
  await loadPositionAttribution(client, dataSource, rerender);
}
