export type CollaborationDefaultsConfig = {
  /** Shared workspace root for collaboration groups. */
  workspace?: string;
};

export type CollaborationConfig = {
  /** Server-managed group overrides; never inherited from personal rule mode. */
  ruleDecisionByGroupId?: Record<
    string,
    {
      mode: "legacy" | "dynamic";
      fallback: "legacy" | "block";
    }
  >;
  defaults?: CollaborationDefaultsConfig;
  /**
   * Floor Runtime v2.1 P0.0a flag `collab.runtimeNamespace` (default false).
   * When true, collaboration runtime facts (rounds, ledger) live under the tenant
   * runtime namespace `<groupLocator>/runtime`; managed_enterprise without a trusted
   * tenant fails closed. Do not enable before the §3.4 / N2 cutover gates pass.
   */
  runtimeNamespace?: boolean;
  /**
   * Cutover maintenance window (default false). When true, collaboration runtime
   * writes (round snapshots/transitions, ledger appends) are rejected.
   */
  runtimeWriteFreeze?: boolean;
  /**
   * Floor Runtime v2.1 P0.0b flag `collab.policySnapshot` (default false).
   * When true, each collaboration round compiles EffectivePolicy once into a
   * frozen RoundPolicySnapshot (policySnapshotId / policyHash / provenanceHash /
   * compilerRevision), injects it into consumers, stamps CollaborationEventKey on
   * new ledger / PDR / round records, and persists the snapshot body content-addressed.
   * When false, paths and bytes match the pre-P0.0b baseline.
   */
  policySnapshot?: boolean;
  /**
   * Collaboration context P0 flag `collab.privateRunBag` (default false).
   * When true, `runGroupBotDiscussionTurn` injects an ephemeral per-bot private
   * run bag (overlay, capability set, scratch, tool side-effect index) onto the
   * turn MsgContext. The bag must never be written into GROUP_PUBLIC transcript.
   * Session `collaborationParticipationOverlay` is stored as a per-botId bag
   * regardless; dispatch always resolves the current bot only. Leave off until
   * P0 gates pass — flag-off skips bag injection only.
   */
  privateRunBag?: boolean;
  /**
   * Collaboration context fault-round observability (default false).
   * When true, emits a structured `collab.fault_round` lifecycle diagnostic per
   * group/bot turn: sessionKey/groupId/runId, agentId, inbound depth (or absence),
   * Context Scope mode, Context Compiler lane/unit counts/budget/dropReasons,
   * active-task summary presence, and visible outcome / skipReason. Reuses
   * existing compiler telemetry; does not widen windows or change dispatch.
   * Also enabled by OPENBOT_COLLAB_FAULT_ROUND_OBS=1.
   */
  faultRoundObservability?: boolean;
  /**
   * Collaboration context: stable group task summary (default false).
   * When true, group-scoped Context Compiler candidates keep injecting a ledger
   * task summary even if the bound / recent task is no longer `active` (paused
   * or done), so「继续」does not lose goal/constraints/decisions. Summary is
   * built from the group task ledger (GROUP_PUBLIC memory SoT) — not private
   * run bags, not private LTM, and not a per-bot history copy. Personal 1:1
   * (agent scope) stays active-only. Also enabled by
   * OPENBOT_COLLAB_GROUP_TASK_STABLE_SUMMARY=1. Does not widen Compiler windows.
   */
  groupTaskStableSummary?: boolean;
  /**
   * Expert #3: collaboration-specific Context Compiler strategy (default false).
   * When true on group sessions: modestly larger group recent-unit window and
   * retain multi-member conclusions/disagreements when compressing a round.
   * Personal 1:1 and flag-off keep global lane budgets unchanged.
   * Also OPENBOT_COLLAB_COMPILE_STRATEGY=1.
   */
  collabCompileStrategy?: boolean;
  /**
   * Expert #4: explicit knowledge recovery entry (default false).
   * When true, phrases like「按前面约定」「继续上次任务」prefer retrieve of the
   * current group task + group-authorized materials. Private LTM still requires
   * explicit promote. Does not break group minimal when unset.
   * Also OPENBOT_COLLAB_EXPLICIT_KNOWLEDGE_RECOVERY=1.
   */
  explicitKnowledgeRecovery?: boolean;
  /**
   * Expert #5: surface silent suppress reasons in UI / abort notices (default false).
   * Distinguishes 已运行重复略过 / 等待成员审批 / 未获调度 / 上下文不足.
   * Also OPENBOT_COLLAB_SURFACE_SILENT_SUPPRESS=1.
   */
  surfaceSilentSuppressReasons?: boolean;
  /**
   * Collaboration context P1 same-round coverage map options (default unset = off).
   * Coverage-map fields are always built for prompts; primaryQualityRedo stays a stub.
   */
  sameRoundCoverage?: CollaborationSameRoundCoverageConfig;
  /**
   * Floor Runtime v2.1 §5.6 P1-B① flag `collab.episodeStore` (default false).
   * When true, Episode orchestration facts may be persisted under
   * `<ns>/episodes/<episodeId>/` and `recoverIncompleteEpisodes` may run.
   * The single-beat runtime may also record Facilitator gate results at
   * FACILITATOR_OBSERVE. Those results use the existing Episode Decision
   * Record `facilitator[]` outcomes and do not change who speaks.
   * When false (default), no live Episode write path is wired — production
   * behavior is byte-for-byte unchanged. Do not enable until P1-B① gates pass.
   */
  episodeStore?: boolean;
  /**
   * P5 multi-Beat Episode raise gate (plan name `collab.episode.maxBeats`).
   * Default unset = single Beat (maxBeats 1). Explicit integer 2..12 raises the
   * EffectivePolicy ceiling and lets Facilitator record next_beat as authorized.
   * Does not enable Floor live or invent a multi-beat production controller;
   * G2 single-beat runtime still refuses to apply next_beat.
   */
  episode?: CollaborationEpisodeConfig;
  /**
   * Floor Runtime v2.1 §5.6 / §2.11 P1-B② flag `collab.ledger.decisionRecords`
   * (default false). When true, the gated writer may append exactly one
   * EpisodeDecisionRecord and one PolicyDecisionRecord v2 per beat. When false,
   * that writer is a no-op and is not on the live hot path.
   */
  ledger?: CollaborationLedgerConfig;
  /**
   * Floor Runtime v2.1 §5.6 / §2.10 P1-B③ flag `collab.task.handoffContract`
   * (default false). When true, owner and responsibility changes go through
   * HandoffContract (accept + approve, then applyApprovedHandoff). The legacy
   * applyTaskHandoff / collaboration.task.handoff shortcut is retired and never
   * mutates responsibility (T09-B1), including when this flag is false.
   */
  task?: CollaborationTaskConfig;
  /**
   * P4c async Learning aggregation (责任·贡献·创新·共享). Default unset = off.
   */
  learning?: CollaborationLearningConfig;
  /**
   * Floor Runtime v2.1 §5.7 P1-C flag `collab.floor.protocol`
   * (default unset = legacy, not shadow). `shadow` records intent / Need /
   * useful-v1 / legacy baseline metrics under `<ns>/shadow/` and does not
   * change decide or dispatch. `floor` is reserved and not wired.
   */
  floor?: CollaborationFloorConfig;
  /**
   * Floor Runtime v2.1 P0.2 ops hotfixes (default unset = no hotfix behavior).
   */
  hotfix?: CollaborationHotfixConfig;
  /**
   * Floor Runtime v2.1 §5.5 P1-A5 per-capability-lane switches
   * (`collab.lane.<x>=legacy|shadow|effective`). Most lanes: unset = legacy (off).
   * Context lane ④: unset = effective (Owner cutover); set `legacy` to roll back.
   * Other lanes: do not set `effective` until that lane's shadow window is clean.
   */
  lane?: CollaborationLaneConfig;
  /**
   * Floor Runtime v2.1 §5.5 ③ governance behavior gates (default off).
   */
  governance?: CollaborationGovernanceGatesConfig;
  /**
   * Floor Runtime v2.1 §5.5 ③ edge isolation gate (default off).
   */
  edge?: CollaborationEdgeConfig;
};

