# Phase 0 shadow collector

Default observation remains off. Tests turn the flag on only inside the
test process. Tests write **only** to `mkdtemp` directories.

`required-skill recall`, `TTFT`, `prompt tokens`, and `first-tool success`
from this harness are **harness calculation values**. They are not a
production baseline.

## Collect a candidate (does not write tracked files)

```bash
pnpm exec tsx .kiro/specs/execution-router-phase0/shadow/cli.ts collect \
  --output /tmp/phase0-shadow-candidate.json
```

Refuses to overwrite an existing file unless `--force` is also passed.
Refuses to write `.kiro/specs/execution-router-phase0/shadow/summary.json`.

## Accept into the repo (review step)

```bash
pnpm exec tsx .kiro/specs/execution-router-phase0/shadow/cli.ts accept \
  --input /tmp/phase0-shadow-candidate.json
```

Validates schema, source SHA, logical artifact digest, coverage, privacy,
and recomputable metrics. Only then copies the candidate to the tracked
summary and refreshes `summary.sha256`.

## Real operational performance (separate)

```bash
pnpm exec tsx .kiro/specs/execution-router-phase0/shadow/cli.ts collect-perf \
  --output /tmp/phase0-shadow-perf.json
```

This path stays pending. It must not accept harness TTFT/token numbers.

## Production identity

`sourceCommit` defaults to `origin/main`. Every production blob SHA is
`git rev-parse <sourceCommit>:<path>`. Collect and accept fail closed
unless that blob, `HEAD:<path>`, and the worktree `git hash-object`
match for every production observation module. Collector or docs WIP
does not affect that check.

## Logical artifact digest

`artifactSha256` is the SHA-256 of collector sources + production
observation-module Git blob SHAs + `sourceCommit`. `collectedAt` is not
part of that digest. The summary file has its own SHA-256.

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts \
  src/agents/pi-embedded-runner/run/execution-router-shadow-cli.test.ts \
  src/agents/pi-embedded-runner/run/execution-router-shadow-identity.test.ts \
  src/agents/pi-embedded-runner/run/execution-router-shadow-revalidate.test.ts \
  src/auto-reply/reply/execution-router-mainchain.test.ts
```

Tests save `git status --porcelain` at start and require the full
worktree to match at end. They must not write tracked evidence.
Accept is an explicit operator step outside the test process.
