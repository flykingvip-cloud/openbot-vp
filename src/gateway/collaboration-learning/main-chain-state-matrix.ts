/**
 * Machine-checkable formal main-chain state matrix (FT-COLLAB-MAIN-CHAIN-MATRIX).
 *
 * ## Definition (t50u revision)
 * **"唯一入口" = unique authoritative state transition**, NOT "one function per stage".
 * RPC / tool / chat may expose multiple **adapter** entries; each must funnel into the
 * **same** auth + state-write implementation for that op. Rows that share
 * `authoritativeOp` + `soleWriteEntry` are views of one op (e.g. S01 recognition vs
 * S02 submit of discuss_to_task) — not two creates.
 *
 * **Bypasses are NOT uniformly "non-writer".** Heartbeat may write wake; selfAdvance
 * may claim via a lawful path. Each bypass lists `mayDelegateTo` (which authoritative
 * entries it may call) and `forbidDirectWrites` (what it must not invent). Catalog
 * kind `bypass` ≠ already constrained; the delegate/forbid columns ARE the constraint.
 *
 * **peer_ask = same-round participation request**, never a formal responsibility fact.
 * Long-task continue reuses board / plan / wake / existing executor — not peer_ask.
 *
 * **This matrix is NOT a second runtime adjudicator.** It describes and verifies
 * existing call relations. It must not re-decide auth, plan, or continue at runtime.
 * Importing this module from production advance/claim/wake paths for control flow
 * is out of scope (tests + docs + static asserts only).
 *
 * Binding keys every formal row may reference:
 * tenant | group | task | board | todolist | claimant | actor | submission |
 * deliverable | opKey | attempt | version | source
 *
 * Hard stops this catalog encodes:
 * - activate success envelope: dispatched === false (ACTIVATE_SUCCESS_DISPATCHED)
 * - wakeDispatcherAccepted only on definite settle / confirmed accept
 * - stop/cancel must pierce the chain: pending continue/wake invalidate; claim
 *   re-validates; reply rewrite / heartbeat / selfAdvance must not lift an effective
 *   stop or auto-mint substitute wake for an invalid wake
 * - budgets stay separate: same-round ≠ finite continue count ≠ task cost
 * - no new scheduler / classifier / role system / total adjudicator
 * - mono vs group SoT must not overwrite each other (see MONO_GROUP_REUSE_BOUNDARY)
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

/** formal_writer = formal chain row; bypass = side path (NOT "already safe non-writer"). */
export type MainChainWriterKind = "formal_writer" | "bypass";

/**
 * authoritative_transition — the unique auth+state write implementation for an op.
 * adapter_view — RPC/tool/chat/recognition view that must funnel into the same
 *   authoritative transition (same authoritativeOp + soleWriteEntry).
 */
export type MainChainEntryRole = "authoritative_transition" | "adapter_view";

export type MainChainMatrixRow = Readonly<{
  /** Stable step id (S01–S17 formal; B* bypass). */
  id: string;
  /** Human / audit event name. */
  event: string;
  /** Ordered step in the formal chain; null for bypass rows. */
  step: number | null;
  kind: MainChainWriterKind;
  /**
   * Formal rows only. adapter_view rows share authoritativeOp + soleWriteEntry with
   * the authoritative_transition for that op (not a second create).
   */
  entryRole: MainChainEntryRole | null;
  /** Shared op key when multiple rows are views of one authoritative transition. */
  authoritativeOp: string | null;
  precondition: string;
  /**
   * Authoritative production write implementation (module#export).
   * Empty for bypass rows (they must only delegate — see mayDelegateTo).
   * Multiple formal rows MAY share this string when they are views of one op.
   */
  soleWriteEntry: string;
  /**
   * Optional extra adapter surfaces (RPC/tool/chat) that must funnel into
   * soleWriteEntry. Descriptive only — not additional writers.
   */
  adapterEntries: readonly string[];
  successFact: string;
  failureFact: string;
  nextAllowed: readonly string[];
  bindings: readonly MainChainBindingKey[];
  /**
   * Bypass only: authoritative formal entries / symbols this path may lawfully
   * delegate to. Empty means messaging/observation only — no formal delegation.
   */
  mayDelegateTo: readonly string[];
  /**
   * Bypass only: direct writes that remain forbidden even if the path can write
   * something else (e.g. heartbeat may write wake via wake-contract, but must not
   * invent claim/accept or mint substitute wake after stop).
   */
  forbidDirectWrites: readonly string[];
  notes?: string;
}>;

