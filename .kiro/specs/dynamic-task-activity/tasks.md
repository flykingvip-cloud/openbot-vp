# Dynamic task activity above the composer

## Agents

- codex-kb-implement · role: contributor · scope: session-scoped task activity UI and pure server projection · paths: src/shared/task-activity.ts, src/gateway/server-methods/task-activity*, ui/src/ui/chat/task-activity*, ui/src/ui/views/chat.ts, ui/src/ui/controllers/chat.ts, ui/src/ui/controllers/chat-task-progress-race.node.test.ts · since: 2026-11-22

## Signal design

Lifecycle and execution health are distinct. Only a server registry run that is live, non-aborted, unexpired and bound to the board's current executionAttempt may produce running. Unfinished alone produces static unknown. Dependency and wake facts must match the current task ID. Paused/terminal/tombstoned tasks hide the line even if late run facts arrive. A reply's final event does not complete the task.

| Fact                                                  | Line                               | Motion                               |
| ----------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| Bound active execution                                | 任务正在执行                       | pulse, disabled under reduced motion |
| Durable dependency wait                               | 正在等待任务回件                   | none                                 |
| Future durable wake                                   | 已安排自动恢复，等待执行           | none                                 |
| Explicit user gate                                    | 任务需要你处理，请查看对话中的请求 | none                                 |
| Active task, no trusted run/lease                     | 任务未结束，执行状态待确认         | none                                 |
| Disconnected, failed read, observation older than 15s | 连接或任务状态待确认               | none                                 |
| No current task, paused, cancelled or terminal        | hidden                             | none                                 |

A component per mounted composer owns its snapshot, generation fence and bounded 5s poll. Session/client changes clear the snapshot; out-of-order responses cannot apply. No global progress singleton is consumed. The existing separate conversation progress refresh also rejects stale requests.

## Tasks

- [x] Fresh origin/main ancestry verified before changes. — codex-kb-implement
- [x] Shared minimal read contract and pure task-board projection with attempt/task identity fences. — codex-kb-implement
- [x] Ephemeral one-line composer UI; polite role=status, aria-atomic, reduced motion. — codex-kb-implement
- [x] Actual Chromium tests: running/waiting/receipt/terminal, final reply with live task, disconnect, pause/cancel, switching sessions with out-of-order responses, static user gate. — codex-kb-implement
- [x] Controller stale progress response protection and two request-race tests. — codex-kb-implement
- [x] Authenticated lightweight task.activity.get route, read-only method scope and method-list wiring. Same identity/scope/visibility gates as chat.history; authorized tenant store only, strict executionAttempt + session ID/key + non-aborted/unexpired registry match. — codex-kb-implement
- [ ] Durable dependency facts are not yet implemented by B/C; production currently returns running or unknown, never fabricated waiting/recovering/needs_user. Root owns dependency implementation.
- [ ] Root independent full integration acceptance and build.

## Validation

23 tests across 6 files (actual RPC handler, server projection, history identity/run compatibility, UI state and controller race): /tmp/task-activity-final-tests.log.
The RPC denial tests inject the existing visibility resolver boundary; history employee-isolation tests separately exercise the existing scope chain. This is not a deployed multi-tenant gateway test.
4 real Chromium DOM tests: /tmp/task-activity-browser.log.
Changed-file type-aware lint: /tmp/task-activity-lint.log (0 warnings/errors).
Types: /tmp/task-activity-types.log (passed).
UI production compilation: /tmp/task-activity-ui-build.log (passed; existing large-chunk advisory). Fresh origin/main ancestry rechecked immediately before the UI build. No deployment or service restart.
No real task state, knowledge base or model calls changed. — codex-kb-implement

## Limitations and acceptance boundary

The UI polls a lightweight read-only endpoint every 5s while mounted and connected, refreshes immediately on run-ID/client/session changes, and stops timers on unmount. Observations older than 15s cannot animate. Unsupported/failed RPC preserves only an uncertain prior active status; it does not invent a task on initial failure. Live run signals are session task execution attempts, not model claims or progress timestamps. A durable dependency result can later populate the pure projection extension; no text parsing substitutes for that source. No precise percentage or promised completion time is shown. Root independent deployed acceptance remains pending. — codex-kb-implement