export type CollaborationSameRoundCoverageConfig = {
  /**
   * Plan flag `collab.sameRoundCoverage.primaryQualityRedo` (default false).
   * When true, would allow one primary redo before opening supplement if primary
   * quality is poor. Stub only in P1 — the redo loop is not wired; leave off.
   */
  primaryQualityRedo?: boolean;
};

export type CollaborationLaneMode = "legacy" | "shadow" | "effective";

export type CollaborationLaneConfig = {
  /**
   * Context lane ④ (BP-11 / BP-12). Default unset = **effective** (Owner cutover 2026-10-14).
   * `shadow` serves legacy live and records policy_lane_divergence;
   * `effective` serves authority.policy.effective.context.
   * Kill-switch: set `legacy` (or `shadow` to re-observe) explicitly.
   */
  context?: CollaborationLaneMode;
  /**
   * Presentation lane ⑤ (BP-14 replyLanguage). Default unset = legacy.
   * `shadow` serves the raw operatingState replyLanguage live and records
   * policy_lane_divergence; `effective` serves
   * authority.policy.effective.presentation.replyLanguage.
   */
  presentation?: CollaborationLaneMode;
  /**
   * Participation lane ① (BP-01/02/04/05 / mentionBotMustRespond). Default unset = legacy.
   * `shadow` serves legacy live and records policy_lane_divergence;
   * `effective` serves authority.policy.effective.participation.
   */
  participation?: CollaborationLaneMode;
  /**
   * Dispatch lane ② (BP-03 / BP-06..10 / BP-13 / B1 keywordCaps). Default unset = legacy.
   * `shadow` serves legacy live and records policy_lane_divergence;
   * `effective` serves authority.policy.effective.dispatch (+ strategy.preserveConflict).
   */
  dispatch?: CollaborationLaneMode;
  /**
   * Governance lane ③ (BP-15/16 coordinator, BP-17 policyHash overlay, B8 actor).
   * Default unset = legacy. `shadow` serves legacy live and records policy_lane_divergence;
   * `effective` serves authority.policy.effective.governance.coordinatorBotId.
   */
  governance?: CollaborationLaneMode;
};

