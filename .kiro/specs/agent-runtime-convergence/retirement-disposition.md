# Batch D retirement disposition

Date: 2026-11-09. Base: accepted Batch C `46f0b7ae019c72398307c129e7ce606b26ffeb74`.

No file in this list is deleted. Evidence is source and existing flags, not a production config dump. Where consumers, flags, or recovery assets are not fully known, the item stays and is marked insufficient.

| Item | Original intent | Production consumers | Dynamic config | Unfinished / recovery assets | Replacement chain | Archive | Delete scope | Regression evidence | Rollback | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `classifyTurnRelation` | Old turn semantic split | Only `task-orchestration/complex-task-loop.ts`; no production importer of the shaping API | Orchestration dispatch default off | None proven in the session board | Live predicates are in policy; this classifier is not promoted | Keep the source file | None | Policy index test asserts it is not exported | Restore the call if a dormant loop is re-enabled | 观察保留 |
| `complex-task-loop.ts` | Optional four-step visible report | No production importer | Flags default off | Shaping output, not a second close authority | Delivery / acceptance stays on the main completion path | Keep | None | Not invoked by the reply host | Leave the file | 观察保留 |
| `session-task-board.ts` facade | Compatibility re-export of board state | Gateway, agents, auto-reply, async-wait | Session board files | Parked tasks, tombstones, continuation tickets | `agent-runtime/state` and policy | Keep the facade until importers are gone | None | Existing board tests | Facade re-exports still point at state | 适配保留 |
| legacy-primary-supplement / round-runtime / decision / wake / floor | Live collaboration round behavior | `collaboration-dispatch` and learning | Floor / LIVE flags, many default off | Round locks, handoff txns, board claims | Policy and state own rules and writes; orchestration stays host | Do not delete the directory | None | Batch C handoff and claim suites | Host modules still call the new entries | 适配保留 |
| `get-reply-run.ts` | Controlled reply host | Web and channel reply entry | Reply and collaboration flags | Session JSONL, queued system events | `selectContextCatalog` plus `runAdmittedTurn` | Keep | None | Aside-dialogue context order test | The host remains the entry | 适配保留 |
| `agent-runner.ts` | Runs the admitted reply | Called by get-reply-run | Typing, model, queue settings | In-flight runs | Execution wiring | Keep | None | Reply runner tests already on main | Do not bypass the admitted turn | 适配保留 |
| `commands/agent` | CLI / gateway agent command | `gateway/server-methods/agent.ts` and CLI | Model and session config | Session transcripts | Same admitted execution path | Keep | None | Not re-proved as a delete candidate | Keep the command | 适配保留 |
| cron | Scheduled turns | `src/cron` | Cron job store | Pending jobs | Main-session focus uses the same wake policy | Keep | None | Cron focus tests exist; not a retirement run | Do not drop the job store | 适配保留 |
| followup runner | Deferred reply queue | Auto-reply queue | Queue settings | Queued followups | Admitted turn after dequeue | Keep | None | System events are consumed once in the aside test | Do not drop queued events on a flag flip | 适配保留 |
| hooks transform | Webhook payload mapping | `gateway/hooks-mapping.ts` when a transform module is configured | Explicit transform path | Unknown external senders | Keep as a reviewed adapter | Keep | None | Production enablement unknown | Do not remove the loader | 证据不足 |
| Lobster | External workflow with resume token | `extensions/lobster` optional tool | Plugin install / allowlist | `resumeToken` pipelines not inventoried | Capability declaration marks recovery `opaque_external` | Keep the extension | None | `declareCapability("lobster")` test | Do not drop in-flight tokens | 证据不足 |
| OpenProse | Prompt-driven skill VM | `extensions/open-prose` skills | Install unknown | User `.prose` programs unknown | Not a core scheduler | Keep | None | No asset census | Do not delete skills | 证据不足 |
| task-orchestration readonly | Read-only surface beside dormant dispatch | `dispatch.ts` when `OPENBOT_ORCH_READONLY_INVOKE` is on (default on) | Readonly flag default on; live invoke false | Unknown data sources | Context/capability read, not a second board | Keep | None | Flag defaults only | Do not flip the readonly switch in this batch | 证据不足 |

Rule-switch note: this batch does not change flag defaults. Queued system events stay on the system prompt and are drained once per reply. Lobster resume tokens are not discarded.

Embedded attempt reports (`embedded-attempt*.ts`) call `buildAgentSystemPrompt` and then may compress messages with `compileModelContext`. That is not a second system-prompt compiler. No empty unified report service is added. `buildAgentSystemPrompt` stays in `src/agents/system-prompt.ts`.
