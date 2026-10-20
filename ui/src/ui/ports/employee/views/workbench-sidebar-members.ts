import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { GrowthStatusView } from "../semantic/view-controller-facade.ts";
import { runWorkbenchNavSelection } from "./workbench-actions.ts";
import { renderNavItem } from "./workbench-chrome.ts";
import type { WorkbenchSpaceNavItem } from "./workbench-nav-model.ts";
import type { WorkbenchSidebarMembersProps } from "./workbench-types.ts";

type CollaborationNavItem = WorkbenchSpaceNavItem;

type SidebarShellModel = {
  primaryModule: string;
  selectedNavKey: string;
};

export function selectCollaborationSpaceEntry(
  item: CollaborationNavItem,
  handlers: WorkbenchSidebarMembersProps,
) {
  if (
    handlers.onPrimaryModuleChange &&
    handlers.onTeamSelectedKeyChange &&
    handlers.onSelectSession
  ) {
    runWorkbenchNavSelection(
      {
        module: "collaboration",
        selectionKey: item.selectionKey,
        sourceKey: item.sourceKey ?? null,
      },
      {
        onPrimaryModuleChange: handlers.onPrimaryModuleChange,
        onTeamSelectedKeyChange: handlers.onTeamSelectedKeyChange,
        onSelectSession: handlers.onSelectSession,
      },
    );
  }
  handlers.onGroupProfileViewChange?.("chat");
  if (item.directoryChannelId?.trim()) {
    void handlers.onLoadGroupMembers?.({
      selectionKey: item.selectionKey,
      channelId: item.directoryChannelId,
      title: item.rawTitle ?? item.title,
      fallbackGroupId: item.directoryGroupId ?? null,
    });
  }
}

function renderMemberPreview(
  membersProps: WorkbenchSidebarMembersProps,
  item: CollaborationNavItem,
) {
  const members = membersProps.groupMembersBySelectionKey?.[item.selectionKey] ?? [];
  if (members.length === 0) {
    return nothing;
  }
  const labels = members
    .slice(0, 3)
    .map((entry) => entry.name?.trim() || entry.handle?.trim())
    .filter(Boolean);
  if (labels.length === 0) {
    return nothing;
  }
  return html`
    <div class="employee-workbench__sidebar-space-members">
      ${t("frontstage.workbench.team.membersPreview", {
        count: String(members.length),
      })}
      · ${labels.join(" / ")}
    </div>
  `;
}

function resolveSpaceGrowthStatus(
  item: CollaborationNavItem,
  membersProps: WorkbenchSidebarMembersProps,
): GrowthStatusView | null {
  const fromMap = membersProps.growthStatusBySelectionKey?.[item.selectionKey];
  if (fromMap) {
    return fromMap;
  }
  if (item.selectionKey === membersProps.activeSessionKey && membersProps.activeGrowthStatus) {
    return membersProps.activeGrowthStatus;
  }
  return null;
}

export function renderSidebarSpaceEntries(
  items: WorkbenchSpaceNavItem[],
  shellModel: SidebarShellModel,
  membersProps: WorkbenchSidebarMembersProps,
  _resolvedModel?: unknown,
) {
  return items.map(
    (item) =>
      html`
        <div class="employee-workbench__sidebar-space-entry">
        ${renderNavItem({
          ...item,
          growthStatus: resolveSpaceGrowthStatus(item, membersProps),
          active:
            shellModel.primaryModule === "collaboration" &&
            (item.selectionKey === shellModel.selectedNavKey || item.active),
          onClick: () => selectCollaborationSpaceEntry(item, membersProps),
        })}
        ${renderMemberPreview(membersProps, item)}
        </div>
      `,
  );
}
