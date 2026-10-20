import { html, nothing } from "lit";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import type { HandoverAssetCategory, HandoverAssetCategoryFilter } from "../view-types.ts";
import {
  detectHandoverExceptionFlags,
  formatHandoverExceptionFlagLabel,
  formatHandoverSessionTransferSummary,
  isRedundantHandoverAccessPolicy,
  normalizeCollaborationAssetKey,
  parseHandoverExceptionFlags,
  resolveCollaborationGroupDisplayName,
  resolveHandoverAccessPolicyLabel,
  resolveHandoverSessionDataStatusLabel,
  resolveSeatMemoryScopeId,
} from "./enterprise-handover-asset-helpers.ts";
import {
  buildHandoverOrganizationTree,
  resolveHandoverOrgTreeQuery,
} from "./enterprise-handover-org-tree.ts";
import { handoverStatusLabel } from "./enterprise-handover-status.ts";
import { renderEnterpriseOrgTree } from "./enterprise-org-tree-view.ts";
import {
  type OrganizationEditorPresentation,
  wrapOrganizationEditorPresentation,
} from "./enterprise-org-workspace.ts";
import { renderMeshBadge } from "./enterprise-surface-shared.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

type HandoverFlowStep = "select" | "review" | "confirm" | "done";

type HandoverAssetKind =
  | "agent"
  | "space"
  | "group"
  | "memory"
  | "permission"
  | "connector"
  | "data";

type HandoverAssetRow = {
  id: string;
  kind: HandoverAssetKind;
  category: HandoverAssetCategory;
  assetKey: string;
  name: string;
  typeLabel: string;
  statusLabel: string;
  statusTone: "ok" | "warn" | "danger" | "neutral";
  inheritLabel: string;
  selected: boolean;
  selectable?: boolean;
};

const HANDOVER_ASSET_CATEGORIES: Array<{ id: HandoverAssetCategory; label: string }> = [
  { id: "robot", label: "机器人" },
  { id: "collaboration_group", label: "协作小组" },
  { id: "session_data", label: "会话数据" },
  { id: "knowledge_base", label: "知识库" },
  { id: "other", label: "治理项" },
];

function resolveHandoverFlowStep(
  status: string,
  incomingEmployeeUser?: string | null,
  successorEmail?: string | null,
): HandoverFlowStep {
  const hasSuccessor = Boolean(incomingEmployeeUser?.trim() || successorEmail?.trim());
  switch (status) {
    case "draft":
      return "select";
    case "asset_review":
      return hasSuccessor ? "review" : "select";
    case "pending_approval":
    case "frozen":
      return "confirm";
    case "completed":
    case "rebound":
      return "done";
    default:
      return "review";
  }
}

function handoverFlowIndex(step: HandoverFlowStep) {
  switch (step) {
    case "select":
      return 1;
    case "review":
      return 2;
    case "confirm":
      return 3;
    case "done":
      return 4;
  }
}

function handoverFlowTitle(step: HandoverFlowStep) {
  switch (step) {
    case "select":
      return "选择继任者";
    case "review":
      return "选择继承资产";
    case "confirm":
      return "确认交接";
    case "done":
      return "交接已完成";
  }
}

function handoverFlowDescription(step: HandoverFlowStep) {
  switch (step) {
    case "select":
      return "先确定继任负责人，再进入资产选择与治理确认。";
    case "review":
      return "逐项核对岗位数字人、协作上下文与权限，确认哪些资产将转移给继任者。";
    case "confirm":
      return "确认转移范围与治理状态，提交冻结或完成继任绑定。";
    case "done":
      return "查看交接结果与岗位最新归属。";
  }
}

function isHandoverAssetSelected(
  editor: EnterpriseSurfaceProps["handoverEditor"],
  row: HandoverAssetRow,
): boolean {
  switch (row.kind) {
    case "agent":
      return editor.selectedAgentIds.includes(row.assetKey);
    case "space":
    case "group":
      return editor.selectedSpaceIds.includes(row.assetKey);
    case "memory":
    case "data":
      return editor.selectedDataKeys.includes(row.assetKey);
    case "permission":
      return editor.selectedPolicyIds.includes(row.assetKey);
    case "connector":
      return true;
    default:
      return false;
  }
}

function isHandoverAssetRowSelectable(row: HandoverAssetRow): boolean {
  return row.selectable !== false;
}

function toggleHandoverAssetRow(
  editor: EnterpriseSurfaceProps["handoverEditor"],
  row: HandoverAssetRow,
) {
  if (!isHandoverAssetRowSelectable(row)) {
    return;
  }
  switch (row.kind) {
    case "agent":
      editor.onToggleAgentAsset(row.assetKey);
      return;
    case "space":
    case "group":
      editor.onToggleSpaceAsset(row.assetKey);
      return;
    case "memory":
    case "data":
      editor.onToggleDataAsset(row.assetKey);
      return;
    case "permission":
    case "connector":
      editor.onTogglePolicyAsset(row.assetKey);
      return;
    default:
      return;
  }
}

