/**
 * Seat 与权限子页 —— 分配席位 + 已分配列表（企业端 UX 重构）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type {
  AllocationOverviewResponse,
  AnalyticsResponse,
  RoleGrantProfileSummary,
  PositionAttributionResponse,
  SeatAttributionResponse,
  SeatRole,
  SeatWithGrantSummary,
} from "../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import type { SeatsGovernanceDrilldownFocus } from "./cost-budget-drilldown.ts";
import { renderCostBudgetPositionModelBindingPanel } from "./cost-budget-position-model-binding-panel.ts";
import type { SelectedOrgPosition } from "./cost-budget-position-model-binding.ts";
import type { PositionReportPeriodPreset } from "./cost-budget-position-report-period.ts";
import {
  renderCostBudgetPositionReportPanel,
  type CostBudgetPositionReportProps,
} from "./cost-budget-position-report.ts";
import {
  buildSeatGovernanceRows,
  buildSeatGovernanceSummary,
  listUnassignedOrgMembers,
  sortSeatGovernanceRowsForDrilldown,
} from "./cost-budget-seat-governance.ts";
import { renderCostBudgetSeatMemberPicker } from "./cost-budget-seat-member-picker.ts";
import { renderSeatRoleTemplatePanel } from "./cost-budget-seat-role-templates-panel.ts";
import {
  resolveAggregatedSuggestedRole,
  type SeatRoleTemplateStore,
} from "./cost-budget-seat-role-templates.ts";

export type SeatFormState = {
  userId: string;
  role: SeatRole;
  botQuota: string;
};

export type SeatToastState = {
  kind: "success" | "error";
  message: string;
  actionLabel?: string;
} | null;

export type CostBudgetSeatsPanelProps = {
  client: GatewayBrowserClient | null;
  readModel: EnterprisePortReadModel | null | undefined;
  allocation: AllocationOverviewResponse;
  seats: SeatWithGrantSummary[];
  seatForm: SeatFormState;
  seatSelectedMembers: Map<string, string>;
  seatOrgTreeQuery: string;
  seatActionBusy: boolean;
  innerTab: "assign" | "list" | "report";
  botQuotaAdvancedOpen: boolean;
  toast: SeatToastState;
  analytics: AnalyticsResponse | null;
  attribution: SeatAttributionResponse | null;
  positionAttribution: PositionAttributionResponse | null;
  positionReportLoading: boolean;
  positionReportExportBusy: boolean;
  positionReportError: string | null;
  hasActiveSubscription: boolean;
  positionReportPreset: PositionReportPeriodPreset;
  positionReportCustomStart: string;
  positionReportCustomEnd: string;
  positionReportCollapsedRows: ReadonlySet<string>;
  fmtMoney: (cents: number | null | undefined) => string;
  roleLabel: (role: SeatRole) => string;
  assignedSeatUserIds: ReadonlySet<string>;
  canSubmit: boolean;
  assignTargetCount: number;
  selectedRoleProfile: RoleGrantProfileSummary | null;
  seatRoleTemplates: SeatRoleTemplateStore;
  seatRoleManuallySet: boolean;
  selectedOrgPosition: SelectedOrgPosition | null;
  positionModelDraftIds: ReadonlySet<string>;
  positionModelSavedIds: readonly string[];
  positionModelBindingDirty: boolean;
  entitledModelIds: readonly string[];
  governanceFocus: SeatsGovernanceDrilldownFocus | null;
  onInnerTabChange: (tab: "assign" | "list" | "report") => void;
  onBotQuotaAdvancedToggle: () => void;
  onQueryChange: (value: string) => void;
  onSelectedMembersChange: (selected: Map<string, string>) => void;
  onRoleChange: (role: SeatRole) => void;
  onSuggestedRoleChange: (role: SeatRole) => void;
  onPrefixRuleChange: (prefix: string, role: SeatRole) => void;
  onPositionOverrideChange: (orgSeatId: string, role: SeatRole | null) => void;
  onSelectedOrgPositionChange: (position: SelectedOrgPosition | null) => void;
  onPositionModelToggle: (modelId: string, selected: boolean) => void;
  onPositionModelSave: () => void;
  onPositionModelCancel: () => void;
  onClearGovernanceFocus: () => void;
  onPositionReportPresetChange: (preset: PositionReportPeriodPreset) => void;
  onPositionReportCustomPeriodChange: (start: string, end: string) => void;
  onReloadPositionReport: () => void;
  onExportPositionReportSummary: () => void;
  onExportPositionReportDaily: () => void;
  onTogglePositionReportRowCollapse: (orgSeatId: string) => void;
  onBotQuotaChange: (value: string) => void;
  onUserIdChange: (value: string) => void;
  onAssignSubmit: () => void;
  onSyncAllSeats: () => void;
  onSeatRoleChange: (seatId: string, role: SeatRole) => void;
  onReapplyProfile: (seatId: string, role: SeatRole) => void;
  onToastAction?: () => void;
};

function renderSeatToast(props: CostBudgetSeatsPanelProps): TemplateResult | typeof nothing {
  if (!props.toast) {
    return nothing;
  }
  return html`
    <div
      class="cost-budget-seats-toast cost-budget-seats-toast--${props.toast.kind}"
      data-testid="seat-action-toast"
      role="status"
    >
      <span>${props.toast.message}</span>
      ${
        props.toast.actionLabel && props.onToastAction
          ? html`
              <button type="button" class="btn btn--sm" @click=${() => props.onToastAction?.()}>
                ${props.toast.actionLabel}
              </button>
            `
          : nothing
      }
    </div>
  `;
}

function renderSeatsHeader(props: CostBudgetSeatsPanelProps): TemplateResult {
  const { allocation, seats } = props;
  const noEnterpriseModels = allocation.ceiling.entitledModelCount === 0;
  return html`
    <div class="cost-budget-seats-header" data-testid="seats-header-kpi">
      <div class="cost-budget-seats-header__item">
        <span class="cost-budget-seats-header__label">${t("costBudget.allocation.headerPlan")}</span>
        <strong>${allocation.ceiling.planName ?? "—"}</strong>
      </div>
      <div class="cost-budget-seats-header__item">
        <span class="cost-budget-seats-header__label">${t("costBudget.allocation.headerAssigned")}</span>
        <strong>${seats.length}</strong>
      </div>
      <div class="cost-budget-seats-header__item">
        <span class="cost-budget-seats-header__label">${t("costBudget.allocation.headerModels")}</span>
        <strong
          class=${noEnterpriseModels ? "cost-budget-seats-header__warn" : ""}
          >${t("costBudget.allocation.headerModelsValue", {
            count: String(allocation.ceiling.entitledModelCount),
          })}</strong
        >
      </div>
      <div class="cost-budget-seats-header__actions">
        <button
          type="button"
          class="btn btn--sm"
          data-testid="sync-all-seats-btn"
          ?disabled=${props.seatActionBusy || !props.client || seats.length === 0 || noEnterpriseModels}
          @click=${() => props.onSyncAllSeats()}
        >
          ${t("costBudget.allocation.syncAllSeats")}
        </button>
      </div>
    </div>
    ${
      noEnterpriseModels
        ? html`
            <div class="callout warning" data-testid="seats-no-enterprise-models">
              ${t("costBudget.allocation.seatsEnterpriseModelsEmpty")}
            </div>
          `
        : nothing
    }
  `;
}

function renderInnerTabs(props: CostBudgetSeatsPanelProps): TemplateResult {
  return html`
    <div class="cost-budget-seats-inner-tabs" data-testid="seats-inner-tabs">
      <button
        type="button"
        class="cost-budget-seats-inner-tab ${props.innerTab === "assign" ? "is-active" : ""}"
        data-testid="seats-tab-assign"
        @click=${() => props.onInnerTabChange("assign")}
      >
        ${t("costBudget.allocation.tabAssign")}
      </button>
      <button
        type="button"
        class="cost-budget-seats-inner-tab ${props.innerTab === "list" ? "is-active" : ""}"
        data-testid="seats-tab-list"
        @click=${() => props.onInnerTabChange("list")}
      >
        ${t("costBudget.allocation.tabList")}
        <span class="cost-budget-seats-inner-tab__count">${props.seats.length}</span>
      </button>
      <button
        type="button"
        class="cost-budget-seats-inner-tab ${props.innerTab === "report" ? "is-active" : ""}"
        data-testid="seats-tab-report"
        @click=${() => props.onInnerTabChange("report")}
      >
        ${t("costBudget.positionReport.tab")}
      </button>
    </div>
  `;
}

function renderRoleCardMeta(
  profile: RoleGrantProfileSummary,
  fmtMoney: CostBudgetSeatsPanelProps["fmtMoney"],
): TemplateResult | typeof nothing {
  const tiers = profile.tierIds.join(", ") || "—";
  const modelLabel =
    profile.modelCount > 0
      ? t("costBudget.allocation.roleCardModels", { count: String(profile.modelCount) })
      : profile.tierIds.length > 0
        ? t("costBudget.allocation.roleCardModelsPending")
        : null;
  if (!modelLabel && profile.seatPriceCents == null && tiers === "—") {
    return nothing;
  }
  return html`
    <span class="cost-budget-role-card__meta">
      ${t("costBudget.allocation.roleCardTier", { tiers })}${
        modelLabel ? html` · ${modelLabel}` : nothing
      }${
        profile.seatPriceCents != null
          ? html` · ${t("costBudget.allocation.roleCardPrice", {
              price: fmtMoney(profile.seatPriceCents),
            })}`
          : nothing
      }
    </span>
  `;
}

function renderRoleCard(
  profile: RoleGrantProfileSummary,
  selected: boolean,
  disabled: boolean,
  fmtMoney: CostBudgetSeatsPanelProps["fmtMoney"],
  onSelect: () => void,
): TemplateResult {
  return html`
    <button
      type="button"
      class="cost-budget-role-card ${selected ? "is-active" : ""}"
      data-testid=${`role-card-${profile.role}`}
      ?disabled=${disabled}
      @click=${onSelect}
    >
      <span class="cost-budget-role-card__title">${profile.label}</span>
      <span class="cost-budget-role-card__role">${propsRoleName(profile.role)}</span>
      ${renderRoleCardMeta(profile, fmtMoney)}
      ${
        profile.description
          ? html`<p class="cost-budget-role-card__desc">${profile.description}</p>`
          : nothing
      }
    </button>
  `;
}

function propsRoleName(role: SeatRole): string {
  switch (role) {
    case "viewer":
      return "Viewer";
    case "creator":
      return "Creator";
    case "admin":
      return "Admin";
  }
}

function renderAssignPanel(props: CostBudgetSeatsPanelProps): TemplateResult {
  const profiles = props.allocation.roleProfiles;
  const fallbackProfiles: RoleGrantProfileSummary[] =
    profiles.length > 0
      ? profiles
      : (["viewer", "creator", "admin"] as SeatRole[]).map((role) => ({
          role,
          label: props.roleLabel(role),
          description: "",
          tierIds: [],
          modelIds: [],
          modelCount: 0,
          seatPriceCents: null,
        }));
  const suggestedRole =
    props.seatSelectedMembers.size > 0
      ? resolveAggregatedSuggestedRole({
          userIds: [...props.seatSelectedMembers.keys()],
          readModel: props.readModel,
          templates: props.seatRoleTemplates,
        })
      : null;
  const showSuggestedHint =
    suggestedRole != null && !props.seatRoleManuallySet && props.seatSelectedMembers.size > 0;
  const positionMode = props.selectedOrgPosition != null;
  const memberMode = props.seatSelectedMembers.size > 0;
  const rightStepLabel = positionMode
    ? t("costBudget.allocation.stepBindModels")
    : t("costBudget.allocation.stepSelectRole");

  return html`
    <div
      class="cost-budget-seats-panel ${props.innerTab === "assign" ? "" : "cost-budget-seats-panel--hidden"}"
      data-testid="seat-assign-form"
    >
      <div class="cost-budget-seat-assign">
        <section class="cost-budget-seat-assign__members">
          <h4 class="cost-budget-seat-assign__step">${t("costBudget.allocation.stepSelectTarget")}</h4>
          ${
            props.readModel
              ? renderCostBudgetSeatMemberPicker({
                  readModel: props.readModel,
                  billingSeats: props.seats,
                  roleTemplates: props.seatRoleTemplates,
                  selectedMembers: props.seatSelectedMembers,
                  assignedSeatUserIds: props.assignedSeatUserIds,
                  query: props.seatOrgTreeQuery,
                  disabled: props.seatActionBusy || !props.client,
                  roleLabel: props.roleLabel,
                  selectedOrgPosition: props.selectedOrgPosition,
                  onQueryChange: props.onQueryChange,
                  onSelectedMembersChange: props.onSelectedMembersChange,
                  onSelectedOrgPositionChange: props.onSelectedOrgPositionChange,
                  onSuggestedRoleChange: props.onSuggestedRoleChange,
                })
              : html`
                  <label>
                    ${t("costBudget.allocation.userId")}
                    <input
                      type="text"
                      placeholder="支持逗号或换行分隔多个用户 ID"
                      .value=${props.seatForm.userId}
                      ?disabled=${props.seatActionBusy || !props.client}
                      @input=${(e: Event) =>
                        props.onUserIdChange((e.target as HTMLInputElement).value)}
                    />
                  </label>
                `
          }
        </section>

        <section class="cost-budget-seat-assign__roles">
          <h4 class="cost-budget-seat-assign__step">${rightStepLabel}</h4>
          ${
            positionMode && props.selectedOrgPosition
              ? renderCostBudgetPositionModelBindingPanel({
                  position: props.selectedOrgPosition,
                  entitledModelIds: props.entitledModelIds,
                  draftModelIds: props.positionModelDraftIds,
                  savedModelIds: props.positionModelSavedIds,
                  dirty: props.positionModelBindingDirty,
                  disabled: props.seatActionBusy || !props.client,
                  defaultRole:
                    props.seatRoleTemplates.positionOverrides[
                      props.selectedOrgPosition.orgSeatId
                    ] ?? null,
                  roleLabel: props.roleLabel,
                  onToggleModel: props.onPositionModelToggle,
                  onDefaultRoleChange: (role) =>
                    props.onPositionOverrideChange(props.selectedOrgPosition!.orgSeatId, role),
                  onSave: props.onPositionModelSave,
                  onCancel: props.onPositionModelCancel,
                  onClearPosition: () => props.onSelectedOrgPositionChange(null),
                })
              : memberMode
                ? html`
                    ${
                      props.readModel
                        ? renderSeatRoleTemplatePanel({
                            readModel: props.readModel,
                            templates: props.seatRoleTemplates,
                            roleLabel: props.roleLabel,
                            disabled: props.seatActionBusy || !props.client,
                            onPrefixRuleChange: props.onPrefixRuleChange,
                            onPositionOverrideChange: props.onPositionOverrideChange,
                          })
                        : nothing
                    }
                    ${
                      showSuggestedHint
                        ? html`
                            <p
                              class="enterprise-hint cost-budget-seat-assign__suggested-role"
                              data-testid="seat-suggested-role-hint"
                            >
                              ${t("costBudget.allocation.suggestedRoleHint", {
                                role: props.roleLabel(suggestedRole),
                              })}
                            </p>
                          `
                        : nothing
                    }
                    <div class="cost-budget-role-cards" data-testid="role-profiles-table">
                      ${fallbackProfiles.map((profile) =>
                        renderRoleCard(
                          profile,
                          props.seatForm.role === profile.role,
                          props.seatActionBusy || !props.client,
                          props.fmtMoney,
                          () => props.onRoleChange(profile.role),
                        ),
                      )}
                    </div>
                    <details
                      class="cost-budget-seat-assign__advanced"
                      ?open=${props.botQuotaAdvancedOpen}
                      @toggle=${(e: Event) => {
                        const open = (e.currentTarget as HTMLDetailsElement).open;
                        if (open !== props.botQuotaAdvancedOpen) {
                          props.onBotQuotaAdvancedToggle();
                        }
                      }}
                    >
                      <summary>${t("costBudget.allocation.advancedToggle")}</summary>
                      <label>
                        ${t("costBudget.allocation.advancedBotQuota")}
                        <input
                          type="number"
                          min="0"
                          .value=${props.seatForm.botQuota}
                          ?disabled=${props.seatActionBusy || !props.client}
                          @input=${(e: Event) =>
                            props.onBotQuotaChange((e.target as HTMLInputElement).value)}
                        />
                      </label>
                    </details>
                  `
                : html`
                    <p class="enterprise-hint cost-budget-seat-assign__idle-hint">
                      ${t("costBudget.allocation.assignIdleHint")}
                    </p>
                  `
          }
        </section>
      </div>

      <div class="cost-budget-seat-assign__sticky" data-testid="seat-assign-sticky">
        ${
          positionMode && props.selectedOrgPosition
            ? html`
                <p class="cost-budget-seat-assign__summary">
                  ${t("costBudget.allocation.positionModelConfirmSummary", {
                    title: props.selectedOrgPosition.title,
                    count: String(props.positionModelDraftIds.size),
                  })}
                </p>
                <button
                  type="button"
                  class="btn primary"
                  data-testid="position-model-sticky-save"
                  ?disabled=${
                    props.seatActionBusy ||
                    !props.client ||
                    !props.positionModelBindingDirty ||
                    props.entitledModelIds.length === 0
                  }
                  @click=${() => props.onPositionModelSave()}
                >
                  ${
                    props.seatActionBusy
                      ? t("costBudget.allocation.busy")
                      : t("costBudget.allocation.positionModelSave")
                  }
                </button>
              `
            : html`
                <p class="cost-budget-seat-assign__summary">
                  ${t("costBudget.allocation.confirmSummary", {
                    count: String(props.assignTargetCount),
                    role: props.roleLabel(props.seatForm.role),
                  })}${
                    props.selectedRoleProfile && props.selectedRoleProfile.modelCount > 0
                      ? t("costBudget.allocation.confirmSummaryModels", {
                          count: String(props.selectedRoleProfile.modelCount),
                        })
                      : ""
                  }
                </p>
                <button
                  type="button"
                  class="btn primary"
                  data-testid="seat-assign-submit"
                  ?disabled=${props.seatActionBusy || !props.client || !props.canSubmit}
                  @click=${() => props.onAssignSubmit()}
                >
                  ${
                    props.seatActionBusy
                      ? t("costBudget.allocation.busy")
                      : props.assignTargetCount > 1
                        ? `${t("costBudget.allocation.assignSubmit")}（${props.assignTargetCount} 人）`
                        : t("costBudget.allocation.assignSubmit")
                  }
                </button>
              `
        }
      </div>
    </div>
  `;
}

function formatUsageQuantity(quantity: number): string {
  if (quantity <= 0) {
    return "—";
  }
  return quantity.toLocaleString("zh-CN");
}

function renderGovernanceSummary(
  props: CostBudgetSeatsPanelProps,
): TemplateResult | typeof nothing {
  const rows = buildSeatGovernanceRows({
    seats: props.seats,
    readModel: props.readModel,
    roleProfiles: props.allocation.roleProfiles,
    analytics: props.analytics,
    attribution: props.attribution,
  });
  if (rows.length === 0) {
    return nothing;
  }
  const summary = buildSeatGovernanceSummary(rows, props.attribution);
  const hasBillingAttribution = props.attribution?.subscribed === true;
  return html`
    <div class="cost-budget-seat-governance-summary" data-testid="seat-governance-summary">
      <span>${t("costBudget.allocation.governanceRoleMix", {
        viewer: String(summary.viewerCount),
        creator: String(summary.creatorCount),
        admin: String(summary.adminCount),
      })}</span>
      <span class="cost-budget-seat-governance-summary__sep">·</span>
      ${
        hasBillingAttribution
          ? html`
              <span
                >${t("costBudget.allocation.governanceCycleSeatCost", {
                  amount: props.fmtMoney(summary.cycleSeatCostCents),
                })}</span
              >
              <span class="cost-budget-seat-governance-summary__sep">·</span>
              <span
                >${t("costBudget.allocation.governanceCycleUsageCost", {
                  amount: props.fmtMoney(summary.cycleUsageCostCents),
                })}</span
              >
              <span class="cost-budget-seat-governance-summary__sep">·</span>
              <span
                ><strong
                  >${t("costBudget.allocation.governanceCycleTotalCost", {
                    amount: props.fmtMoney(summary.cycleTotalCostCents),
                  })}</strong
                ></span
              >
              <span class="cost-budget-seat-governance-summary__sep">·</span>
              <span class="enterprise-hint">${t("costBudget.allocation.governanceBillingHint")}</span>
            `
          : html`
              <span
                >${t("costBudget.allocation.governanceEstimatedSeatCost", {
                  amount: props.fmtMoney(summary.estimatedSeatMonthlyCents),
                })}</span
              >
              <span class="cost-budget-seat-governance-summary__sep">·</span>
              <span class="enterprise-hint">${t("costBudget.allocation.governanceCatalogHint")}</span>
            `
      }
    </div>
  `;
}

function renderUnassignedOrgBanner(
  props: CostBudgetSeatsPanelProps,
): TemplateResult | typeof nothing {
  const pending = listUnassignedOrgMembers(props.readModel, props.assignedSeatUserIds);
  if (pending.length === 0) {
    return nothing;
  }
  return html`
    <div class="callout info cost-budget-seat-governance-alert" data-testid="seat-governance-unassigned">
      <span
        >${t("costBudget.allocation.governanceUnassignedNotice", {
          count: String(pending.length),
        })}</span
      >
      <button
        type="button"
        class="btn btn--sm"
        @click=${() => props.onInnerTabChange("assign")}
      >
        ${t("costBudget.allocation.governanceGoAssign")}
      </button>
    </div>
  `;
}

function governanceColumnClass(
  focus: SeatsGovernanceDrilldownFocus | null,
  column: SeatsGovernanceDrilldownFocus,
): string {
  return focus === column ? "cost-budget-seat-table__col--focus" : "";
}

function renderGovernanceDrilldownBanner(
  props: CostBudgetSeatsPanelProps,
): TemplateResult | typeof nothing {
  if (!props.governanceFocus) {
    return nothing;
  }
  const labelKey =
    props.governanceFocus === "seat"
      ? "costBudget.allocation.governanceDrilldownSeat"
      : props.governanceFocus === "usage"
        ? "costBudget.allocation.governanceDrilldownUsage"
        : "costBudget.allocation.governanceDrilldownTotal";
  return html`
    <div class="callout info cost-budget-seat-governance-drilldown" data-testid="seat-governance-drilldown">
      <span>${t("costBudget.allocation.governanceDrilldownFromOverview")} · ${t(labelKey)}</span>
      <button type="button" class="btn btn--sm" @click=${() => props.onClearGovernanceFocus()}>
        ${t("costBudget.allocation.governanceDrilldownClear")}
      </button>
    </div>
  `;
}

function renderListPanel(props: CostBudgetSeatsPanelProps): TemplateResult {
  const rows = sortSeatGovernanceRowsForDrilldown(
    buildSeatGovernanceRows({
      seats: props.seats,
      readModel: props.readModel,
      roleProfiles: props.allocation.roleProfiles,
      analytics: props.analytics,
      attribution: props.attribution,
    }),
    props.governanceFocus,
  );
  const hasBillingAttribution = props.attribution?.subscribed === true;
  return html`
    <div
      class="cost-budget-seats-panel ${props.innerTab === "list" ? "" : "cost-budget-seats-panel--hidden"}"
      data-testid="seat-list-panel"
    >
      ${renderGovernanceDrilldownBanner(props)}
      ${renderGovernanceSummary(props)}
      ${renderUnassignedOrgBanner(props)}
      ${
        rows.length === 0
          ? html`<div class="enterprise-empty">${t("costBudget.allocation.noSeats")}</div>`
          : html`
              <div class="cost-budget-seat-table-wrap">
                <table class="cost-budget-seat-table cost-budget-seat-table--governance" data-testid="seat-list-table">
                  <thead>
                    <tr>
                      <th>${t("costBudget.allocation.listColDepartment")}</th>
                      <th>${t("costBudget.allocation.listColPosition")}</th>
                      <th>${t("costBudget.allocation.listColMember")}</th>
                      <th>${t("costBudget.allocation.listColRole")}</th>
                      <th>${t("costBudget.allocation.listColModels")}</th>
                      <th class=${governanceColumnClass(props.governanceFocus, "seat")}>
                        ${t("costBudget.allocation.listColSeatCost")}
                      </th>
                      <th>${t("costBudget.allocation.listColUsage")}</th>
                      <th class=${governanceColumnClass(props.governanceFocus, "usage")}>
                        ${t("costBudget.allocation.listColUsageCost")}
                      </th>
                      <th class=${governanceColumnClass(props.governanceFocus, "total")}>
                        ${t("costBudget.allocation.listColTotal")}
                      </th>
                      <th>${t("costBudget.allocation.listColBot")}</th>
                      <th>${t("costBudget.allocation.listColActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(
                      (row) => html`
                        <tr data-testid=${`seat-row-${row.seat.id}`}>
                          <td>${row.department}</td>
                          <td>
                            <strong>${row.positionTitle}</strong>
                          </td>
                          <td>
                            <strong>${row.memberLabel}</strong>
                            <div class="enterprise-hint">${row.seat.userId}</div>
                          </td>
                          <td>
                            <select
                              .value=${row.seat.currentRole}
                              ?disabled=${props.seatActionBusy || !props.client}
                              data-testid=${`seat-role-${row.seat.id}`}
                              @change=${(e: Event) => {
                                props.onSeatRoleChange(
                                  row.seat.id,
                                  (e.target as HTMLSelectElement).value as SeatRole,
                                );
                              }}
                            >
                              <option value="viewer">${props.roleLabel("viewer")}</option>
                              <option value="creator">${props.roleLabel("creator")}</option>
                              <option value="admin">${props.roleLabel("admin")}</option>
                            </select>
                          </td>
                          <td>${row.seat.grantedModelCount}</td>
                          <td class=${governanceColumnClass(props.governanceFocus, "seat")}>
                            ${
                              hasBillingAttribution
                                ? props.fmtMoney(row.cycleSeatCostCents)
                                : row.catalogSeatPriceCents != null
                                  ? html`
                                      ${props.fmtMoney(row.catalogSeatPriceCents)}
                                      <div class="enterprise-hint">
                                        ${t("costBudget.allocation.listCatalogSeatHint")}
                                      </div>
                                    `
                                  : html`<span class="enterprise-hint">${t("costBudget.allocation.listSeatCostPending")}</span>`
                            }
                          </td>
                          <td>${formatUsageQuantity(row.usageQuantity)}</td>
                          <td class=${governanceColumnClass(props.governanceFocus, "usage")}>
                            ${
                              hasBillingAttribution
                                ? props.fmtMoney(row.cycleUsageCostCents)
                                : html`
                                    <span class="enterprise-hint">—</span>
                                  `
                            }
                          </td>
                          <td class=${governanceColumnClass(props.governanceFocus, "total")}>
                            ${
                              hasBillingAttribution
                                ? html`<strong>${props.fmtMoney(row.cycleTotalCostCents)}</strong>`
                                : html`
                                    <span class="enterprise-hint">—</span>
                                  `
                            }
                          </td>
                          <td>${row.seat.botQuota}</td>
                          <td>
                            <button
                              type="button"
                              class="btn btn--sm"
                              data-testid=${`seat-reapply-${row.seat.id}`}
                              ?disabled=${props.seatActionBusy || !props.client}
                              @click=${() => props.onReapplyProfile(row.seat.id, row.seat.currentRole)}
                            >
                              ${t("costBudget.allocation.reapplyProfile")}
                            </button>
                          </td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            `
      }
    </div>
  `;
}

export function renderCostBudgetSeatsPanel(props: CostBudgetSeatsPanelProps): TemplateResult {
  const positionReportProps: CostBudgetPositionReportProps = {
    client: props.client,
    positionAttribution: props.positionAttribution,
    meshAgents: props.readModel?.meshAgents ?? [],
    loading: props.positionReportLoading,
    exportBusy: props.positionReportExportBusy,
    loadError: props.positionReportError,
    hasActiveSubscription: props.hasActiveSubscription,
    periodPreset: props.positionReportPreset,
    customPeriodStart: props.positionReportCustomStart,
    customPeriodEnd: props.positionReportCustomEnd,
    fmtMoney: props.fmtMoney,
    onPeriodPresetChange: props.onPositionReportPresetChange,
    onCustomPeriodChange: props.onPositionReportCustomPeriodChange,
    onReload: props.onReloadPositionReport,
    onExportSummary: props.onExportPositionReportSummary,
    onExportDaily: props.onExportPositionReportDaily,
    collapsedRowIds: props.positionReportCollapsedRows,
    onToggleRowCollapse: props.onTogglePositionReportRowCollapse,
  };
  return html`
    <div class="enterprise-card cost-budget-seats-panel-root" data-testid="seats-allocation-panel">
      ${renderSeatToast(props)}
      ${renderSeatsHeader(props)}
      ${renderInnerTabs(props)}
      ${renderAssignPanel(props)}
      ${renderListPanel(props)}
      <div
        class=${props.innerTab === "report" ? "" : "cost-budget-seats-panel--hidden"}
      >
        ${renderCostBudgetPositionReportPanel(positionReportProps)}
      </div>
    </div>
  `;
}
