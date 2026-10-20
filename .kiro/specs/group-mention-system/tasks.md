# Implementation Plan: Group Mention System

## Overview

This plan implements the Organization Communication Protocol for collaboration groups, delivering an "@" mention system across UI, runtime, and organization routing layers. Tasks are ordered in **four phases** for incremental delivery:

- **Phase 1 (MUST):** Mention UI (trigger, popup MVP, chip), Mention Metadata (mention_id, serialization), Mention Runtime (validator, delivery), Mention Event Bus, Mention Rendering
- **Phase 2:** Coordinator Observation (async, non-blocking), Mention Acknowledgement, Mention State Tracking, Mention Inbox (mention.acknowledge RPC)
- **Phase 3:** Intent Suggestion (with confidence, no auto-execution), Task Conversion (confirmation-required), Escalation
- **Phase 4 (DEFERRED):** Advanced Authority (complex RBAC), Collaboration Graph Ranking, Organization Intelligence, SQLite migration

## Tasks

### Phase 1: Core Mention System (MUST)

- [x] 1. Define core data models and types
  - [x] 1.1 Create `src/organization/mention-types.ts` with all mention type definitions
    - Define `MentionMetadata` type (`mention_id`, `agentId`, `displayName`, `offset`, `length`)
    - Define `MentionIntent` union type
    - Define `IntentSuggestion` type (`intent`, `confidence: number`, `reasoning?`)
    - Define `MentionContext` type (`isMentioned`, `mentionType`, `mentionSourceAgentId`, `coordinatorVisible`, `requiresAck`, `priority`, `mentionIds`)
    - Define `MentionState` type (lifecycle fields, timestamps)
    - Define `MentionEvent` and `MentionEventType` types for event bus
    - Define `MentionCandidate` type for UI layer (MVP: `agentId`, `displayName`, `roleName?`, `online`, `isCoordinator`, `isBot`)
    - Define `MentionChipData` type
    - Define `MentionTriggerState` type
    - Define `ValidationResult` type
    - Define `DeliveryResult` type
    - Define `MatchResult` type for FuzzyMatcher
    - Define `InterventionDecision` type for coordinator observation
    - _Requirements: 6.1, 6.2, 7.1, 15.1, 16.1_

  - [x]\* 1.2 Write unit tests for type guards and validation helpers
    - Test `isMentionState`, `isMentionMetadata` type guards
    - Test `MentionIntent` enum validation
    - Test `IntentSuggestion` confidence range validation
    - _Requirements: 6.1, 16.1_

- [x] 2. Implement Mention Event Bus
  - [x] 2.1 Create `src/organization/mention-events.ts` with event bus implementation
    - Implement `MentionEventBus` with `emit()` and `subscribe()` methods
    - Support event types: `mention.created`, `mention.acknowledged`, `mention.responded`, `mention.resolved`, `mention.escalated`
    - Support filtering by `type`, `target_agent_id`, `organization_id`
    - Return unsubscribe function from `subscribe()`
    - _Requirements: 15.5_

  - [x]\* 2.2 Write unit tests for MentionEventBus
    - Test emit/subscribe lifecycle
    - Test filter matching
    - Test unsubscribe cleanup
    - Test multiple subscribers receive same event
    - _Requirements: 15.5_

- [x] 3. Implement MentionAuthority (MVP-simplified)
  - [x] 3.1 Create `src/organization/mention-authority.ts` with permission enforcement
    - Implement `canMention()` deriving permissions from `RuntimeOrganizationContext`
    - MVP rules: `@all` → everyone (default), `@coordinator` → everyone, `@system` → admin only
    - Check `permissions` array from `RuntimeIdentity` for admin check
    - No separate policy file — derive from existing context
    - _Requirements: 17.1, 17.4_

  - [x]\* 3.2 Write property test for mention authority enforcement
    - **Property 14: Mention authority enforcement (MVP)**
    - **Validates: Requirements 17.1, 17.2**

