# Offline evaluation plan

Required-skill and required-tool recall are measured **offline first**.
Shadow recording starts only after that offline pass exists. Live
routing stays off.

## Dataset

Replay rows are labeled envelopes, not live traffic:

| Field                       | Rule                                              |
| --------------------------- | ------------------------------------------------- |
| `envelope`                  | `TaskEnvelope` with digests only                  |
| `eligibleSkillDigests`      | snapshot at label time                            |
| `constructedToolDigests`    | constructed server tools at label time            |
| `requiredSkillDigests`      | human gold, may be empty                          |
| `requiredToolDigests`       | human gold, may be empty                          |
| `actualInvokedSkillDigests` | optional; empty until shadow                      |
| `actualInvokedToolDigests`  | optional; empty until shadow                      |
| `sourceKind`                | `synthetic` \| `labeled_replay` \| `shadow_later` |

Do **not** ingest the P2-C 20-sample operational summary as a weight
source. Those samples may be cited only as latency/reliability
context (TTFT p50/p95 632/886 ms, first-tool 0.8, fallback 0).

A later labeled replay set must be collected under a new operator
approval. This design does not collect it.

## Recall

When gold is non-empty:

- required-skill recall = `|goldSkills ∩ candidateSkills| / |goldSkills|`
- required-tool recall = `|goldTools ∩ candidateTools| / |goldTools|`

When gold is empty, the metric is omitted (`null`). Do not guess.

Offline report also records:

- fallback rate (`LOW_CONFIDENCE_FALLBACK_FULL_PATH` / `EMPTY_ENVELOPE_FALLBACK`)
- mean candidate count
- privacy hit count (must stay 0)

## Shadow comparison (later, still apply=false)

Once shadow events exist, add:

- candidate set vs actual invoked set (digests)
- precision/recall of candidates against invoked
- cases where invoked ⊂ live authorized set but ⊄ candidates

Shadow comparison does not change injection or allowlists.

## Gate to later implementation PR

1. Offline recall functions and fixtures pass.
2. At least one labeled replay file exists (not this design task).
3. Privacy scan of that file is 0.
4. Flags still default off.
5. New PR; P2-C evidence untouched.
