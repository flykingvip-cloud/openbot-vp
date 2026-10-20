# Requirements Document

## Introduction

This feature implements an **Organization Communication Protocol** (组织通信协议) for collaboration groups (协作小组). The system provides a structured mention mechanism that goes beyond simple UI "@" addressing — it defines how agents and humans direct attention, assign work, request approvals, and hand off responsibilities within an organization runtime.

The protocol operates across three layers:

1. **Mention UI** — The user-facing "@" trigger, smart popup, chip rendering, and accessibility.
2. **Mention Runtime** — Structured metadata with stable `mention_id` anchors, intent classification, and state tracking.
3. **Organization Routing** — Coordinator-first delivery, permission enforcement, and task/notification pipeline.

Architecture flow:

```
Mention UI (trigger → popup → chip)
  ↓
Mention Metadata (mention_id, offset, intent)
  ↓
Mention Runtime (intent classification, state tracking)
  ↓
Organization Routing (coordinator-first, permission check)
  ↓
Task / Attention / Notification delivery
```

The feature integrates with the existing `RuntimeOrganizationContext` (which provides `members: RuntimeAgentRef[]`, presence state, coordinator info, and active tasks) and the `chat.send` gateway RPC. Mention metadata is embedded in the message payload with stable `mention_id` anchors. Mention state is tracked in the organization memory layer alongside task assignments.

## Glossary

- **Mention_Popup**: The dropdown/overlay UI component that appears when the user types "@" in the message input, displaying a filtered list of mentionable candidates with organizational context (coordinator badge, busy status, capability tags).
- **Mention_Trigger**: The "@" character typed by the user in the message input that activates the Mention_Popup.
- **Mention_Query**: The text typed by the user after the "@" character, used to filter and rank candidates in the Mention_Popup.
- **Mention_Candidate**: A group member (human or bot) eligible to be mentioned, derived from `RuntimeOrganizationContext.members`.
- **Mention_Chip**: The inline visual representation of a completed mention in the message input — a highlighted, non-editable token showing the member's display name.
- **Mention_Metadata**: The structured data embedded in the message payload that identifies which members were mentioned, including `mention_id`, `agentId`, `displayName`, character offsets, and optional `intent`.
- **Mention_All**: A special mention target representing all members of the collaboration group ("@所有人" / "@all"), encoded with `agentId: "__all__"`.
- **MentionIntent**: A classification of the purpose behind a mention — one of `"attention"`, `"task_assignment"`, `"approval_request"`, `"review_request"`, `"notification"`, or `"handoff"`. Used to prevent conflicts between mention, task assignment, and coordinator dispatch systems.
- **MentionContext**: The enriched context object delivered to a mentioned agent's processing pipeline, containing `isMentioned`, `mentionType`, `mentionSourceAgentId`, `coordinatorVisible`, `requiresAck`, and `priority` fields.
- **MentionState**: The lifecycle tracking record for each mention instance, containing `mention_id`, `source_message_id`, `target_agent_id`, `acknowledged`, `responded`, and `resolved` fields.
- **Mention_Authority**: The permission/policy layer that governs who may use specific mention targets (e.g., `@all` configurable, `@coordinator` open to all, `@system` admin-only).
- **Mention_Runtime**: The server-side subsystem responsible for intent classification, state tracking, coordinator routing, and mention-to-task conversion.
- **Message_Input**: The text input/textarea component where the user composes messages in the collaboration chat view.
- **Organization_Members**: The `RuntimeAgentRef[]` array from `RuntimeOrganizationContext.members`, representing all active members (humans and bots) in the current collaboration group.
- **Fuzzy_Matcher**: The matching algorithm that ranks Mention_Candidates against the Mention_Query using displayName, roleName, agentId, and capability tags.
- **Coordinator_Runtime**: The coordinator agent's runtime context, which has authority over task routing, mention interception, and broadcast decisions within the organization.
- **Mention_Action_Pipeline**: The processing sequence: mention → intent parse → organization routing → task creation → acknowledgement.

## Requirements

### Requirement 1: Mention trigger activates popup on "@" input

**User Story:** As a group member, I want the mention popup to appear when I type "@" in the message input, so that I can quickly find and select someone to address.

#### Acceptance Criteria

