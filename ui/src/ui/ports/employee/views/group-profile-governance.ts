import { html } from "lit";
import { t } from "../../../../i18n/index.ts";
import { renderCollaborationObservabilityPanel } from "../../../collaboration/collaboration-observability-panel.ts";
import { icons } from "../../../icons.ts";
import type { UsageCostClient } from "../../../views/usage-cost/usage-cost-client.ts";
import { renderUsageCostDisclosure } from "../../../views/usage-cost/usage-cost-panel.ts";
import type {
  GroupProfileView,
  WorkbenchCollaborationGovernanceSnapshot,
  WorkbenchGovernanceObjectKind,
  WorkbenchGovernanceTransitionOpts,
} from "./workbench-types.ts";

type GovernanceTransitionHandler = (
  kind: WorkbenchGovernanceObjectKind,
  id: string,
  toStatus: string,
  opts?: WorkbenchGovernanceTransitionOpts,
) => void;

function readLabel(key: string, fallback: string) {
  const value = t(key);
  return value === key ? fallback : value;
}

function toUniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function readFormText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

function splitHandoffList(value: FormDataEntryValue | null) {
  return toUniqueStrings(readFormText(value).split(/[,，\n]/));
}

function readHandoffField(data: FormData, name: string) {
  return readFormText(data.get(name)).trim();
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : readLabel("common.na", "N/A");
}

function formatValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return readLabel("common.na", "N/A");
  }
  return String(value);
}

function formatTimestamp(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return readLabel("common.na", "N/A");
  }
  return new Date(value).toLocaleString();
}

function renderObservabilitySection(snapshot: WorkbenchCollaborationGovernanceSnapshot) {
  return renderCollaborationObservabilityPanel({
    loading: snapshot.observabilityLoading === true,
    error: snapshot.observabilityError ?? null,
    snapshot: snapshot.observabilitySnapshot ?? null,
    onRefresh: snapshot.onRefreshCollaborationObservability ?? null,
  });
}

function parsePolicyFilters(filters: string[]) {
  const allow = new Set<string>();
  const block = new Set<string>();

  for (const filter of filters.map((entry) => entry.trim()).filter(Boolean)) {
    if (filter.startsWith("allow:")) {
      allow.add(filter.slice("allow:".length).trim());
      continue;
    }
    if (filter.startsWith("block:")) {
      block.add(filter.slice("block:".length).trim());
      continue;
    }
    if (filter.startsWith("!")) {
      block.add(filter.slice(1).trim());
      continue;
    }
    allow.add(filter);
  }

  return { allow, block };
}

function readAssetCapabilities(snapshot: WorkbenchCollaborationGovernanceSnapshot): string[] {
  const assets = snapshot.learningObjects?.assets ?? [];
  return toUniqueStrings(
    assets.flatMap((asset) =>
      Array.isArray(asset.abstractedContent?.capabilities)
        ? asset.abstractedContent.capabilities.filter(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          )
        : [],
    ),
  );
}

function resolveCapabilityContext(snapshot: WorkbenchCollaborationGovernanceSnapshot) {
  const personal = toUniqueStrings(snapshot.personalCapabilities);
  const group = toUniqueStrings(snapshot.groupProfile?.enabledSkills ?? []);
  const collaborationScoped = toUniqueStrings(
    snapshot.participationOverlay?.overlayCapabilities ?? [],
  );
  const learned = readAssetCapabilities(snapshot);
  const policyFilters = toUniqueStrings([
    ...(snapshot.groupProfile?.blockedSkills ?? []).map((skill) => `!${skill}`),
    ...(snapshot.participationOverlay?.policyFilters ?? []),
  ]);
  const { allow, block } = parsePolicyFilters(policyFilters);
  const final = toUniqueStrings([...personal, ...group, ...collaborationScoped, ...learned]).filter(
    (capability) => {
      if (allow.size > 0 && !allow.has(capability)) {
        return false;
      }
      return !block.has(capability);
    },
  );
  const systemInstructions = toUniqueStrings([
    ...(snapshot.groupProfile?.systemInstructions ?? []),
    ...(snapshot.participationOverlay?.systemInstructions ?? []),
  ]);

  return {
    personal,
    group,
    collaborationScoped,
    learned,
    final,
    policyFilters,
    systemInstructions,
    confidentialityTier:
      snapshot.participationOverlay?.confidentialityTier ??
      snapshot.groupProfile?.confidentialityTier ??
      null,
  };
}

function normalizeToolbarView(view: GroupProfileView): GroupProfileView {
  switch (view) {
    case "task-detail":
      return "tasks";
    case "deliverable-detail":
      return "deliverables";
    case "review-detail":
      return "reviews";
    case "decision-detail":
      return "decisions";
    case "participation-detail":
    case "capsule-detail":
      return "capsules";
    case "projection-detail":
    case "asset-detail":
    case "learning-lineage":
    case "member-detail":
    case "binding-detail":
    case "members":
    case "bindings":
    case "memories":
    case "insights":
      return "governance";
    default:
      return view;
  }
}

