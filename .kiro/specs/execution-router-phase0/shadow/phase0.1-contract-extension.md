# Phase 0.1 contract extension (plan only)

Do not enable Skill Top-K, Tool Top-K, DAG, or `ORCHESTRATION_LIVE_INVOKE`.
Do not wire these fields into the live reply path until the listed files are
taken over.

## Why Phase 0 cannot store the five entry metrics

Current `ChatRunObservation` stores counts and timestamps only:

- `skillBaseline`: `eligibleCount` / `injectedCount` / `promptChars`
- `toolBaseline`: `constructedCount` / `afterPolicyCount` / `exposedCount` / `schemaChars`
- `latencies`: `routePrepMs` / `ttftMs` / `totalMs`

It does not store Skill IDs, Tool IDs, first-tool outcome, or prompt tokens.
`SkillCandidate.name` / `ToolCandidate.name` already exist as types but must
not be written into snapshots (privacy).

## Proposed additive fields (digests only)

All IDs are `sha256(\`${kind}:${normalizedName}\`).hex.slice(0,16)`.
Never write Skill bodies, Tool names, schema, args, results, or raw sessionKey.

```ts
type Phase01SkillBaseline = SkillBaseline & {
  injectedDigests?: string[]; // max 32
};

type Phase01ToolBaseline = ToolBaseline & {
  exposedDigests?: string[]; // final allowlist, max 64
  firstToolDigest?: string;
  firstToolStatus?: "succeeded" | "failed" | "none";
};

type Phase01Usage = {
  promptTokens?: number; // existing NormalizedUsage.input only
};

type Phase01GoldLabel = {
  requiredSkillDigests: string[];
  requiredToolDigests: string[];
};
```

Gold labels stay on the collector summary, not on the live observer, until a
human-labeled catalog exists.

## Recall formulas (Phase 0.1, observation only)

- required-skill recall = `|goldSkills ∩ injectedDigests| / |goldSkills|` when gold is non-empty
- required-tool recall = `|goldTools ∩ exposedDigests| / |goldTools|` when gold is non-empty
- TTFT = existing `latencies.ttftMs`
- prompt tokens = `Phase01Usage.promptTokens` from existing attempt usage
- first-tool success = `firstToolStatus === "succeeded"`

Missing fields omit the metric. Do not guess.

## Main-chain files that would need exact-file takeover

These are **not** edited in this round:

| Field                      | Live write point                                                                             | Owner today                             |
| -------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `injectedDigests`          | `src/agents/pi-embedded-runner/run/attempt.ts` after `skillsPrompt`                          | execution-router-phase0 (already taken) |
| `exposedDigests`           | same file after `applyEmbeddedCustomToolPolicy`                                              | execution-router-phase0                 |
| `firstToolDigest` / status | `src/auto-reply/reply/session-updates.ts` or `agent-runner-execution.ts`                     | not transferred                         |
| `promptTokens`             | `EmbeddedRunAttemptResult.attemptUsage` already exists; observer write would be `attempt.ts` | execution-router-phase0                 |
| inbound gold attach        | none; collector-only                                                                         | n/a                                     |

`session-updates.ts` and `agent-runner-execution.ts` remain out of scope.
This commit records sidecar digests from attempt **inputs/results** in the
sanitized summary only.

## Default

Observation stays default-off. New fields are optional. Disabled runs must not
hash extra IDs.
