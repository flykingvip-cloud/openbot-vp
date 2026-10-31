# Batch B — local merge gate fail-closed (2026-10-31 Asia/Shanghai)

## Intent
Make the local CI Gate substitute honest: never PASS on a stale/unreachable `origin/main`, and stop calling the script a full equivalent of remote CI Gate.

## Changes
1. `scripts/ci-local-merge-gate.sh`
   - Remove `git fetch origin main ... || true`
   - Fetch failure → exit 3 + `result=blocked`
   - `merge-base --is-ancestor` base→candidate required; else blocked
2. `docs/reference/ci-local-merge-gate.md`
   - Partial coverage / gaps listed
   - Status vocabulary: passed / blocked / partial
   - Outage notes: 2026-08 + 2026-10-31 audit; `#289` may be inaccessible
3. `.github/workflows/ci-gate.yml` header comments only
   - Stop claiming current `ci.yml` is still Blacksmith-bound
   - Keep minutes exhaustion → local substitute guidance

## Not in this PR
- Billing / spending-limit changes
- Runner label / self-hosted registration
- Ruleset edits
- A3 control workflow dispatch
- Volume prune / Tier 2 disk cleanup

## Verification (author)
- `bash -n scripts/ci-local-merge-gate.sh`
- Review diff for absence of `|| true` on the fetch line
- Codex acceptance separate
