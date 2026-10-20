# OpenBot Conversation System and Isolation Path Audit

Date: 2026-09-20

Status: architecture audit of the current implementation; no runtime changes are proposed as already approved.

## 1. Executive conclusion

OpenBot does not have one conversation model. It currently composes three related models:

1. an agent session model inherited from the core Gateway;
2. an employee-specific steward model that rewrites the builtin `main` agent into a per-user session;
3. a collaboration model that exposes one group transcript while running multiple bot-specific mirror sessions.

The intended isolation boundaries are materially stronger than the workbench symptoms suggest:

- independent robots use agent-scoped session stores and exact transcript files;
- the builtin steward uses `agent:main:employee:<owner>` to isolate each employee;
- a collaboration group uses `groupId` as its resource identity and stores its public conversation at `collaboration/groups/<groupId>/runtime/transcript.jsonl`;
- managed employee access is checked in the Gateway before history reads and writes;
- live chat events are delivered through an authorized recipient set, with UI filtering only as defense in depth.

However, the system is not structurally simple or fully proven end to end. The same `sessionKey` type is used as route, UI selection, compatibility alias, cache key, transcript lookup key, run key, and event topic. Collaboration adds `space:<groupId>` aliases and `agent:<bot>:main:space:<groupId>` mirrors, then reconstructs group identity from keys, session metadata, catalog records, titles, and legacy entries. This creates many opportunities for an incorrect projection to make several visible objects share one conversation surface even when the underlying group transcript store is capable of isolation.

The running workbench demonstrates exactly that class of failure: distinct group titles and rosters are displayed, but the selected session remains one shared scoped key and the same transcript is painted under several group headers. The evidence does not prove that all physical group transcripts are merged. It proves that the current UI projection and routing chain can lose the distinct group identity before requesting history.

The architectural priority is therefore not another filter. It is to make resource identity explicit and singular from catalog to storage:

```text
ConversationRef = tenantId + kind + resourceId + conversationId
```

`sessionKey` should remain an execution/routing address derived from that reference, not serve as the reference itself.

## 2. Product-specific conversation domains

OpenBot is a team AI workbench rather than a single chat client. Its conversation system supports four different product behaviors.

### 2.1 Employee to independent robot

An employee opens a specialist such as Market Assistant or Skill Incubation. The expected product contract is a private work thread with that robot. The robot may have channel, cron, and child sessions, but those are not the robot's primary workbench conversation.

### 2.2 Employee to builtin steward

Daibai is the universal builtin steward implemented by agent `main`. Unlike a normal specialist, it is visible to every employee and also participates in collaboration groups. OpenBot therefore adds a per-employee session boundary so one employee's steward transcript does not become another employee's transcript.

### 2.3 Collaboration group public conversation

A group is a governed resource with humans, robots, owner/admin roles, operating state, tasks, decisions, memory, and one member-visible public transcript. The transcript belongs to the group, not to its coordinator robot.

### 2.4 Bot execution inside a collaboration round

When a user speaks in a group, the Gateway selects participating bots. Each bot runs in its own agent-scoped mirror session so its model execution and agent state remain attributable. Visible replies are then appended to the public group transcript. These mirror sessions are execution contexts, not separate user-facing group conversations.

This distinction is fundamental:

```text
group public conversation != coordinator private conversation
group public conversation != bot mirror execution session
```

## 3. Current identity model

### 3.1 Independent-agent keys

The common canonical shape is:

```text
agent:<agentId>:<rest>
```

`parseAgentSessionKey()` extracts `agentId` and leaves the remaining routing domain in `rest`. The type system does not provide a closed enum for `rest`; direct, channel, cron, thread, employee, and collaboration forms are inferred from tokens.

Typical workbench home sessions are:

```text
agent:<agentId>:main
```

Child channel sessions and cron sessions remain separate keys. The workbench navigation chooses a preferred source session but is intended to present a stable robot-level entry.

