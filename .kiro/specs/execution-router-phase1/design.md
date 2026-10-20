# Phase 1 Shadow Router design

Design only. No live routing. This package lives under
`.kiro/specs/execution-router-phase1/` and must not change production
Skill/Tool sets, Tool policy, model selection, or prompts.

A later implementation PR is required. That PR must not rewrite P2-C
historical evidence.

## Non-goals

- Do not inject a smaller Skill set.
- Do not expose a smaller Tool allowlist.
- Do not change `applyEmbeddedCustomToolPolicy` outcomes.
- Do not enable Top-K, DAG, ConversationTask, or
  `ORCHESTRATION_LIVE_INVOKE`.
- Do not fit weights from the current 20 operational samples.
- Do not perform external writes.

## Eight invariants

1. **Skill Router recalls candidates only.** The live injected Skill set
   stays the current `skillsPrompt` / snapshot path.
2. **Tool Router records candidates only.** The live authorized Tool set
   stays the current policy pipeline output.
3. **The existing policy pipeline is the final authority.** Shadow
   scores never grant, deny, or reorder authorization.
4. **Low confidence falls back to the current full path.** Fallback is
   the default, not an error.
5. **Required-skill / required-tool recall is measured offline first**,
   then compared in shadow. Shadow does not start until offline labels
   exist.
6. **Production observations store candidate names as digests only.**
7. **The current operational baseline is a latency/reliability
   reference, not a routing weight.** P2-C numbers must not auto-tune
   Top-K.
8. **Phase 1 implementation needs a separate PR.** This design tree
   must not edit `.kiro/specs/execution-router-phase03-p2/**`.

## Live path today (unchanged)

| Stage                       | Live write point                  | Shadow role             |
| --------------------------- | --------------------------------- | ----------------------- |
| Skill eligible / injected   | `attempt.ts` after `skillsPrompt` | observe + score offline |
| Tool constructed            | `createOpenClawCodingTools`       | observe + score offline |
| Tool after policy / exposed | `applyEmbeddedCustomToolPolicy`   | final authority         |
| Observation                 | `chat.execution_observation`      | counts only; no names   |

## Shadow path (this design)

```
TaskEnvelope
  → scoreSkillCandidates (offline / later shadow-record)
  → scoreToolCandidates
  → decideShadowRoute (apply=false always in this package)
  → shadow event (digests only)
  → offline recall + candidate-vs-invoked report
```

`decideShadowRoute` returns candidates and a reason code. It never
returns `apply: true` from this package. Even a later implementation
PR must keep `apply` behind a new, default-off flag that this design
does not set.

## Scoring (declared constants, not fitted)

See `score.ts`. Weights are design constants:

- class match 0.50
- tag overlap 0.30
- risk alignment 0.20

They are **not** derived from P2-C TTFT 632/886 ms, first-tool 0.8, or
token averages. Those figures remain performance references only.

Low confidence when top-1 score `< 0.55` or top-1 minus top-2 `< 0.08`.
Low confidence reason: `LOW_CONFIDENCE_FALLBACK_FULL_PATH`.

## Implementation gate

Do not merge live wiring until all are true:

- offline required-skill and required-tool recall measured on a labeled
  replay set that is **not** the P2-C weight source
- shadow event schema accepted
- flags remain default off
- privacy scan passes
- separate PR from P2-C evidence