function buildCollaborationHandoverRows(params: {
  editor: EnterpriseSurfaceProps["handoverEditor"];
  readModel: EnterprisePortReadModel;
  seatId: string | null;
  collaborationSpaces?: EnterpriseSurfaceProps["collaborationSpacesResult"];
}): HandoverAssetRow[] {
  const rows: HandoverAssetRow[] = [];
  const seenKeys = new Set<string>();
  const addRow = (row: HandoverAssetRow) => {
    const dedupeKey = normalizeCollaborationAssetKey(row.assetKey);
    if (seenKeys.has(dedupeKey)) {
      return;
    }
    seenKeys.add(dedupeKey);
    rows.push(row);
  };

  if (params.seatId) {
    for (const group of params.readModel.meshGroups) {
      if (group.ownership.positionId !== params.seatId) {
        continue;
      }
      addRow({
        id: `group:${group.groupId}`,
        kind: "group",
        category: "collaboration_group",
        assetKey: group.groupId,
        name: resolveCollaborationGroupDisplayName(
          params.readModel,
          group.groupId,
          params.collaborationSpaces,
        ),
        typeLabel: "协作小组",
        statusLabel: group.governanceStatus === "normal" ? "可转移" : "待复核",
        statusTone: group.governanceStatus === "normal" ? "ok" : "warn",
        inheritLabel: "完整继承",
        selected: params.editor.selectedSpaceIds.includes(group.groupId),
      });
    }
  }

  for (const spaceId of params.editor.defaultSpaceIds) {
    addRow({
      id: `space:${spaceId}`,
      kind: "space",
      category: "collaboration_group",
      assetKey: spaceId,
      name: resolveCollaborationGroupDisplayName(
        params.readModel,
        spaceId,
        params.collaborationSpaces,
      ),
      typeLabel: "协作小组",
      statusLabel: "可转移",
      statusTone: "ok",
      inheritLabel: "完整继承",
      selected: params.editor.selectedSpaceIds.includes(spaceId),
    });
  }

  return rows;
}

function buildHandoverAssetRows(
  editor: EnterpriseSurfaceProps["handoverEditor"],
  readModel: EnterprisePortReadModel,
  collaborationSpaces?: EnterpriseSurfaceProps["collaborationSpacesResult"],
): HandoverAssetRow[] {
  const rows: HandoverAssetRow[] = [];
  const meshById = new Map(readModel.meshAgents.map((agent) => [agent.agentId, agent] as const));
  const seatId =
    editor.seatId ??
    readModel.seatSummaries.find((seat) => seat.title === editor.seatTitle)?.seatId ??
    null;
  const defaultAgentId = editor.defaultAgentIds[0] ?? null;
  const snapshot = editor.assetSnapshot;
  const reauthRequired = Boolean(snapshot?.connectorCredentialReauthorizationRequired);
  const collaborationIds = new Set<string>([
    ...editor.defaultSpaceIds,
    ...readModel.meshGroups
      .filter((group) => !seatId || group.ownership.positionId === seatId)
      .map((group) => group.groupId),
  ]);
  const agentIds = new Set(editor.defaultAgentIds);
  const seatMemoryScopeId = seatId ? resolveSeatMemoryScopeId(seatId) : null;

  for (const agentId of editor.defaultAgentIds) {
    const agent = meshById.get(agentId);
    rows.push({
      id: `agent:${agentId}`,
      kind: "agent",
      category: "robot",
      assetKey: agentId,
      name: agent?.name ?? agentId,
      typeLabel: agentId === defaultAgentId ? "默认数字人" : "岗位数字人",
      statusLabel:
        agent?.status === "online" ? "运行中" : agent?.status === "offline" ? "已停止" : "待复核",
      statusTone:
        agent?.status === "online" ? "ok" : agent?.status === "offline" ? "warn" : "neutral",
      inheritLabel: "完整继承",
      selected: editor.selectedAgentIds.includes(agentId),
    });
  }

  rows.push(
    ...buildCollaborationHandoverRows({
      editor,
      readModel,
      seatId,
      collaborationSpaces,
    }),
  );

  const sessionTransfer = snapshot?.sessionDataTransfer ?? null;
  const sessionDataAssets = [
    { key: "recent_sessions", label: "会话记录（最近30天）" },
    { key: "history_archive", label: "历史归档（>30天）" },
  ] as const;
  for (const asset of sessionDataAssets) {
    const status = resolveHandoverSessionDataStatusLabel({
      dataKey: asset.key,
      transfer: sessionTransfer,
    });
    rows.push({
      id: `data:${asset.key}`,
      kind: "data",
      category: "session_data",
      assetKey: asset.key,
      name: asset.label,
      typeLabel: "会话数据",
      statusLabel: status.label,
      statusTone: status.tone,
      inheritLabel: asset.key === "history_archive" ? "建议归档" : "完整继承",
      selected: editor.selectedDataKeys.includes(asset.key),
    });
  }

  rows.push({
    id: "data:knowledge",
    kind: "data",
    category: "knowledge_base",
    assetKey: "knowledge",
    name: "共享记忆与岗位资料",
    typeLabel: "知识库",
    statusLabel: "可继承",
    statusTone: "ok",
    inheritLabel: "完整继承",
    selected: editor.selectedDataKeys.includes("knowledge"),
  });

  if (snapshot?.memoryScopes?.length) {
    for (const scope of snapshot.memoryScopes) {
      rows.push({
        id: `memory:${scope.scopeId}`,
        kind: "memory",
        category: "knowledge_base",
        assetKey: scope.scopeId,
        name: scope.scopeId,
        typeLabel: "记忆范围",
        statusLabel: scope.transferClass === "manual_review" ? "需复核" : "可继承",
        statusTone: scope.transferClass === "manual_review" ? "warn" : "ok",
        inheritLabel: scope.transferClass === "manual_review" ? "人工确认" : "完整继承",
        selected: editor.selectedDataKeys.includes("knowledge"),
      });
    }
  }

  for (const policy of [...editor.employeePolicies, ...editor.seatPolicies]) {
    if (
      isRedundantHandoverAccessPolicy({
        policy,
        agentIds,
        collaborationIds,
        seatMemoryScopeId,
      })
    ) {
      continue;
    }
    rows.push({
      id: `permission:${policy.policyId}`,
      kind: "permission",
      category: "other",
      assetKey: policy.policyId,
      name: resolveHandoverAccessPolicyLabel({
        policy,
        seatTitle: editor.seatTitle,
        readModel,
        collaborationSpaces,
      }),
      typeLabel: policy.resourceType === "seat" ? "岗位权限" : "访问权限",
      statusLabel: policy.resourceId.toLowerCase().includes("admin") ? "高权限" : "常规",
      statusTone: policy.resourceId.toLowerCase().includes("admin") ? "warn" : "neutral",
      inheritLabel: policy.resourceType === "seat" ? "随岗位自动继承" : "随岗位继承",
      selected:
        policy.resourceType === "seat" ? true : editor.selectedPolicyIds.includes(policy.policyId),
      selectable: policy.resourceType !== "seat" && policy.resourceType !== "connector",
    });
  }

  for (const profile of snapshot?.connectorProfiles ?? []) {
    rows.push({
      id: `connector:${profile.profileId}`,
      kind: "connector",
      category: "other",
      assetKey: profile.profileId,
      name: profile.profileId,
      typeLabel: "连接器配置",
      statusLabel: profile.credentialReauthorizationRequired ? "需重授权" : "可沿用",
      statusTone: profile.credentialReauthorizationRequired ? "warn" : "ok",
      inheritLabel:
        profile.credentialReauthorizationRequired || reauthRequired ? "需重授权" : "配置沿用",
      selected: true,
      selectable: false,
    });
  }

  return rows;
}

