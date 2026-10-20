# PR #402 CI triage (2026-10-07 CST)

Tip after rebase + oxfmt: `5c3ca68a3` on `app/stage52-desktop-web-shell-adr` (onto `main` @ `613733bef`).

## Fixed on this branch (in-scope)

| Step | Result |
| --- | --- |
| Rebase onto current `main` | Done |
| `oxfmt` Stage 52 architecture markdown | Done — `format:docs:check` **passes** inside check-docs |
| Evidence commit | `5c3ca68a3` |

## Observed on tip `5c3ca68a3`

| Check | Status | Root cause | In #402 scope? |
| --- | --- | --- | --- |
| docs-scope / actionlint / no-tabs / label | PASS | — | — |
| **format:docs:check** (oxfmt) | PASS | ADR docs formatted | Yes — fixed |
| **check-docs** (overall) | FAIL | `lint:docs` markdownlint: ~369 errors / ~114 files under `docs/channels/*`, `docs/design/**` (handoffs). **No** Stage 52 ADR paths in the error list | No — main docs debt |
| **check (types, lint, format)** | FAIL | `oxfmt --check` → `scripts/sandbox-browser-start.html` only | No — main (also fails on `main` CI Gate) |
| **delivery guard** | FAIL | ledger `open-interval` / open LIVE seq **112** (double-open with 109) | No — main; **#407** closes this (delivery guard already PASS on #407) |
| **secrets** | FAIL | `pnpm audit --prod --audit-level=high`: simple-git (via node-llama-cpp) critical/high; axios etc. | No — main; **#407** reduces advisories but simple-git stays 3.36.0 (v4 breaks node-llama-cpp postinstall) |
| **freeze + phase0** | FAIL | trusted freeze: `addedProductionCallSites` + `addedProductionHelpers` vs baseline blob `03efd61dd855ce3c66bd57d8393a0727f6f28c65` | No — main tip identical failure; **not** in #407 |

Confirmed: `main` @ `613733bef` CI Gate = fail (delivery + format); Memory Workspace Freeze = fail.

## Unblock (do not duplicate #407)

1. Land **#407** `fix(ci): main format + delivery ledger + pnpm audit` — format HTML + delivery ledger; secrets may stay red until simple-git story resolved.
2. Separate: freeze baseline refresh / call-site retirement (or waive for docs-only PRs).
3. Separate: markdownlint debt (`docs/design/**` / channels) or ignore-policy — blocks **every** PR’s check-docs today.
4. Rebase #402 onto post-#407 `main`, re-poll.

**Do not merge #402 or #408** until Daniel’s CI-green rule is met or explicitly waived.
