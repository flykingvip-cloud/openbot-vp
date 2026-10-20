# Rollout and rollback

All Phase 1 flags stay **default off**. This design package freezes
them as compile-time `false`. A later implementation PR may introduce
runtime flags; it must keep the same fail-closed defaults.

## Flags

| Flag                        | This package | Later PR default | Meaning                           |
| --------------------------- | ------------ | ---------------- | --------------------------------- |
| `SKILL_TOP_K_ENABLED`       | false        | false            | would shrink live Skill injection |
| `TOOL_TOP_K_ENABLED`        | false        | false            | would shrink live Tool exposure   |
| `SHADOW_ROUTER_RECORD`      | false        | false            | would emit shadow events          |
| `SHADOW_ROUTER_APPLY`       | false        | false            | would apply candidates live       |
| `DAG_ENABLED`               | false        | false            | AOR DAG                           |
| `CONVERSATION_TASK_ENABLED` | false        | false            | ConversationTask activation       |
| `ORCHESTRATION_LIVE_INVOKE` | false        | false            | live orchestration invoke         |

`SHADOW_ROUTER_APPLY` must not be true unless `SHADOW_ROUTER_RECORD`
is true and offline recall has passed. This package never sets either.

## Gray rollout (later PR only)

1. Offline labeled replay.
2. Shadow-record on an isolated loopback / allowlisted tenant.
3. Compare candidate vs invoked; no apply.
4. Hold. Do not apply Top-K from this design.

Stop conditions: privacy hit, policy bypass attempt, apply flag
flipped, recall below the later-agreed floor, or P2-C evidence edit.

## Rollback

Rollback is **flag off**, not a model revert:

1. Set every flag above to false.
2. Keep the current full Skill injection and Tool policy path.
3. Keep historical P2-C files immutable.
4. Shadow events are not inputs to live decisions, so disabling
   record is sufficient.

There is no need to roll back production Skill or Tool catalogs
because this design does not change them.

## Performance reference

P2-C operational baseline (20 samples, sourceCommit `0de7abd0f7`)
is a latency reference only. Rollback is not triggered by those
numbers, and those numbers must not auto-tune weights.