function filterHandoverAssetRows(
  rows: HandoverAssetRow[],
  editor: EnterpriseSurfaceProps["handoverEditor"],
): HandoverAssetRow[] {
  const query = editor.assetQuery.trim().toLowerCase();
  return rows.filter((row) => {
    if (editor.assetKindFilter !== "all" && row.category !== editor.assetKindFilter) {
      return false;
    }
    if (!query) {
      return true;
    }
    const categoryLabel =
      HANDOVER_ASSET_CATEGORIES.find((entry) => entry.id === row.category)?.label ?? "";
    return (
      row.name.toLowerCase().includes(query) ||
      row.typeLabel.toLowerCase().includes(query) ||
      row.statusLabel.toLowerCase().includes(query) ||
      categoryLabel.toLowerCase().includes(query)
    );
  });
}

function groupHandoverAssetRowsByCategory(
  rows: HandoverAssetRow[],
): Array<{ category: HandoverAssetCategory; label: string; rows: HandoverAssetRow[] }> {
  return HANDOVER_ASSET_CATEGORIES.map((entry) => ({
    category: entry.id,
    label: entry.label,
    rows: rows.filter((row) => row.category === entry.id),
  })).filter((group) => group.rows.length > 0);
}

function computeHandoverTransferSummary(rows: HandoverAssetRow[]) {
  const selectableRows = rows.filter((row) => row.selectable !== false);
  const total = selectableRows.length;
  const selected = selectableRows.filter((row) => row.selected).length;
  return {
    total,
    selected,
    retained: Math.max(total - selected, 0),
    successorTotal: selected,
  };
}

function renderHandoverVerticalStepper(flowIndex: number) {
  const steps = [
    { index: 1, label: "选择继任者" },
    { index: 2, label: "选择继承资产" },
    { index: 3, label: "确认交接" },
    { index: 4, label: "完成" },
  ];
  return html`
    <nav class="enterprise-handover-rail__stepper" aria-label="交接步骤">
      ${steps.map(
        (step) => html`
          <div
            class="enterprise-handover-rail__step ${flowIndex === step.index ? "is-active" : flowIndex > step.index ? "is-done" : ""}"
          >
            <span class="enterprise-handover-rail__step-dot">${step.index}</span>
            <span class="enterprise-handover-rail__step-label">${step.label}</span>
          </div>
        `,
      )}
    </nav>
  `;
}

function renderHandoverContextCard(params: {
  title: string;
  seatTitle: string;
  teamLabel: string;
  ownerLabel: string;
  assetCount: number;
  tone?: "outgoing" | "incoming";
}) {
  return html`
    <section
      class="enterprise-handover-context-card enterprise-handover-context-card--${params.tone ?? "outgoing"}"
    >
      <div class="enterprise-handover-context-card__title">${params.title}</div>
      <div class="enterprise-handover-context-card__grid">
        <div><span>岗位名称</span><strong>${params.seatTitle}</strong></div>
        <div><span>所属团队</span><strong>${params.teamLabel}</strong></div>
        <div><span>负责人</span><strong>${params.ownerLabel}</strong></div>
        <div><span>岗位资产</span><strong>${params.assetCount}</strong></div>
      </div>
    </section>
  `;
}