const TASK_TRANSITIONS: Record<string, string[]> = {
  draft: ["ready", "cancelled"],
  ready: ["in_progress", "cancelled"],
  in_progress: ["blocked", "review", "completed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  review: ["in_progress", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const DELIVERABLE_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["in_review", "draft"],
  in_review: ["approved", "submitted"],
  approved: ["published", "in_review"],
  published: ["superseded", "archived"],
  superseded: ["archived"],
  archived: [],
};

const REVIEW_TRANSITIONS: Record<string, string[]> = {
  requested: ["submitted"],
  submitted: ["acknowledged", "resolved"],
  acknowledged: ["resolved"],
  resolved: [],
};

const DECISION_TRANSITIONS: Record<string, string[]> = {
  draft: ["finalized"],
  finalized: ["superseded"],
  superseded: [],
};

// 经验胶囊治理审批迁移（见 capsule-governance.ts）：candidate 可批准/驳回，approved 可驳回。
const CAPSULE_TRANSITIONS: Record<string, string[]> = {
  candidate: ["approved", "revoked"],
  approved: ["revoked"],
  revoked: [],
};

function resolveCapsuleTransitions(status: string | undefined): string[] {
  return CAPSULE_TRANSITIONS[status ?? "candidate"] ?? [];
}

function renderGovernanceShell(content: unknown) {
  return html`<div class="employee-workbench__governance-shell--flat">${content}</div>`;
}

function renderGovernanceSection(title: string, content: unknown, subtitle?: string) {
  return html`
    <section class="employee-workbench__governance-section--flat">
      <header class="employee-workbench__governance-section-head">
        <div class="employee-workbench__governance-section-title">${title}</div>
        ${subtitle ? html`<div class="employee-workbench__governance-section-subtitle">${subtitle}</div>` : null}
      </header>
      <div class="employee-workbench__governance-section-body">${content}</div>
    </section>
  `;
}

function renderGovernanceBack(label: string, onClick: () => void) {
  return html`
    <button type="button" class="employee-workbench__governance-back" @click=${onClick}>
      ${icons.chevronLeft}
      <span>${label}</span>
    </button>
  `;
}

function renderGovernanceActionStatus(snapshot: WorkbenchCollaborationGovernanceSnapshot) {
  const error = snapshot.governanceActionError?.trim();
  if (!error) {
    return null;
  }
  return html`
    <div class="employee-workbench__member-governance-banner is-error">${error}</div>
  `;
}

function renderTransitionButtons(params: {
  kind: WorkbenchGovernanceObjectKind;
  id: string;
  transitions: string[];
  busyKey?: string | null;
  onTransitionGovernanceObject?: GovernanceTransitionHandler | null;
  selectedOption?: string;
}) {
  if (params.transitions.length === 0) {
    return html`<div>${readLabel("common.na", "N/A")}</div>`;
  }

  return html`
    <div class="employee-workbench__module-actions">
      ${params.transitions.map((transition) => {
        const busyKey = `${params.kind}:${params.id}:${transition}`;
        return html`
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${params.busyKey === busyKey}
            @click=${() =>
              params.onTransitionGovernanceObject?.(
                params.kind,
                params.id,
                transition,
                params.selectedOption ? { selectedOption: params.selectedOption } : {},
              )}
          >
            <span>${transition}</span>
          </button>
        `;
      })}
    </div>
  `;
}

function renderTaskHandoffForm(params: {
  task: {
    taskId: string;
    status: string;
    ownerMemberId?: string;
    assignedMemberIds?: string[];
  };
  busyKey?: string | null;
  onTransitionGovernanceObject?: GovernanceTransitionHandler | null;
}) {
  const defaultFrom =
    params.task.assignedMemberIds?.[0]?.trim() || params.task.ownerMemberId?.trim() || "";
  const busy = params.busyKey === `task:${params.task.taskId}:handoff`;
  return html`
    <div class="employee-workbench__governance-section-title">Handoff contract</div>
    <form
      class="employee-workbench__governance-section-subtitle employee-workbench__task-handoff"
      style="display:grid;gap:10px"
      @submit=${(event: Event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget as HTMLFormElement);
        params.onTransitionGovernanceObject?.("task", params.task.taskId, params.task.status, {
          handoff: {
            from: readHandoffField(data, "from"),
            to: readHandoffField(data, "to"),
            reason: readHandoffField(data, "reason"),
            remainingWork: readHandoffField(data, "remainingWork"),
            acceptanceCriteria: splitHandoffList(data.get("acceptanceCriteria")),
            completedArtifacts: splitHandoffList(data.get("completedArtifacts")),
            assumptions: splitHandoffList(data.get("assumptions")),
            blockers: splitHandoffList(data.get("blockers")),
          },
        });
      }}
    >
      <label>
        <strong>From</strong>
        <input
          class="employee-workbench__settings-input"
          name="from"
          .value=${defaultFrom}
          required
        />
      </label>
      <label>
        <strong>To</strong>
        <input class="employee-workbench__settings-input" name="to" required />
      </label>
      <label>
        <strong>Reason</strong>
        <select class="employee-workbench__settings-input" name="reason" required>
          <option value="need_specialist" selected>need_specialist</option>
          <option value="owner_transfer">owner_transfer</option>
          <option value="capacity">capacity</option>
          <option value="other">other</option>
        </select>
      </label>
      <label>
        <strong>Remaining work</strong>
        <textarea name="remainingWork" rows="2" required></textarea>
      </label>
      <label>
        <strong>Acceptance criteria</strong>
        <textarea
          name="acceptanceCriteria"
          rows="2"
          required
          placeholder="One criterion per line"
        ></textarea>
      </label>
      <label>
        <strong>Completed artifacts</strong>
        <textarea name="completedArtifacts" rows="2"></textarea>
      </label>
      <label>
        <strong>Assumptions</strong>
        <textarea name="assumptions" rows="2"></textarea>
      </label>
      <label>
        <strong>Blockers</strong>
        <textarea name="blockers" rows="2"></textarea>
      </label>
      <div class="employee-workbench__module-actions">
        <button class="btn btn--sm" type="submit" ?disabled=${busy}>
          <span>Handoff</span>
        </button>
      </div>
    </form>
  `;
}

function buildToolbarItems(snapshot: WorkbenchCollaborationGovernanceSnapshot | null) {
  const learningObjects = snapshot?.learningObjects;
  const items: Array<{ view: GroupProfileView; label: string; icon: unknown }> = [
    {
      view: "chat",
      label: readLabel("frontstage.workbench.assistantStage.ask", "Chat"),
      icon: icons.messageSquare,
    },
    { view: "governance", label: "Capabilities", icon: icons.book },
  ];

  if ((learningObjects?.tasks.length ?? 0) > 0) {
    items.push({ view: "tasks", label: "Tasks", icon: icons.clipboardCheck });
  }
  if ((learningObjects?.deliverables.length ?? 0) > 0) {
    items.push({ view: "deliverables", label: "Deliverables", icon: icons.fileText });
  }
  if ((learningObjects?.reviews.length ?? 0) > 0) {
    items.push({ view: "reviews", label: "Reviews", icon: icons.clipboardCheck });
  }
  if ((learningObjects?.decisions.length ?? 0) > 0) {
    items.push({ view: "decisions", label: "Decisions", icon: icons.scrollText });
  }
  // 有候选或历史经验胶囊时暴露 Capsules 入口（审批后可回看/驳回）。
  const capsules = (learningObjects?.capsules ?? []).filter(
    (capsule) => (capsule.status ?? "candidate") !== "revoked",
  );
  const candidateCapsules = capsules.filter(
    (capsule) => (capsule.status ?? "candidate") === "candidate",
  ).length;
  if (capsules.length > 0) {
    items.push({
      view: "capsules",
      label: candidateCapsules > 0 ? `Capsules (${candidateCapsules})` : "Capsules",
      icon: icons.sparkles,
    });
  }

  return items;
}

function renderToolbar(params: {
  activeView: GroupProfileView;
  snapshot?: WorkbenchCollaborationGovernanceSnapshot | null;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
}) {
  const normalizedActiveView = normalizeToolbarView(params.activeView);

  return html`
    <div class="employee-workbench__module-actions">
      ${buildToolbarItems(params.snapshot ?? null).map(
        (item) => html`
          <button
            type="button"
            class="btn btn--sm ${normalizedActiveView === item.view ? "btn--primary" : ""}"
            ?disabled=${normalizedActiveView === item.view}
            @click=${() => params.onGroupProfileViewChange?.(item.view)}
          >
            ${item.icon}
            <span>${item.label}</span>
          </button>
        `,
      )}
    </div>
  `;
}

function renderGovernanceModulePage(content: unknown) {
  return html`
    <section class="employee-workbench__module-page employee-workbench__module-page--governance">
      ${content}
    </section>
  `;
}

function renderEmpty(
  itemTitle: string,
  view: string,
  snapshot?: WorkbenchCollaborationGovernanceSnapshot | null,
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null,
) {
  return html`
    <section class="employee-workbench__module-page employee-workbench__module-page--governance">
      <div class="employee-workbench__panel-title">${itemTitle}</div>
      <div class="employee-workbench__panel-subtitle">
        ${readLabel(
          "frontstage.workbench.groupProfile.empty.purpose",
          "This capability view is not available yet.",
        )}
      </div>
      ${renderToolbar({
        activeView: "governance",
        snapshot,
        onGroupProfileViewChange,
      })}
      <div class="employee-workbench__module-empty">${view}</div>
    </section>
  `;
}

function renderCapabilitiesSummary(
  itemTitle: string,
  snapshot: WorkbenchCollaborationGovernanceSnapshot,
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null,
) {
  const context = resolveCapabilityContext(snapshot);
  const groupId = snapshot.groupId?.trim() || snapshot.groupProfile?.groupId || null;
  const loading = snapshot.learningObjectsLoading === true;
  const error = snapshot.learningObjectsError?.trim() || null;
  const pendingApprovals =
    snapshot.learningObjects?.projections.filter(
      (projection) => projection.approvalStatus === "pending",
    ).length ?? 0;

  return renderGovernanceModulePage(html`
    <div class="employee-workbench__panel-title">${itemTitle}</div>
    <div class="employee-workbench__panel-subtitle">
      ${
        groupId
          ? `Collaboration-scoped capability context for ${groupId}`
          : "Collaboration-scoped capability context"
      }
    </div>
    ${renderToolbar({
      activeView: "governance",
      snapshot,
      onGroupProfileViewChange,
    })}
    ${renderGovernanceShell(html`
      ${renderGovernanceActionStatus(snapshot)}
      ${renderGovernanceSection("Effective Capabilities", formatList(context.final))}
      ${renderGovernanceSection("Base Capabilities", formatList(context.personal))}
      ${renderGovernanceSection("Group Capabilities", formatList(context.group))}
      ${renderGovernanceSection(
        "Collaboration-only Capabilities",
        formatList(context.collaborationScoped),
      )}
      ${renderGovernanceSection("Learned and Retained", formatList(context.learned))}
      ${renderGovernanceSection("Capability Boundaries", formatList(context.policyFilters))}
      ${renderGovernanceSection("Working Instructions", formatList(context.systemInstructions))}
      ${renderGovernanceSection(
        "Confidentiality",
        context.confidentialityTier ?? readLabel("common.na", "N/A"),
        "Group-restricted knowledge can improve future behavior without exposing raw internals.",
      )}
      ${renderGovernanceSection(
        "Learning State",
        html`
          <div>
            ${
              loading
                ? "Learning records are loading."
                : error
                  ? `Learning records unavailable: ${error}`
                  : `Retained learnings: ${snapshot.learningObjects?.assets.length ?? 0}`
            }
          </div>
          <div>Pending approvals: ${String(pendingApprovals)}</div>
        `,
      )}
      ${renderObservabilitySection(snapshot)}
    `)}
  `);
}

function renderDataPoint(label: string, value: string | number | null | undefined) {
  return html`
    <div class="employee-workbench__governance-kv-row">
      <dt>${label}</dt>
      <dd>${formatValue(value)}</dd>
    </div>
  `;
}

function renderDataPoints(
  rows: Array<{ label: string; value: string | number | null | undefined }>,
) {
  return html`
    <dl class="employee-workbench__governance-kv">
      ${rows.map((row) => renderDataPoint(row.label, row.value))}
    </dl>
  `;
}

function renderObjectListPage<T>(params: {
  itemTitle: string;
  subtitle: string;
  activeView: GroupProfileView;
  emptyLabel: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  items: T[];
  renderItem: (item: T) => unknown;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
}) {
  return renderGovernanceModulePage(html`
    <div class="employee-workbench__panel-title">${params.itemTitle}</div>
    <div class="employee-workbench__panel-subtitle">${params.subtitle}</div>
    ${renderToolbar({
      activeView: params.activeView,
      snapshot: params.snapshot,
      onGroupProfileViewChange: params.onGroupProfileViewChange,
    })}
    ${renderGovernanceShell(html`
      ${renderGovernanceActionStatus(params.snapshot)}
      ${
        params.items.length > 0
          ? html`<div class="employee-workbench__governance-list--flat">
              ${params.items.map((item) => params.renderItem(item))}
            </div>`
          : html`<div class="employee-workbench__module-empty">${params.emptyLabel}</div>`
      }
    `)}
  `);
}

function renderRelationButtons(params: {
  buttons: Array<{ label: string; kind: WorkbenchGovernanceObjectKind; id: string }>;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
}) {
  if (params.buttons.length === 0) {
    return html`<div>${readLabel("common.na", "N/A")}</div>`;
  }

  return html`
    <div class="employee-workbench__module-actions">
      ${params.buttons.map(
        (button) => html`
          <button
            type="button"
            class="btn btn--sm"
            @click=${() => params.onOpenGovernanceObjectDetail?.(button.kind, button.id)}
          >
            <span>${button.label}</span>
          </button>
        `,
      )}
    </div>
  `;
}

function selectTask(snapshot: WorkbenchCollaborationGovernanceSnapshot) {
  const tasks = snapshot.learningObjects?.tasks ?? [];
  return tasks.find((entry) => entry.taskId === snapshot.selectedTaskId) ?? tasks[0] ?? null;
}

function selectDeliverable(snapshot: WorkbenchCollaborationGovernanceSnapshot) {
  const deliverables = snapshot.learningObjects?.deliverables ?? [];
  return (
    deliverables.find((entry) => entry.deliverableId === snapshot.selectedDeliverableId) ??
    deliverables[0] ??
    null
  );
}

function selectReview(snapshot: WorkbenchCollaborationGovernanceSnapshot) {
  const reviews = snapshot.learningObjects?.reviews ?? [];
  return (
    reviews.find((entry) => entry.reviewId === snapshot.selectedReviewId) ?? reviews[0] ?? null
  );
}

function selectDecision(snapshot: WorkbenchCollaborationGovernanceSnapshot) {
  const decisions = snapshot.learningObjects?.decisions ?? [];
  return (
    decisions.find((entry) => entry.decisionId === snapshot.selectedDecisionId) ??
    decisions[0] ??
    null
  );
}

function selectCapsule(snapshot: WorkbenchCollaborationGovernanceSnapshot) {
  const selectedId = snapshot.selectedCapsuleId?.trim();
  if (!selectedId) {
    return null;
  }
  const capsules = (snapshot.learningObjects?.capsules ?? []).filter(
    (capsule) => (capsule.status ?? "candidate") !== "revoked",
  );
  return capsules.find((entry) => entry.capsuleId === selectedId) ?? null;
}

function renderTaskListPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
}) {
  const tasks = params.snapshot.learningObjects?.tasks ?? [];
  return renderObjectListPage({
    itemTitle: params.itemTitle,
    subtitle: "Persisted collaboration tasks in the active group scope.",
    activeView: "tasks",
    emptyLabel: "No tasks found in the current collaboration scope.",
    snapshot: params.snapshot,
    items: tasks,
    onGroupProfileViewChange: params.onGroupProfileViewChange,
    renderItem: (task) => html`
      <div class="employee-workbench__governance-list-row">
        <div class="employee-workbench__governance-list-row-copy">
          <div class="employee-workbench__governance-list-row-title">${task.title}</div>
          <div class="employee-workbench__governance-list-row-subtitle">${task.taskId}</div>
          <div class="employee-workbench__governance-list-row-meta">
            <span>Status: ${formatValue(task.status)}</span>
            <span>Priority: ${formatValue(task.priority)}</span>
            <span>Owner: ${formatValue(task.ownerMemberId)}</span>
          </div>
        </div>
        <div class="employee-workbench__governance-list-row-actions">
          <button
            type="button"
            class="btn btn--sm"
            @click=${() => params.onOpenGovernanceObjectDetail?.("task", task.taskId)}
          >
            <span>Details</span>
          </button>
        </div>
      </div>
    `,
  });
}

function renderTaskDetailPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
  onTransitionGovernanceObject?: GovernanceTransitionHandler | null;
  usageClient?: UsageCostClient | null;
  onUsageRerender?: (() => void) | null;
}) {
  const task = selectTask(params.snapshot);
  if (!task) {
    return renderTaskListPage(params);
  }

  const deliverables =
    params.snapshot.learningObjects?.deliverables.filter((entry) => entry.taskId === task.taskId) ??
    [];
  const reviews =
    params.snapshot.learningObjects?.reviews.filter((entry) => entry.taskId === task.taskId) ?? [];
  const decisions =
    params.snapshot.learningObjects?.decisions.filter(
      (entry) => entry.relatedTaskId === task.taskId,
    ) ?? [];

  return renderGovernanceModulePage(html`
    <div class="employee-workbench__panel-title">${params.itemTitle}</div>
    <div class="employee-workbench__panel-subtitle">Task detail for ${task.taskId}</div>
    ${renderToolbar({
      activeView: "task-detail",
      snapshot: params.snapshot,
      onGroupProfileViewChange: params.onGroupProfileViewChange,
    })}
    ${renderGovernanceShell(html`
      ${renderGovernanceActionStatus(params.snapshot)}
      ${renderGovernanceBack("Back to tasks", () => params.onGroupProfileViewChange?.("tasks"))}
      ${renderGovernanceSection(
        task.title,
        html`
          ${renderDataPoints([
            { label: "Task ID", value: task.taskId },
            { label: "Status", value: task.status },
            { label: "Priority", value: task.priority },
            { label: "Description", value: task.description },
            { label: "Owner", value: task.ownerMemberId },
            { label: "Assigned", value: formatList(task.assignedMemberIds ?? []) },
            { label: "Depends on", value: formatList(task.dependsOnTaskIds ?? []) },
            { label: "Tags", value: formatList(task.tags ?? []) },
            { label: "Created", value: formatTimestamp(task.createdAtMs) },
            { label: "Updated", value: formatTimestamp(task.updatedAtMs) },
          ])}
          <div class="employee-workbench__governance-section-title">Available transitions</div>
          ${renderTransitionButtons({
            kind: "task",
            id: task.taskId,
            transitions: TASK_TRANSITIONS[task.status] ?? [],
            busyKey: params.snapshot.governanceActionBusyKey,
            onTransitionGovernanceObject: params.onTransitionGovernanceObject,
          })}
          ${renderTaskHandoffForm({
            task,
            busyKey: params.snapshot.governanceActionBusyKey,
            onTransitionGovernanceObject: params.onTransitionGovernanceObject,
          })}
        `,
        task.taskId,
      )}
      ${renderUsageCostDisclosure({
        surface: "user",
        taskId: task.taskId,
        client: params.usageClient,
        rerender: params.onUsageRerender,
      })}
      ${renderObservabilitySection(params.snapshot)}
      ${renderGovernanceSection(
        "Related deliverables",
        renderRelationButtons({
          buttons: deliverables.map((entry) => ({
            label: entry.title,
            kind: "deliverable",
            id: entry.deliverableId,
          })),
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
      ${renderGovernanceSection(
        "Related reviews",
        renderRelationButtons({
          buttons: reviews.map((entry) => ({
            label: `${entry.reviewId} (${entry.status})`,
            kind: "review",
            id: entry.reviewId,
          })),
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
      ${renderGovernanceSection(
        "Related decisions",
        renderRelationButtons({
          buttons: decisions.map((entry) => ({
            label: entry.title,
            kind: "decision",
            id: entry.decisionId,
          })),
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
    `)}
  `);
}

function renderDeliverableListPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
}) {
  const deliverables = params.snapshot.learningObjects?.deliverables ?? [];
  return renderObjectListPage({
    itemTitle: params.itemTitle,
    subtitle: "Published and in-flight collaboration outputs for the active group scope.",
    activeView: "deliverables",
    emptyLabel: "No deliverables found in the current collaboration scope.",
    snapshot: params.snapshot,
    items: deliverables,
    onGroupProfileViewChange: params.onGroupProfileViewChange,
    renderItem: (deliverable) => html`
      <div class="employee-workbench__governance-list-row">
        <div class="employee-workbench__governance-list-row-copy">
          <div class="employee-workbench__governance-list-row-title">${deliverable.title}</div>
          <div class="employee-workbench__governance-list-row-subtitle">${deliverable.deliverableId}</div>
          <div class="employee-workbench__governance-list-row-meta">
            <span>Status: ${formatValue(deliverable.status)}</span>
            <span>Version: ${formatValue(deliverable.version)}</span>
            <span>Task: ${formatValue(deliverable.taskId)}</span>
          </div>
        </div>
        <div class="employee-workbench__governance-list-row-actions">
          <button
            type="button"
            class="btn btn--sm"
            @click=${() =>
              params.onOpenGovernanceObjectDetail?.("deliverable", deliverable.deliverableId)}
          >
            <span>Details</span>
          </button>
        </div>
      </div>
    `,
  });
}

function renderDeliverableDetailPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
  onTransitionGovernanceObject?: GovernanceTransitionHandler | null;
}) {
  const deliverable = selectDeliverable(params.snapshot);
  if (!deliverable) {
    return renderDeliverableListPage(params);
  }

  const relatedTask =
    params.snapshot.learningObjects?.tasks.find((entry) => entry.taskId === deliverable.taskId) ??
    null;
  const reviews =
    params.snapshot.learningObjects?.reviews.filter(
      (entry) => entry.deliverableId === deliverable.deliverableId,
    ) ?? [];
  const decisions =
    params.snapshot.learningObjects?.decisions.filter(
      (entry) => entry.relatedDeliverableId === deliverable.deliverableId,
    ) ?? [];

  return renderGovernanceModulePage(html`
    <div class="employee-workbench__panel-title">${params.itemTitle}</div>
    <div class="employee-workbench__panel-subtitle">
      Deliverable detail for ${deliverable.deliverableId}
    </div>
    ${renderToolbar({
      activeView: "deliverable-detail",
      snapshot: params.snapshot,
      onGroupProfileViewChange: params.onGroupProfileViewChange,
    })}
    ${renderGovernanceShell(html`
      ${renderGovernanceActionStatus(params.snapshot)}
      ${renderGovernanceBack("Back to deliverables", () =>
        params.onGroupProfileViewChange?.("deliverables"),
      )}
      ${renderGovernanceSection(
        deliverable.title,
        html`
          ${renderDataPoints([
            { label: "Deliverable ID", value: deliverable.deliverableId },
            { label: "Status", value: deliverable.status },
            { label: "Version", value: deliverable.version },
            { label: "Description", value: deliverable.description },
            { label: "Content type", value: deliverable.contentType },
            { label: "Task", value: deliverable.taskId },
            { label: "Published", value: formatTimestamp(deliverable.publishedAtMs) },
            { label: "Updated", value: formatTimestamp(deliverable.updatedAtMs) },
          ])}
          <div class="employee-workbench__governance-section-title">Available transitions</div>
          ${renderTransitionButtons({
            kind: "deliverable",
            id: deliverable.deliverableId,
            transitions: DELIVERABLE_TRANSITIONS[deliverable.status] ?? [],
            busyKey: params.snapshot.governanceActionBusyKey,
            onTransitionGovernanceObject: params.onTransitionGovernanceObject,
          })}
        `,
        deliverable.deliverableId,
      )}
      ${renderGovernanceSection(
        "Parent task",
        renderRelationButtons({
          buttons: relatedTask
            ? [{ label: relatedTask.title, kind: "task", id: relatedTask.taskId }]
            : [],
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
      ${renderGovernanceSection(
        "Reviews",
        renderRelationButtons({
          buttons: reviews.map((entry) => ({
            label: `${entry.reviewId} (${entry.status})`,
            kind: "review",
            id: entry.reviewId,
          })),
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
      ${renderGovernanceSection(
        "Decisions",
        renderRelationButtons({
          buttons: decisions.map((entry) => ({
            label: entry.title,
            kind: "decision",
            id: entry.decisionId,
          })),
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
    `)}
  `);
}

function renderReviewListPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
}) {
  const reviews = params.snapshot.learningObjects?.reviews ?? [];
  return renderObjectListPage({
    itemTitle: params.itemTitle,
    subtitle: "Review records tied to collaboration deliverables.",
    activeView: "reviews",
    emptyLabel: "No reviews found in the current collaboration scope.",
    snapshot: params.snapshot,
    items: reviews,
    onGroupProfileViewChange: params.onGroupProfileViewChange,
    renderItem: (review) => html`
      <div class="employee-workbench__governance-list-row">
        <div class="employee-workbench__governance-list-row-copy">
          <div class="employee-workbench__governance-list-row-title">${review.reviewId}</div>
          <div class="employee-workbench__governance-list-row-subtitle">${review.deliverableId}</div>
          <div class="employee-workbench__governance-list-row-meta">
            <span>Status: ${formatValue(review.status)}</span>
            <span>Verdict: ${formatValue(review.verdict)}</span>
            <span>Reviewer: ${formatValue(review.reviewerMemberId)}</span>
          </div>
        </div>
        <div class="employee-workbench__governance-list-row-actions">
          <button
            type="button"
            class="btn btn--sm"
            @click=${() => params.onOpenGovernanceObjectDetail?.("review", review.reviewId)}
          >
            <span>Details</span>
          </button>
        </div>
      </div>
    `,
  });
}

function renderCapsuleListPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
  onTransitionGovernanceObject?: GovernanceTransitionHandler | null;
}) {
  // 展示非驳回的胶囊（候选待审批 + 已批准可驳回），最新在前。
  const capsules = (params.snapshot.learningObjects?.capsules ?? [])
    .filter((capsule) => (capsule.status ?? "candidate") !== "revoked")
    .toSorted((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  return renderObjectListPage({
    itemTitle: params.itemTitle,
    subtitle: "Experience captured from task outcomes, awaiting governance approval before reuse.",
    activeView: "capsules",
    emptyLabel: "No experience capsules awaiting review in the current collaboration scope.",
    snapshot: params.snapshot,
    items: capsules,
    onGroupProfileViewChange: params.onGroupProfileViewChange,
    renderItem: (capsule) => {
      const status = capsule.status ?? "candidate";
      return html`
        <div class="employee-workbench__governance-list-row">
          <div class="employee-workbench__governance-list-row-copy">
            <div class="employee-workbench__governance-list-row-title">
              ${formatValue(capsule.title || capsule.capsuleId)}
            </div>
            <div class="employee-workbench__governance-list-row-subtitle">
              ${formatValue(capsule.summary)}
            </div>
            <div class="employee-workbench__governance-list-row-meta">
              <span>Type: ${formatValue(capsule.capsuleType)}</span>
              <span>Source: ${formatValue(capsule.sourceType ?? "unknown")}</span>
              <span>Status: ${formatValue(status)}</span>
              <span>Reusability: ${formatValue(capsule.reusability)}</span>
            </div>
          </div>
          <div class="employee-workbench__governance-list-row-actions">
            <button
              type="button"
              class="btn btn--sm"
              @click=${() => params.onOpenGovernanceObjectDetail?.("capsule", capsule.capsuleId)}
            >
              <span>Details</span>
            </button>
            ${renderTransitionButtons({
              kind: "capsule",
              id: capsule.capsuleId,
              transitions: resolveCapsuleTransitions(status),
              busyKey: params.snapshot.governanceActionBusyKey,
              onTransitionGovernanceObject: params.onTransitionGovernanceObject,
            })}
          </div>
        </div>
      `;
    },
  });
}

function renderCapsuleDetailPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
  onTransitionGovernanceObject?: GovernanceTransitionHandler | null;
}) {
  const capsule = selectCapsule(params.snapshot);
  if (!capsule) {
    return renderCapsuleListPage(params);
  }

  const status = capsule.status ?? "candidate";
  const relatedAssets =
    params.snapshot.learningObjects?.assets.filter(
      (entry) => entry.sourceCapsuleId === capsule.capsuleId,
    ) ?? [];
  const relatedProjections =
    params.snapshot.learningObjects?.projections.filter(
      (entry) => entry.sourceCapsuleId === capsule.capsuleId,
    ) ?? [];
  const structuredPreview =
    capsule.structuredContent && Object.keys(capsule.structuredContent).length > 0
      ? JSON.stringify(capsule.structuredContent, null, 2)
      : null;

  return renderGovernanceModulePage(html`
    <div class="employee-workbench__panel-title">${params.itemTitle}</div>
    <div class="employee-workbench__panel-subtitle">Capsule detail for ${capsule.capsuleId}</div>
    ${renderToolbar({
      activeView: "capsule-detail",
      snapshot: params.snapshot,
      onGroupProfileViewChange: params.onGroupProfileViewChange,
    })}
    ${renderGovernanceShell(html`
      ${renderGovernanceActionStatus(params.snapshot)}
      ${renderGovernanceBack("Back to capsules", () => params.onGroupProfileViewChange?.("capsules"))}
      ${renderGovernanceSection(
        formatValue(capsule.title || capsule.capsuleId),
        html`
          ${renderDataPoints([
            { label: "Capsule ID", value: capsule.capsuleId },
            { label: "Status", value: status },
            { label: "Type", value: capsule.capsuleType },
            { label: "Source type", value: capsule.sourceType ?? "unknown" },
            { label: "Source IDs", value: formatList(capsule.sourceIds ?? []) },
            { label: "Summary", value: capsule.summary },
            { label: "Sensitivity", value: capsule.sensitivity },
            { label: "Reusability", value: capsule.reusability },
            { label: "Confidentiality scope", value: capsule.confidentialityScope },
            { label: "Created by", value: capsule.createdBy },
            { label: "Approved by", value: capsule.approvedBy },
            { label: "Approved at", value: formatTimestamp(capsule.approvedAt) },
            { label: "Created", value: formatTimestamp(capsule.createdAt) },
            { label: "Updated", value: formatTimestamp(capsule.updatedAt) },
          ])}
          ${
            structuredPreview
              ? html`
                  <div class="employee-workbench__governance-section-title">Structured content</div>
                  <pre style="white-space: pre-wrap; margin: 0;">${structuredPreview}</pre>
                `
              : null
          }
          <div class="employee-workbench__governance-section-title">Available transitions</div>
          ${renderTransitionButtons({
            kind: "capsule",
            id: capsule.capsuleId,
            transitions: resolveCapsuleTransitions(status),
            busyKey: params.snapshot.governanceActionBusyKey,
            onTransitionGovernanceObject: params.onTransitionGovernanceObject,
          })}
        `,
        capsule.capsuleId,
      )}
      ${renderGovernanceSection(
        "Promoted learning assets",
        relatedAssets.length > 0
          ? relatedAssets.map(
              (asset) =>
                html`<div>${formatValue(asset.assetId)} (${formatValue(asset.status ?? "active")})</div>`,
            )
          : readLabel("common.na", "N/A"),
        "Assets created after approval and promotion into agent learning stores.",
      )}
      ${renderGovernanceSection(
        "Projections",
        relatedProjections.length > 0
          ? relatedProjections.map(
              (projection) =>
                html`<div>${formatValue(projection.projectionId)} (${formatValue(projection.approvalStatus)})</div>`,
            )
          : readLabel("common.na", "N/A"),
      )}
    `)}
  `);
}

function renderReviewDetailPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
  onTransitionGovernanceObject?: GovernanceTransitionHandler | null;
}) {
  const review = selectReview(params.snapshot);
  if (!review) {
    return renderReviewListPage(params);
  }

  const deliverable =
    params.snapshot.learningObjects?.deliverables.find(
      (entry) => entry.deliverableId === review.deliverableId,
    ) ?? null;
  const task =
    params.snapshot.learningObjects?.tasks.find((entry) => entry.taskId === review.taskId) ?? null;

  return renderGovernanceModulePage(html`
    <div class="employee-workbench__panel-title">${params.itemTitle}</div>
    <div class="employee-workbench__panel-subtitle">Review detail for ${review.reviewId}</div>
    ${renderToolbar({
      activeView: "review-detail",
      snapshot: params.snapshot,
      onGroupProfileViewChange: params.onGroupProfileViewChange,
    })}
    ${renderGovernanceShell(html`
      ${renderGovernanceActionStatus(params.snapshot)}
      ${renderGovernanceBack("Back to reviews", () => params.onGroupProfileViewChange?.("reviews"))}
      ${renderGovernanceSection(
        review.reviewId,
        html`
          ${renderDataPoints([
            { label: "Status", value: review.status },
            { label: "Verdict", value: review.verdict },
            { label: "Reviewer", value: review.reviewerMemberId },
            { label: "Deliverable", value: review.deliverableId },
            { label: "Task", value: review.taskId },
            { label: "Comments", value: review.comments },
            { label: "Suggestions", value: formatList(review.suggestions ?? []) },
            { label: "Disposition", value: review.disposition },
            { label: "Resolved", value: formatTimestamp(review.resolvedAtMs) },
          ])}
          <div class="employee-workbench__governance-section-title">Available transitions</div>
          ${renderTransitionButtons({
            kind: "review",
            id: review.reviewId,
            transitions: REVIEW_TRANSITIONS[review.status] ?? [],
            busyKey: params.snapshot.governanceActionBusyKey,
            onTransitionGovernanceObject: params.onTransitionGovernanceObject,
          })}
        `,
        review.deliverableId,
      )}
      ${renderGovernanceSection(
        "Deliverable",
        renderRelationButtons({
          buttons: deliverable
            ? [{ label: deliverable.title, kind: "deliverable", id: deliverable.deliverableId }]
            : [],
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
      ${renderGovernanceSection(
        "Task",
        renderRelationButtons({
          buttons: task ? [{ label: task.title, kind: "task", id: task.taskId }] : [],
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
    `)}
  `);
}

function renderDecisionListPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
}) {
  const decisions = params.snapshot.learningObjects?.decisions ?? [];
  return renderObjectListPage({
    itemTitle: params.itemTitle,
    subtitle: "Formal collaboration decisions connected to tasks and deliverables.",
    activeView: "decisions",
    emptyLabel: "No decisions found in the current collaboration scope.",
    snapshot: params.snapshot,
    items: decisions,
    onGroupProfileViewChange: params.onGroupProfileViewChange,
    renderItem: (decision) => html`
      <div class="employee-workbench__governance-list-row">
        <div class="employee-workbench__governance-list-row-copy">
          <div class="employee-workbench__governance-list-row-title">${decision.title}</div>
          <div class="employee-workbench__governance-list-row-subtitle">${decision.decisionId}</div>
          <div class="employee-workbench__governance-list-row-meta">
            <span>Status: ${formatValue(decision.status)}</span>
            <span>Selected: ${formatValue(decision.selectedOption)}</span>
            <span>Task: ${formatValue(decision.relatedTaskId)}</span>
          </div>
        </div>
        <div class="employee-workbench__governance-list-row-actions">
          <button
            type="button"
            class="btn btn--sm"
            @click=${() => params.onOpenGovernanceObjectDetail?.("decision", decision.decisionId)}
          >
            <span>Details</span>
          </button>
        </div>
      </div>
    `,
  });
}

function renderDecisionDetailPage(params: {
  itemTitle: string;
  snapshot: WorkbenchCollaborationGovernanceSnapshot;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
  onDecisionOptionDraftChange?: ((optionId: string | null) => void) | null;
  onDecisionRationaleDraftChange?: ((value: string) => void) | null;
  onSaveDecisionDraft?: ((decisionId: string) => void) | null;
  onTransitionGovernanceObject?: GovernanceTransitionHandler | null;
}) {
  const decision = selectDecision(params.snapshot);
  if (!decision) {
    return renderDecisionListPage(params);
  }

  const task =
    params.snapshot.learningObjects?.tasks.find(
      (entry) => entry.taskId === decision.relatedTaskId,
    ) ?? null;
  const deliverable =
    params.snapshot.learningObjects?.deliverables.find(
      (entry) => entry.deliverableId === decision.relatedDeliverableId,
    ) ?? null;
  const decisionOptionDraft =
    params.snapshot.selectedDecisionOptionDraft ?? decision.selectedOption ?? null;
  const decisionRationaleDraft =
    params.snapshot.selectedDecisionRationaleDraft ?? decision.rationale ?? "";
  const selectedOption =
    decision.options.find((entry) => entry.optionId === decisionOptionDraft) ?? null;

  return renderGovernanceModulePage(html`
    <div class="employee-workbench__panel-title">${params.itemTitle}</div>
    <div class="employee-workbench__panel-subtitle">Decision detail for ${decision.decisionId}</div>
    ${renderToolbar({
      activeView: "decision-detail",
      snapshot: params.snapshot,
      onGroupProfileViewChange: params.onGroupProfileViewChange,
    })}
    ${renderGovernanceShell(html`
      ${renderGovernanceActionStatus(params.snapshot)}
      ${renderGovernanceBack("Back to decisions", () =>
        params.onGroupProfileViewChange?.("decisions"),
      )}
      ${renderGovernanceSection(
        decision.title,
        html`
          ${renderDataPoints([
            { label: "Decision ID", value: decision.decisionId },
            { label: "Status", value: decision.status },
            {
              label: "Selected option",
              value: selectedOption?.title ?? decisionOptionDraft,
            },
            { label: "Rationale", value: decisionRationaleDraft },
            { label: "Task", value: decision.relatedTaskId },
            { label: "Deliverable", value: decision.relatedDeliverableId },
            { label: "Finalized", value: formatTimestamp(decision.finalizedAt) },
          ])}
          ${
            decision.status === "draft"
              ? html`
                  <div class="employee-workbench__governance-section-title">Working option</div>
                  <div class="employee-workbench__module-actions">
                    ${decision.options.map(
                      (option) => html`
                        <button
                          type="button"
                          class="btn btn--sm ${
                            decisionOptionDraft === option.optionId ? "btn--primary" : ""
                          }"
                          ?disabled=${decisionOptionDraft === option.optionId}
                          @click=${() => params.onDecisionOptionDraftChange?.(option.optionId)}
                        >
                          <span>${option.title}</span>
                        </button>
                      `,
                    )}
                  </div>
                  <label class="employee-workbench__governance-section-subtitle">
                    <strong>Working rationale:</strong>
                    <textarea
                      rows="4"
                      .value=${decisionRationaleDraft}
                      @input=${(event: Event) =>
                        params.onDecisionRationaleDraftChange?.(
                          (event.target as HTMLTextAreaElement).value,
                        )}
                    ></textarea>
                  </label>
                  <div class="employee-workbench__module-actions">
                    <button
                      type="button"
                      class="btn btn--sm"
                      ?disabled=${
                        params.snapshot.governanceActionBusyKey ===
                        `decision-save:${decision.decisionId}`
                      }
                      @click=${() => params.onSaveDecisionDraft?.(decision.decisionId)}
                    >
                      <span>Save draft</span>
                    </button>
                  </div>
                `
              : null
          }
          <div class="employee-workbench__governance-section-title">Available transitions</div>
          ${renderTransitionButtons({
            kind: "decision",
            id: decision.decisionId,
            transitions: (DECISION_TRANSITIONS[decision.status] ?? []).filter(
              (entry) => entry !== "finalized" || Boolean(decisionOptionDraft),
            ),
            busyKey: params.snapshot.governanceActionBusyKey,
            onTransitionGovernanceObject: params.onTransitionGovernanceObject,
            selectedOption: decisionOptionDraft ?? undefined,
          })}
        `,
        decision.decisionId,
      )}
      ${renderGovernanceSection(
        "Options",
        decision.options.length > 0
          ? decision.options.map(
              (option) =>
                html`<div>${option.title}${option.optionId === decision.selectedOption ? " (selected)" : ""}</div>`,
            )
          : readLabel("common.na", "N/A"),
      )}
      ${renderGovernanceSection(
        "Related task",
        renderRelationButtons({
          buttons: task ? [{ label: task.title, kind: "task", id: task.taskId }] : [],
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
      ${renderGovernanceSection(
        "Related deliverable",
        renderRelationButtons({
          buttons: deliverable
            ? [{ label: deliverable.title, kind: "deliverable", id: deliverable.deliverableId }]
            : [],
          onOpenGovernanceObjectDetail: params.onOpenGovernanceObjectDetail,
        }),
      )}
    `)}
  `);
}

export function renderGroupProfileStageView(params: {
  itemTitle: string;
  view: GroupProfileView;
  snapshot?: WorkbenchCollaborationGovernanceSnapshot | null;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
  onDecisionOptionDraftChange?: ((optionId: string | null) => void) | null;
  onDecisionRationaleDraftChange?: ((value: string) => void) | null;
  onSaveDecisionDraft?: ((decisionId: string) => void) | null;
  onTransitionGovernanceObject?: GovernanceTransitionHandler | null;
  usageClient?: UsageCostClient | null;
  onUsageRerender?: (() => void) | null;
}) {
  if (!params.snapshot) {
    return renderEmpty(
      params.itemTitle,
      params.view,
      params.snapshot,
      params.onGroupProfileViewChange,
    );
  }

  if (params.view === "chat") {
    return renderEmpty(
      params.itemTitle,
      params.view,
      params.snapshot,
      params.onGroupProfileViewChange,
    );
  }

  const resolvedParams = {
    ...params,
    snapshot: params.snapshot,
  };

  switch (params.view) {
    case "tasks":
      return renderTaskListPage(resolvedParams);
    case "task-detail":
      return renderTaskDetailPage(resolvedParams);
    case "deliverables":
      return renderDeliverableListPage(resolvedParams);
    case "deliverable-detail":
      return renderDeliverableDetailPage(resolvedParams);
    case "reviews":
      return renderReviewListPage(resolvedParams);
    case "review-detail":
      return renderReviewDetailPage(resolvedParams);
    case "decisions":
      return renderDecisionListPage(resolvedParams);
    case "decision-detail":
      return renderDecisionDetailPage(resolvedParams);
    case "capsules":
      return renderCapsuleListPage(resolvedParams);
    case "capsule-detail":
      return renderCapsuleDetailPage(resolvedParams);
    default:
      return renderCapabilitiesSummary(
        params.itemTitle,
        params.snapshot,
        params.onGroupProfileViewChange,
      );
  }
}
