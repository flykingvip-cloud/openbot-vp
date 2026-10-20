import { html, nothing } from "lit";
import { t } from "../../../i18n/index.ts";
import type { SeatRole, SeatWithGrantSummary } from "../../capability/cost-budget-billing/index.ts";
import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import { buildEnterpriseOrgTree } from "../../ports/enterprise/views/enterprise-org-tree-model.ts";
import { renderEnterpriseOrgTree } from "../../ports/enterprise/views/enterprise-org-tree-view.ts";
import type { SelectedOrgPosition } from "./cost-budget-position-model-binding.ts";
import {
  buildBillingRoleByUserId,
  buildSuggestedRoleByOrgSeatId,
  resolveAggregatedSuggestedRole,
  seatRoleShortLabel,
  type SeatRoleTemplateStore,
} from "./cost-budget-seat-role-templates.ts";
import {
  addSeatMemberSelections,
  collectAssignableMembersFromDepartment,
  findEnterpriseOrgDepartment,
  isSeatMemberAssignable,
  listSeatMemberSelections,
  removeSeatMemberSelection,
  toggleSeatMemberSelection,
} from "./cost-budget-seat-selection.ts";

export function listCostBudgetUnboundMembers(
  readModel: EnterprisePortReadModel,
  assignedSeatUserIds: ReadonlySet<string>,
) {
  return readModel.memberSummaries.filter(
    (member) =>
      member.status === "active" &&
      !member.seatTitle?.trim() &&
      isSeatMemberAssignable(member.user, assignedSeatUserIds),
  );
}