1. WHEN the user types "@" in the Message_Input, THE Mention_Popup SHALL appear within 100 ms showing the full list of Mention_Candidates.
2. WHEN the user types "@" at the beginning of the message, in the middle of a sentence, or after a whitespace character, THE Mention_Popup SHALL activate in all three positions.
3. WHEN the user types "@" inside a code block or inline code span, THE Mention_Popup SHALL NOT activate.
4. WHEN the Mention_Popup is visible and the user presses Escape or clicks outside the popup, THE Mention_Popup SHALL close without inserting a mention.
5. WHEN the Mention_Popup is visible and the user deletes the "@" character via Backspace, THE Mention_Popup SHALL close.

### Requirement 2: Smart matching filters and ranks candidates

**User Story:** As a group member, I want the candidate list to narrow down as I type after "@", so that I can find the right person quickly even in large groups.

#### Acceptance Criteria

1. WHEN the user types characters after "@", THE Fuzzy_Matcher SHALL filter Mention_Candidates whose `displayName`, `roleName`, `agentId`, or capability tags contain a subsequence match against the Mention_Query.
2. WHEN multiple candidates match the Mention_Query, THE Fuzzy_Matcher SHALL rank results by: exact prefix match first, then substring match, then subsequence match, with ties broken by recent collaboration frequency, then current project participation, then online status (online members first), then alphabetical order.
3. WHEN the Mention_Query changes, THE Mention_Popup SHALL update the displayed candidates within 50 ms of the last keystroke (debounced).
4. WHEN no candidates match the Mention_Query, THE Mention_Popup SHALL display an empty-state message indicating no matches found.
5. THE Fuzzy_Matcher SHALL perform case-insensitive matching for Latin characters and pinyin-aware matching for Chinese display names.

### Requirement 3: Candidate list sources from organization members with organizational context

**User Story:** As a group member, I want to see all active group members with their organizational roles and status in the mention popup, so that I can make informed decisions about who to address.

#### Acceptance Criteria

1. WHEN the Mention_Popup is activated, THE Mention_Popup SHALL derive its candidate list from `RuntimeOrganizationContext.members` for the current collaboration group session.
2. EACH Mention_Candidate displayed in the Mention_Popup SHALL show the member's `displayName`, `roleName` (when available), an online/offline indicator, and capability tags derived from the member's registered skills.
3. THE Mention_Popup SHALL distinguish bot members from human members using a visual badge or icon, and SHALL display a coordinator badge (🧠) for the coordinator agent.
4. WHEN a member is currently processing a task, THE Mention_Popup SHALL display the member's busy status text (e.g., "正在处理任务") alongside the online indicator.
5. THE Mention_Popup SHALL exclude the current user (self) from the candidate list.
6. WHEN a member's presence state changes while the Mention_Popup is open, THE Mention_Popup SHALL reflect the updated online/offline status and busy state without requiring the user to re-trigger.

### Requirement 4: Selection via keyboard and pointer

**User Story:** As a group member, I want to select a mention target using either keyboard or mouse, so that I can use whichever input method is most convenient.

#### Acceptance Criteria

1. WHEN the Mention_Popup is visible and the user presses ArrowDown or ArrowUp, THE Mention_Popup SHALL move the highlight to the next or previous candidate respectively, wrapping at list boundaries.
2. WHEN the Mention_Popup is visible and the user presses Enter or Tab on a highlighted candidate, THE Mention_Popup SHALL insert the selected candidate as a Mention_Chip and close the popup.
3. WHEN the user clicks a candidate in the Mention_Popup, THE Mention_Popup SHALL insert that candidate as a Mention_Chip and close the popup.
4. WHEN the Mention_Popup first appears, THE Mention_Popup SHALL highlight the first candidate by default.
5. WHEN the user scrolls the candidate list using a scroll wheel or touch gesture, THE Mention_Popup SHALL scroll the list without closing.

### Requirement 5: Mention chip rendering in composed message

**User Story:** As a group member, I want completed mentions to appear as highlighted chips in my message, so that I can clearly see who I am addressing before sending.

#### Acceptance Criteria

1. WHEN a Mention_Candidate is selected, THE Message_Input SHALL replace the "@" plus Mention_Query text with a Mention_Chip displaying the candidate's `displayName` prefixed with "@".
2. THE Mention_Chip SHALL be rendered as a non-editable inline element with a distinct background color that differentiates it from surrounding text.
3. WHEN the user places the cursor immediately before or after a Mention_Chip and presses Backspace or Delete respectively, THE Message_Input SHALL remove the entire Mention_Chip as a single unit.
4. WHEN the user copies text containing a Mention_Chip, THE Message_Input SHALL include the plain-text fallback "@displayName" in the clipboard content.
5. THE Mention_Chip SHALL display a tooltip on hover showing the candidate's `roleName`, online status, and capability tags.

