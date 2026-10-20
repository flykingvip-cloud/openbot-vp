# E0.1 Runtime Behavior Proof

This checkpoint must not change production execution.

## Unchanged paths (must stay empty in the E0.1 diff)

- `src/diagnosis/**`
- `src/gateway/evolution-control/control-plane.ts`
- `src/gateway/evolution-control/gateway-plane.ts`
- `src/gateway/evolution-governance/tick-pipeline.ts`
- `src/gateway/evolution-governance/runtime-actions.ts`
- `src/gateway/evolution-governance/skill-auto-evolution.ts`
- `src/gateway/evolution-governance/mode.ts`

No new RPC, no live diagnosis ingest, no gate/auto expansion, no production deploy.

## What this checkpoint adds

- Additive contracts and tests under `packages/evolution-core/src/*`
- Spec documents under `.kiro/specs/openbot-evolution-evaluation-closure/**`
- Re-exports from `packages/evolution-core/src/index.ts`

`EvaluationPolicy` and WAL helpers are not imported by the Gateway control plane in this commit.

## How to verify

```
git diff --name-only origin/main
```

Expect only the spec files, new evolution-core modules, their tests, and `packages/evolution-core/src/index.ts`.
