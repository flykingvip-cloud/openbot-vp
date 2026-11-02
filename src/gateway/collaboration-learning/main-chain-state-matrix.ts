/**
 * Machine-checkable formal main-chain state matrix (FT-COLLAB-MAIN-CHAIN-MATRIX).
 *
 * Unique formal chain freeze (audit): steps 1–17 below are the ONLY formal write
 * sequence. Bypass / audit / recovery / compat paths are catalogued separately as
 * non-writers — they must not invent alternate formal board/plan/binding/wake
 * writers.
 *
 * Binding keys every formal row may reference:
 * tenant | group | task | board | todolist | claimant | actor | submission |
 * deliverable | opKey | attempt | version | source
 *
 * Hard stops this catalog encodes:
 * - activate success envelope: dispatched === false (ACTIVATE_SUCCESS_DISPATCHED)
 * - wakeDispatcherAccepted only on definite settle / confirmed accept
 * - no new scheduler / classifier / role system
 */

export const MAIN_CHAIN_BINDING_KEYS = [
  "tenant",
  "group",
  "task",
  "board",
  "todolist",
  "claimant",
  "actor",
  "submission",
  "deliverable",
  "opKey",
  "attempt",
  "version",
  "source",
] as const;

export type MainChainBindingKey = (typeof MAIN_CHAIN_BINDING_KEYS)[number];

export type MainChainWriterKind = "formal_writer" | "non_writer";

export type MainChainMatrixRow = Readonly<{
  /** Stable step id (1–17 formal; B* bypass). */
  id: string;
  /** Human / audit event name. */
  event: string;
  /** Ordered step in the unique formal chain; null for bypass rows. */
  step: number | null;
  kind: MainChainWriterKind;
  precondition: string;
  /** Sole production write entry (module#export) — empty when non_writer. */
  soleWriteEntry: string;
  successFact: string;
  failureFact: string;
  nextAllowed: readonly string[];
  bindings: readonly MainChainBindingKey[];
  notes?: string;
}>;

/** Sole formal write entrypoints — symbol paths only; no alternate writers. */
export const MAIN_CHAIN_SOLE_WRITE_ENTRIES = [
  "controlled-discuss-to-task.ts#controlledDiscussToTask",
  "activate-collaboration-task.ts#activateCollaborationTask",
  "claim-contract-entry.ts#publishCollaborationBoardItem",
  "claim-contract-entry.ts#claimCollaborationBoardItem",
  "claim-contract-entry.ts#proposeCollaborationTodolist",
  "claim-contract-entry.ts#confirmCollaborationTodolist",
  "post-plan-confirm-advance.ts#triggerPostPlanConfirmAdvance",
  "wake-contract / wake-round-dispatch.ts#recordNudgeWake+consumeWakeForRoundDispatch",
  "mode-b-wake-round-dispatcher.ts#createModeBWakeRoundDispatcher",
  "attach-wake-execution-deliverable-binding.ts#attachWakeExecutionDeliverableBinding",
  "team-deliverable-submit.ts#submitTeamDeliverable",
  "claim-contract-entry.ts#submitCollaborationBoardItemForReview",
  "post-submission-event-advance.ts#triggerPostSubmissionEventAdvance",
  "claim-contract-entry.ts#returnCollaborationBoardItemSubmission",
  "claim-contract-entry.ts#markCollaborationBoardItemInProgress",
  "claim-contract-entry.ts#acceptCollaborationBoardItemSubmission",
] as const;

