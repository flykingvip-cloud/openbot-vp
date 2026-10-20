import type {
  DaibaiAskResult,
  DaibaiExecuteResult,
} from "../../../../../../src/shared/daibai-types.ts";
import type { DaibaiPendingConfirmation } from "../semantic/view-controller-facade.ts";
import type { WorkbenchSignalBundle, WorkbenchSignalCardKey } from "./workbench-signals.ts";
import type { WorkbenchGovernanceObjectKind } from "./workbench-types.ts";

export type WorkbenchScheduleEntryDraftInput = {
  title: string;
  startAtMs: number;
  endAtMs?: number;
  kind?: string;
};

export type WorkbenchSignalsCapabilityContract = {
  onOpenCron?: (() => void) | null;
  onOpenAssistantSettings?: (() => void) | null;
  onOpenChannelSettings?: (() => void) | null;
  onOpenOverview?: (() => void) | null;
  /** Manual schedule add (Phase A1); when absent the manage UI stays hidden. */
  onAddScheduleEntry?: ((input: WorkbenchScheduleEntryDraftInput) => void | Promise<void>) | null;
  /** Manual schedule cancel by entry id (Phase A1). */
  onCancelScheduleEntry?: ((id: string) => void | Promise<void>) | null;
  /**
   * Open a single auto-extracted card entry for reading (per-item deep-link).
   * The card body passes its own key + the clicked entry's id; the resolver
   * routes to the best available detail surface (e.g. a 待治理 deliverable opens
   * its deliverable-detail view) and falls back to the card's section when no
   * per-item reading page applies. When absent, the surface falls back to the
   * card-level action instead.
   */
  onOpenSignalEntry?: ((cardKey: WorkbenchSignalCardKey, entryId: string) => void) | null;
  /**
   * Deep-link from the steward suggestion bar by its server `kind`
   * (attention/conflict → knowledge; ack/task/collab kinds → steward inbox).
   */
  onOpenStewardSuggestion?: ((kind: string) => void) | null;
};

export type WorkbenchDaibaiOverviewCapabilityContract = {
  daibaiLoading?: boolean;
  daibaiError?: string | null;
  daibaiLastMessage?: string | null;
  daibaiAskResult?: DaibaiAskResult | null;
  daibaiExecuteResult?: DaibaiExecuteResult | null;
  daibaiActionLoading?: boolean;
  daibaiActionPendingId?: string | null;
  daibaiActionError?: string | null;
  daibaiPendingConfirmation?: DaibaiPendingConfirmation | null;
  /** CollabDispatch D1: organizer meeting release confirm card (chat primary). */
  meetingPendingConfirmation?: {
    meeting: {
      id: string;
      title: string;
      status: string;
      startAtMs?: number;
      endAtMs?: number;
      timezone?: string;
      location?: string;
      joinUrl?: string;
      externalMeetingCode?: string;
      agenda?: string[];
      attendees?: Array<{ userId: string }>;
      meetingMode?: "online" | "offline";
    };
    confirmation: {
      proposalId: string;
      confirmationToken: string;
      payloadHash: string;
      expiresAtMs: number;
    };
    confirmationDetail?: {
      title: string;
      impact?: string;
      irreversible: boolean;
      expiresAtMs: number;
    };
    message: string;
  } | null;
  meetingConfirmationLoading?: boolean;
  meetingConfirmationError?: string | null;
  /** Pause-release epilogue after confirm (pending card cleared). */
  meetingConfirmRelease?: {
    meetingId: string;
    title: string;
    phase: "releasing" | "released" | "partial";
    progressMessage: string;
    resultMessage?: string;
    scheduleComplete?: boolean;
    deliveredCount?: number;
    failedCount?: number;
    noticeText?: string;
  } | null;
  onConfirmMeetingPendingApproval?: (() => Promise<void>) | null;
  onCancelMeetingPendingConfirmation?: (() => void) | null;
  onDismissMeetingConfirmRelease?: (() => void) | null;
  /** Parsed group-config-proposal from steward chat awaiting user apply. */
  groupConfigProposal?: {
    groupId: string;
    summaryLines: string[];
    busy?: boolean;
    error?: string | null;
    notice?: string | null;
  } | null;
  onAskDaibai?: ((message?: string) => Promise<void>) | null;
  onExecuteDaibaiAction?:
    | ((actionId: string, payload?: Record<string, unknown>) => Promise<void>)
    | null;
  onConfirmDaibaiPendingAction?: (() => Promise<void>) | null;
  onCancelDaibaiPendingConfirmation?: (() => void) | null;
  onApplyGroupConfigProposal?: (() => void | Promise<void>) | null;
  onDismissGroupConfigProposal?: (() => void) | null;
  onOpenDaibaiHelp?:
    | ((params: { moduleLabel: string; contextMessage?: string }) => Promise<void>)
    | null;
  onOpenSupervisorTask?: ((taskId: string) => void) | null;
  /** Opens 我的任务 → 开发监督 without selecting a task. */
  onOpenSupervisorBoard?: (() => void) | null;
  /** Jumps to 大白 with a dev-task entry prompt. */
  onOpenDaibaiForDevTask?: (() => void | Promise<void>) | null;
};