### 3.2 Employee steward keys

The builtin steward canonical employee key is:

```text
agent:main:employee:<sanitizedPlatformUserId>
```

Gateway aliases such as `main`, `global`, `agent:main`, and `agent:main:main` are rewritten to the authenticated employee's key by `resolveEmployeeScopedChatSessionKey()`. A foreign employee steward key is also rewritten to the caller's own key.

This is a deliberate product boundary layered on top of the legacy personal-assistant model.

### 3.3 Collaboration keys

The public workbench alias is:

```text
space:<groupId>
```

Each participating bot can also have a mirror:

```text
agent:<botId>:main:space:<groupId>
```

Legacy steward mirrors additionally appear as:

```text
agent:main:space:<groupId>
agent:main:main:space:<groupId>
```

All aliases are expected to resolve to the same group resource when the embedded `groupId` is the same.

### 3.4 Physical group identity

The canonical group filesystem identity is `groupId`. The group root is resolved once by `resolveGroupCollaborationPaths()`:

```text
collaboration/groups/<groupId>/
  profile.json
  members.json or profile members
  operating-state.json
  memory/
  governance/
  ledger/
  runtime/transcript.jsonl
```

The documented code invariant is that `runtime/transcript.jsonl` is `GROUP_PUBLIC`, shared only by members of that group.

## 4. Independent robot path

### 4.1 Read path

```text
workbench robot entry
  -> selected sessionKey
  -> chat.history(sessionKey)
  -> employee session visibility check
  -> loadSessionEntryForClient(sessionKey)
  -> session entry { sessionId, sessionFile }
  -> transcript history reader
  -> UI chatMessages
```

For a normal robot, no group alias resolution is involved. The agent ID determines the agent store and the session entry points to its transcript.

### 4.2 Write path

```text
composer
  -> chat.send(sessionKey, idempotencyKey, message)
  -> employee session visibility check
  -> tenant binding and interest registration
  -> loadSessionEntryForClient(resolvedSessionKey)
  -> dispatch inbound message to resolved agent
  -> append transcript
  -> authorized chat event fan-out
```

### 4.3 Isolation controls

- agent ID remains embedded in the session key;
- employee visibility is resolved server-side for personal workbench sessions;
- employee and enterprise shells receive live events only when registered as interested in the session and tenant matches;
- UI event matching rejects another agent's surface;
- transcript cache keeps non-group bot keys exact rather than collapsing all sessions of one robot.

### 4.4 Residual ambiguity

The navigation model may group several agent sessions under one robot entry and choose one history source. This is a presentation concern, but it becomes a routing concern because the chosen source is also passed to `chat.history` and `chat.send`. The model lacks a distinct `robotConversationId`; therefore UI aggregation and execution routing are coupled.

## 5. Builtin steward path

### 5.1 Read and write normalization

Both `chat.history` and `chat.send` call `resolveEmployeeScopedChatSessionKey()`. A global steward alias becomes the authenticated employee's canonical steward key before the session entry is loaded.

### 5.2 Storage and workspace

The steward session is isolated by employee owner. Its writable workspace is also resolved under an employee-specific directory or the tenant workspace resolver in managed mode.

### 5.3 Event isolation

Live events for an employee steward session require:

- session owner equals connected platform user;
- resource tenant equals connection tenant.

Global steward events are not delivered to employee or enterprise shells.

### 5.4 Structural risk

Agent `main` has three roles:

- legacy global assistant;
- per-employee steward;
- participant/mirror in collaboration groups.

The code compensates through alias rewriting and special-case equivalence. This role multiplication is a recurring source of UI and session-store ambiguity. It is not evidence that the steward transcripts are physically identical, but it increases the cost of proving that they are not.

## 6. Collaboration-group path

### 6.1 Catalog and authorization

Before a group write, `resolveCollaborationGroupWriteDenial()` extracts `groupId` from either the public alias or a mirror key.