/**
 * Floor Runtime v2.1 §5.5 ③ behavior gates (default all off).
 * Do not enable until the lane's shadow divergence window is clean.
 */
export type CollaborationGovernanceGatesConfig = {
  /**
   * When true (and lane.governance=effective), classifyGovernanceActor fails closed
   * for empty/unknown actors. Default unset/false = legacy fail-open classification.
   */
  actorFailClosed?: boolean;
};

export type CollaborationEdgeConfig = {
  /**
   * When true, edge-content isolation is enforced. Default unset/false = off.
   * Declared for §5.5 ③; live wiring is a cutover decision (see final-gate report).
   */
  isolation?: boolean;
};

export type CollaborationLedgerConfig = {
  /**
   * Plan flag `collab.ledger.decisionRecords`. Default unset/false = off.
   * Do not enable until P1-B② gates pass — flag-off record-class paths stay unchanged.
   */
  decisionRecords?: boolean;
};

export type CollaborationFloorProtocol = "legacy" | "shadow" | "floor";

export type CollaborationFloorConfig = {
  /**
   * Plan flag `collab.floor.protocol`. Default unset/legacy = off.
   * `shadow` is observe-only. `floor` is accepted and ignored. P0 G1 does not
   * treat it as live: production speakers stay on the legacy executor until
   * the unsigned cutover receipt in floor-live-cutover.ts is signed.
   */
  protocol?: CollaborationFloorProtocol;
  /**
   * Plan flag `collab.floor.shadowStage`. Default unset = off.
   * `A` computes L0/L1/Admission onto decision.floorShadow and, when
   * ledger decision records are also enabled, writes the legacy-vs-floor
   * compare onto the EpisodeDecisionRecord. It does not change participants.
   * `B` is Shadow-B. Plan notation `B@rate` is this value plus
   * `bidSampleRate` and `bidDailyTokenCap`. Bids never change participants.
   */
  shadowStage?: "A" | "B";
  /**
   * Sample rate in [0, 1] for ambiguous L2 bids. Unset = 0.
   * Consulted only when shadowStage is `B`.
   */
  bidSampleRate?: number;
  /**
   * Per-group daily token ceiling for L2 bids. Unset = 0 (no model calls).
   * Consulted only when shadowStage is `B`.
   */
  bidDailyTokenCap?: number;
};

