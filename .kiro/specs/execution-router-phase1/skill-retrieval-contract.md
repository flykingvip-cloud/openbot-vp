# Skill retrieval contract

Skill Router is a **candidate recall** function. It does not change the
live injected Skill set.

## Input

- `TaskEnvelope` (see `task-envelope.schema.json`)
- `eligibleSkills`: already-discovered snapshot entries, each reduced
  to `{ nameDigest, tagDigests, sideEffect }`
- `k` (design default 8)

The envelope must not carry Skill bodies or raw user text.

## Output

```
{
  candidates: [{ nameDigest, score, rank }],
  confidence: number,
  reasonCode: RouteReasonCode,
  apply: false
}
```

`apply` is always `false` in this design package. The live path keeps
injecting the current full eligible-to-prompt set.

## Rules

1. Candidates are a subset of the **current eligible** snapshot. The
   router must not invent Skills or load new Skill files.
2. Ranking is offline / shadow-only. Injection order stays today's
   `skillsPrompt` construction.
3. If confidence is low, or the envelope is empty/unknown, reason is
   `LOW_CONFIDENCE_FALLBACK_FULL_PATH` or `EMPTY_ENVELOPE_FALLBACK`.
   Live injection is unchanged.
4. Required-skill gold labels are offline-only. They are not written
   to `chat.execution_observation`.
5. Production shadow events store `nameDigest` only
   (`sha256("skill:" + normalizedName).hex.slice(0,16)`).

## Non-interference

- Do not edit Skill directories.
- Do not filter `skillsPrompt`.
- Do not change Skill policy.
- Do not use P2-C metrics as Skill weights.