/**
 * Frozen cardinality baselines (t50u). Counterexample tests assert these do not
 * grow — new exec entry or continue-loop without replacing an old path is OOS.
 */
export const MAIN_CHAIN_BASELINE_COUNTS = {
  formalSteps: 17,
  bypassRows: 8,
  /** Distinct soleWriteEntry strings referenced by formal rows (compound allowed). */
  distinctSoleWriteEntries: 15,
  /** Distinct authoritativeOp keys across formal rows. */
  distinctAuthoritativeOps: 15,
  /** Rows whose entryRole is adapter_view (recognition/submit/stop views). */
  adapterViewRows: 3,
} as const;

/** Catalog stance: describe/verify only — never a runtime control plane. */
export const MAIN_CHAIN_MATRIX_RUNTIME_STANCE = {
  isRuntimeAdjudicator: false,
  mayReDecideAuth: false,
  mayReDecidePlan: false,
  mayReDecideContinue: false,
  purpose: "describe_and_verify_existing_call_relations",
} as const;

/**
 * Mono (personal) vs group reuse boundary — shareable mechanics vs non-mergeable SoT.
 * Document + cheap assert; not a new runtime gate.
 */
export const MONO_GROUP_REUSE_BOUNDARY = {
  shareable: [
    "executor_finite_continue",
    "tool_fail_class",
    "unknown_anti_retry",
    "queue",
    "stop_checks",
    "progress_event_semantics",
  ],
  doNotMergeSoT: ["personal_current_parked", "group_board_claim_plan"],
  note: "Personal current/parked and group board/claim/plan may feed a unified executor context but must not overwrite each other's authority.",
} as const;

/**
 * Budget semantics stay separate — do not conflate into one fuzzy quota.
 */
export const MAIN_CHAIN_BUDGET_SEMANTICS = {
  sameRoundBudget: "same-round participation / peer budget",
  finiteContinueCount: "executor finite continue count",
  taskCost: "task cost / billing quota",
  mustNotConflate: true,
} as const;

/** Authoritative production write symbols — adapter surfaces funnel here. */
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

const emptyAdapters: readonly string[] = [];
const emptyDelegate: readonly string[] = [];
const emptyForbid: readonly string[] = [];