### Requirement 6: Mention metadata encoded with stable mention_id anchors

**User Story:** As a platform developer, I want mentions to be encoded as structured metadata with stable identifiers, so that the gateway and receiving agents can reliably identify who was mentioned regardless of text transformations.

#### Acceptance Criteria

1. WHEN a message containing one or more Mention_Chips is sent via `chat.send`, THE Message_Input SHALL include a `mentions` array in the request payload with each entry containing `{ mention_id, agentId, displayName, offset, length, intent? }`.
2. EACH mention entry SHALL include a unique `mention_id` (UUID) that serves as a stable anchor independent of character offsets.
3. THE Message_Input SHALL encode the message text with mentions replaced by their plain-text form "@displayName" and the `offset` and `length` fields SHALL reference the character positions in this plain-text representation.
4. THE stored message representation SHALL include internal anchors in the form `<mention id="mention_id">@displayName</mention>` so that mention identity is preserved across markdown rendering, rich text transformation, translation, and editing.
5. WHEN a message contains a Mention_All, THE Message_Input SHALL include a single entry in the `mentions` array with `{ mention_id, agentId: "__all__", displayName: "所有人", offset, length }`.
6. FOR ALL messages with mentions, serializing the `mentions` array to JSON and deserializing it back SHALL produce an array deep-equal to the original (round-trip property).
7. IF the message text is empty but contains only Mention_Chips, THEN THE Message_Input SHALL still send the message with the plain-text mention representations and the `mentions` metadata.

### Requirement 7: Mentioned agents receive enriched MentionContext

**User Story:** As an AI agent in the group, I want to receive rich context about how and why I was mentioned, so that I can prioritize and respond appropriately to directed messages.

#### Acceptance Criteria

1. WHEN the gateway processes a message with a `mentions` array, THE gateway SHALL construct a `MentionContext` object for each mentioned agent containing: `{ isMentioned: boolean, mentionType: "direct" | "broadcast", mentionSourceAgentId?: string, coordinatorVisible: boolean, requiresAck?: boolean, priority?: "low" | "normal" | "high" }`.
2. WHEN an agent's `agentId` appears in the `mentions` array, THE gateway SHALL deliver the `MentionContext` with `isMentioned: true` and `mentionType: "direct"` in the message context for that agent's processing pipeline.
3. WHEN a Mention_All is present in the `mentions` array, THE gateway SHALL deliver the `MentionContext` with `isMentioned: true` and `mentionType: "broadcast"` for all agents in the collaboration group.
4. THE gateway SHALL set `coordinatorVisible: true` on all MentionContext objects to confirm that the coordinator runtime has visibility of the mention.
5. WHEN a mention carries an intent of `"task_assignment"` or `"approval_request"`, THE gateway SHALL set `requiresAck: true` in the MentionContext.
6. IF a mentioned `agentId` does not correspond to any active member in the organization, THEN THE gateway SHALL deliver the message without the MentionContext for that `agentId` and SHALL NOT raise an error.

### Requirement 8: Multiple mentions in a single message

**User Story:** As a group member, I want to mention multiple people in one message, so that I can address a subset of the group in a single communication.

#### Acceptance Criteria

1. THE Message_Input SHALL support inserting multiple Mention_Chips in a single message with no upper limit on count.
2. WHEN multiple Mention_Chips are present, THE Message_Input SHALL maintain each chip's identity independently (via `mention_id`) so that deleting one chip does not affect others.
3. WHEN the same member is mentioned more than once in a message, THE `mentions` array SHALL contain one entry per occurrence with distinct `mention_id` and `offset` values.
4. WHEN the user triggers "@" while a Mention_Chip already exists in the message, THE Mention_Popup SHALL activate normally and allow selecting additional candidates.

### Requirement 9: "@all" mention support

**User Story:** As a group member, I want to mention everyone in the group with a single "@all" action, so that I can broadcast an important message to all members.

#### Acceptance Criteria

1. THE Mention_Popup SHALL include a "所有人" (All Members) entry at the top of the candidate list when the Mention_Query is empty or matches "all" or "所有人".
2. WHEN the user selects the "所有人" entry, THE Message_Input SHALL insert a Mention_Chip with displayName "所有人" and a visually distinct style indicating a broadcast mention.
3. WHEN a message contains a Mention_All chip, THE Mention_Metadata SHALL encode it with `agentId: "__all__"`.
4. WHERE the collaboration group has a coordinator, THE Mention_Popup SHALL NOT restrict Mention_All to coordinators only — any group member may use it unless the Mention_Authority policy restricts it.