In Managed Enterprise mode it uses tenant-scoped authoritative members. In local mode it uses the collaboration-space catalog and employee actor membership. Missing actor, unknown group, catalog failure, or denied membership returns a stable denial.

The group discussion scope then re-lists the managed space after the write ACL. A second catalog miss fails closed rather than reconstructing authorization from historical sessions.

### 6.2 Public transcript binding

For `space:<groupId>`, `ensureGroupSessionEntry()` creates or updates a session-store row and binds it to:

```text
collaboration/groups/<groupId>/runtime/transcript.jsonl
```

The group session ID is deterministic for the group. `findCollaborationSpaceStoreEntry()` can locate a legacy steward mirror when the bare alias has no transcript metadata.

### 6.3 Participant execution

The Gateway ensures bot group sessions for active roster members, gathers eligible bot mirrors, applies collaboration policy, and runs selected bots separately. Each run receives:

- its bot session key;
- `CollaborationGroupId`;
- tenant context;
- roster and coordinator context;
- group system prompt;
- recent public group history.

Bot replies are normalized and appended to the public group transcript with sender attribution.

### 6.4 Read path

`chat.history` recognizes only a bare `space:` prefix as the group public-history path. It loads the group session entry and resolves its shared transcript. A scoped mirror sent as the current history key follows the normal session loader instead.

This is a key architectural distinction: aliases and mirrors are considered equivalent by several UI helpers, but they do not enter the same Gateway branch.

### 6.5 Event path

Group live-event delivery extracts `groupId` from either alias or mirror. Employee/enterprise recipients must match the authoritative tenant and be in the cached group ACL. If tenant or ACL is unavailable, employee shells fail closed.

### 6.6 Cache path

The workbench transcript cache normalizes `space:<id>` and every `*:space:<id>` mirror to one `space:<id>` slot. This is correct only when the embedded ID is authoritative and stable.

## 7. Current management architecture

The current system can be summarized as six layers.

| Layer         | Source of truth                                       | Responsibility                               |
| ------------- | ----------------------------------------------------- | -------------------------------------------- |
| Identity      | authenticated membership, agent ID, group ID          | establishes actor and resource               |
| Catalog       | agent registry, collaboration space store             | lists visible robots and groups              |
| Routing       | session key and aliases                               | selects agent/session execution path         |
| Authorization | employee visibility, group membership, tenant context | permits history, write, and events           |
| Persistence   | session store plus transcript files                   | maps routing keys to physical history        |
| Projection    | workbench read models and caches                      | presents robots/groups and restores UI state |

The intended dependency direction is top to bottom. In practice, compatibility code also reconstructs upper-layer identity from lower-layer session metadata and titles. That reverse inference is the main complexity source.

## 8. Isolation invariants and current assessment

### I1. Independent robot transcripts are agent-scoped

Assessment: implemented and covered by exact agent keys, but the workbench has no first-class conversation object separate from session selection.

### I2. Employee steward transcripts are owner-scoped

Assessment: strongly implemented in Gateway normalization and live-event delivery. This is the clearest isolation path.

### I3. Each collaboration group has one unique public transcript

Assessment: implemented at filesystem resolution by `groupId`. Local evidence shows multiple distinct group transcript files. End-to-end uniqueness is not currently proven because UI projections can route several visible groups to one selected key.

### I4. Bot mirror sessions do not become public group identity

Assessment: conceptually intended but inconsistently represented. UI navigation deliberately prefers a scoped mirror as the history source, while Gateway group history has a special branch only for the bare alias. This weakens the invariant.

### I5. Authorization precedes group read/write

Assessment: writes have explicit group ACL. History uses general employee session visibility plus group session resolution. The security model is fail-closed for managed employee traffic, but the authorization path is split rather than expressed through one conversation authorization function.

### I6. Live events cannot cross tenant/user/group boundaries