export type CollaborationEpisodeConfig = {
  /**
   * Plan flag `collab.episode.maxBeats`. Default unset = 1 (single Beat).
   * Integer 1..12. Values below 1 clamp to 1; above 12 clamp to 12.
   * Raising above 1 opens the P5 multi-Beat gate for policy + Facilitator
   * observation only. Leave at default until multi-beat pilot gates pass.
   */
  maxBeats?: number;
};

export type CollaborationTaskConfig = {
  /**
   * Plan flag `collab.task.handoffContract`. Default unset/false = off.
   * Do not enable until P1-B③ gates pass — flag-off owner_transfer stays unchanged.
   */
  handoffContract?: boolean;
  /**
   * Plan flag `collab.task.claimContract`. Default unset/false = off.
   * When true, group task board publish → claim → apply writes board facts and
   * seeds task-runtime responsibility. Oral “已派工” alone is never a board fact.
   * Leave off until P4b gates pass. Does not grant bots L3 task.assign.
   */
  claimContract?: boolean;
  /**
   * P1 gray-group allowlist for ClaimContract writes (default empty = off).
   * FINAL v3 P0: managed_enterprise gray entries MUST be `tenantId/groupId`
   * (or wildcard-tenant `/groupId`). Bare `groupId` never authorizes a non-empty tenantId
   * caller (cross-tenant collision hazard). Bare entries remain personal_local
   * only. Platform `claimContract` stays false by default; gray-enable = add
   * the scoped entry; rollback = remove it. Does not grant L3 task.assign.
   * Do not open production gray writes until P0 isolation gate passes.
   */
  claimContractGroupAllowlist?: string[];
  /**
   * C2 Wake Contract ledger flag (plan `collab.task.wakeContract`). Default off.
   * When true, structured @mention / handoff / claim|return / nudge / stitch_only
   * / escalate / insight events append under `<ns>/wake-events/`. Does not open
   * Floor live or invent a second orchestrator. Prefer wakeContractGroupAllowlist
   * for gray-group enable. Leave off until gates pass.
   */
  wakeContract?: boolean;
  /**
   * P3 gray-group allowlist for Wake Contract writes (default empty = off).
   * FINAL v3 P0: managed_enterprise gray entries MUST be `tenantId/groupId`
   * (or wildcard-tenant `/groupId`). Bare `groupId` never authorizes a non-empty tenantId
   * caller. Bare entries remain personal_local only. Sample managed:
   * `001/grp-daniel-hhd-gmail-com-upbeyond`. Platform `wakeContract` stays
   * false by default. Does not open Floor live. P0 isolation gate must pass
   * before production gray writes.
   */
  wakeContractGroupAllowlist?: string[];
  /**
   * R3 wake-op gateway recovery (plan `collab.task.wakeOpGatewayRecovery`). Default off.
   * When true, gateway methods `collaboration.task.wakeOp.releaseForRetry` /
   * `collaboration.task.wakeOp.confirmCompleted` may mint a trusted gateway
   * session from platform auth and run recovery release/confirm. Prefer
   * wakeOpGatewayRecoveryGroupAllowlist for gray canary. Fail-closed until
   * CF-008 + explicit gray GO. Does not enable TEST_ONLY mint or non-nudge
   * auto-retry.
   */
  wakeOpGatewayRecovery?: boolean;
  /**
   * Gray-group allowlist for wake-op gateway recovery (default empty = off).
   * FINAL v3 P0: managed_enterprise entries MUST be `tenantId/groupId`
   * (or wildcard-tenant `/groupId` with tenant=`*`). Bare `groupId` never authorizes a non-empty tenantId
   * caller. Bare entries remain personal_local only. Platform flag stays
   * false by default; gray-enable = add the scoped entry; rollback = remove it.
   */
  wakeOpGatewayRecoveryGroupAllowlist?: string[];
  /**
   * Mode B post-claim intended fan-out wake (plan `collab.task.postClaimFanoutWake`).
   * Default unset/false = off. When true (or group on allowlist), claimBoardItem
   * also wakes `intendedClaimantIds \ {claimantId}` via Wake Contract so
   * non-lead intended members are pulled into collab — not just the claimant.
   * Prefer postClaimFanoutWakeGroupAllowlist for gray-group enable. Does not
   * open Floor live / LIVE / auto-submit. Leave off until gates pass.
   */
  postClaimFanoutWake?: boolean;
  /**
   * Gray-group allowlist for post-claim intended fan-out wake (default empty = off).
   * FINAL v3 P0: managed_enterprise entries MUST be `tenantId/groupId`
   * (or wildcard-tenant `/groupId` with tenant=`*`). Bare `groupId` never authorizes a non-empty
   * tenantId caller. Bare entries remain personal_local only. Platform
   * `postClaimFanoutWake` stays false by default; gray-enable = add the scoped
   * entry; rollback = remove it. Still requires Wake Contract for the group
   * for the wake ledger write. No digital-team hardcodes / LIVE / Floor.
   */
  postClaimFanoutWakeGroupAllowlist?: string[];
  /**
   * Mode B board-tied kickoff multi-participant (plan `collab.task.boardKickoffMultiParticipant`).
   * Default unset/false = off. When true (or group on allowlist), a single named
   * @mention on a chat round with active board intendedClaimantIds expands to
   * explicit_multi over (mention lead ∪ intended) ∩ group bots — so kickoff via
   * @主答 / @高级秘书 does not lock Mode B collab to mentionOverridesPrimary solo.
   * Prefer boardKickoffMultiParticipantGroupAllowlist for gray-group enable.
   * Does not open Floor live / LIVE / auto-submit. Leave off until gates pass.
   */
  boardKickoffMultiParticipant?: boolean;
  /**
   * Gray-group allowlist for board-kickoff multi-participant (default empty = off).
   * FINAL v3 P0: managed_enterprise entries MUST be `tenantId/groupId`
   * (or wildcard-tenant `/groupId` with tenant=`*`). Bare `groupId` never authorizes a non-empty
   * tenantId caller. Bare entries remain personal_local only. Platform
   * `boardKickoffMultiParticipant` stays false by default; gray-enable = add the scoped
   * entry; rollback = remove it. No digital-team hardcodes / LIVE / Floor.
   */
  boardKickoffMultiParticipantGroupAllowlist?: string[];
  /**
   * C2/C3 gate (plan `collab.task.assistantMentionDispatch`). Default off.
   * AS-IS: assistant inline `@` does **not** open a new collaboration round.
   * When true, the C3 consumer resolves @ to group bots, records wake outcome
   * `dispatched`, and attaches same-round `peer_ask` CollabEdges — still not
   * Floor live / not a default new-round storm (eligibility only). Leave off.
   */
  assistantMentionDispatch?: boolean;
  /**
   * P3 group task heartbeat knobs (cron-shaped). Defaults from FINAL §1.5:
   * scan every 30min; escalate after 2 consecutive no-response nudges.
   * Heartbeat runs only when Wake Contract is enabled for the group
   * (global or allowlist). Does not fake transcript completion.
   */
  groupTaskHeartbeat?: {
    /** Scan interval in ms (default 1_800_000 = 30min). Configurable, not a platform hard constant. */
    scanIntervalMs?: number;
    /** Consecutive no-response nudges before escalate (default 2). Configurable. */
    escalateAfterConsecutiveNoResponse?: number;
    /**
     * S4: background scheduler wiring. Default false — gateway does not arm the
     * timer until tip explicitly enables. Does not flip wake/claim/LIVE/Floor.
     */
    schedulerEnabled?: boolean;
    /**
     * S4 write mode. Default `observe`: plan + persist decisions/scan log; never
     * write wake nudge/escalate. `emit` alone is still insufficient — real wake
     * writes also require Wake Contract for the group AND (mode emit or
     * emitGroupAllowlist match). Tip: keep observe until gray emit allowlist.
     */
    mode?: "observe" | "emit";
    /**
     * S4 gray groups allowed to receive real nudge/escalate when Wake Contract
     * is on for the group. Prefer scoped `tenantId/groupId`. Default empty.
     * Bare groupId is personal_local-only (P0). Does not open production gray
     * writes by itself.
     */
    emitGroupAllowlist?: string[];
  };
  /**
   * FINAL v3 S5 — limited self_advance write mode + gray execute allowlist.
   * Platform L1 `botMaySelfAdvanceWithoutHuman` stays false. Default
   * `mode=dry_run`: per-tick reauth + decision ledger only; never wake/exec.
   * Real execute requires mode=execute AND executeGroupAllowlist match AND
   * group L2 botMaySelfAdvanceWithoutHuman=true. Does not auto-complete,
   * submit, or accept; outbound/final remain human_required. No LIVE/Floor.
   */
  selfAdvance?: {
    /**
     * Default `dry_run`. `execute` alone is insufficient — group must also
     * match executeGroupAllowlist (prefer tenantId/groupId).
     */
    mode?: "dry_run" | "execute";
    /**
     * Gray groups allowed to perform real self_advance side effects (wake).
     * Prefer scoped `tenantId/groupId` (P0). Bare groupId is personal_local-only.
     * Default empty. Does not open production gray writes by listing alone.
     */
    executeGroupAllowlist?: string[];
  };
  /**
   * Batch 5 single-target unattended lane. Default empty = off.
   * Exactly one allowlist entry arms the mission fence for that group.
   * Zero or many entries authorize nobody (not a global any-group switch).
   * Does not open wake, claim, heartbeat scheduler, selfAdvance execute, or
   * L2 botMaySelfAdvanceWithoutHuman, and does not grant accept/finalize.
   */
  singleGroupUnattended?: {
    /**
     * Prefer one scoped `tenantId/groupId`. Bare groupId is personal_local-only.
     * Listing the group does not by itself emit wakes.
     */
    groupAllowlist?: string[];
  };
  /**
   * Platform Mode B — continue / re-wake after ROUND_COMPLETE (inventory-first).
   * Default OFF. Prefer groupAllowlist (tenantId/groupId) over enabled=true.
   * When authorized: after ROUND_COMPLETE, scan board; if published|claimed|
   * applied|in_progress|returned remain, claim-first for published then wake
   * Mode B lead + trySelfAdvance tick. No Floor live / auto-publish.
   * Does not flip claim/wake/challenge/LIVE defaults. Group-agnostic.
   */
  continueAfterRoundComplete?: {
    /** Discouraged global on-switch; prefer groupAllowlist. Default false. */
    enabled?: boolean;
    /**
     * Gray groups allowed to continue after ROUND_COMPLETE.
     * Prefer scoped tenantId/groupId (P0). Bare groupId is personal_local-only.
     * Default empty = off.
     */
    groupAllowlist?: string[];
  };
  /**
   * P4 acceptance-loop cap: max returnBoardItemSubmission cycles before
   * escalating to coordinator/human (default 3). Does not flip LIVE or
   * enable self_advance; only bounds submit→return churn.
   */
  acceptanceLoopMaxReturns?: number;
  /**
   * P5 deploy quality gate (plan `collab.task.challengeWindow`). Default off.
   * When true, publishBoardItem requires a resolved|skipped single-challenger
   * (蓝) red/blue short window under `<ns>/challenge-windows/`, or explicit
   * `skipChallengeWindow: true` (per-item 可关). Challenger critiques
   * acceptance_gap / scope_drift / role_mismatch; lead (红) absorb|reject with
   * reason — auditable, not full-group debate. Does not open Floor live,
   * invent a second orchestrator, or flip claim/wake allowlists. Prefer
   * challengeWindowGroupAllowlist for gray-group enable. Leave off until
   * P5 gates pass / separate LIVE auth.
   */
  challengeWindow?: boolean;
  /**
   * P5/S1 gray-group allowlist for Challenge Window writes (default empty = off).
   * FINAL v3 P0: managed_enterprise gray entries MUST be `tenantId/groupId`
   * (or wildcard-tenant `/groupId` with tenant=`*`). Bare `groupId` never
   * authorizes a non-empty tenantId caller (cross-tenant collision hazard).
   * Bare entries remain personal_local only. Sample managed:
   * `001/grp-daniel-hhd-gmail-com-upbeyond`. Platform `challengeWindow` stays
   * false by default; gray-enable = add the scoped entry; rollback = remove it.
   * Prefer this over flipping global `challengeWindow=true`. Does not open
   * Floor live / LIVE / claim|wake.
   */
  challengeWindowGroupAllowlist?: string[];
  /**
   * C3 peer-review gate (plan `collab.task.requirePeerReview`). Default off.
   * When true, acceptBoardItemSubmission refuses unless ≥1 non-author peer
   * review exists on the current submitted_for_review submission. Peer review
   * events are observe-only for RCIS (`drivesAdmission` stays false). Leave off
   * until C3 gates pass. Does not open Floor live or invent ui.* RPC.
   */
  requirePeerReview?: boolean;
  /**
   * C4 OGUI→handoff projection flag (plan `collab.task.oguiHandoffProjection`).
   * Default off. When true, a legal submitted `ogui-answer` fence on group
   * chat.send is stored under `<ns>/ogui-projections` and appended into
   * proposeHandoff assumptions. Does **not** expand ChatSendParamsSchema or
   * add `ui.*` RPC. Tip may enable for smoke; LIVE stays off.
   */
  oguiHandoffProjection?: boolean;
  /**
   * Batch 11 OGUI decision lifecycle (default off).
   * When unset or false, legacy ogui-form / ogui-answer submit is unchanged
   * and no issue, WAIT, or admission path runs. Setting true is an explicit
   * opt-in for a later slice; S0 does not persist decisions, S1 issue alone
   * is not a gray open, and this flag does not mint PRODUCTION_GO or open LIVE.
   * Env `OPENBOT_OGUI_DECISION_LIFECYCLE=0` forces off. `=1` opts in for tests.
   */
  oguiDecisionLifecycle?: boolean;
  /**
   * tenantId or agentId allowlist for the OGUI decision lifecycle.
   * Default empty. Empty does not enable the feature. A non-empty list is
   * consulted only when `oguiDecisionLifecycle` is on; the authenticated
   * subject must match an entry exactly. Listing a subject does not issue
   * a card or grant PRODUCTION_GO.
   */
  oguiDecisionLifecycleAllowlist?: string[];
};

