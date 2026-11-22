# Batch A3 — minimal control experiment (PENDING AUTH) — 2026-10-31

**Status: prepared, not authorized, not executed.**

Goal: see whether a trivial GitHub-hosted job obtains a runner (`runner_id≠0`, non-empty steps, downloadable logs).
**A3 alone cannot close H1 (minutes exhaustion).** H1 still needs org Billing UI export/screenshot or an annotation that explicitly states billing/minutes block.

## Defaults / registration

| Item                                       | Value                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow file (proposed)                   | `.github/workflows/audit-a3-runner-probe.yml`                                                                                                                                                                                                                                                                                                     |
| Trigger                                    | `workflow_dispatch` only (no `push`/`pull_request`)                                                                                                                                                                                                                                                                                               |
| **Default-branch registration (required)** | GitHub requires the workflow file to exist on the repository **default branch** before `workflow_dispatch` can be triggered. See [Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow): “To trigger the `workflow_dispatch` event, your workflow must be in the default branch.” |
| `--ref` / Branch dropdown                  | Selects which branch/SHA the **run** checks out / executes against. **`--ref` does not replace default-branch registration.** A workflow that exists _only_ on a feature branch is **not** reliably dispatchable via `gh workflow run … --ref <branch>`.                                                                                          |
| Authorized path (still PENDING AUTH)       | (1) Owner-authorized minimal change that lands **only** the probe workflow YAML on `main` (default), then (2) `gh workflow run audit-a3-runner-probe.yml --ref <exact-full-SHA>` to pin the run checkout. Do not treat feature-branch presence alone as enough.                                                                                   |
| Exact ref SHA                              | Record the full SHA used with `--ref` (and workflow file SHA256) in evidence before run; never “latest main” loosely                                                                                                                                                                                                                              |
| `runs-on`                                  | `ubuntu-latest`                                                                                                                                                                                                                                                                                                                                   |
| Job body Exp-1                             | single step `run: echo ok && uname -a && date -u`                                                                                                                                                                                                                                                                                                 |
| Permissions                                | `contents: read`                                                                                                                                                                                                                                                                                                                                  |

## Cost ceiling

- Max **2** `workflow_dispatch` attempts (Exp-1, optional Exp-2).
- Job `timeout-minutes: 5` each ⇒ **at most ~10 minutes of billed job execution budget** (Exp-1 + Exp-2 combined).
- **Queue / pending wait is separate** from that ~10-minute job budget and is not additional billed job minutes in the same sense; still apply the wall-clock stop below so we do not wait forever.
- Wall-clock stop: if Exp-1 sits `queued`/`pending` with `runner_id=0` / empty steps for **10 minutes** wall clock — capture JSON and **stop** (do not retry-spam). This stop condition is **not** an extra 10 minutes of job budget.
- No matrix, no reusable workflows, no services, no cache warming.

### Exp-2 execution policy

- **Exp-2 runs only if Exp-1 obtains a runner** (`success` with `runner_id≠0` and downloadable logs).
- Even then, Exp-2 is **optional** (checkout probe). **Default after Exp-1 success: stop** unless the owner explicitly asks to spend the second ≤5 minutes on Exp-2.
- If Exp-1 reproduces Batch A class (`startup_failure` / `steps=[]` / `runner_id=0` / log 404) → **do not** run Exp-2.

## Stop conditions

1. Exp-1 reaches `success` with `runner_id≠0` and log downloadable → stop (unless owner asks for Exp-2); report “runner obtainable”; H1 still open.
2. Exp-1 terminal `startup_failure` / failure with `steps=[]` / `runner_id=0` / log 404 → stop; report Batch A class reproduced; H1 still **待验证**; skip Exp-2.
3. Any unexpected write to `main`, ruleset, billing, or production host → abort immediately.

## Exp-2 (only if Exp-1 got a runner **and** owner asks)

- Same workflow job + `actions/checkout@v4` with `fetch-depth: 1`.
- Distinguishes “have runner” vs “clone/network fail”.

## Evidence retention

- Save under `docs/notes/infrastructure-audit-2026-10-31/a3-evidence/<run_id>/`:
  - `run.json` (`gh api repos/.../actions/runs/<id>`)
  - `jobs.json` (jobs+steps)
  - `attempt-log.txt` or note of log 404
  - `dispatch-ref.txt` (full SHA + workflow file SHA256 + confirmation workflow was registered on default branch)
- Do not delete the workflow file until owner confirms; then remove in a follow-up PR.

## Non-goals

- Not a minutes counter; not Billing API substitute.
- No ruleset/spending/runner-group changes; no DIGEST; no LIVE mutate.
- Cannot alone close H1.