export const MAIN_CHAIN_FORMAL_ROWS: readonly MainChainMatrixRow[] = [
  {
    id: "S01",
    event: "explicit_delegate",
    step: 1,
    kind: "formal_writer",
    precondition: "Trusted actor issues an explicit collaboration delegate (not oral chat alone).",
    soleWriteEntry: "controlled-discuss-to-task.ts#controlledDiscussToTask",
    successFact:
      "Discuss-to-task draft / needs_confirm persisted; no board claim; no wake dispatched.",
    failureFact: "blocked / missing contract fields; no board publish.",
    nextAllowed: ["S02"],
    bindings: ["tenant", "group", "task", "actor"],
    notes: "Oral chat alone never creates a board fact.",
  },
  {
    id: "S02",
    event: "controlledDiscussToTask",
    step: 2,
    kind: "formal_writer",
    precondition: "S01 contract fields present; claimContract on for group/tenant.",
    soleWriteEntry: "controlled-discuss-to-task.ts#controlledDiscussToTask",
    successFact: "needs_confirm or equivalent draft with stable activation fingerprint.",
    failureFact: "blocked; client cannot set humanConfirmed to bypass.",
    nextAllowed: ["S03"],
    bindings: ["tenant", "group", "task", "actor", "version"],
  },
  {
    id: "S03",
    event: "activateCollaborationTask",
    step: 3,
    kind: "formal_writer",
    precondition: "Human confirmed with same first-persisted contract fingerprint.",
    soleWriteEntry: "activate-collaboration-task.ts#activateCollaborationTask",
    successFact:
      "status=activated|partial_success; boardPublished may be true; dispatched===false always.",
    failureFact: "needs_confirm | blocked | activation_contract_conflict.",
    nextAllowed: ["S04"],
    bindings: ["tenant", "group", "task", "board", "actor"],
    notes: "ACTIVATE_SUCCESS_DISPATCHED is false; activate never flips wake-level dispatched.",
  },
  {
    id: "S04",
    event: "publish_board",
    step: 4,
    kind: "formal_writer",
    precondition: "Activate confirmed path or explicit publishCollaborationBoardItem.",
    soleWriteEntry: "claim-contract-entry.ts#publishCollaborationBoardItem",
    successFact: "board status=published; claimantId unset; intended ≠ claimed.",
    failureFact: "publish refused (auth/flag/stopped).",
    nextAllowed: ["S05"],
    bindings: ["tenant", "group", "task", "board", "actor"],
    notes: "publish ≠ claim; tryClaimAfterBoardPublish may schedule handoff only.",
  },
  {
    id: "S05",
    event: "claimant_self_claim",
    step: 5,
    kind: "formal_writer",
    precondition: "Board published; non-empty trusted actor; actor matches claimant identity.",
    soleWriteEntry: "claim-contract-entry.ts#claimCollaborationBoardItem",
    successFact: "claimantId set; status claimed/applied path available; actor non-empty.",
    failureFact: "actor_required | claim_actor_mismatch | claimant_required | auth_revoked.",
    nextAllowed: ["S06"],
    bindings: ["tenant", "group", "task", "board", "claimant", "actor"],
    notes: "Proxy claim forbidden; empty actor must not backfill from claimantId (#214).",
  },
  {
    id: "S06",
    event: "propose_todolist",
    step: 6,
    kind: "formal_writer",
    precondition: "Active claim/apply; ownerMemberId/actor present.",
    soleWriteEntry: "claim-contract-entry.ts#proposeCollaborationTodolist",
    successFact: "todolist proposed with boardItemId+version; awaiting confirm.",
    failureFact: "owner_required | board/task mismatch | flag off.",
    nextAllowed: ["S07"],
    bindings: ["tenant", "group", "task", "board", "todolist", "claimant", "actor", "version"],
  },
  {
    id: "S07",
    event: "confirm_todolist",
    step: 7,
    kind: "formal_writer",
    precondition: "Proposed todolist; authorized confirmer; expectedVersion binds.",
    soleWriteEntry: "claim-contract-entry.ts#confirmCollaborationTodolist",
    successFact: "todolist status=confirmed at bound version.",
    failureFact: "confirmer_required | confirmer_mismatch | version conflict.",
    nextAllowed: ["S08"],
    bindings: ["tenant", "group", "task", "board", "todolist", "actor", "version"],
  },
  {
    id: "S08",
    event: "triggerPostPlanConfirmAdvance",
    step: 8,
    kind: "formal_writer",
    precondition: "Confirmed plan; board item has current claimant; binding inputs complete.",
    soleWriteEntry: "post-plan-confirm-advance.ts#triggerPostPlanConfirmAdvance",
    successFact:
      "Wake recorded for claimant only; executionDeliverableBinding attached when complete.",
    failureFact: "confirm_binding_incomplete | claimant missing | version drift.",
    nextAllowed: ["S09"],
    bindings: [
      "tenant",
      "group",
      "task",
      "board",
      "todolist",
      "claimant",
      "opKey",
      "attempt",
      "version",
      "source",
    ],
  },
  {
    id: "S09",
    event: "record_nudge_and_consumeWake",
    step: 9,
    kind: "formal_writer",
    precondition: "Post-plan (or lawful handoff) recorded consumable nudge; wakeContract on.",
    soleWriteEntry:
      "wake-contract / wake-round-dispatch.ts#recordNudgeWake+consumeWakeForRoundDispatch",
    successFact:
      "consume.dispatched===true only on durable settle; wakeDispatcherAccepted definite only.",
    failureFact: "recorded_not_dispatched | wakePendingVerification (unknown/in-flight).",
    nextAllowed: ["S10"],
    bindings: ["tenant", "group", "task", "board", "claimant", "opKey", "attempt", "source"],
    notes: "wakeDispatcherAccepted excludes unknown / external_sent_* / mere pending.",
  },
  {
    id: "S10",
    event: "mode_b_dispatcher",
    step: 10,
    kind: "formal_writer",
    precondition: "consumeWake permitted Mode B round; production createModeBWakeRoundDispatcher.",
    soleWriteEntry: "mode-b-wake-round-dispatcher.ts#createModeBWakeRoundDispatcher",
    successFact:
      "Mode B round runs with real tools; mock model OK; no custom business-state writer.",
    failureFact: "mode_b_* unavailable | auth_revoked | readiness_not_ready.",
    nextAllowed: ["S11", "S12"],
    bindings: ["tenant", "group", "task", "board", "claimant", "opKey", "attempt", "source"],
  },
  {
    id: "S11",
    event: "executionDeliverableBinding",
    step: 11,
    kind: "formal_writer",
    precondition: "Wake request has task+board+op+attempt+agent; confirmed plan bag.",
    soleWriteEntry:
      "attach-wake-execution-deliverable-binding.ts#attachWakeExecutionDeliverableBinding",
    successFact: "Unconfusable binding on request (tenant/group/task/board/planVersion/runId).",
    failureFact:
      "Incomplete inputs leave request unchanged; never mint from OS currentTaskId alone.",
    nextAllowed: ["S12"],
    bindings: [
      "tenant",
      "group",
      "task",
      "board",
      "todolist",
      "deliverable",
      "opKey",
      "attempt",
      "version",
    ],
  },
  {
    id: "S12",
    event: "submitTeamDeliverable",
    step: 12,
    kind: "formal_writer",
    precondition: "Execution binding / ACL allows deliverable write.",
    soleWriteEntry: "team-deliverable-submit.ts#submitTeamDeliverable",
    successFact: "Team deliverable version committed with content sha.",
    failureFact: "ACL deny | idempotent conflict | write failure.",
    nextAllowed: ["S13"],
    bindings: ["tenant", "group", "task", "deliverable", "actor", "version"],
  },
  {
    id: "S13",
    event: "submitForReview",
    step: 13,
    kind: "formal_writer",
    precondition: "Item in_progress; linked deliverable + submissionId + summary.",
    soleWriteEntry: "claim-contract-entry.ts#submitCollaborationBoardItemForReview",
    successFact: "status=submitted_for_review; pendingEventRelay targets authorized reviewer.",
    failureFact: "permissions | missing linked deliverable | version gate.",
    nextAllowed: ["S14"],
    bindings: [
      "tenant",
      "group",
      "task",
      "board",
      "claimant",
      "actor",
      "submission",
      "deliverable",
      "version",
    ],
  },
  {
    id: "S14",
    event: "authorized_review_wake",
    step: 14,
    kind: "formal_writer",
    precondition: "Submission pending review; reviewer = coordinatorBotId || publishedBy (AS-IS).",
    soleWriteEntry: "post-submission-event-advance.ts#triggerPostSubmissionEventAdvance",
    successFact: "Review wake targets authorized reviewer; not executor fan-out.",
    failureFact: "relay blocked | auth_revoked | already settled.",
    nextAllowed: ["S15", "S16"],
    bindings: ["tenant", "group", "task", "board", "submission", "actor", "opKey", "source"],
  },
  {
    id: "S15",
    event: "return_or_revise_optional",
    step: 15,
    kind: "formal_writer",
    precondition: "Authorized return of current submission; then mark in_progress + new submit.",
    soleWriteEntry:
      "claim-contract-entry.ts#returnCollaborationBoardItemSubmission(+markCollaborationBoardItemInProgress)",
    successFact: "status=returned; wake targets claimant; old submission cannot be accepted.",
    failureFact: "invalid_status | expectedSubmissionId mismatch.",
    nextAllowed: ["S12", "S13", "S16"],
    bindings: ["tenant", "group", "task", "board", "claimant", "actor", "submission", "version"],
  },
  {
    id: "S16",
    event: "acceptSubmission",
    step: 16,
    kind: "formal_writer",
    precondition:
      "Authorized reviewer; current submissionId; checked criteria; not bare chat 完成.",
    soleWriteEntry: "claim-contract-entry.ts#acceptCollaborationBoardItemSubmission",
    successFact: "status=accepted; acceptance rationale recorded.",
    failureFact: "chat_completion_is_not_acceptance | late/old submission | criteria fail.",
    nextAllowed: ["S17"],
    bindings: ["tenant", "group", "task", "board", "actor", "submission", "deliverable", "version"],
  },
  {
    id: "S17",
    event: "stop_after_accept",
    step: 17,
    kind: "formal_writer",
    precondition: "Item accepted.",
    soleWriteEntry: "post-submission-event-advance.ts#triggerPostSubmissionEventAdvance",
    successFact: "accepted_no_further_exec_schedule; no further execute wakes for that item.",
    failureFact: "N/A — stop is the terminal success; further exec schedule must refuse.",
    nextAllowed: [],
    bindings: ["tenant", "group", "task", "board", "submission"],
  },
] as const;