export type CollaborationLearningConfig = {
  /**
   * Plan flag `collab.learning.rcisAggregate`. Default unset/false = off.
   * When true, async Learning may aggregate named 责任·贡献·创新·共享 (RCIS)
   * scores from collaboration ledger facts (claim/handoff/deliverable/challenge/idle)
   * into runtime/rcis-aggregate.json. Reuses contribution-quality + ledger reader.
   * Must never feed Admission / decideParticipants / Floor Bid (C7 / R5).
   * Does not rename GrowthDimension into a selection-driving set. Leave off until
   * P4c gates pass.
   */
  rcisAggregate?: boolean;
  /**
   * Collaboration-context P3: private long-term memory promote-only path.
   * Default unset/false = off. When true, `promotePrivateMemoryCapsuleToGroup`
   * may copy an approved personal-scope capsule into group learning assets
   * (DefaultLearningPromotionService) with confidentiality + promotion audit.
   * Private LTM stays in `agent:<botId>`; dirty writes / DM-history mirrors into
   * GROUP_PUBLIC remain refused regardless of this flag. No Floor live.
   */
  privateMemoryPromote?: boolean;
};

export type CollaborationHotfixConfig = {
  /**
   * Floor Runtime v2.1 P0.2 ops allow-list (default empty = off).
   * Entries are `tenantId/groupId`. Only listed groups get the 15:13 v1-only
   * roll-call hotfix; remove an entry to roll back that group. Not an admin UI switch.
   */
  v1RollCallGroups?: string[];
};