- [x] 4. Implement MentionValidator
  - [x] 4.1 Create `src/organization/mention-validator.ts`
    - Implement `validateMentions()` checking schema validity of `mentions` array
    - Validate `mention_id` uniqueness across entries
    - Validate `offset`/`length` bounds against message text
    - Resolve each `agentId` against `RuntimeOrganizationContext.members`
    - Return `ValidationResult` with `valid` and `invalid` arrays (with reasons)
    - Handle `"__all__"` agentId as valid without member lookup
    - _Requirements: 6.2, 6.3, 7.6, 13.1, 13.2, 13.3_

  - [x]\* 4.2 Write unit tests for MentionValidator
    - Test valid mention array passes
    - Test duplicate `mention_id` rejection
    - Test out-of-bounds offset rejection
    - Test unknown `agentId` handling (skip, don't error)
    - _Requirements: 13.1, 13.2, 13.3_

- [x] 5. Implement MentionDelivery module
  - [x] 5.1 Create `src/organization/mention-delivery.ts`
    - Implement `deliver()`: validateMentions → deliver message immediately → emit mention.created events → state tracking begins
    - Construct `MentionContext` for each valid target agent
    - Set `mentionType: "direct"` for specific agents, `"broadcast"` for `__all__`
    - Set `coordinatorVisible: true` when coordinator exists
    - Deliver via `InterAgentBus` (non-blocking)
    - Emit `mention.created` event via `MentionEventBus` for each mention
    - Skip delivery for unknown/removed agents without error
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 14.1_

  - [x]\* 5.2 Write property test for MentionContext construction correctness
    - **Property 7: MentionContext construction correctness**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6**

  - [x]\* 5.3 Write property test for coordinator observation is non-blocking
    - **Property 15: Coordinator observation is non-blocking**
    - **Validates: Requirements 14.1, 14.2**

- [x] 6. Checkpoint - Ensure Phase 1 runtime tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Extend chat.send handler to accept mentions
  - [x] 7.1 Extend `chat.send` handler to accept `mentions` field
    - Add optional `mentions?: MentionMetadata[]` to `ChatSendParams` type
    - After message sanitization, call `MentionDelivery.deliver()`
    - Return `INVALID_REQUEST` error for invalid mentions schema
    - Message delivery is NEVER blocked by mention processing
    - _Requirements: 6.1, 13.1_

- [x] 8. Implement UI layer — MentionTriggerDetector
  - [x] 8.1 Create `ui/src/ui/components/mention/mention-trigger-detector.ts`
    - Implement `onInputChange()` detecting "@" and computing trigger state
    - Implement `isValidTriggerPosition()` checking not inside code block or inline code
    - Implement `dismiss()` for Escape, click-outside, backspace-over-"@"
    - Support trigger at start of message, after whitespace, and mid-sentence
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x]\* 8.2 Write property test for trigger position validity
    - **Property 1: Trigger position validity**
    - **Validates: Requirements 1.2, 1.3**

- [x] 9. Implement UI layer — FuzzyMatcher
  - [x] 9.1 Create `ui/src/ui/components/mention/fuzzy-matcher.ts`
    - Implement `match()` filtering and ranking candidates against query
    - Implement `isSubsequenceMatch()` with case-insensitive Latin and pinyin-aware Chinese matching
    - Ranking: prefix match (100) > substring match (80) > subsequence match (60)
    - MVP tie-breaking: online status > alphabetical (no collaboration frequency or project participation)
    - Match against `displayName`, `roleName`, `agentId`
    - _Requirements: 2.1, 2.2, 2.5_

  - [x]\* 9.2 Write property test for fuzzy matcher results satisfy match criteria
    - **Property 2: Fuzzy matcher results satisfy match criteria**
    - **Validates: Requirements 2.1, 2.5**

  - [x]\* 9.3 Write property test for fuzzy matcher result ordering
    - **Property 3: Fuzzy matcher result ordering**
    - **Validates: Requirements 2.2**