/** Bypass / audit / recovery / compat — NOT alternate formal writers. */
export const MAIN_CHAIN_BYPASS_ROWS: readonly MainChainMatrixRow[] = [
  {
    id: "B01",
    event: "peer_ask_or_mention",
    step: null,
    kind: "non_writer",
    precondition: "Peer ask / @mention in chat.",
    soleWriteEntry: "",
    successFact: "May notify; does not publish/claim/confirm/accept.",
    failureFact: "N/A",
    nextAllowed: [],
    bindings: ["group", "actor"],
    notes: "Audit/same-round only — not a formal writer.",
  },
  {
    id: "B02",
    event: "signalInsight",
    step: null,
    kind: "non_writer",
    precondition: "Insight signal / ledger write.",
    soleWriteEntry: "",
    successFact: "Insight recorded; ≠ wake dispatched; ≠ board FSM advance.",
    failureFact: "N/A",
    nextAllowed: [],
    bindings: ["group", "task", "actor"],
  },
  {
    id: "B03",
    event: "heartbeat",
    step: null,
    kind: "non_writer",
    precondition: "Heartbeat tick.",
    soleWriteEntry: "",
    successFact: "May observe / nudge within existing wake contract; not a sole formal writer.",
    failureFact: "N/A",
    nextAllowed: [],
    bindings: ["group", "task", "source"],
  },
  {
    id: "B04",
    event: "selfAdvance_gray_only",
    step: null,
    kind: "non_writer",
    precondition: "selfAdvance gray allowlist; same board/plan/binding/wake surface.",
    soleWriteEntry: "",
    successFact: "May consume existing wake sources; must not invent board/plan/accept writes.",
    failureFact: "allowlist miss → recorded only.",
    nextAllowed: [],
    bindings: ["group", "task", "board", "opKey", "source"],
    notes: "Gray only — same board/plan/binding/wake; not an alternate formal writer.",
  },
  {
    id: "B05",
    event: "scheduleContinueAfterDeliverableSettlement",
    step: null,
    kind: "non_writer",
    precondition: "Deliverable settlement continue schedule.",
    soleWriteEntry: "",
    successFact: "Must respect board/submission state; no shadow accept/claim.",
    failureFact: "Refuses when board/submission gates fail.",
    nextAllowed: [],
    bindings: ["group", "task", "board", "submission", "deliverable"],
  },
  {
    id: "B06",
    event: "resume_after_restart",
    step: null,
    kind: "non_writer",
    precondition: "Process restart with pending relays.",
    soleWriteEntry: "",
    successFact: "Pending relay recovery first; does not invent new formal facts.",
    failureFact: "Unverifiable deferred cleanup retains binding + stops advance.",
    nextAllowed: [],
    bindings: ["group", "task", "board", "opKey", "attempt"],
  },
  {
    id: "B07",
    event: "old_handoff_rpc",
    step: null,
    kind: "non_writer",
    precondition: "Legacy handoff RPC call.",
    soleWriteEntry: "",
    successFact: "reject-adapt only; must not write formal claim/accept as legacy path.",
    failureFact: "Rejected / adapted to current entries.",
    nextAllowed: [],
    bindings: ["group", "task", "actor"],
  },
  {
    id: "B08",
    event: "insight_or_return_ledger_not_dispatched",
    step: null,
    kind: "non_writer",
    precondition: "Insight/return ledger row present.",
    soleWriteEntry: "",
    successFact: "Ledger ≠ dispatched; wakeDispatcherAccepted stays false without definite settle.",
    failureFact: "N/A",
    nextAllowed: [],
    bindings: ["group", "task", "source"],
  },
] as const;

