# Bound same-task continuation

## Agents

- codex-kb-implement · role: contributor · scope: interaction continue/status and host enforcement · paths: src/agent-runtime/contracts/interaction.ts, src/agent-runtime/contracts/task-binding.ts, src/agent-runtime/command/interpret-interaction*, src/agent-runtime/command/task-proposal-reply*, src/agent-runtime/model/interaction-completion.ts, src/agent-runtime/model/interaction-output-contract.ts, src/agent-runtime/state/mutations/interaction-proposal.ts, src/agent-runtime/state/mutations/resume-current*, src/agent-runtime/wiring/same-task-continuation.test.ts, src/auto-reply/reply/get-reply-run.ts · since: 2026-11-22

- [x] Add semantic continue/status controls to interpreter schema and prompt; preserve independent execution requests. — codex-kb-implement
- [x] Bind controls to host task ID/revision; status checks state under lock without mutation and reports host facts alone. — codex-kb-implement
- [x] Continue through existing gateway live authorization and atomic resume mutation with unchanged task identity, constraints and focus; paused/finished/stale/unauthorized requests cannot restart. Active embedded execution is acknowledged without starting another. — codex-kb-implement
- [x] Trace interaction task_control consumers: interpreter → routeInteraction → runPreparedReply; state mutation handles status, gateway resume callback handles continue; pause/cancel effect callback narrowed explicitly. Collaboration task_control CAS is a different protocol and unchanged. — codex-kb-implement
- [x] Regression fixture covers repeated controls same ID/no parked task, independent new goal switching, stale interpretation, host-only status and rejected continuation board-byte preservation. — codex-kb-implement
- [ ] Root integration review and durable receipt/wake integration; contributor does not commit/deploy.

## Evidence

Seven focused files: /tmp/same-task-green.log. Type checking: /tmp/same-task-final-types.log. Type-aware changed-file lint: /tmp/same-task-final-lint.log.

Additional inbound-depth-router suite: 32 pass/22 fail because it spies on nonexistent replyTurnRuntime.steer at line 410. Untouched HEAD exported by git archive to /tmp/same-task-head-baseline produces exactly the same 32 pass/22 fail (/tmp/same-task-head-inbound.log); no assertions changed. This is explicitly not a green full reply-layer suite. — codex-kb-implement

Semantic accuracy is enforced through the structured decision protocol and tested injected inference, not a real-model continuation intent experiment. No real task board changed. — codex-kb-implement