export function renderCostBudgetSeatMemberPicker(params: {
  readModel: EnterprisePortReadModel;
  billingSeats: ReadonlyArray<SeatWithGrantSummary>;
  roleTemplates: SeatRoleTemplateStore;
  selectedMembers: Map<string, string>;
  assignedSeatUserIds: ReadonlySet<string>;
  query: string;
  disabled: boolean;
  roleLabel: (role: SeatRole) => string;
  onQueryChange: (value: string) => void;
  onSelectedMembersChange: (selected: Map<string, string>) => void;
  onSuggestedRoleChange?: (role: SeatRole) => void;
  selectedOrgPosition?: SelectedOrgPosition | null;
  onSelectedOrgPositionChange?: (position: SelectedOrgPosition | null) => void;
}) {
  const departments = buildEnterpriseOrgTree({
    readModel: params.readModel,
    query: params.query || undefined,
    includeVacantPositions: true,
  });
  const billingRoleByUserId = buildBillingRoleByUserId(params.billingSeats);
  const suggestedRoleByOrgSeatId = buildSuggestedRoleByOrgSeatId({
    readModel: params.readModel,
    templates: params.roleTemplates,
    billingRoleByUserId,
  });
  const formatBillingRoleLabel = (role: string) => {
    const short = seatRoleShortLabel(role as SeatRole);
    return params.roleLabel(role as SeatRole).includes(short)
      ? params.roleLabel(role as SeatRole)
      : short;
  };

  const unboundMembers = listCostBudgetUnboundMembers(
    params.readModel,
    params.assignedSeatUserIds,
  ).filter((member) => {
    const query = params.query.trim().toLowerCase();
    if (!query) {
      return true;
    }
    const haystack = [member.displayLabel, member.user].join(" ").toLowerCase();
    return haystack.includes(query);
  });
  const selectedMembers = listSeatMemberSelections(params.selectedMembers);
  const selectedMemberEmails = new Set(params.selectedMembers.keys());
  const skippedAssignedCount = params.assignedSeatUserIds.size;

  const applySelection = (selected: Map<string, string>) => {
    if (selected.size > 0) {
      params.onSelectedOrgPositionChange?.(null);
    }
    params.onSelectedMembersChange(selected);
    if (params.onSuggestedRoleChange) {
      const userIds = [...selected.keys()];
      const suggested = resolveAggregatedSuggestedRole({
        userIds,
        readModel: params.readModel,
        templates: params.roleTemplates,
      });
      params.onSuggestedRoleChange(suggested);
    }
  };

  const selectOrgPosition = (position: SelectedOrgPosition) => {
    params.onSelectedOrgPositionChange?.(position);
    if (params.selectedMembers.size > 0) {
      params.onSelectedMembersChange(new Map());
    }
  };

  const toggleMember = (userId: string, displayLabel: string) => {
    applySelection(
      toggleSeatMemberSelection(
        params.selectedMembers,
        userId,
        displayLabel,
        params.assignedSeatUserIds,
      ),
    );
  };

  const selectDepartmentMembers = (departmentPath: string) => {
    const department = findEnterpriseOrgDepartment(departments, departmentPath);
    if (!department) {
      return;
    }
    const members = collectAssignableMembersFromDepartment(department, params.assignedSeatUserIds);
    if (members.length === 0) {
      return;
    }
    applySelection(addSeatMemberSelections(params.selectedMembers, members));
  };

  return html`
    <div class="cost-budget-seat-member-picker" data-testid="seat-member-picker">
      <label class="cost-budget-seat-member-picker__search">
        ${t("costBudget.allocation.searchMembers")}
        <input
          type="search"
          placeholder=${t("costBudget.allocation.searchPlaceholder")}
          .value=${params.query}
          ?disabled=${params.disabled}
          @input=${(event: Event) =>
            params.onQueryChange((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <div class="cost-budget-seat-member-picker__summary" data-testid="seat-member-selected">
        <div class="cost-budget-seat-member-picker__summary-head">
          <span
            >${t("costBudget.allocation.selectedCount", {
              count: String(selectedMembers.length),
            })}</span
          >
          ${
            params.selectedOrgPosition
              ? html`
                  <span class="cost-budget-seat-member-picker__position-chip">
                    ${t("costBudget.allocation.selectedPosition", {
                      title: params.selectedOrgPosition.title,
                    })}
                  </span>
                `
              : nothing
          }
          ${
            skippedAssignedCount > 0
              ? html`
                  <span class="cost-budget-seat-member-picker__skip-note enterprise-hint">
                    ${t("costBudget.allocation.skipAssignedNoteShort", {
                      count: String(skippedAssignedCount),
                    })}
                  </span>
                `
              : nothing
          }
          ${
            selectedMembers.length > 0
              ? html`
                  <button
                    type="button"
                    class="btn btn--sm"
                    ?disabled=${params.disabled}
                    @click=${() => applySelection(new Map())}
                  >
                    ${t("costBudget.allocation.clearSelection")}
                  </button>
                `
              : nothing
          }
        </div>
        ${
          selectedMembers.length > 0
            ? html`
                <div class="chip-row cost-budget-seat-member-picker__chips">
                  ${selectedMembers.map(
                    (member) => html`
                      <button
                        type="button"
                        class="chip ok"
                        title=${member.userId}
                        ?disabled=${params.disabled}
                        @click=${() =>
                          applySelection(
                            removeSeatMemberSelection(params.selectedMembers, member.userId),
                          )}
                      >
                        ${member.displayLabel} ×
                      </button>
                    `,
                  )}
                </div>
              `
            : nothing
        }
      </div>
      <div class="cost-budget-seat-member-picker__tree">
        ${renderEnterpriseOrgTree({
          departments,
          mode: "select-member",
          title: t("costBudget.allocation.orgTreeTitle"),
          hint: t("costBudget.allocation.orgTreeHintWithBadgesAndPosition"),
          query: params.query,
          disabled: params.disabled,
          selectedMemberEmails,
          selectedSeatId: params.selectedOrgPosition?.orgSeatId ?? null,
          assignedSeatUserIds: params.assignedSeatUserIds,
          billingRoleByUserId,
          suggestedRoleByOrgSeatId,
          formatBillingRoleLabel,
          emptyLabel: t("costBudget.allocation.orgTreeEmpty"),
          autoExpandAll: Boolean(params.query.trim()),
          onSelectPosition: (seatId, teamLabel) => {
            const seat =
              params.readModel.seatSummaries.find((entry) => entry.seatId === seatId) ?? null;
            if (!seat) {
              return;
            }
            selectOrgPosition({
              orgSeatId: seatId,
              title: seat.title,
              teamLabel,
            });
          },
          renderPositionBadge: (position) => {
            if (position.member) {
              return null;
            }
            const suggested = suggestedRoleByOrgSeatId.get(position.seatId);
            return suggested
              ? t("costBudget.allocation.orgTreeSuggestedBadge", {
                  role: formatBillingRoleLabel(suggested),
                })
              : null;
          },
          onSelectMember: (user) => {
            const member =
              params.readModel.memberSummaries.find((entry) => entry.user === user) ?? null;
            toggleMember(user, member?.displayLabel?.trim() || user);
          },
          onSelectDepartmentMembers: selectDepartmentMembers,
          isMemberSelectable: (member) =>
            member.status === "active" &&
            isSeatMemberAssignable(member.user, params.assignedSeatUserIds),
        })}
      </div>
      ${
        unboundMembers.length > 0
          ? html`
              <div class="cost-budget-seat-member-picker__unbound">
                <div class="cost-budget-seat-member-picker__unbound-title">
                  ${t("costBudget.allocation.unboundMembers")}
                </div>
                <div class="chip-row">
                  ${unboundMembers.map(
                    (member) => html`
                      <button
                        type="button"
                        class="chip ${params.selectedMembers.has(member.user) ? "ok" : ""}"
                        ?disabled=${params.disabled}
                        @click=${() => toggleMember(member.user, member.displayLabel)}
                      >
                        ${member.displayLabel}
                      </button>
                    `,
                  )}
                </div>
              </div>
            `
          : nothing
      }
    </div>
  `;
}
