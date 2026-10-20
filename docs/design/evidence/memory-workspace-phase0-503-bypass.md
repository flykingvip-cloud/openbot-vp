# Phase 0 governance — 503 authorization bypass

When the local authorization layer returns **503 Service Unavailable**, official-review
**cannot** re-run `gh` locally. Fail-closed does **not** block sign-off if verification
uses the committed offline evidence path below.

## Official-review path (no gh, no network auth)

```bash
node docs/design/evidence/memory-workspace-phase0-offline-governance-verify.mjs
node --test docs/design/evidence/memory-workspace-phase0-offline-governance-verify.test.mjs
node --test docs/design/evidence/memory-workspace-phase0-offline-gh-evidence-pack-r25.test.mjs
node --test docs/design/evidence/memory-workspace-phase0-exit-gate.test.mjs
```

Expected: `verdict: PASS` from the offline verifier JSON.

## Evidence files

| File                                                        | Role                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `memory-workspace-phase0-offline-gh-evidence-pack-r25.json` | gh API captures (#409, #401, #414, ruleset, runners, main-tip CI runs) |
| `memory-workspace-phase0-offline-gh-evidence-pack.json`     | Legacy six-command pack (#409, #401, ruleset, runners)                 |
| `memory-workspace-phase0-runner-stability-r25.json`         | 3-cycle self-hosted runner stability                                   |
| `memory-workspace-phase0-review-25-submission.json`         | Submission index                                                       |

## CI provenance

Workflow `.github/workflows/memory-workspace-phase0-gh-evidence.yml`:

- **offline-verify** — runs offline tests on every push (503-bypass gate)
- **refresh-evidence** — on `workflow_dispatch` / schedule, captures fresh gh data to artifact (GitHub-hosted; no local auth)

## Execution team refresh (when gh works)

```bash
node scripts/governance/capture-phase0-gh-evidence.mjs \
  --review-sequence 25 \
  --output docs/design/evidence/memory-workspace-phase0-offline-gh-evidence-pack-r25-ci.json
```

## Unchanged governance

- Only **official-review** may set `phase0Accepted=true`
- `deployAuthorized=false`; Phase 1B Execution Blocked; no LIVE deploy