Assessment: explicitly enforced by `chat-event-isolation.ts`; UI filtering is secondary. This is structurally sound, subject to correct tenant and group bindings.

### I7. UI caches cannot merge unrelated conversations

Assessment: correct when keys carry correct IDs. Not independently safe against a catalog/projection assigning the same key to two visible groups.

## 9. Observed runtime evidence

The local runtime contained separate physical group transcripts, including:

- `collaboration/groups/aegis/runtime/transcript.jsonl`;
- `collaboration/groups/grp-daniel-hhd-gmail-com-upbeyond/runtime/transcript.jsonl`;
- `collaboration/groups/grp-elledecke204-gmail-com-ai/runtime/transcript.jsonl`;
- `collaboration/groups/space-fef40e8a-0958-4c74-b557-069d7c333981/runtime/transcript.jsonl`;
- a separate encoded group directory for the digital-human test group.

This proves the storage layer supports distinct group roots.

The workbench inspection showed a different condition:

- five group entries displayed different titles and rosters;
- switching entries left one scoped session in the URL;
- all five painted the same user-message history;
- bypassing browser cache changed the shared target but did not make targets unique.

Therefore the current incident is best classified as a catalog/projection/routing identity collapse until a lower-layer binding audit proves otherwise. It must not be described merely as a visual header bug, and it must not be assumed to be physical transcript corruption without examining each session-store row and `sessionFile` binding.

## 10. Structural findings

### F1. `sessionKey` carries too many responsibilities

Severity: architectural P1.

It is simultaneously used for navigation selection, routing, storage lookup, access interest, event topics, cache identity, run occupancy, legacy compatibility, and URL state. A key that changes shape through aliases cannot safely be the universal identity of all those concepts.

### F2. Group alias and mirror equivalence is asymmetric

Severity: functional P1.

UI matchers and caches treat aliases and mirrors as one surface. Gateway history and send use different branches depending on whether the raw key starts with `space:`. Equivalent-looking keys therefore do not have equivalent control flow.

### F3. Collaboration read models use inference from multiple weak signals

Severity: architectural P1.

The workbench merges managed spaces, legacy team entries, session metadata, titles, `space`, `groupId`, display names, subjects, and labels. This helps migration but makes identity convergence non-deterministic when data is stale or duplicated.

### F4. Group transcript binding has a fail-open fallback

Severity: hardening P1 for Managed Enterprise, lower for Personal Local.

If `bindGroupPublicTranscript()` throws, `resolveGroupPublicSessionFile()` returns the canonical group path so writes still land on one file. The path is group-specific, so this does not inherently merge groups. However, Managed Enterprise design states ambiguous storage bindings fail closed. The fallback should be reviewed against that contract.

### F5. Authorization logic is distributed

Severity: maintainability P2.

Session visibility, group write ACL, group discussion catalog checks, transcript path authorization, event recipient ACL, and UI filtering live in different modules with related but non-identical identity parsing.

### F6. Display projection can remain plausible after identity collapse

Severity: product P1.

Group header and roster are resolved from the managed-space snapshot, while transcript is resolved from selected session state. This allows a convincing but false UI: correct group name and members above another group's conversation.

### F7. Legacy healing obscures provenance

Severity: maintainability P2.

The system can bind a bare alias to a steward mirror, merge legacy per-user group transcripts, rewrite `.openclaw` paths, and synthesize missing entries. Necessary migration behavior is interleaved with steady-state reads, making it difficult to know whether a result is canonical or healed.

## 11. Target architecture

Introduce a first-class immutable reference used at every boundary:

```ts
type ConversationRef =
  | {
      tenantId: string;
      kind: "agent_private";
      ownerUserId: string;
      agentId: string;
      conversationId: string;
    }
  | {
      tenantId: string;
      kind: "group_public";
      groupId: string;
      conversationId: string;
    };
```

Derived execution addresses remain separate:

```ts
type ExecutionRef = {
  agentId: string;
  sessionKey: string;
  parentConversationId: string;
  groupId?: string;
};
```

