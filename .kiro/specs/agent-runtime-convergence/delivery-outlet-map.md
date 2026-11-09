# Terminal reply delivery ownership

Scope: the normal reply adapter after its original execution returns. This is an equivalent extraction, not a new execution loop or a claim that all task acceptance and delivery semantics are finished.

## Main chain

```text
original execution returns
  -> original usage/session persistence
  -> no raw payloads -------------------------> completeReplyDelivery(empty)
  -> buildReplyPayloads
       -> no prepared payloads ---------------> completeReplyDelivery(empty)
       -> original markers / reminders / language gate
            -> all filtered ------------------> completeReplyDelivery(language_filtered)
            -> prepareVisibleDelivery (await outcome -> register -> publish pending identity)
            -> original usage / notices / complex-task presentation
            -> completeReplyDelivery(visible)

completeReplyDelivery
  -> classify and record original terminal outcome, where applicable
  -> original continuation consideration, only for placeholder or visible results
  -> original finalizeWithFollowup, once on a normal completion
```

`completeReplyDelivery` is synchronous. Original non-visible outcome writes remain fire-and-forget; visible preparation remains awaited before any receipt identity is published. The original outer catch/finally still owns exceptional queue draining, block-pipeline stop and typing cleanup. No second recovery or scheduling loop was introduced.

## Preserved semantics

| Result                                      | Turn outcome                                                     | User response                                            | Continuation consideration |
| ------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- | -------------------------- |
| User-aborted empty turn                     | Failed / user_cancelled                                          | Silent                                                   | No                         |
| Private empty turn needing fallback         | Failed / run_failed; original gap recorded                       | Original honest fallback in selected language            | No                         |
| Legitimate silent / duplicate-delivery skip | Original legacy skip settlement                                  | Silent                                                   | No                         |
| Language-filtered final, no tool activity   | Failed / user_filtered                                           | Silent                                                   | No                         |
| Language-filtered final after tools         | Original processPlaceholder flag; no final acceptance or receipt | Original process sentence                                | Existing host only         |
| Prepared visible result                     | Already prepared as awaiting, not recommitted by terminal outlet | Original payload(s), including empty array after shaping | Existing host only         |

Stable delivery identity, pinned contract evidence and transport confirmation continue to use the existing implementations. A process sentence does not become a final task result. A successful model turn, task acceptance and channel delivery remain separate concepts.

## Module boundaries

- `delivery/presentation/empty-reply.ts`: original pure empty-turn decision, types and text formatting. The legacy honest-empty module re-exports the same implementations through the public delivery entry.
- `delivery/dispatch/complete-reply.ts`: one terminal result switch and completion outlet. Fixed source-code host ports preserve outcome recording, gap I/O, continuation and queue-drain implementations; these ports are not configuration scripts or extension callbacks.
- `delivery/dispatch/prepare-visible.ts`: existing pending-receipt preparation transaction.
- Original adapter: captures live delivery evidence at the original point; binds immutable run identity and original side effects; retains earlier command/admission/aside branches and presentation timing.
- Original dispatch transport: actual channel send confirmation. Preparation is not proof of a send.

## Open evidence gap retained deliberately

The original silent classifier returns success for group, heartbeat, internal and visible-payload-filtered exemptions as well as observed in-run delivery. The original caller maps all such successes to `deliveryPhase=delivered`. This migration preserves that behavior and does not turn exemptions into new evidence.

A separate correction must distinguish permission to stay silent from observed delivery, verify TaskOutcome and acceptance consequences, and add failing-before/passing-after coverage. Do not claim that the unified outlet already provides universally evidence-backed delivery semantics.

Builder normalization/retesting and the user-facing collapsible action timeline remain deferred under their existing acceptance gates.