function renderHandoverSessionTransferPanel(
  transfer:
    | import("./enterprise-handover-asset-helpers.ts").EnterpriseHandoverSessionDataTransferSnapshot
    | null
    | undefined,
) {
  const summary = formatHandoverSessionTransferSummary(transfer);
  if (!summary) {
    return nothing;
  }
  return html`
    <section class="enterprise-handover-session-transfer" aria-label="${summary.headline}">
      <div class="enterprise-handover-session-transfer__title">${summary.headline}</div>
      <ul class="enterprise-handover-session-transfer__list">
        ${summary.details.map((line) => html`<li>${line}</li>`)}
      </ul>
      ${
        transfer?.executedAt
          ? html`
              <div class="enterprise-handover-session-transfer__meta">
                执行时间：${transfer.executedAt}
              </div>
            `
          : nothing
      }
    </section>
  `;
}

function renderHandoverOverviewBar(summary: ReturnType<typeof computeHandoverTransferSummary>) {
  return html`
    <div class="enterprise-handover-overview" aria-label="交接概览">
      <div class="enterprise-handover-overview__item">
        <span>岗位原资产</span>
        <strong>${summary.total}</strong>
      </div>
      <div class="enterprise-handover-overview__arrow" aria-hidden="true">→</div>
      <div class="enterprise-handover-overview__item enterprise-handover-overview__item--accent">
        <span>本次转移</span>
        <strong>${summary.selected}</strong>
      </div>
      <div class="enterprise-handover-overview__arrow" aria-hidden="true">→</div>
      <div class="enterprise-handover-overview__item">
        <span>保留/归档</span>
        <strong>${summary.retained}</strong>
      </div>
      <div class="enterprise-handover-overview__item enterprise-handover-overview__item--total">
        <span>继任后合计</span>
        <strong>${summary.successorTotal}</strong>
      </div>
    </div>
  `;
}

function renderHandoverSourceAssetRow(params: {
  editor: EnterpriseSurfaceProps["handoverEditor"];
  row: HandoverAssetRow;
  canEdit: boolean;
}) {
  return html`
    <label class="enterprise-handover-asset-table__row" role="row">
      <span role="cell">
        <input
          type="checkbox"
          .checked=${params.row.selected}
          ?disabled=${!params.canEdit || params.editor.busy || !isHandoverAssetRowSelectable(params.row)}
          @change=${() => toggleHandoverAssetRow(params.editor, params.row)}
        />
      </span>
      <span role="cell" class="enterprise-handover-asset-table__name">${params.row.name}</span>
      <span role="cell">${params.row.typeLabel}</span>
      <span role="cell">${renderMeshBadge(params.row.statusLabel, params.row.statusTone)}</span>
      <span role="cell">${params.row.inheritLabel}</span>
    </label>
  `;
}

function renderHandoverSelectedAssetRow(params: {
  editor: EnterpriseSurfaceProps["handoverEditor"];
  row: HandoverAssetRow;
  canEdit: boolean;
}) {
  return html`
    <div
      class="enterprise-handover-asset-table__row enterprise-handover-asset-table__row--selected"
      role="row"
    >
      <span role="cell" class="enterprise-handover-asset-table__name">${params.row.name}</span>
      <span role="cell">${params.row.typeLabel}</span>
      <span role="cell">${renderMeshBadge(params.row.statusLabel, params.row.statusTone)}</span>
      <span role="cell">
        ${
          !isHandoverAssetRowSelectable(params.row)
            ? nothing
            : html`
                <button
                  class="btn btn--sm"
                  type="button"
                  ?disabled=${!params.canEdit || params.editor.busy}
                  @click=${() => toggleHandoverAssetRow(params.editor, params.row)}
                >
                  移除
                </button>
              `
        }
      </span>
    </div>
  `;
}

function renderHandoverAssetCategorySection(params: {
  label: string;
  count: number;
  selectedCount: number;
  body: ReturnType<typeof html> | Array<ReturnType<typeof html>>;
}) {
  return html`
    <section class="enterprise-handover-asset-category">
      <div class="enterprise-handover-asset-category__header">
        <span class="enterprise-handover-asset-category__title">${params.label}</span>
        <span class="enterprise-handover-asset-category__meta">
          ${params.selectedCount > 0 ? `${params.selectedCount}/` : ""}${params.count}
        </span>
      </div>
      <div class="enterprise-handover-asset-category__body">${params.body}</div>
    </section>
  `;
}