### Requirement 10: Accessibility for keyboard and screen reader users

**User Story:** As a user relying on assistive technology, I want the mention popup to be fully navigable via keyboard and announced by screen readers, so that I can use the mention feature without a pointer device.

#### Acceptance Criteria

1. THE Mention_Popup SHALL use `role="listbox"` and each candidate SHALL use `role="option"` with `aria-selected` reflecting the current highlight state.
2. THE Message_Input SHALL use `aria-expanded` to indicate whether the Mention_Popup is open and `aria-activedescendant` to reference the currently highlighted option.
3. WHEN the highlight moves via ArrowUp/ArrowDown, THE Mention_Popup SHALL announce the newly highlighted candidate's `displayName` and `roleName` to screen readers via live region or `aria-activedescendant` update.
4. THE Mention_Chip SHALL use `role="button"` with an `aria-label` of "Remove mention: {displayName}" so that screen reader users can identify and remove individual mentions.
5. WHEN the Mention_Popup opens, THE Mention_Popup SHALL not trap focus — the user SHALL remain able to continue typing in the Message_Input while navigating the popup with arrow keys.

### Requirement 11: Mention display and response state in received messages

**User Story:** As a group member reading the chat history, I want mentions in received messages to be visually highlighted with response status indicators, so that I can see who was addressed and whether they have responded.

#### Acceptance Criteria

1. WHEN a received message contains a `mentions` array, THE chat message renderer SHALL highlight each mentioned name span using the `mention_id` anchors from the metadata, falling back to `offset` and `length` fields.
2. THE highlighted mention spans in received messages SHALL use a distinct style (color or background) consistent with the Mention_Chip appearance in the composer.
3. WHEN the current user's `agentId` appears in a received message's `mentions` array, THE chat message renderer SHALL apply an additional "self-mentioned" visual indicator to the message bubble.
4. WHEN a mention references an `agentId` that is no longer in the group, THE chat message renderer SHALL still display the `displayName` from the metadata with a muted style.
5. WHEN a mention has associated MentionState, THE chat message renderer SHALL display the current response state indicator: ⏳ 等待回复 (awaiting response), ✅ 已查看 (acknowledged), or 📌 已接手 (task accepted).

### Requirement 12: Mention popup positioning and overflow

**User Story:** As a group member, I want the mention popup to appear in a readable position regardless of where my cursor is, so that the popup does not get clipped or obscured.

#### Acceptance Criteria

1. THE Mention_Popup SHALL position itself above the Message_Input caret when there is insufficient viewport space below, and below the caret otherwise.
2. WHEN the candidate list exceeds 8 items, THE Mention_Popup SHALL constrain its height to show at most 8 candidates with a scrollable overflow.
3. THE Mention_Popup SHALL remain within the visible viewport boundaries, adjusting horizontal position when the caret is near the left or right edge.
4. WHEN the Message_Input is resized or the viewport changes while the Mention_Popup is open, THE Mention_Popup SHALL recompute its position.

### Requirement 13: Mention runtime resolution against Organization Registry

**User Story:** As a platform developer, I want the gateway to validate mentions against the live organization registry before delivery, so that invalid or removed agent references are handled gracefully.

#### Acceptance Criteria

1. WHEN the gateway receives a message with a `mentions` array, THE Mention_Runtime SHALL resolve each `agentId` against the Organization Registry for the current collaboration group.
2. WHEN a mentioned `agentId` is found in the Organization Registry with status "active", THE Mention_Runtime SHALL proceed with normal mention delivery including MentionContext construction.
3. WHEN a mentioned `agentId` is not found in the Organization Registry or has status "removed", THE Mention_Runtime SHALL skip MentionContext delivery for that agent, retain the mention in the stored metadata for display purposes, and log a warning.
4. WHEN a mentioned `agentId` corresponds to a member with status "suspended", THE Mention_Runtime SHALL queue the mention for delivery upon reactivation and include a `"pending"` state in the MentionState record.
5. THE Mention_Runtime SHALL complete resolution for all mentions in a message within 200 ms of receiving the `chat.send` request.

### Requirement 14: Coordinator visibility and routing authority

**User Story:** As the organization coordinator, I want all mentions to be visible to me so that I can intercept, redirect, or augment mention delivery to prevent multi-agent race conditions (抢答).

#### Acceptance Criteria