export type WorkbenchDaibaiStageCapabilityContract = WorkbenchDaibaiOverviewCapabilityContract;

export type WorkbenchViewCapabilityContract = {
  signals: WorkbenchSignalsCapabilityContract;
  daibaiStage: WorkbenchDaibaiStageCapabilityContract;
};

type SignalsContractSource = {
  onOpenCron?: (() => void) | null;
  onOpenAssistantSettings?: (() => void) | null;
  onOpenChannelSettings?: (() => void) | null;
  onOpenOverview?: (() => void) | null;
  onAddScheduleEntry?: ((input: WorkbenchScheduleEntryDraftInput) => void | Promise<void>) | null;
  onCancelScheduleEntry?: ((id: string) => void | Promise<void>) | null;
  /** Existing per-item governance-object opener, reused for todos governance entries. */
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
  /** Per-item 今日日程 opener (cron:<jobId> -> cron task detail); wired by the shell. */
  onOpenScheduleEntry?: ((entryId: string) => void) | null;
  /** Per-item collaboration opener (opens the space by groupId); wired by the shell. */
  onOpenCollaborationSpace?: ((groupId: string) => void) | null;
  /**
   * Open a collaboration invite todos entry (`invite:bot:…` / `invite:human:…`)
   * into the member-governance approval surface for that group.
   */
  onOpenCollaborationInvite?:
    | ((params: { kind: "bot" | "human"; groupId: string; subjectId: string }) => void)
    | null;
  onOpenStewardSuggestion?: ((kind: string) => void) | null;
  /** CollabDispatch D1: workbench mirror → chat meeting confirm card. */
  onOpenMeetingInviteReview?: (() => void) | null;
  /** Confirm a directed tenant notice (`tenant-notice:<id>`) from 待办事项. */
  onConfirmTenantNotice?: ((noticeId: string) => void | Promise<void>) | null;
  signals?: WorkbenchSignalBundle | null;
};

const GOVERNANCE_ENTRY_PREFIX = "governance:";
const TASK_ENTRY_PREFIX = "task:";
const INVITE_ENTRY_PREFIX = "invite:";
const LEDGER_GATE_PREFIX = "ledger-gate:";

