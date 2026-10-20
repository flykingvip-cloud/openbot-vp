# Tool retrieval contract

Tool Router **records candidates only**. It does not change the final
authorized Tool set.

## Input

- `TaskEnvelope`
- `constructedTools`: server tools after construction, before policy,
  each reduced to `{ nameDigest, tagDigests, sideEffect }`
- `k` (design default 8)

No Tool schemas, arguments, or results enter the envelope.

## Output

```
{
  candidates: [{ nameDigest, score, rank }],
  confidence: number,
  reasonCode: RouteReasonCode,
  apply: false
}
```

`apply` is always `false` here. Live exposure stays
`applyEmbeddedCustomToolPolicy` → `customToolAllowlist`.

## Rules

1. Candidates are scored from the **constructed** set. They are not an
   allowlist and not an execution grant.
2. **Policy is the final authority.** After-policy / exposed counts
   remain the only live authorization signal.
3. A high shadow score cannot bypass deny lists, approvals, or
   `disableTools`.
4. Low confidence falls back to the current full Tool path. The model
   still sees today's exposed set.
5. Required-tool gold labels are offline-only.
6. Production observations store Tool `nameDigest` only
   (`sha256("tool:" + normalizedName).hex.slice(0,16)`).

## Non-interference

- Do not change Tool policy.
- Do not shrink `exposedCount`.
- Do not change model selection or prompts to force Tool calls.
- Do not use P2-C first-tool success 0.8 as a routing weight.