function renderHandoverAssetShuttle(params: {
  editor: EnterpriseSurfaceProps["handoverEditor"];
  rows: HandoverAssetRow[];
  filteredRows: HandoverAssetRow[];
  canEdit: boolean;
}) {
  const selectedRows = params.rows.filter(
    (row) => row.selected && isHandoverAssetRowSelectable(row),
  );
  const transferableRows = params.rows.filter((row) => isHandoverAssetRowSelectable(row));
  const sourceGroups = groupHandoverAssetRowsByCategory(params.filteredRows);
  const selectedGroups = groupHandoverAssetRowsByCategory(selectedRows);
  return html`
    <div class="enterprise-handover-shuttle">
      <div class="enterprise-handover-shuttle__toolbar">
        <label class="field enterprise-handover-shuttle__search">
          <span>搜索资产</span>
          <input
            .value=${params.editor.assetQuery}
            type="search"
            placeholder="名称、分类或状态"
            ?disabled=${params.editor.busy}
            @input=${(event: Event) =>
              params.editor.onAssetQueryChange((event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>资产分类</span>
          <select
            .value=${params.editor.assetKindFilter}
            ?disabled=${params.editor.busy}
            @change=${(event: Event) =>
              params.editor.onAssetKindFilterChange(
                (event.target as HTMLSelectElement).value as HandoverAssetCategoryFilter,
              )}
          >
            <option value="all">全部分类</option>
            ${HANDOVER_ASSET_CATEGORIES.map(
              (entry) => html` <option value=${entry.id}>${entry.label}</option> `,
            )}
          </select>
        </label>
      </div>

      <div class="enterprise-handover-shuttle__grid">
        <section class="enterprise-handover-shuttle__panel">
          <div class="enterprise-handover-shuttle__panel-title">
            岗位可继承资产（${transferableRows.length}）
          </div>
          <div class="enterprise-handover-asset-table" role="table" aria-label="岗位可继承资产">
            <div class="enterprise-handover-asset-table__head" role="row">
              <span role="columnheader"></span>
              <span role="columnheader">资产名称</span>
              <span role="columnheader">类型</span>
              <span role="columnheader">状态</span>
              <span role="columnheader">继承策略</span>
            </div>
            <div class="enterprise-handover-asset-table__body">
              ${
                sourceGroups.length
                  ? sourceGroups.map((group) =>
                      renderHandoverAssetCategorySection({
                        label: group.label,
                        count: group.rows.filter((row) => isHandoverAssetRowSelectable(row)).length,
                        selectedCount: group.rows.filter(
                          (row) => isHandoverAssetRowSelectable(row) && row.selected,
                        ).length,
                        body: group.rows.map((row) =>
                          renderHandoverSourceAssetRow({
                            editor: params.editor,
                            row,
                            canEdit: params.canEdit,
                          }),
                        ),
                      }),
                    )
                  : html`
                      <div class="enterprise-empty enterprise-empty--compact">没有匹配的岗位资产。</div>
                    `
              }
            </div>
          </div>
          <div class="enterprise-handover-shuttle__panel-footer">
            <span>已选择 ${selectedRows.length} 项资产</span>
            <button
              class="btn btn--sm"
              type="button"
              ?disabled=${!params.canEdit || params.editor.busy || selectedRows.length === 0}
              @click=${params.editor.onClearSelectedAssets}
            >
              清空
            </button>
          </div>
        </section>

        <div class="enterprise-handover-shuttle__actions" aria-label="资产穿梭操作">
          <button
            class="btn btn--sm"
            type="button"
            title="加入已选"
            ?disabled=${!params.canEdit || params.editor.busy}
            @click=${params.editor.onSelectFilteredAssets}
          >
            ›
          </button>
          <button
            class="btn btn--sm"
            type="button"
            title="全部加入"
            ?disabled=${!params.canEdit || params.editor.busy}
            @click=${params.editor.onSelectAllAssets}
          >
            ››
          </button>
          <button
            class="btn btn--sm"
            type="button"
            title="移出已选"
            ?disabled=${!params.canEdit || params.editor.busy}
            @click=${params.editor.onClearSelectedAssets}
          >
            ‹
          </button>
          <button
            class="btn btn--sm"
            type="button"
            title="清空已选"
            ?disabled=${!params.canEdit || params.editor.busy}
            @click=${params.editor.onClearSelectedAssets}
          >
            ‹‹
          </button>
        </div>

        <section class="enterprise-handover-shuttle__panel">
          <div class="enterprise-handover-shuttle__panel-title">
            本次转移给继任者（${selectedRows.length}）
          </div>
          <div class="enterprise-handover-asset-table" role="table" aria-label="本次转移资产">
            <div
              class="enterprise-handover-asset-table__head enterprise-handover-asset-table__head--selected"
              role="row"
            >
              <span role="columnheader">资产名称</span>
              <span role="columnheader">类型</span>
              <span role="columnheader">状态</span>
              <span role="columnheader"></span>
            </div>
            <div class="enterprise-handover-asset-table__body">
              ${
                selectedGroups.length
                  ? selectedGroups.map((group) =>
                      renderHandoverAssetCategorySection({
                        label: group.label,
                        count: group.rows.length,
                        selectedCount: group.rows.length,
                        body: group.rows.map((row) =>
                          renderHandoverSelectedAssetRow({
                            editor: params.editor,
                            row,
                            canEdit: params.canEdit,
                          }),
                        ),
                      }),
                    )
                  : html`
                      <div class="enterprise-empty enterprise-empty--compact">请从左侧选择要转移的资产。</div>
                    `
              }
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderHandoverOrgTreeSection(params: {
  readModel: EnterprisePortReadModel;
  editor: EnterpriseSurfaceProps["handoverEditor"];
  handoverSeatId: string | null;
  handoverSeatTitle: string;
  outgoingEmployeeUser: string | null;
  orgTreeQuery: string;
  successorEmail: string;
  busy: boolean;
}) {
  const { departments, positionLookup } = buildHandoverOrganizationTree({
    readModel: params.readModel,
    handoverSeatId: params.handoverSeatId,
    handoverSeatTitle: params.handoverSeatTitle,
    outgoingEmployeeUser: params.outgoingEmployeeUser,
    authenticatedUser: params.readModel.authenticatedUser,
    query: params.orgTreeQuery || undefined,
  });
  return renderEnterpriseOrgTree({
    departments,
    mode: "select-member",
    title: "组织目录",
    hint: "按部门浏览岗位，点击成员选择继任者",
    query: params.orgTreeQuery,
    disabled: params.busy,
    selectedMemberEmail: params.successorEmail,
    highlightSeatId: params.handoverSeatId,
    emptyLabel: "暂无匹配岗位，请调整关键词后重试。",
    autoExpandAll: false,
    onSelectMember: (user) => params.editor.onSuccessorEmailChange(user),
    isMemberSelectable: (member, position) =>
      positionLookup.get(position.seatId)?.selectable ?? false,
    renderPositionBadge: (position) =>
      positionLookup.get(position.seatId)?.isHandoverSeat ? "交接岗位" : null,
  });
}

export function renderHandoverEditor(
  props: EnterpriseSurfaceProps,
  options?: { presentation?: OrganizationEditorPresentation },
) {
  const presentation = options?.presentation ?? "modal";
  const caseId = props.handoverEditor.caseId;
  if (!caseId) {
    return nothing;
  }
  const handover =
    props.readModel.handoverSummaries.find((entry) => entry.handoverCaseId === caseId) ?? null;
  if (!handover) {
    return nothing;
  }

  const editor = props.handoverEditor;
  const status = editor.status ?? handover.status;
  const nominatedSuccessor = handover.incomingEmployeeUser?.trim() || null;
  const successorEmail = editor.successorEmail.trim() || nominatedSuccessor || "";
  const canNominate =
    status === "draft" || (status === "asset_review" && !nominatedSuccessor && !successorEmail);
  const hasSuccessor = Boolean(nominatedSuccessor || successorEmail);
  const canEditAssets = status === "asset_review" && !editor.busy;
  const canSubmitReview = canEditAssets && hasSuccessor && editor.reviewSummary.trim().length > 0;
  const canApprove = status === "pending_approval";
  const canRebind = status === "frozen";
  const reviewSummary = editor.reviewSummary.trim();
  const statusLabel = handoverStatusLabel(status);
  const flowStep = resolveHandoverFlowStep(status, nominatedSuccessor, successorEmail);
  const flowIndex = handoverFlowIndex(flowStep);
  const seatTitle = editor.seatTitle || handover.seatTitle;
  const teamLabel = editor.teamLabel?.trim() || "未分组";
  const currentUser =
    editor.currentEmployeeDisplayName ||
    editor.currentEmployeeEmail ||
    handover.outgoingEmployeeUser ||
    "待确认";
  const incomingMember =
    props.readModel.memberSummaries.find((member) => member.user === successorEmail) ?? null;
  const incomingOwnerLabel = incomingMember?.displayLabel || successorEmail || "继任者（未指定）";
  const assetRows = buildHandoverAssetRows(
    editor,
    props.readModel,
    props.collaborationSpacesResult,
  );
  const filteredRows = filterHandoverAssetRows(assetRows, editor).map((row) => ({
    ...row,
    selected: isHandoverAssetSelected(editor, row),
  }));
  const transferSummary = computeHandoverTransferSummary(
    assetRows.map((row) => ({
      ...row,
      selected: isHandoverAssetSelected(editor, row),
    })),
  );

  const seatTeamByTitle = new Map(
    props.readModel.seatSummaries.map((seat) => [seat.title, seat.teamLabel] as const),
  );
  const memberQuery = editor.successorEmail.trim().toLowerCase();
  const orgTreeQuery = resolveHandoverOrgTreeQuery({
    successorEmail: editor.successorEmail,
    readModel: props.readModel,
  });
  const successorCandidates = [...props.readModel.memberSummaries]
    .filter(
      (member) =>
        member.status === "active" &&
        member.user !== handover.outgoingEmployeeUser &&
        member.user !== props.readModel.authenticatedUser,
    )
    .filter((member) => {
      if (!memberQuery) {
        return true;
      }
      const teamLabel = member.seatTitle ? (seatTeamByTitle.get(member.seatTitle) ?? "") : "";
      return (
        member.user.toLowerCase().includes(memberQuery) ||
        member.displayLabel.toLowerCase().includes(memberQuery) ||
        (member.seatTitle?.toLowerCase().includes(memberQuery) ?? false) ||
        teamLabel.toLowerCase().includes(memberQuery)
      );
    })
    .toSorted((left, right) => {
      const leftScore = (left.membershipRole === "member" ? 2 : 0) + (left.seatTitle ? 0 : 1);
      const rightScore = (right.membershipRole === "member" ? 2 : 0) + (right.seatTitle ? 0 : 1);
      return rightScore - leftScore || left.displayLabel.localeCompare(right.displayLabel);
    })
    .slice(0, memberQuery ? 20 : 5);
  const handoverSeatId =
    editor.seatId ??
    props.readModel.seatSummaries.find((seat) => seat.title === seatTitle)?.seatId ??
    null;
  const detectedExceptionFlags = detectHandoverExceptionFlags({
    connectorCredentialReauthorizationRequired:
      editor.assetSnapshot?.connectorCredentialReauthorizationRequired,
    memoryScopes: editor.assetSnapshot?.memoryScopes,
  });
  const exceptionFlags = parseHandoverExceptionFlags(editor.exceptionFlags);

  const riskItems = [
    canNominate && !successorEmail ? "继任者未指定，无法进入资产选择。" : null,
    incomingMember?.seatTitle ? `继任者当前已绑定岗位：${incomingMember.seatTitle}` : null,
    canEditAssets && transferSummary.selected === 0 ? "尚未选择任何继承资产。" : null,
    canEditAssets && !reviewSummary ? "资产审查摘要未完成。" : null,
    editor.exceptionFlags ? `存在异常标记：${editor.exceptionFlags}` : null,
    editor.assetSnapshot?.connectorCredentialReauthorizationRequired
      ? "继任后部分连接器凭证需要重新授权。"
      : null,
  ].filter(Boolean) as string[];

  const primaryLabel = canNominate
    ? "确认继任者"
    : canEditAssets
      ? "确认资产并提交审查"
      : canApprove
        ? "提交审批冻结"
        : canRebind
          ? "完成继任绑定"
          : "关闭";

  return wrapOrganizationEditorPresentation({
    presentation,
    ariaLabel: "岗位交接",
    panelClass:
      presentation === "workspace"
        ? "enterprise-org-workspace--panel enterprise-handover-panel"
        : "enterprise-handover-panel",
    onClose: () => editor.onClose(),
    content: html`
      <header class="enterprise-handover-panel__header">
        <div class="enterprise-handover-panel__intro">
          <div class="enterprise-handover-panel__title">岗位交接</div>
          <div class="enterprise-handover-panel__subtitle">${seatTitle} · 资产与岗位绑定转移</div>
        </div>
        <button class="btn btn--sm" type="button" @click=${editor.onClose}>关闭</button>
      </header>

      <div class="enterprise-handover-panel__body">
        <aside class="enterprise-handover-panel__rail">
          ${renderHandoverVerticalStepper(flowIndex)}
          ${renderHandoverContextCard({
            title: "当前迁出岗位",
            seatTitle,
            teamLabel,
            ownerLabel: currentUser,
            assetCount: transferSummary.total,
            tone: "outgoing",
          })}
          ${renderHandoverContextCard({
            title: "继任接收",
            seatTitle,
            teamLabel,
            ownerLabel: incomingOwnerLabel,
            assetCount: transferSummary.successorTotal,
            tone: "incoming",
          })}
          ${
            riskItems.length
              ? html`
                  <section class="enterprise-handover-context-card">
                    <div class="enterprise-handover-context-card__title">风险提示</div>
                    <div class="enterprise-handover-risk-list">
                      ${riskItems.map(
                        (item) => html`
                          <div class="enterprise-handover-risk">
                            <span>⚠</span>
                            <strong>${item}</strong>
                          </div>
                        `,
                      )}
                    </div>
                  </section>
                `
              : nothing
          }
        </aside>

        <main class="enterprise-handover-panel__main">
          <section class="enterprise-handover-step">
            <div class="enterprise-handover-step__header">
              <div>
                <div class="enterprise-handover-step__title">${handoverFlowTitle(flowStep)}</div>
                <div class="enterprise-handover-step__subtitle">
                  ${handoverFlowDescription(flowStep)}
                </div>
              </div>
              ${renderMeshBadge(statusLabel, "ok")}
            </div>

            ${
              flowStep === "select"
                ? html`
                    <div class="enterprise-handover-search">
                      <label class="field" style="grid-column: 1 / -1;">
                        <span>搜索成员</span>
                        <input
                          .value=${editor.successorEmail}
                          type="search"
                          placeholder="姓名、邮箱、岗位或部门关键词"
                          ?disabled=${editor.busy}
                          @input=${(event: Event) =>
                            editor.onSuccessorEmailChange((event.target as HTMLInputElement).value)}
                        />
                      </label>
                    </div>
                    ${renderHandoverOrgTreeSection({
                      readModel: props.readModel,
                      editor,
                      handoverSeatId,
                      handoverSeatTitle: seatTitle,
                      outgoingEmployeeUser: handover.outgoingEmployeeUser,
                      orgTreeQuery,
                      successorEmail,
                      busy: editor.busy,
                    })}
                    <div class="enterprise-handover-candidate-list__title">
                      ${memberQuery ? "关键词匹配" : "推荐继任者"}
                    </div>
                    <div class="enterprise-handover-candidate-list">
                      ${
                        successorCandidates.length
                          ? successorCandidates.map((candidate, index) => {
                              const selected = candidate.user === successorEmail;
                              const teamLabel = candidate.seatTitle
                                ? (seatTeamByTitle.get(candidate.seatTitle) ?? "未分组")
                                : "未绑定岗位";
                              return html`
                                <div
                                  class="enterprise-handover-candidate ${selected ? "is-selected" : ""}"
                                >
                                  <div class="enterprise-handover-candidate__main">
                                    <div class="enterprise-handover-candidate__title">
                                      ${candidate.displayLabel}
                                      ${
                                        index === 0 && !memberQuery
                                          ? html`
                                              <span class="enterprise-handover-candidate__badge">推荐</span>
                                            `
                                          : nothing
                                      }
                                    </div>
                                    <div class="enterprise-handover-candidate__meta">
                                      ${candidate.user} · ${teamLabel} ·
                                      ${candidate.seatTitle ?? "当前未绑定岗位"}
                                    </div>
                                  </div>
                                  <button
                                    class="btn btn--sm ${selected ? "btn--primary" : ""}"
                                    type="button"
                                    @click=${() => editor.onSuccessorEmailChange(candidate.user)}
                                  >
                                    ${selected ? "已选择" : "选择"}
                                  </button>
                                </div>
                              `;
                            })
                          : html`
                              <div class="enterprise-empty enterprise-empty--compact">未找到匹配成员，请调整关键词后重试。</div>
                            `
                      }
                    </div>
                  `
                : flowStep === "review"
                  ? html`
                      ${renderHandoverAssetShuttle({
                        editor,
                        rows: assetRows.map((row) => ({
                          ...row,
                          selected: isHandoverAssetSelected(editor, row),
                        })),
                        filteredRows,
                        canEdit: canEditAssets,
                      })}
                      <div class="form-grid" style="margin-top: 16px;">
                        <label class="field" style="grid-column: 1 / -1;">
                          <span>交接审查摘要</span>
                          <textarea
                            rows="3"
                            .value=${editor.reviewSummary}
                            ?disabled=${!canEditAssets || editor.busy}
                            placeholder="说明本次资产转移范围、风险项与需继任者复核的内容。"
                            @input=${(event: Event) =>
                              editor.onReviewSummaryChange(
                                (event.target as HTMLTextAreaElement).value,
                              )}
                          ></textarea>
                        </label>
                        <label class="field" style="grid-column: 1 / -1;">
                          <span>异常标记</span>
                          ${
                            detectedExceptionFlags.length
                              ? html`
                                  <div class="enterprise-handover-exception-flags">
                                    ${detectedExceptionFlags.map(
                                      (flag) => html`
                                        <span class="enterprise-handover-exception-flag">
                                          ${formatHandoverExceptionFlagLabel(flag)}
                                        </span>
                                      `,
                                    )}
                                  </div>
                                `
                              : nothing
                          }
                          <input
                            .value=${editor.exceptionFlags}
                            ?disabled=${!canEditAssets || editor.busy}
                            placeholder="可补充记录：connector_rebind_required, memory_review_pending"
                            @input=${(event: Event) =>
                              editor.onExceptionFlagsChange(
                                (event.target as HTMLInputElement).value,
                              )}
                          />
                          ${
                            exceptionFlags.length
                              ? html`
                                  <small class="enterprise-handover-exception-hint">
                                    已记录：${exceptionFlags
                                      .map((flag) => formatHandoverExceptionFlagLabel(flag))
                                      .join("；")}
                                  </small>
                                `
                              : html`
                                  <small class="enterprise-handover-exception-hint">
                                    系统会在检测到连接器重授权或知识库复核项时自动提示。
                                  </small>
                                `
                          }
                        </label>
                      </div>
                    `
                  : flowStep === "confirm"
                    ? html`
                        <div class="enterprise-handover-summary-grid">
                          <div class="enterprise-handover-summary-card">
                            <span>岗位</span>
                            <strong>${seatTitle}</strong>
                          </div>
                          <div class="enterprise-handover-summary-card">
                            <span>原负责人</span>
                            <strong>${currentUser}</strong>
                          </div>
                          <div class="enterprise-handover-summary-card">
                            <span>继任者</span>
                            <strong>${successorEmail || "未指定"}</strong>
                          </div>
                          <div class="enterprise-handover-summary-card">
                            <span>治理状态</span>
                            <strong>${statusLabel}</strong>
                          </div>
                        </div>
                        <div class="enterprise-handover-note">
                          已选择 ${transferSummary.selected}
                          项资产转移给继任者，${transferSummary.retained} 项将保留或归档。
                        </div>
                        ${renderHandoverSessionTransferPanel(editor.assetSnapshot?.sessionDataTransfer)}
                      `
                    : html`
                        <div class="enterprise-handover-complete">
                          <div class="enterprise-handover-complete__title">交接已完成</div>
                          <div class="enterprise-handover-complete__meta">
                            岗位：${seatTitle} ·
                            新负责人：${successorEmail || handover.incomingEmployeeUser || "待确认"}
                          </div>
                        </div>
                        ${renderHandoverSessionTransferPanel(editor.assetSnapshot?.sessionDataTransfer)}
                      `
            }
          </section>

          ${
            editor.error
              ? html`<div class="enterprise-handover-banner enterprise-handover-banner--danger">
                  ${editor.error}
                </div>`
              : nothing
          }
          ${
            editor.notice
              ? html`<div class="enterprise-handover-banner enterprise-handover-banner--ok">
                  ${editor.notice}
                </div>`
              : nothing
          }
        </main>
      </div>

      <footer class="enterprise-handover-panel__footer">
        ${renderHandoverOverviewBar(transferSummary)}
        <div class="enterprise-handover-panel__actions">
          <button class="btn" type="button" @click=${editor.onClose}>取消交接</button>
          ${
            canNominate
              ? html`
                  <button
                    class="btn btn--primary"
                    type="button"
                    ?disabled=${editor.busy || !successorEmail}
                    @click=${editor.onSubmitNominate}
                  >
                    ${editor.busy ? "提交中..." : primaryLabel}
                  </button>
                `
              : canEditAssets
                ? html`
                    <button
                      class="btn btn--primary"
                      type="button"
                      ?disabled=${editor.busy || !canSubmitReview || transferSummary.selected === 0}
                      @click=${editor.onSubmitReview}
                    >
                      ${editor.busy ? "提交中..." : primaryLabel}
                    </button>
                  `
                : canApprove
                  ? html`
                      <button
                        class="btn btn--primary"
                        type="button"
                        ?disabled=${editor.busy}
                        @click=${editor.onSubmitApproval}
                      >
                        ${editor.busy ? "处理中..." : primaryLabel}
                      </button>
                    `
                  : canRebind
                    ? html`
                        <button
                          class="btn btn--primary"
                          type="button"
                          ?disabled=${editor.busy || !successorEmail}
                          @click=${editor.onSubmitRebind}
                        >
                          ${editor.busy ? "处理中..." : primaryLabel}
                        </button>
                      `
                    : html`
                        <button class="btn btn--primary" type="button" @click=${editor.onClose}>
                          ${primaryLabel}
                        </button>
                      `
          }
        </div>
      </footer>
    `,
  });
}
