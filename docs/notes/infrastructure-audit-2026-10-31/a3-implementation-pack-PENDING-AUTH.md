# A3 implementation pack — PENDING AUTH — 2026-10-31

**Status: reviewable pack only. Not authorized. Not executed. Do not merge YAML to default. Do not `workflow_dispatch` / `gh workflow run`.**

Based on the Codex-accepted corrected plan at #172 tip `d189e74f`
(`docs/notes/infrastructure-audit-2026-10-31/a3-control-experiment-plan-PENDING-AUTH.md`)
and GitHub docs:
[Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## STOP — scheme acceptance ≠ authorization

| Gate | Meaning |
|---|---|
| Pack / PR review green | Documents + proposed YAML are reviewable |
| Owner explicit merge auth | Required before landing YAML on **default branch** |
| Owner explicit run auth | Required before any `gh workflow run` / UI dispatch |
| Exp-2 | Default **off**; needs a **separate** explicit owner instruction after Exp-1 got a runner |

- **Do not merge this PR (or the YAML) without owner go-ahead.**
- **Do not treat feature-branch-only YAML as dispatchable.** `workflow_dispatch` requires the workflow file on the repository **default branch** for registration; `--ref` only pins the run checkout and **does not** replace registration.
- **A3 alone cannot close H1** (minutes exhaustion). H1 still needs Billing UI evidence or an annotation that explicitly states billing/minutes block.

## Proposed workflow (this PR, feature branch only)

Path: `.github/workflows/audit-a3-runner-probe.yml`

| Field | Value |
|---|---|
| Trigger | `workflow_dispatch` **only** (no `push` / `pull_request` / schedule) |
| Permissions | `contents: read` |
| `runs-on` | `ubuntu-latest` |
| `timeout-minutes` | `5` |
| Exp-1 body | single step `run: echo ok && uname -a && date -u` |
| Secrets | **none** |
| Production / DIGEST / SSH / billing / ruleset / runner-group | **none** |
| Exp-2 in this YAML | **not included** (default off; separate auth if ever added) |

Full proposed file is committed on this feature branch for review. Merging it to `main` is a **separate authorization**.

### Full proposed YAML (verbatim)

```yaml
# PENDING AUTH — do NOT merge to default branch without explicit owner authorization.
# PENDING AUTH — do NOT workflow_dispatch / gh workflow run without explicit owner authorization.
# Feature-branch presence alone does NOT register workflow_dispatch (must exist on default branch).
# A3 alone cannot close H1 (Actions minutes exhaustion). See:
#   docs/notes/infrastructure-audit-2026-10-31/a3-implementation-pack-PENDING-AUTH.md
name: Audit A3 runner probe

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  exp1-echo:
    name: Exp-1 trivial echo (runner obtainability)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Exp-1 echo
        run: echo ok && uname -a && date -u
```

## Default-branch registration steps (authorized path only)

After **explicit owner authorization to land YAML on default**:

1. Merge **only** `.github/workflows/audit-a3-runner-probe.yml` (plus this docs pack if desired) onto the repository default branch (`main`).
2. Confirm registration: `gh workflow list --repo flykingvip-cloud/openbot-vp` shows `Audit A3 runner probe` / `audit-a3-runner-probe.yml` as active on default.
3. Record workflow file SHA256 on default:
   `gh api repos/flykingvip-cloud/openbot-vp/contents/.github/workflows/audit-a3-runner-probe.yml?ref=main --jq .sha`
4. Choose exact full commit SHA for run checkout (not “latest main” loosely). Write it to evidence `dispatch-ref.txt` **before** dispatch.
5. Only after a **second** explicit owner authorization to **run**:
   `gh workflow run audit-a3-runner-probe.yml --ref <exact-full-SHA>`
6. Capture run id immediately; do not spam retries.

**If YAML exists only on a feature branch:** do **not** expect `gh workflow run … --ref <feature>` to work. That is not a substitute for default-branch registration.

## Expected permissions, pinned ref, evidence fields

### Permissions
- Workflow: `contents: read` only.
- Operator: repo Actions read + workflow dispatch capability; no org billing write; no ruleset change; no production SSH.

### Pinned ref procedure
1. `REF=$(git rev-parse <chosen-commit>)` — full 40-char SHA.
2. Confirm tree contains the intended probe YAML content (or accept that checkout SHA is independent of registration SHA — record both).
3. `gh workflow run audit-a3-runner-probe.yml --ref "$REF"`
4. Save `dispatch-ref.txt` with: default-branch workflow blob SHA, `--ref` full SHA, operator, Asia/Shanghai timestamp, auth ticket/quote.

### Evidence directory (after an authorized run — not now)

`docs/notes/infrastructure-audit-2026-10-31/a3-evidence/<run_id>/`

| File | Source |
|---|---|
| `run.json` | `gh api repos/flykingvip-cloud/openbot-vp/actions/runs/<id>` |
| `jobs.json` | jobs + steps (`runner_name` / `runner_id`) |
| `attempt-log.txt` | `gh run view --log` or note of log 404 |
| `dispatch-ref.txt` | full `--ref` SHA + workflow file SHA256 + default-branch registration confirmation |
| `classification.txt` | one of the failure/success classes below |

## Cost ceiling and stop conditions

### Budget
- Max **2** `workflow_dispatch` attempts in the whole A3 series (Exp-1 + optional Exp-2).
- Each job `timeout-minutes: 5` ⇒ **at most ~10 minutes of billed job execution budget** combined.
- **Queue / pending wait is separate** from that ~10-minute job budget.
- Wall-clock queue stop: if Exp-1 remains `queued`/`pending` with `runner_id=0` / empty steps for **10 minutes** wall clock → capture JSON and **stop** (no retry-spam). This stop is **not** extra job-minute budget.

### Exp-1 stop outcomes
1. `success` with `runner_id≠0` and downloadable logs → **stop by default**; report “runner obtainable”; **H1 still open**.
2. Terminal `startup_failure` / failure with `steps=[]` / `runner_id=0` / log 404 → **stop**; Batch A class reproduced; **H1 still 待验证**; **skip Exp-2**.
3. Any unexpected write to `main`, ruleset, billing, runner groups, or production host → **abort immediately**.

### Exp-2 policy (default not run)
- Exp-2 runs **only if** Exp-1 obtained a runner **and** the owner gives a **separate explicit** instruction to spend the second ≤5 minutes.
- Default after Exp-1 success: **do not** run Exp-2.
- If Exp-1 reproduces Batch A class → **do not** run Exp-2.
- Exp-2 design (not in this YAML until separately authorized): same job + `actions/checkout@v4` with `fetch-depth: 1` to separate “have runner” from “clone/network fail”.

## Cleanup plan

After owner confirms evidence is retained:

1. Open a follow-up PR that **deletes** `.github/workflows/audit-a3-runner-probe.yml` from default (and feature branches if still present).
2. Do not leave a dispatchable probe on default longer than needed.
3. Keep `a3-evidence/<run_id>/` notes; do not delete evidence when removing the workflow.

## Failure classification (for an authorized run)

| Class | Signals | H1 impact |
|---|---|---|
| `runner-obtained` | `success`, `runner_id≠0`, non-empty steps, logs downloadable | Does **not** close H1; only shows capacity path works |
| `batch-a-class` | `startup_failure` / `steps=[]` / `runner_id=0` / log 404 | Consistent with prior Batch A; H1 still 待验证 |
| `queued-timeout` | wall-clock ≥10 min pending/queued, no runner | Stop; H1 still 待验证 |
| `authz-or-disabled` | workflow missing on default / Actions disabled / 403-class | Environment limit; not minutes proof |
| `unexpected` | any other terminal state | Capture raw JSON; do not reinterpret as H1 close |

## Non-goals (unchanged)

- Not a minutes counter; not Billing API substitute.
- No ruleset / spending / runner-group / DIGEST / LIVE mutate.
- No automatic push/PR triggers on the probe.
- No secrets; no production access.
- Pack acceptance by Codex ≠ merge auth ≠ run auth.

## Baseline for this pack PR

| Item | Value |
|---|---|
| Base | `origin/main` |
| Base SHA at branch creation | `0e4d269615e26909bbac606f1dfb755b3511400c` |
| Branch | `audit/a3-implementation-pack-PENDING-AUTH-20261031` |
| Related open PRs (do not stack) | #171, #172, #173, #174 |
| Executed? | **No** |
| Merged to default? | **No** (must not, without owner auth) |

## Files in this pack

1. `.github/workflows/audit-a3-runner-probe.yml` — proposed probe (feature branch only)
2. `docs/notes/infrastructure-audit-2026-10-31/a3-implementation-pack-PENDING-AUTH.md` — this document
3. `.loom/registry.yaml` — task + landingStream for the above paths