export function parseWorkbenchInviteEntryId(entryId: string): {
  kind: "bot" | "human";
  groupId: string;
  subjectId: string;
} | null {
  const id = entryId.trim();
  if (!id.startsWith(INVITE_ENTRY_PREFIX)) {
    return null;
  }
  const rest = id.slice(INVITE_ENTRY_PREFIX.length);
  const kindSep = rest.indexOf(":");
  if (kindSep <= 0) {
    return null;
  }
  const kindRaw = rest.slice(0, kindSep);
  if (kindRaw !== "bot" && kindRaw !== "human") {
    return null;
  }
  const remainder = rest.slice(kindSep + 1);
  const subjectSep = remainder.lastIndexOf(":");
  if (subjectSep <= 0) {
    return null;
  }
  const groupId = remainder.slice(0, subjectSep).trim();
  const subjectId = remainder.slice(subjectSep + 1).trim();
  if (!groupId || !subjectId) {
    return null;
  }
  return { kind: kindRaw, groupId, subjectId };
}

/**
 * Resolve a per-item "open to read" for an auto-extracted signal-card entry.
 *
 * Routing (two-card home):
 * - schedule → onOpenScheduleEntry (cron:<jobId> opens that cron task's detail).
 * - todos:
 *   - governance:<deliverableId> → deliverable detail
 *   - invite:bot|human:… → member-governance approval for that group
 *   - task:* → steward (todos hub)
 *   - ledger-gate:<jobId> → cron task detail (human gate, not an execution step)
 *   - meeting:* → steward (not a real groupId)
 *   - bare groupId (collaboration) → collaboration space
 * - Anything without a per-item opener falls back to the card's section action.
 */
function buildSignalEntryOpener(
  props: SignalsContractSource,
): (cardKey: WorkbenchSignalCardKey, entryId: string) => void {
  const openSection = (cardKey: WorkbenchSignalCardKey) => {
    switch (cardKey) {
      case "schedule":
        props.onOpenCron?.();
        break;
      case "todos":
        props.onOpenAssistantSettings?.();
        break;
    }
  };
  return (cardKey, entryId) => {
    const id = entryId.trim();
    if (cardKey === "schedule" && props.onOpenScheduleEntry) {
      props.onOpenScheduleEntry(id);
      return;
    }
    if (cardKey === "todos") {
      if (id === "governance:conflict" || id === "governance:attention") {
        const kind = id === "governance:conflict" ? "conflict" : "attention";
        if (props.onOpenStewardSuggestion) {
          props.onOpenStewardSuggestion(kind);
          return;
        }
        props.onOpenAssistantSettings?.();
        return;
      }
      if (id.startsWith(GOVERNANCE_ENTRY_PREFIX) && props.onOpenGovernanceObjectDetail) {
        const deliverableId = id.slice(GOVERNANCE_ENTRY_PREFIX.length).trim();
        if (deliverableId) {
          props.onOpenGovernanceObjectDetail("deliverable", deliverableId);
          return;
        }
      }
      if (id.startsWith(INVITE_ENTRY_PREFIX)) {
        const invite = parseWorkbenchInviteEntryId(id);
        if (invite && props.onOpenCollaborationInvite) {
          props.onOpenCollaborationInvite(invite);
          return;
        }
        // Fallback: open the collaboration space when invite opener is absent.
        if (invite && props.onOpenCollaborationSpace) {
          props.onOpenCollaborationSpace(invite.groupId);
          return;
        }
        props.onOpenAssistantSettings?.();
        return;
      }
      if (id.startsWith("tenant-notice:")) {
        const noticeId = id.slice("tenant-notice:".length).trim();
        if (noticeId && props.onConfirmTenantNotice) {
          void props.onConfirmTenantNotice(noticeId);
          return;
        }
        props.onOpenAssistantSettings?.();
        return;
      }
      if (id.startsWith(TASK_ENTRY_PREFIX)) {
        props.onOpenAssistantSettings?.();
        return;
      }
      if (id.startsWith(LEDGER_GATE_PREFIX)) {
        const jobId = id.slice(LEDGER_GATE_PREFIX.length).trim();
        if (jobId && props.onOpenScheduleEntry) {
          props.onOpenScheduleEntry(`cron:${jobId}`);
          return;
        }
        props.onOpenCron?.();
        return;
      }
      // Meeting-notice aggregates are not real groupIds — keep them on the
      // steward inbox instead of calling onOpenCollaborationSpace("meeting:…"),
      // which previously resolved to no space and left the user on a stale chat.
      if (id.startsWith("meeting:")) {
        if (props.onOpenMeetingInviteReview) {
          props.onOpenMeetingInviteReview();
          return;
        }
        props.onOpenAssistantSettings?.();
        return;
      }
      if (props.onOpenCollaborationSpace) {
        // Collaboration space ids are bare groupIds.
        props.onOpenCollaborationSpace(id);
        return;
      }
    }
    openSection(cardKey);
  };
}

