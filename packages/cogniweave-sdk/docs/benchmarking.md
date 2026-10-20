# Benchmarking (MVP Runtime)

This document defines how to run repeatable runtime benchmarks for the CogniWeave MVP baseline.

## Scope

Current benchmark focuses on three metrics aligned with Technical Spec v1.4:

- reason latency
- graph query latency (relation lookup path used by reasoner)
- distillation throughput

Evaluation gate additionally tracks distillation stage quality metrics:

- `distillationStageCoverage`
- `distillationStageFallbackRate`

## Runner

- Script: `scripts/benchmark-mvp.ts`
- Eval script: `scripts/eval-mvp.ts`
- Distillation replay eval script: `scripts/eval-distillation-replay.ts`
- Diff script: `scripts/benchmark-diff.mjs`
- Baseline refresh script: `scripts/refresh-benchmark-baseline.mjs`
- Baseline validation script: `scripts/validate-benchmark-baseline-candidate.mjs`
- Package script: `pnpm --dir packages/cogniweave-sdk run benchmark:mvp`
- Long-run profile script: `pnpm --dir packages/cogniweave-sdk run benchmark:longrun`
- Nightly workflow: `.github/workflows/cogniweave-sdk-nightly.yml`
- Baseline refresh workflow: `.github/workflows/cogniweave-sdk-benchmark-baseline-refresh.yml`

## Usage

Run with defaults:

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:mvp
```

Run MVP evaluation report (writes `.runtime/cogniweave-eval-mvp.json`):

```bash
pnpm --dir packages/cogniweave-sdk run eval:mvp
```

Run MVP evaluation gate:

```bash
pnpm --dir packages/cogniweave-sdk run eval:mvp:gate
```

Run multi-call distillation replay evaluation:

```bash
pnpm --dir packages/cogniweave-sdk run eval:distill:replay
```

Run multi-call distillation replay gate:

```bash
pnpm --dir packages/cogniweave-sdk run eval:distill:replay:gate
```

Run HTTP-recorded distillation replay evaluation:

```bash
pnpm --dir packages/cogniweave-sdk run eval:distill:replay:http
```

Run HTTP-recorded distillation replay gate:

```bash
pnpm --dir packages/cogniweave-sdk run eval:distill:replay:http:gate
```

Record fresh multi-call stage snapshots from a real distillation endpoint:

```bash
COGNIWEAVE_LLM_DISTILL_ENDPOINT="https://your-distill-endpoint" \
pnpm --dir packages/cogniweave-sdk run record:distill:http
```

Dry-run recording plan without network calls:

```bash
pnpm --dir packages/cogniweave-sdk run record:distill:http:dry-run
```

Run with custom iterations and output:

```bash
pnpm --dir packages/cogniweave-sdk exec tsx scripts/benchmark-mvp.ts \
  --dataset datasets/mvp-core-eval.json \
  --warmup 5 \
  --iterations 100 \
  --output /tmp/cogniweave-benchmark.json
```

Enforce thresholds:

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:mvp:gate
```

Run long-run profile (higher sustained replay):

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:longrun
```

Run long-run gate:

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:longrun:gate
```

Run long-run diff against baseline:

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:longrun:diff
```

Run long-run diff gate:

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:longrun:diff:gate
```

Default diff gate thresholds:

- `maxReasonP95RegressionRatio = 1.5`
- `maxGraphP95RegressionRatio = 5`
- `maxDistillP95RegressionRatio = 0.75`
- `maxThroughputDropRatio = 0.4`

Generate baseline candidate from latest long-run report:

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:longrun:baseline:candidate
```

Validate candidate baseline against acceptance gate:

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:longrun:baseline:validate
```

## Default Thresholds

- `reasonLatencyMs.p95 <= 200`
- `graphQueryLatencyMs.p95 <= 50`
- `distillationThroughputOpsPerSec >= 10`

## Notes

- These are baseline guardrails for the in-memory reference runtime.
- Results should be tracked over time for regression detection, not treated as production SLOs.
- Distillation replay dataset supports two case modes:
  - `stagePlan`: synthetic stage success/failure matrix.
  - `stageSnapshotBundle`: replay from recorded stage payload snapshots (`datasets/replay-http-recordings/*.json`).
- `record-distillation-http.ts` writes:
  - stage bundles under `datasets/replay-http-recordings/generated/`
  - generated replay dataset `datasets/distillation-replay-http-recorded.generated.json`
  - recording summary `.runtime/cogniweave-record-distill-http-summary.json`
- `--profile longrun` defaults to larger warmup/iteration counts and writes report to `.runtime/cogniweave-benchmark-longrun.json`.
- Nightly job uploads long-run benchmark JSON as build artifact with 30-day retention.
- Nightly job also runs `eval:mvp:gate` and uploads `.runtime/cogniweave-eval-mvp.json`.
- Nightly job also runs `eval:distill:replay:gate` and uploads `.runtime/cogniweave-eval-distill-replay.json`.
- Nightly job also runs `eval:distill:replay:http:gate` and uploads `.runtime/cogniweave-eval-distill-replay-http.json`.
- Nightly diff gate compares current report with `datasets/benchmark-longrun-baseline.json`.
- Baseline refresh workflow is manual (`workflow_dispatch`) and emits candidate baseline artifact for review before updating committed baseline.

## Baseline Acceptance Checklist

Required checks before replacing committed baseline:

1. `benchmark:longrun:gate` must pass.
2. `benchmark:longrun:diff:gate` must pass.
3. Candidate baseline must pass validation gate:
   - profile is `longrun`
   - warmup iterations >= 30
   - measure iterations >= 1000
   - total reason ops >= 1000
   - total distillation ops >= 1000
   - distillation throughput >= 10000 ops/s
   - reason p95 <= 2ms
   - distillation p95 <= 0.25ms
4. Refresh workflow dispatch must include explicit reason.
5. Candidate artifact must be reviewed before any baseline file update PR is merged.