1. WHEN any mention is processed by the Mention_Runtime, THE Mention_Runtime SHALL make the mention visible to the Coordinator_Runtime before delivering to the target agent.
2. THE default routing policy SHALL be: all mentions route through the Coordinator_Runtime first, and the Coordinator_Runtime decides whether to forward, wake, broadcast, or convert to a task.
3. WHEN the Coordinator_Runtime intercepts a mention, THE Coordinator_Runtime MAY redirect the mention to a different agent, augment the MentionContext with additional instructions, or suppress delivery with a reason.
4. WHEN multiple agents are mentioned in a single message, THE Coordinator_Runtime SHALL coordinate delivery order to prevent race conditions where multiple agents attempt to respond simultaneously.
5. IF the Coordinator_Runtime is unavailable or does not respond within 500 ms, THEN THE Mention_Runtime SHALL fall back to direct delivery with `coordinatorVisible: false` in the MentionContext.

### Requirement 15: Mention acknowledgement and state tracking

**User Story:** As a group member who mentioned someone, I want to know whether my mention was seen and acted upon, so that I can follow up if needed.

#### Acceptance Criteria

1. WHEN a mention is delivered to a target agent, THE Mention_Runtime SHALL create a MentionState record with fields: `{ mention_id, source_message_id, target_agent_id, acknowledged: false, responded: false, resolved: false, created_at, updated_at }`.
2. WHEN a mentioned agent processes the message containing the mention, THE mentioned agent MAY acknowledge the mention by updating the MentionState to `acknowledged: true`.
3. WHEN a mentioned agent sends a reply in the same conversation thread, THE Mention_Runtime SHALL update the MentionState to `responded: true`.
4. THE MentionState SHALL be queryable by the mention sender to check delivery and response status.
5. WHEN a MentionState transitions (from unacknowledged to acknowledged, or from unresponded to responded), THE Mention_Runtime SHALL emit a state change event visible to the sender's UI for real-time status updates.
6. IF a mention remains unacknowledged for a configurable timeout period (default: 5 minutes), THEN THE Mention_Runtime SHALL notify the Coordinator_Runtime for potential escalation.

### Requirement 16: Mention intent classification

**User Story:** As a platform developer, I want mentions to carry intent classification so that the organization routing layer can distinguish between attention requests, task assignments, approvals, and handoffs without conflicting with existing task and coordinator dispatch systems.

#### Acceptance Criteria

1. THE gateway MAY classify each mention into one of the following MentionIntent values: `"attention"`, `"task_assignment"`, `"approval_request"`, `"review_request"`, `"notification"`, or `"handoff"`.
2. WHEN a mention is classified with intent `"task_assignment"`, THE Mention_Action_Pipeline SHALL route the mention through the task creation subsystem and create a corresponding TaskAssignment record linked to the `mention_id`.
3. WHEN a mention is classified with intent `"handoff"`, THE Mention_Action_Pipeline SHALL notify the Coordinator_Runtime to facilitate responsibility transfer between the source and target agents.
4. WHEN a mention is classified with intent `"approval_request"` or `"review_request"`, THE Mention_Action_Pipeline SHALL set `requiresAck: true` and `priority: "high"` in the delivered MentionContext.
5. WHEN no intent can be determined, THE gateway SHALL default to `"attention"` intent and deliver the mention with standard priority.
6. THE intent classification SHALL feed into the Organization Routing layer and SHALL NOT bypass the Coordinator_Runtime visibility requirement defined in Requirement 14.

### Requirement 17: Mention authority and permission policy

**User Story:** As an organization administrator, I want to control who can use specific mention targets, so that sensitive system-level mentions are restricted to authorized users.

#### Acceptance Criteria

1. THE Mention_Authority layer SHALL enforce the following default permission policy: `@all` is configurable (default: everyone may use), `@coordinator` is open to all group members, and `@system` is restricted to admin-role members only.
2. WHEN a user attempts to send a message with a mention that violates the Mention_Authority policy, THE Message_Input SHALL prevent sending and display an inline error indicating insufficient permission for that mention target.
3. WHERE the organization has configured custom mention policies, THE Mention_Authority layer SHALL evaluate the custom policy before the default policy.
4. THE Mention_Authority policy SHALL be derivable from the `RuntimeOrganizationContext` permissions array without requiring additional network calls.
5. WHEN a mention is blocked by the Mention_Authority policy, THE Mention_Runtime SHALL log the blocked attempt with the source agent, target agent, and policy rule that triggered the block.