Rules:

1. Catalog entries carry `ConversationRef`; UI never reconstructs it from titles or session rows.
2. `chat.history`, `chat.send`, caches, URLs, and live events address the conversation reference.
3. Gateway resolves the conversation once into authorization, transcript, and execution plan.
4. Group bot mirrors are returned only inside the execution plan and never become navigation targets.
5. Compatibility aliases resolve at one boundary into a canonical conversation reference, with telemetry and a retirement date.
6. Physical transcript metadata records tenant, kind, resource ID, and conversation ID in its header; mismatches fail closed.

## 12. Convergence plan

### Phase 0: prove the current graph

- Export every visible workbench entry with title, agent/group ID, selected key, source key, session entry, session ID, and realpath of `sessionFile`.
- Assert one visible group maps to exactly one `groupId` and one public transcript realpath.
- Assert no transcript realpath belongs to two distinct group IDs.
- Keep this read-only and do not heal during the audit.

### Phase 1: centralize parsing

- Replace duplicate `space:` extraction helpers with one shared parser returning a typed identity.
- Separate `SessionRoute` parsing from `ConversationRef` parsing.
- Make ambiguous and title-only identities invalid in steady state.

### Phase 2: make catalog identity authoritative

- Collaboration-space list returns canonical `groupId` and `conversationId`.
- Workbench nav uses those fields directly.
- Remove title matching from identity association; retain it only for display or an explicit migration command.

### Phase 3: unify history and send

- Both alias and mirror requests resolve through one `resolveConversation()` service.
- The resolver returns ACL decision, transcript path, public event topic, and execution targets.
- `chat.history` and `chat.send` stop branching on raw string prefix.

### Phase 4: isolate migration

- Move transcript healing and legacy merge into an explicit idempotent migration step.
- Mark migrated session rows with provenance.
- Remove live-read title inference and legacy mirror scanning after coverage reaches 100%.

### Phase 5: delete compatibility complexity

- Retire unused aliases and duplicate parsers.
- Remove UI source-key heuristics for groups.
- Reduce cache equivalence to canonical conversation ID equality.

## 13. Required acceptance matrix

For every independent robot and collaboration group:

1. record its canonical conversation reference;
2. send a unique probe;
3. verify its physical transcript realpath;
4. verify every non-target transcript lacks the probe;
5. refresh the page;
6. reconnect WebSocket;
7. restart Gateway;
8. log out and back in;
9. verify the same target restores and every non-target remains clean;
10. verify a non-member cannot read, write, or receive live events.

The test must compare server storage and events, not only visible headers.

## 14. Review methodology for the wider OpenBot codebase

This audit establishes a reusable review order:

```text
product object
  -> canonical identity
  -> ownership and authorization
  -> routing
  -> physical persistence
  -> execution
  -> event delivery
  -> projection and cache
  -> compatibility/migration
```

For each subsystem:

- name the single source of truth;
- list every derived alias;
- prove the complete happy path;
- prove isolation and failure behavior;
- identify reverse inference and fallback;
- separate migration from steady state;
- prefer deleting ambiguity over adding another guard.

The optimization criterion is not fewer lines in isolation. It is fewer identities, fewer direction reversals, fewer runtime inference paths, and fewer places where the same authorization rule can diverge.

## 15. Final assessment

OpenBot already contains serious isolation mechanisms, especially employee steward remapping, tenant-aware event delivery, group membership ACL, and group-specific transcript roots. The core problem is not absence of controls. It is that a mature compatibility layer has allowed routing identity, product identity, and storage identity to remain partially interchangeable.

The correct remediation is architectural convergence around an explicit conversation reference. Until that exists, local fixes should be accepted only when they remove an inference path or enforce an already-proven invariant. New title matching, fallback selection, alias equivalence, or cache filtering should be presumed harmful unless the end-to-end identity graph demonstrates why it is necessary.