- [x] 10. Implement UI layer — MentionPopup component (MVP)
  - [x] 10.1 Create `ui/src/ui/components/mention/mention-popup.ts`
    - Render candidate list with `role="listbox"` and `role="option"` items
    - Show `displayName`, `roleName`, online/offline indicator
    - Display coordinator badge (🧠) and bot badge
    - Exclude self from candidate list
    - Include "所有人" (All Members) entry at top when query is empty or matches "all"/"所有人"
    - Constrain height to 8 items with scrollable overflow
    - Position above/below caret based on viewport space
    - Support ArrowUp/ArrowDown navigation with wrapping
    - Support Enter/Tab/click selection
    - Highlight first candidate by default
    - Use `aria-expanded`, `aria-activedescendant`, `aria-selected` for accessibility
    - Debounce query updates within 50ms
    - _Requirements: 1.1, 2.3, 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 9.1, 10.1, 10.2, 10.3, 10.5, 12.1, 12.2, 12.3, 12.4_

  - [x] 10.2 Write property test for self-exclusion from candidate list
    - **Property 4: Self-exclusion from candidate list**
    - **Validates: Requirements 3.5**

  - [x]\* 10.3 Write property test for popup positioning within viewport
    - **Property 13: Popup positioning within viewport**
    - **Validates: Requirements 12.1, 12.3**

- [x] 11. Implement UI layer — MentionChip component
  - [x] 11.1 Create `ui/src/ui/components/mention/mention-chip.ts`
    - Render non-editable inline element with distinct background color
    - Display "@displayName" with visually distinct style for @all
    - Support single-unit deletion via Backspace/Delete
    - Provide plain-text "@displayName" for clipboard copy
    - Show tooltip on hover with `roleName` and online status
    - Use `role="button"` with `aria-label="Remove mention: {displayName}"`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 9.2, 10.4_

  - [x]\* 11.2 Write property test for mention chip text replacement correctness
    - **Property 5 (partial): Chip produces correct plain-text**
    - **Validates: Requirements 5.1, 5.4**

- [x] 12. Implement UI layer — Mention metadata serialization
  - [x] 12.1 Create `ui/src/ui/components/mention/mention-serializer.ts`
    - Implement `serializeMentions()` converting chips to `MentionMetadata[]` array
    - Generate UUID `mention_id` for each chip
    - Calculate `offset` and `length` from plain-text message representation
    - Implement `toInternalAnchors()` converting to `<mention id="...">@displayName</mention>` format
    - Implement `parseInternalAnchors()` parsing anchor format back to metadata
    - Support multiple mentions with independent offsets
    - Support same member mentioned multiple times with distinct `mention_id` and `offset`
    - Handle empty message with only mention chips
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.1, 8.2, 8.3, 8.4_

  - [x]\* 12.2 Write property test for mention metadata offset and uniqueness
    - **Property 5: Mention metadata offset and uniqueness**
    - **Validates: Requirements 6.2, 6.3, 8.3**

  - [x]\* 12.3 Write property test for mention anchor serialization round-trip
    - **Property 6: Mention serialization round-trip**
    - **Validates: Requirements 6.4, 6.6**

  - [x]\* 12.4 Write property test for multiple mentions independence
    - **Property 8: Multiple mentions independence**
    - **Validates: Requirements 8.2**

- [x] 13. Implement UI layer — Mention display in received messages
  - [x] 13.1 Create `ui/src/ui/components/mention/mention-renderer.ts`
    - Highlight mentioned name spans using `mention_id` anchors, falling back to `offset`/`length`
    - Use consistent styling with MentionChip appearance
    - Apply "self-mentioned" indicator when current user's `agentId` is in mentions
    - Display muted style for mentions referencing removed members
    - Subscribe to MentionEventBus for state indicators: ⏳ (awaiting), ✅ (acknowledged), 📌 (task accepted)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 14. Implement MentionAuthority UI enforcement
  - [x] 14.1 Wire MentionAuthority policy check in Message_Input send flow
    - Before sending, validate all mentions against `canMention()` policy
    - Display inline error when mention violates policy
    - Prevent send when blocked mentions exist
    - _Requirements: 17.2, 17.5_

- [x] 15. Checkpoint - Ensure Phase 1 complete
  - Ensure all Phase 1 tests pass, ask the user if questions arise.

