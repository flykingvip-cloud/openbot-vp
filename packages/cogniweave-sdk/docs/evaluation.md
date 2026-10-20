# Evaluation Baseline (MVP)

This package ships a minimal evaluation dataset and runner to validate core runtime behavior before expansion.

## Assets

- Dataset: `datasets/mvp-core-eval.json`
- Runner: `scripts/eval-mvp.ts`
- Benchmark: `scripts/benchmark-mvp.ts`
- Script: `pnpm --dir packages/cogniweave-sdk run eval:mvp`
- Gate script: `pnpm --dir packages/cogniweave-sdk run eval:mvp:gate`

## Report Metrics

The runner emits:

- `taskTypeAccuracy`
- `atomPrecision`
- `atomRecall`
- `atomSchemaCorrectness`
- `reasoningHitRate`
- `explainabilityCoverage`

## Usage

```bash
pnpm --dir packages/cogniweave-sdk run eval:mvp
```

CI:

- `cogniweave-sdk-core-gate` executes `eval:mvp:gate` as part of the core-quality gate.

Optional output file:

```bash
pnpm --dir packages/cogniweave-sdk exec tsx scripts/eval-mvp.ts \
  --dataset datasets/mvp-core-eval.json \
  --output /tmp/cogniweave-eval.json
```

Threshold gate (defaults):

```bash
pnpm --dir packages/cogniweave-sdk run eval:mvp:gate
```

Default minimums:

- `taskTypeAccuracy >= 0.80`
- `atomPrecision >= 0.75`
- `atomRecall >= 0.50`
- `atomSchemaCorrectness >= 0.90`
- `reasoningHitRate >= 0.70`
- `explainabilityCoverage >= 0.70`

## Performance Benchmark

The benchmark runner validates execution characteristics for the core runtime path.

Script:

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:mvp
```

Optional output:

```bash
pnpm --dir packages/cogniweave-sdk exec tsx scripts/benchmark-mvp.ts \
  --dataset datasets/mvp-core-eval.json \
  --iterations 50 \
  --warmup 5 \
  --output /tmp/cogniweave-benchmark.json
```

Threshold gate (defaults):

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:mvp:gate
```

Default benchmark thresholds:

- `reasonLatencyMs.p95 <= 200`
- `graphQueryLatencyMs.p95 <= 50`
- `distillationThroughputOpsPerSec >= 10`

## Notes

- Current metrics are baseline values from the reference in-memory runtime.
- Current baseline snapshot (2026-04-08, `datasets/mvp-core-eval.json`):
  - `taskTypeAccuracy`: `1.00`
  - `atomPrecision`: `0.9583`
  - `atomRecall`: `1.00`
  - `atomSchemaCorrectness`: `1.00`
  - `reasoningHitRate`: `1.00`
  - `explainabilityCoverage`: `1.00`
- Use this report as a regression guard, not as a final quality target.