export function buildWorkbenchSignalsCapabilityContract(
  props: SignalsContractSource,
): WorkbenchSignalsCapabilityContract {
  return {
    onOpenCron: props.onOpenCron ?? null,
    onOpenAssistantSettings: props.onOpenAssistantSettings ?? null,
    onOpenChannelSettings: props.onOpenChannelSettings ?? null,
    onOpenOverview: props.onOpenOverview ?? null,
    onAddScheduleEntry: props.onAddScheduleEntry ?? null,
    onCancelScheduleEntry: props.onCancelScheduleEntry ?? null,
    onOpenSignalEntry: buildSignalEntryOpener(props),
    onOpenStewardSuggestion: props.onOpenStewardSuggestion ?? null,
  };
}

type DaibaiContractSource = Partial<WorkbenchDaibaiStageCapabilityContract>;

export function buildWorkbenchDaibaiStageCapabilityContract(
  props: DaibaiContractSource,
): WorkbenchDaibaiStageCapabilityContract {
  return {
    daibaiLoading: props.daibaiLoading ?? false,
    daibaiError: props.daibaiError ?? null,
    daibaiLastMessage: props.daibaiLastMessage ?? null,
    daibaiAskResult: props.daibaiAskResult ?? null,
    daibaiExecuteResult: props.daibaiExecuteResult ?? null,
    daibaiActionLoading: props.daibaiActionLoading ?? false,
    daibaiActionPendingId: props.daibaiActionPendingId ?? null,
    daibaiActionError: props.daibaiActionError ?? null,
    daibaiPendingConfirmation: props.daibaiPendingConfirmation ?? null,
    meetingPendingConfirmation: props.meetingPendingConfirmation ?? null,
    meetingConfirmationLoading: props.meetingConfirmationLoading ?? false,
    meetingConfirmationError: props.meetingConfirmationError ?? null,
    meetingConfirmRelease: props.meetingConfirmRelease ?? null,
    onConfirmMeetingPendingApproval: props.onConfirmMeetingPendingApproval ?? null,
    onCancelMeetingPendingConfirmation: props.onCancelMeetingPendingConfirmation ?? null,
    onDismissMeetingConfirmRelease: props.onDismissMeetingConfirmRelease ?? null,
    groupConfigProposal: props.groupConfigProposal ?? null,
    onAskDaibai: props.onAskDaibai ?? null,
    onExecuteDaibaiAction: props.onExecuteDaibaiAction ?? null,
    onConfirmDaibaiPendingAction: props.onConfirmDaibaiPendingAction ?? null,
    onCancelDaibaiPendingConfirmation: props.onCancelDaibaiPendingConfirmation ?? null,
    onApplyGroupConfigProposal: props.onApplyGroupConfigProposal ?? null,
    onDismissGroupConfigProposal: props.onDismissGroupConfigProposal ?? null,
    onOpenDaibaiHelp: props.onOpenDaibaiHelp ?? null,
    onOpenSupervisorTask: props.onOpenSupervisorTask ?? null,
    onOpenSupervisorBoard: props.onOpenSupervisorBoard ?? null,
    onOpenDaibaiForDevTask: props.onOpenDaibaiForDevTask ?? null,
  };
}