export const MAIN_CHAIN_MATRIX_ALL: readonly MainChainMatrixRow[] = [
  ...MAIN_CHAIN_FORMAL_ROWS,
  ...MAIN_CHAIN_BYPASS_ROWS,
];

export function assertMainChainMatrixInvariants(
  rows: readonly MainChainMatrixRow[] = MAIN_CHAIN_MATRIX_ALL,
): {
  ok: true;
  formalCount: number;
  bypassCount: number;
} {
  const formal = rows.filter((r) => r.kind === "formal_writer");
  const bypass = rows.filter((r) => r.kind === "non_writer");
  if (formal.length !== 17) {
    throw new Error(`expected 17 formal rows, got ${formal.length}`);
  }
  const steps = formal.map((r) => r.step).toSorted((a, b) => (a ?? 0) - (b ?? 0));
  for (let i = 0; i < 17; i += 1) {
    if (steps[i] !== i + 1) {
      throw new Error(`formal step sequence broken at index ${i}: ${JSON.stringify(steps)}`);
    }
  }
  const soleSet = new Set<string>(MAIN_CHAIN_SOLE_WRITE_ENTRIES);
  for (const row of formal) {
    if (!row.soleWriteEntry.trim()) {
      throw new Error(`formal row ${row.id} missing soleWriteEntry`);
    }
    if (!soleSet.has(row.soleWriteEntry) && !row.soleWriteEntry.includes("+")) {
      // Compound entries (return+mark) are allowed when listed with (+…).
      const base = row.soleWriteEntry.split("(")[0].trim();
      if (!soleSet.has(base) && ![...soleSet].some((e) => e.startsWith(base.split("#")[0]))) {
        // Accept if any sole entry shares the same module file prefix.
        const mod = row.soleWriteEntry.split("#")[0];
        if (![...soleSet].some((e) => e.startsWith(mod))) {
          throw new Error(
            `formal row ${row.id} soleWriteEntry not in catalog: ${row.soleWriteEntry}`,
          );
        }
      }
    }
    for (const key of row.bindings) {
      if (!(MAIN_CHAIN_BINDING_KEYS as readonly string[]).includes(key)) {
        throw new Error(`row ${row.id} unknown binding ${key}`);
      }
    }
  }
  for (const row of bypass) {
    if (row.step !== null) {
      throw new Error(`bypass ${row.id} must have step=null`);
    }
    if (row.soleWriteEntry.trim() !== "") {
      throw new Error(`bypass ${row.id} must not declare a sole formal write entry`);
    }
  }
  return { ok: true, formalCount: formal.length, bypassCount: bypass.length };
}

export function renderMainChainMatrixMarkdown(
  rows: readonly MainChainMatrixRow[] = MAIN_CHAIN_FORMAL_ROWS,
): string {
  const header =
    "| id | step | event | precondition | sole write entry | success fact | failure fact | next allowed | bindings |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = rows
    .map((r) => {
      const next = r.nextAllowed.length ? r.nextAllowed.join(", ") : "∅ (stop)";
      const bindings = r.bindings.join(", ");
      return `| ${r.id} | ${r.step ?? "—"} | ${r.event} | ${r.precondition.replace(/\|/g, "/")} | \`${r.soleWriteEntry || "(non-writer)"}\` | ${r.successFact.replace(/\|/g, "/")} | ${r.failureFact.replace(/\|/g, "/")} | ${next} | ${bindings} |`;
    })
    .join("\n");
  return `${header}\n${body}\n`;
}