export const MAIN_CHAIN_FORMAL_ROWS: readonly MainChainMatrixRow[] = [
  {
    id: "S01",
    event: "explicit_delegate",
    step: 1,
    kind: "formal_writer",
    entryRole: "adapter_view",
    authoritativeOp: "discuss_to_task",
    precondition: "Trusted actor issues an explicit collaboration delegate (not oral chat alone).",
    soleWriteEntry: "controlled-discuss-to-task.ts#controlledDiscussToTask",
    adapterEntries: [
      "chat/RPC recognition of explicit delegate intent",
      "tool surface that maps oral→structured delegate",
    ],
    successFact:
      "Discuss-to-task draft / needs_confirm persisted; no board claim; no wake dispatched.",
    failureFact: "blocked / missing contract fields; no board publish.",
    nextAllowed: ["S02"],
    bindings: ["tenant", "group", "task", "actor"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
    notes:
      "Recognition view of discuss_to_task — same authoritative write as S02; NOT a second task create. Oral chat alone never creates a board fact.",
  },
  {
    id: "S02",
    event: "controlledDiscussToTask",
    step: 2,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "discuss_to_task",
    precondition: "S01 contract fields present; claimContract on for group/tenant.",
    soleWriteEntry: "controlled-discuss-to-task.ts#controlledDiscussToTask",
    adapterEntries: emptyAdapters,
    successFact: "needs_confirm or equivalent draft with stable activation fingerprint.",
    failureFact: "blocked; client cannot set humanConfirmed to bypass.",
    nextAllowed: ["S03"],
    bindings: ["tenant", "group", "task", "actor", "version"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
    notes: "Submit/contract view of the same discuss_to_task op as S01 (same soleWriteEntry).",
  },
  {
    id: "S03",
    event: "activateCollaborationTask",
    step: 3,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "activate",
    precondition: "Human confirmed with same first-persisted contract fingerprint.",
    soleWriteEntry: "activate-collaboration-task.ts#activateCollaborationTask",
    adapterEntries: emptyAdapters,
    successFact:
      "status=activated|partial_success; boardPublished may be true; dispatched===false always.",
    failureFact: "needs_confirm | blocked | activation_contract_conflict.",
    nextAllowed: ["S04"],
    bindings: ["tenant", "group", "task", "board", "actor"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
    notes: "ACTIVATE_SUCCESS_DISPATCHED is false; activate never flips wake-level dispatched.",
  },
  {
    id: "S04",
    event: "publish_board",
    step: 4,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "publish_board",
    precondition: "Activate confirmed path or explicit publishCollaborationBoardItem.",
    soleWriteEntry: "claim-contract-entry.ts#publishCollaborationBoardItem",
    adapterEntries: ["activate path may call publish; RPC publishCollaborationBoardItem"],
    successFact: "board status=published; claimantId unset; intended ≠ claimed.",
    failureFact: "publish refused (auth/flag/stopped).",
    nextAllowed: ["S05"],
    bindings: ["tenant", "group", "task", "board", "actor"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
    notes:
      "publish ≠ claim (#214); tryClaimAfterBoardPublish may schedule handoff wake only — not auto-claim.",
  },
  {
    id: "S05",
    event: "claimant_self_claim",
    step: 5,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "claim",
    precondition: "Board published; non-empty trusted actor; actor matches claimant identity.",
    soleWriteEntry: "claim-contract-entry.ts#claimCollaborationBoardItem",
    adapterEntries: [
      "claim-contract tool/RPC",
      "selfAdvance may delegate here when lawful (see B04)",
    ],
    successFact: "claimantId set; status claimed/applied path available; actor non-empty.",
    failureFact: "actor_required | claim_actor_mismatch | claimant_required | auth_revoked.",
    nextAllowed: ["S06"],
    bindings: ["tenant", "group", "task", "board", "claimant", "actor"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
    notes:
      "Proxy claim forbidden; empty actor must not backfill from claimantId (#214). Re-validate stop/cancel on claim.",
  },
  {
    id: "S06",
    event: "propose_todolist",
    step: 6,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "propose_todolist",
    precondition: "Active claim/apply; ownerMemberId/actor present.",
    soleWriteEntry: "claim-contract-entry.ts#proposeCollaborationTodolist",
    adapterEntries: emptyAdapters,
    successFact: "todolist proposed with boardItemId+version; awaiting confirm.",
    failureFact: "owner_required | board/task mismatch | flag off.",
    nextAllowed: ["S07"],
    bindings: ["tenant", "group", "task", "board", "todolist", "claimant", "actor", "version"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
  },
  {
    id: "S07",
    event: "confirm_todolist",
    step: 7,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "confirm_todolist",
    precondition: "Proposed todolist; authorized confirmer; expectedVersion binds.",
    soleWriteEntry: "claim-contract-entry.ts#confirmCollaborationTodolist",
    adapterEntries: ["agent-peer confirmTodolist auto-confirm when authorized"],
    successFact: "todolist status=confirmed at bound version.",
    failureFact: "confirmer_required | confirmer_mismatch | version conflict.",
    nextAllowed: ["S08"],
    bindings: ["tenant", "group", "task", "board", "todolist", "actor", "version"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
  },
  {
    id: "S08",
    event: "triggerPostPlanConfirmAdvance",
    step: 8,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "post_plan_advance",
    precondition: "Confirmed plan; board item has current claimant; binding inputs complete.",
    soleWriteEntry: "post-plan-confirm-advance.ts#triggerPostPlanConfirmAdvance",
    adapterEntries: emptyAdapters,
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
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
  },
  {
    id: "S09",
    event: "record_nudge_and_consumeWake",
    step: 9,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "wake_record_consume",
    precondition: "Post-plan (or lawful handoff) recorded consumable nudge; wakeContract on.",
    soleWriteEntry:
      "wake-contract / wake-round-dispatch.ts#recordNudgeWake+consumeWakeForRoundDispatch",
    adapterEntries: [
      "heartbeat may delegate wake write here (B03)",
      "selfAdvance may consume existing wake here (B04)",
    ],
    successFact:
      "consume.dispatched===true only on durable settle; wakeDispatcherAccepted definite only.",
    failureFact: "recorded_not_dispatched | wakePendingVerification (unknown/in-flight).",
    nextAllowed: ["S10"],
    bindings: ["tenant", "group", "task", "board", "claimant", "opKey", "attempt", "source"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
    notes:
      "wakeDispatcherAccepted excludes unknown / external_sent_* / mere pending. Invalid wake must not be replaced by auto-minted substitute after stop.",
  },
  {
    id: "S10",
    event: "mode_b_dispatcher",
    step: 10,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "mode_b_dispatch",
    precondition: "consumeWake permitted Mode B round; production createModeBWakeRoundDispatcher.",
    soleWriteEntry: "mode-b-wake-round-dispatcher.ts#createModeBWakeRoundDispatcher",
    adapterEntries: emptyAdapters,
    successFact:
      "Mode B round runs with real tools; mock model OK; no custom business-state writer.",
    failureFact: "mode_b_* unavailable | auth_revoked | readiness_not_ready.",
    nextAllowed: ["S11", "S12"],
    bindings: ["tenant", "group", "task", "board", "claimant", "opKey", "attempt", "source"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
  },
  {
    id: "S11",
    event: "executionDeliverableBinding",
    step: 11,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "exec_binding",
    precondition: "Wake request has task+board+op+attempt+agent; confirmed plan bag.",
    soleWriteEntry:
      "attach-wake-execution-deliverable-binding.ts#attachWakeExecutionDeliverableBinding",
    adapterEntries: emptyAdapters,
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
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
  },
  {
    id: "S12",
    event: "submitTeamDeliverable",
    step: 12,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "submit_deliverable",
    precondition: "Execution binding / ACL allows deliverable write.",
    soleWriteEntry: "team-deliverable-submit.ts#submitTeamDeliverable",
    adapterEntries: emptyAdapters,
    successFact: "Team deliverable version committed with content sha.",
    failureFact: "ACL deny | idempotent conflict | write failure.",
    nextAllowed: ["S13"],
    bindings: ["tenant", "group", "task", "deliverable", "actor", "version"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
  },
  {
    id: "S13",
    event: "submitForReview",
    step: 13,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "submit_for_review",
    precondition: "Item in_progress; linked deliverable + submissionId + summary.",
    soleWriteEntry: "claim-contract-entry.ts#submitCollaborationBoardItemForReview",
    adapterEntries: emptyAdapters,
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
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
  },
  {
    id: "S14",
    event: "authorized_review_wake",
    step: 14,
    kind: "formal_writer",
    entryRole: "adapter_view",
    authoritativeOp: "post_submission_advance",
    precondition: "Submission pending review; reviewer = coordinatorBotId || publishedBy (AS-IS).",
    soleWriteEntry: "post-submission-event-advance.ts#triggerPostSubmissionEventAdvance",
    adapterEntries: emptyAdapters,
    successFact: "Review wake targets authorized reviewer; not executor fan-out.",
    failureFact: "relay blocked | auth_revoked | already settled.",
    nextAllowed: ["S15", "S16"],
    bindings: ["tenant", "group", "task", "board", "submission", "actor", "opKey", "source"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
    notes:
      "Review-wake view of post_submission_advance — same authoritative entry as S17 stop view.",
  },
  {
    id: "S15",
    event: "return_or_revise_optional",
    step: 15,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "return_revise",
    precondition: "Authorized return of current submission; then mark in_progress + new submit.",
    soleWriteEntry:
      "claim-contract-entry.ts#returnCollaborationBoardItemSubmission(+markCollaborationBoardItemInProgress)",
    adapterEntries: emptyAdapters,
    successFact: "status=returned; wake targets claimant; old submission cannot be accepted.",
    failureFact: "invalid_status | expectedSubmissionId mismatch.",
    nextAllowed: ["S12", "S13", "S16"],
    bindings: ["tenant", "group", "task", "board", "claimant", "actor", "submission", "version"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
  },
  {
    id: "S16",
    event: "acceptSubmission",
    step: 16,
    kind: "formal_writer",
    entryRole: "authoritative_transition",
    authoritativeOp: "accept",
    precondition:
      "Authorized reviewer; current submissionId; checked criteria; not bare chat 完成.",
    soleWriteEntry: "claim-contract-entry.ts#acceptCollaborationBoardItemSubmission",
    adapterEntries: emptyAdapters,
    successFact: "status=accepted; acceptance rationale recorded.",
    failureFact: "chat_completion_is_not_acceptance | late/old submission | criteria fail.",
    nextAllowed: ["S17"],
    bindings: ["tenant", "group", "task", "board", "actor", "submission", "deliverable", "version"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
  },
  {
    id: "S17",
    event: "stop_after_accept",
    step: 17,
    kind: "formal_writer",
    entryRole: "adapter_view",
    authoritativeOp: "post_submission_advance",
    precondition: "Item accepted (or cancelled/stopped — same refuse path).",
    soleWriteEntry: "post-submission-event-advance.ts#triggerPostSubmissionEventAdvance",
    adapterEntries: emptyAdapters,
    successFact:
      "accepted_no_further_exec_schedule / cancelled_no_further_exec_schedule; no further execute wakes.",
    failureFact: "N/A — stop is the terminal success; further exec schedule must refuse.",
    nextAllowed: [],
    bindings: ["tenant", "group", "task", "board", "submission"],
    mayDelegateTo: emptyDelegate,
    forbidDirectWrites: emptyForbid,
    notes:
      "Stop view of post_submission_advance. After user cancel/stop: pending continue/wake invalidate; claim re-validates; heartbeat/selfAdvance/reply rewrite must not lift effective stop or mint substitute wake.",
  },
] as const;

/**
 * Bypass / audit / recovery / compat. NOT uniformly "non-writer":
 * each row MUST declare mayDelegateTo + forbidDirectWrites.
 */
export const MAIN_CHAIN_BYPASS_ROWS: readonly MainChainMatrixRow[] = [
  {
    id: "B01",
    event: "peer_ask_or_mention",
    step: null,
    kind: "bypass",
    entryRole: null,
    authoritativeOp: null,
    precondition: "Peer ask / @mention in chat (same-round participation request).",
    soleWriteEntry: "",
    adapterEntries: emptyAdapters,
    successFact:
      "May request same-round participation; does not create formal responsibility / claim / accept.",
    failureFact: "N/A",
    nextAllowed: [],
    bindings: ["group", "actor"],
    mayDelegateTo: [],
    forbidDirectWrites: [
      "publish_board",
      "claim",
      "confirm_todolist",
      "accept",
      "formal_responsibility_fact",
      "mint_execute_wake",
    ],
    notes:
      "Discuss supplement ≠ formal handoff. peer_ask never becomes formal responsibility. Long-task continue reuses board/plan/wake/existing executor — not this path.",
  },
  {
    id: "B02",
    event: "signalInsight",
    step: null,
    kind: "bypass",
    entryRole: null,
    authoritativeOp: null,
    precondition: "Insight signal / ledger write.",
    soleWriteEntry: "",
    adapterEntries: emptyAdapters,
    successFact: "Insight recorded; ≠ wake dispatched; ≠ board FSM advance.",
    failureFact: "N/A",
    nextAllowed: [],
    bindings: ["group", "task", "actor"],
    mayDelegateTo: [],
    forbidDirectWrites: [
      "publish_board",
      "claim",
      "confirm_todolist",
      "accept",
      "wake_dispatch_as_definite",
      "board_fsm_advance",
    ],
    notes: "Observation / audit ledger only.",
  },
  {
    id: "B03",
    event: "heartbeat",
    step: null,
    kind: "bypass",
    entryRole: null,
    authoritativeOp: null,
    precondition: "Heartbeat tick.",
    soleWriteEntry: "",
    adapterEntries: emptyAdapters,
    successFact:
      "May write/observe wake ONLY by delegating to wake-contract (S09); not an unconstrained writer.",
    failureFact: "N/A",
    nextAllowed: [],
    bindings: ["group", "task", "source"],
    mayDelegateTo: ["S09:wake-contract/recordNudgeWake+consumeWakeForRoundDispatch"],
    forbidDirectWrites: [
      "publish_board",
      "claim",
      "confirm_todolist",
      "accept",
      "lift_effective_stop",
      "mint_substitute_wake_for_invalid_wake",
      "direct_board_fsm_without_sole_entry",
    ],
    notes:
      "NOT 'non-writer' — may write wake via lawful S09. Must not lift stop or auto-mint substitute wake after invalidation.",
  },
  {
    id: "B04",
    event: "selfAdvance_gray_only",
    step: null,
    kind: "bypass",
    entryRole: null,
    authoritativeOp: null,
    precondition: "selfAdvance gray allowlist; same board/plan/binding/wake surface.",
    soleWriteEntry: "",
    adapterEntries: emptyAdapters,
    successFact:
      "May claim/consume ONLY by delegating to S05/S09; must not invent board/plan/accept writes.",
    failureFact: "allowlist miss → recorded only.",
    nextAllowed: [],
    bindings: ["group", "task", "board", "opKey", "source"],
    mayDelegateTo: [
      "S05:claim-contract-entry.ts#claimCollaborationBoardItem",
      "S09:wake-contract/recordNudgeWake+consumeWakeForRoundDispatch",
    ],
    forbidDirectWrites: [
      "direct_board_fsm_invent",
      "confirm_todolist_without_claim",
      "accept",
      "lift_effective_stop",
      "mint_substitute_wake_for_invalid_wake",
      "shadow_scheduler",
    ],
    notes:
      "NOT uniform non-writer — lawful claim via S05 is allowed. Gray only; no alternate adjudicator.",
  },
  {
    id: "B05",
    event: "scheduleContinueAfterDeliverableSettlement",
    step: null,
    kind: "bypass",
    entryRole: null,
    authoritativeOp: null,
    precondition: "Deliverable settlement continue schedule (finite continue — distinct budget).",
    soleWriteEntry: "",
    adapterEntries: emptyAdapters,
    successFact:
      "May continue only by reusing board/plan/wake/executor + stop checks; no shadow accept/claim.",
    failureFact: "Refuses when board/submission/stop gates fail.",
    nextAllowed: [],
    bindings: ["group", "task", "board", "submission", "deliverable"],
    mayDelegateTo: [
      "S09:wake-contract/recordNudgeWake+consumeWakeForRoundDispatch",
      "S10:mode-b-wake-round-dispatcher",
      "existing_executor_finite_continue",
    ],
    forbidDirectWrites: [
      "accept",
      "claim",
      "publish_board",
      "lift_effective_stop",
      "conflate_same_round_budget_with_continue_count",
    ],
    notes:
      "Long-task continue reuses board/plan/wake/executor. Finite continue count ≠ same-round budget ≠ task cost.",
  },
  {
    id: "B06",
    event: "resume_after_restart",
    step: null,
    kind: "bypass",
    entryRole: null,
    authoritativeOp: null,
    precondition: "Process restart with pending relays.",
    soleWriteEntry: "",
    adapterEntries: emptyAdapters,
    successFact: "Pending relay recovery first; does not invent new formal facts.",
    failureFact: "Unverifiable deferred cleanup retains binding + stops advance.",
    nextAllowed: [],
    bindings: ["group", "task", "board", "opKey", "attempt"],
    mayDelegateTo: ["S09:wake-contract recovery consume", "post-submission pending relay recovery"],
    forbidDirectWrites: [
      "invent_new_claim",
      "invent_new_accept",
      "mint_substitute_wake_for_invalid_wake",
      "clear_effective_stop",
    ],
  },
  {
    id: "B07",
    event: "old_handoff_rpc",
    step: null,
    kind: "bypass",
    entryRole: null,
    authoritativeOp: null,
    precondition: "Legacy handoff RPC call (compat kept — reject-adapt only).",
    soleWriteEntry: "",
    adapterEntries: emptyAdapters,
    successFact: "reject-adapt only; must funnel to current authoritative entries when adapted.",
    failureFact: "Rejected / adapted to current entries.",
    nextAllowed: [],
    bindings: ["group", "task", "actor"],
    mayDelegateTo: [
      "S04:publishCollaborationBoardItem",
      "S05:claimCollaborationBoardItem",
      "S01/S02:controlledDiscussToTask",
    ],
    forbidDirectWrites: [
      "legacy_direct_claim_write",
      "legacy_direct_accept_write",
      "duplicate_schedule_same_work_alongside_new_entry",
    ],
    notes: "Compat path retained; must not write formal claim/accept as legacy parallel writer.",
  },
  {
    id: "B08",
    event: "insight_or_return_ledger_not_dispatched",
    step: null,
    kind: "bypass",
    entryRole: null,
    authoritativeOp: null,
    precondition: "Insight/return ledger row present.",
    soleWriteEntry: "",
    adapterEntries: emptyAdapters,
    successFact: "Ledger ≠ dispatched; wakeDispatcherAccepted stays false without definite settle.",
    failureFact: "N/A",
    nextAllowed: [],
    bindings: ["group", "task", "source"],
    mayDelegateTo: [],
    forbidDirectWrites: ["wake_dispatch_as_definite", "claim", "accept", "board_fsm_advance"],
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
  distinctSoleWriteEntries: number;
  distinctAuthoritativeOps: number;
  adapterViewRows: number;
} {
  const formal = rows.filter((r) => r.kind === "formal_writer");
  const bypass = rows.filter((r) => r.kind === "bypass");
  if (formal.length !== MAIN_CHAIN_BASELINE_COUNTS.formalSteps) {
    throw new Error(
      `expected ${MAIN_CHAIN_BASELINE_COUNTS.formalSteps} formal rows, got ${formal.length}`,
    );
  }
  if (bypass.length !== MAIN_CHAIN_BASELINE_COUNTS.bypassRows) {
    throw new Error(
      `expected ${MAIN_CHAIN_BASELINE_COUNTS.bypassRows} bypass rows, got ${bypass.length}`,
    );
  }
  const steps = formal.map((r) => r.step).toSorted((a, b) => (a ?? 0) - (b ?? 0));
  for (let i = 0; i < formal.length; i += 1) {
    if (steps[i] !== i + 1) {
      throw new Error(`formal step sequence broken at index ${i}: ${JSON.stringify(steps)}`);
    }
  }
  const soleSet = new Set<string>(MAIN_CHAIN_SOLE_WRITE_ENTRIES);
  for (const row of formal) {
    if (!row.soleWriteEntry.trim()) {
      throw new Error(`formal row ${row.id} missing soleWriteEntry`);
    }
    if (!row.authoritativeOp) {
      throw new Error(`formal row ${row.id} missing authoritativeOp`);
    }
    if (!row.entryRole) {
      throw new Error(`formal row ${row.id} missing entryRole`);
    }
    if (!soleSet.has(row.soleWriteEntry) && !row.soleWriteEntry.includes("+")) {
      const base = row.soleWriteEntry.split("(")[0].trim();
      if (!soleSet.has(base) && ![...soleSet].some((e) => e.startsWith(base.split("#")[0]))) {
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

  // Adapter views of the same op must share soleWriteEntry with the authoritative row.
  const byOp = new Map<string, MainChainMatrixRow[]>();
  for (const row of formal) {
    const op = row.authoritativeOp!;
    const list = byOp.get(op) ?? [];
    list.push(row);
    byOp.set(op, list);
  }
  for (const [op, group] of byOp) {
    const auth = group.filter((r) => r.entryRole === "authoritative_transition");
    const adapters = group.filter((r) => r.entryRole === "adapter_view");
    if (adapters.length > 0) {
      if (auth.length !== 1 && op !== "post_submission_advance") {
        // discuss_to_task: S02 authoritative + S01 adapter; post_submission: S14+S17 both adapter views of one impl
        // Allow ops where all sharing rows are adapter_view of one soleWriteEntry (stop/review).
        const entries = new Set(group.map((r) => r.soleWriteEntry));
        if (entries.size !== 1) {
          throw new Error(
            `authoritativeOp ${op}: adapter views must share one soleWriteEntry, got ${[...entries].join(" | ")}`,
          );
        }
      } else if (auth.length === 1) {
        for (const a of adapters) {
          if (a.soleWriteEntry !== auth[0].soleWriteEntry) {
            throw new Error(
              `adapter ${a.id} must share soleWriteEntry with authoritative ${auth[0].id} for op ${op}`,
            );
          }
        }
      } else {
        const entries = new Set(group.map((r) => r.soleWriteEntry));
        if (entries.size !== 1) {
          throw new Error(`authoritativeOp ${op}: shared views must funnel to one soleWriteEntry`);
        }
      }
    }
  }

  for (const row of bypass) {
    if (row.step !== null) {
      throw new Error(`bypass ${row.id} must have step=null`);
    }
    if (row.soleWriteEntry.trim() !== "") {
      throw new Error(
        `bypass ${row.id} must not declare soleWriteEntry (delegate via mayDelegateTo instead)`,
      );
    }
    if (row.entryRole !== null) {
      throw new Error(`bypass ${row.id} entryRole must be null`);
    }
    if (!Array.isArray(row.mayDelegateTo)) {
      throw new Error(`bypass ${row.id} missing mayDelegateTo`);
    }
    if (!Array.isArray(row.forbidDirectWrites) || row.forbidDirectWrites.length === 0) {
      throw new Error(
        `bypass ${row.id} must list forbidDirectWrites (kind=bypass ≠ already constrained)`,
      );
    }
  }

  if (MAIN_CHAIN_MATRIX_RUNTIME_STANCE.isRuntimeAdjudicator) {
    throw new Error("matrix must not be a runtime adjudicator");
  }

  const distinctSole = new Set(formal.map((r) => r.soleWriteEntry));
  const distinctOps = new Set(formal.map((r) => r.authoritativeOp));
  const adapterViewRows = formal.filter((r) => r.entryRole === "adapter_view").length;

  if (distinctSole.size !== MAIN_CHAIN_BASELINE_COUNTS.distinctSoleWriteEntries) {
    throw new Error(
      `distinct soleWriteEntry count ${distinctSole.size} ≠ baseline ${MAIN_CHAIN_BASELINE_COUNTS.distinctSoleWriteEntries} (exec entry growth OOS)`,
    );
  }
  if (distinctOps.size !== MAIN_CHAIN_BASELINE_COUNTS.distinctAuthoritativeOps) {
    throw new Error(
      `distinct authoritativeOp count ${distinctOps.size} ≠ baseline ${MAIN_CHAIN_BASELINE_COUNTS.distinctAuthoritativeOps}`,
    );
  }
  if (adapterViewRows !== MAIN_CHAIN_BASELINE_COUNTS.adapterViewRows) {
    throw new Error(
      `adapter_view rows ${adapterViewRows} ≠ baseline ${MAIN_CHAIN_BASELINE_COUNTS.adapterViewRows}`,
    );
  }

  return {
    ok: true,
    formalCount: formal.length,
    bypassCount: bypass.length,
    distinctSoleWriteEntries: distinctSole.size,
    distinctAuthoritativeOps: distinctOps.size,
    adapterViewRows,
  };
}

export function renderMainChainMatrixMarkdown(
  rows: readonly MainChainMatrixRow[] = MAIN_CHAIN_FORMAL_ROWS,
): string {
  const header =
    "| id | step | event | role | authoritativeOp | precondition | authoritative write | adapters | success fact | failure fact | next allowed | bindings |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = rows
    .map((r) => {
      const next = r.nextAllowed.length ? r.nextAllowed.join(", ") : "∅ (stop)";
      const bindings = r.bindings.join(", ");
      const adapters = r.adapterEntries.length ? r.adapterEntries.join("; ") : "—";
      return `| ${r.id} | ${r.step ?? "—"} | ${r.event} | ${r.entryRole ?? "bypass"} | ${r.authoritativeOp ?? "—"} | ${r.precondition.replace(/\|/g, "/")} | \`${r.soleWriteEntry || "(delegate-only)"}\` | ${adapters.replace(/\|/g, "/")} | ${r.successFact.replace(/\|/g, "/")} | ${r.failureFact.replace(/\|/g, "/")} | ${next} | ${bindings} |`;
    })
    .join("\n");
  return `${header}\n${body}\n`;
}

export function renderMainChainBypassMarkdown(
  rows: readonly MainChainMatrixRow[] = MAIN_CHAIN_BYPASS_ROWS,
): string {
  const header =
    "| id | event | mayDelegateTo | forbidDirectWrites | success fact | notes |\n| --- | --- | --- | --- | --- | --- |";
  const body = rows
    .map((r) => {
      const dele = r.mayDelegateTo.length
        ? r.mayDelegateTo.join("; ")
        : "(none — no formal delegation)";
      const forbid = r.forbidDirectWrites.join("; ");
      return `| ${r.id} | ${r.event} | ${dele.replace(/\|/g, "/")} | ${forbid.replace(/\|/g, "/")} | ${r.successFact.replace(/\|/g, "/")} | ${(r.notes ?? "").replace(/\|/g, "/")} |`;
    })
    .join("\n");
  return `${header}\n${body}\n`;
}