### Phase 2: State Tracking & Acknowledgement

- [x] 16. Implement append-only journal storage
  - [x] 16.1 Create `src/organization/mention-state-journal.ts` with append-only persistence
    - Implement `appendMentionEvent()` appending single JSON line to `.jsonl` file
    - Implement `replayJournal()` reading `.jsonl` and reconstructing current state per `mention_id`
    - Implement `queryMentionStates()` with filters: `source_agent_id`, `target_agent_id`, `acknowledged`, `limit`
    - Use dual-path pattern (workspace + managed) following `task-assignment.ts`
    - File path: `mentions.jsonl` in organization memory directory
    - _Requirements: 15.1, 15.4_

  - [x]\* 16.2 Write property test for append-only journal integrity
    - **Property 16: Append-only journal integrity**
    - **Validates: Requirements 15.1**

  - [x]\* 16.3 Write property test for MentionState query correctness
    - **Property 10: MentionState query correctness**
    - **Validates: Requirements 15.4**

- [x] 17. Implement StateTracker with monotonic transitions
  - [x] 17.1 Create `src/organization/mention-state-tracker.ts`
    - Implement `createMentionState()` creating initial record on delivery (appends to journal)
    - Implement `transitionMentionState()` for acknowledge/respond/resolve transitions
    - Enforce monotonic state transitions (once `true`, never reverts to `false`)
    - Set `acknowledged_at`, `responded_at`, `resolved_at` timestamps on transitions
    - Emit state change events via `MentionEventBus` on transitions
    - _Requirements: 15.1, 15.2, 15.3, 15.5_

  - [x]\* 17.2 Write property test for MentionState lifecycle transitions
    - **Property 9: MentionState lifecycle transitions are monotonic**
    - **Validates: Requirements 15.1, 15.2, 15.3**

- [x] 18. Implement Coordinator Observation (async, non-blocking)
  - [x] 18.1 Create `src/organization/mention-coordinator-observer.ts`
    - Implement `CoordinatorObserver` subscribing to `mention.created` events
    - Forward mirrored events to coordinator agent asynchronously
    - Implement `evaluateIntervention()` for coordinator decisions (redirect/escalate/reassign)
    - Coordinator observation NEVER blocks message delivery
    - When no coordinator exists, no observation occurs
    - _Requirements: 14.1, 14.2_

  - [x]\* 18.2 Write unit tests for CoordinatorObserver
    - Test coordinator receives mirrored event after delivery
    - Test delivery proceeds without coordinator
    - Test intervention decisions are applied asynchronously
    - _Requirements: 14.1, 14.2_

- [x] 19. Implement mention.acknowledge RPC
  - [x] 19.1 Create `mention.acknowledge` RPC method
    - Accept `MentionAcknowledgeParams` (mention_id, organizationId)
    - Transition mention state to `acknowledged: true` via StateTracker
    - Emit `mention.acknowledged` event via MentionEventBus
    - Return updated `MentionState`
    - _Requirements: 15.2, 15.5_

  - [x]\* 19.2 Write unit tests for mention.acknowledge RPC
    - Test acknowledge transitions state correctly
    - Test acknowledge on already-acknowledged mention is idempotent
    - Test event is emitted on transition
    - _Requirements: 15.2_

- [x] 20. Implement escalation timeout detection
  - [x] 20.1 Add escalation check to StateTracker
    - Implement `checkEscalation()` returning unacknowledged mentions past timeout (default: 5 min)
    - Emit `mention.escalated` event for unacknowledged mentions
    - Notify coordinator via CoordinatorObserver
    - _Requirements: 15.6_

  - [x]\* 20.2 Write property test for escalation timeout detection
    - **Property 11: Escalation timeout detection**
    - **Validates: Requirements 15.6**

- [x] 21. Checkpoint - Ensure Phase 2 complete
  - Ensure all Phase 2 tests pass, ask the user if questions arise.

### Phase 3: Intent Suggestion & Task Conversion

