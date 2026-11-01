# Batch B — local merge gate fail-closed (2026-10-31)

## Intent
Make the local CI Gate substitute honest: never PASS on a stale/unreachable
`origin/main`, never let an older `--base` bypass trunk ancestry, and never self-report
`passed` when absolute gates were skipped.

## Changes
1. `scripts/ci-local-merge-gate.sh`
   - Fail closed on `git fetch origin main`
   - Always require freshly fetched `origin/main` ∈ ancestors(candidate)
   - Still require chosen `--base` ∈ ancestors(candidate)
   - `--skip-absolute` / dirty tree / `HEAD != candidate` → `result=partial` with lists
   - Only emit `result=passed` when absolute gates ran and checkout matches candidate
2. `scripts/ci-local-merge-gate.test.ts` — real temp git repos + stubbed pnpm/node
3. `docs/reference/ci-local-merge-gate.md` — partial coverage; observed vs hypothesis
4. `.github/workflows/ci-gate.yml` — comment-only; empty-steps observed, billing not asserted

## Verification
- `bash -n scripts/ci-local-merge-gate.sh`
- `pnpm vitest run scripts/ci-local-merge-gate.test.ts`
- Codex independent acceptance (this agent does not declare PASS)