- [x] 22. Implement IntentClassifier (suggestion-only)
  - [x] 22.1 Create `src/organization/mention-intent-classifier.ts`
    - Implement `classify()` returning `IntentSuggestion` with `{ intent, confidence }`
    - Low confidence (< 0.6) → default to `"attention"`, never suggest action
    - High confidence (≥ 0.6) → suggest intent, still requires confirmation
    - NEVER auto-create TaskAssignment from mention
    - Classify based on message text patterns (task keywords, handoff patterns, approval patterns)
    - _Requirements: 16.1, 16.5_

  - [x]\* 22.2 Write property test for intent classification
    - **Property 12: Intent classifier returns valid suggestion with confidence**
    - **Validates: Requirements 16.1, 16.5**

- [x] 23. Implement TaskConverter (confirmation-required)
  - [x] 23.1 Create `src/organization/mention-task-converter.ts`
    - Implement `convert()` creating TaskAssignment ONLY after confirmation
    - Require `confirmedBy: "coordinator" | "user"` parameter
    - Link TaskAssignment to `mention_id` via `linked_task_id`
    - Pipeline: Mention → Intent Suggestion → Confirmation → Task Creation
    - _Requirements: 16.2_

  - [x]\* 23.2 Write unit tests for TaskConverter
    - Test task creation requires confirmation parameter
    - Test task is linked to mention_id
    - Test rejection when no confirmation provided
    - _Requirements: 16.2_

- [x] 24. Wire intent suggestion into delivery pipeline
  - [x] 24.1 Integrate IntentClassifier into MentionDelivery
    - After delivery, classify intent as suggestion
    - Pass suggestion to CoordinatorObserver for potential intervention
    - When coordinator confirms task intent, call TaskConverter
    - When intent is `"approval_request"` or `"review_request"` with high confidence AND confirmation, set `requiresAck: true`
    - _Requirements: 16.3, 16.4, 16.6_

- [x] 25. Checkpoint - Ensure Phase 3 complete
  - Ensure all Phase 3 tests pass, ask the user if questions arise.

### Phase 4: Deferred (Future)

- [x] 26. Advanced Authority (complex RBAC policy file)
  - [x] 26.1 Implement configurable mention-policy.json
    - Support custom `MentionAuthorityPolicy` rules
    - Evaluate custom policies before defaults
    - _Requirements: 17.3_

- [x] 27. Collaboration Graph Ranking
  - [x] 27.1 Add collaboration frequency and project participation to FuzzyMatcher tie-breaking
    - Tie-breaking: collaboration frequency > project participation > online status > alphabetical
    - _Requirements: 2.2 (full)_

- [x] 28. Organization Intelligence
  - [x] 28.1 Add capability tags to MentionPopup
    - Display capability tags in popup
    - Add current task display
    - Match against capability tags in FuzzyMatcher
    - _Requirements: 3.2, 3.4_

- [x] 29. SQLite migration
  - [x] 29.1 Migrate append-only journal to SQLite
    - Replace `.jsonl` with SQLite database
    - Implement migration from journal to SQLite
    - Add periodic compaction for journal (pre-migration)

- [x] 30. Final checkpoint
  - Ensure all tests pass across all phases.

## Notes

- Tasks marked with `*` are optional property-based tests that can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation per phase
- **Phase 1** delivers a working mention system with immediate delivery, event bus, and simplified UI
- **Phase 2** adds state tracking, acknowledgement, and async coordinator observation
- **Phase 3** adds intent suggestion (never auto-execution) and confirmation-required task conversion
- **Phase 4** is deferred and adds advanced features (RBAC, ranking, SQLite)
- Property tests validate universal correctness properties from the design document (Properties 1–16)
- The implementation uses TypeScript with Vitest + fast-check for property-based testing
- Storage uses append-only `.jsonl` journal pattern (not full JSON rewrite)
- Coordinator observes asynchronously — never blocks message delivery
- Intent classification is suggestion-only — task creation always requires confirmation
- MentionAuthority for MVP derives from existing `RuntimeOrganizationContext.permissions`
- Real-time mention state delivered via event bus, NOT injected into system prompts
