# PR #797 CI failure evidence

Collected 2026-08-29 from `gh pr view 797` and `gh run view --log-failed`.
Head at collection: `f05d660caef1f789668f627c4b0438f6ca705d14`.
Baseline `origin/main`: `959b367d7eb00545093b4d4dbcd028a48e412100`.

Source PR: https://github.com/gmood2008/openbot/pull/797

## Failed checks

| Workflow | Job          | Run                                                                          | Root cause                                                                                                                                                                                                            |
| -------- | ------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI       | secrets      | [33222015199](https://github.com/gmood2008/openbot/actions/runs/33222015199) | `pre-commit run --all-files pnpm-audit-prod` → `pnpm audit --prod --audit-level=high` exit 1. 193 vulns (16 low / 106 moderate / 68 high / 3 critical). Same findings reproduce on clean `origin/main`.               |
| CI       | check-docs   | [33222015199](https://github.com/gmood2008/openbot/actions/runs/33222015199) | `pnpm check:docs` → `markdownlint-cli2` "242 issues in 52 files". Format check passed. Neither PR #797 doc is in the error list.                                                                                      |
| Labeler  | label        | [33222015286](https://github.com/gmood2008/openbot/actions/runs/33222015286) | `actions/create-github-app-token`: first app (`2729701`) continues on error; fallback app `2971289` fails: `The 'private-key' input must be set to a non-empty string` (`secrets.GH_APP_PRIVATE_KEY_FALLBACK` empty). |
| Labeler  | label-issues | [33222015286](https://github.com/gmood2008/openbot/actions/runs/33222015286) | Same missing GitHub App private key. Not a missing-label or `.github/labeler.yml` match error.                                                                                                                        |

## secrets — critical (from `pnpm audit --prod --json` on origin/main)

| Package                   | Current    | Vulnerable                                 | Patched        | Path                                   |
| ------------------------- | ---------- | ------------------------------------------ | -------------- | -------------------------------------- |
| `@whiskeysockets/baileys` | 7.0.0-rc.9 | `>=7.0.0-rc.1 <7.0.0-rc12`                 | `>=7.0.0-rc12` | `.>@whiskeysockets/baileys`            |
| `protobufjs`              | 7.5.4      | `<7.5.5` and later highs through `<=7.6.0` | `>=7.6.1`      | `.>@larksuiteoapi/node-sdk>protobufjs` |
| `tar`                     | 7.5.11     | `<=7.5.18` / `<=7.5.20`                    | `>=7.5.21`     | `.>tar`                                |

## secrets — high packages with patches

`@grpc/grpc-js` 1.14.3→1.14.4; `@opentelemetry/sdk-node` 0.213.0→0.217.0; `@opentelemetry/exporter-prometheus` 0.213.0→0.217.0; `@opentelemetry/propagator-jaeger` 2.6.0→2.9.0; `axios` 1.13.5→1.18.0; `basic-ftp` 5.2.0→5.3.1; `brace-expansion` 5.0.4→5.0.9; `fast-uri` 3.1.0→3.1.5; `fast-xml-parser` 5.3.8→5.5.6; `form-data` 2.5.4→2.5.6; `hono` 4.12.7→4.12.25; `ip-address` 10.1.0/10.2.0→10.3.1; `linkify-it` 5.0.0→5.0.2; `lodash` 4.17.23→4.18.0; `music-metadata` 11.12.1→11.12.3; `nanoid` 3.3.11→3.3.18 and 5.1.6→5.1.16; `path-to-regexp` 0.1.12→0.1.13 and 8.3.0→8.4.0; `picomatch` 4.0.3→4.0.4; `postcss` 8.5.6→8.5.18; `sharp` 0.34.5→0.35.0; `simple-git` 3.32.3→3.36.0; `undici` 7.22.0→7.29.0 and 8.3.0→8.9.0; `vite` 7.3.1→7.3.5; `ws` 8.19.0→8.21.0.

## secrets — no patched version (stop / record)

| Package                         | Current | Patched versions | Notes                                                                            |
| ------------------------------- | ------- | ---------------- | -------------------------------------------------------------------------------- |
| `@mariozechner/pi-coding-agent` | 0.57.1  | `<0.0.0`         | GHSA-jfgx-wxx8-mp94. npm latest is 0.73.1, still inside `>=0.50.0 <=0.73.1`.     |
| `extract-zip`                   | 2.0.1   | `<0.0.0`         | GHSA-jmr9-qjv8-65gv. Transitive of pi-coding-agent. Latest remains 2.0.1 (2020). |

These two will keep `pnpm-audit-prod` red after all other high/critical bumps. No ignore rule added.

## check-docs

Command: `pnpm format:docs:check && pnpm lint:docs && pnpm docs:check-links`.
`oxfmt --check` passed (1032 files). Failure is markdownlint on the **whole** docs tree.

PR #797 files are **not** in the 242-issue list:

- `docs/design/openbot-data-storage-governance-implementation-summary-2026-08-28.md`
- `docs/design/openbot-data-storage-governance-code-review-index-2026-08-28.md`

Representative errors (already on `origin/main` after #792/#794/#799): MD024 duplicate headings, MD034 bare URLs, MD018 missing space after `#`, MD028 blank line in blockquote, MD001 heading increment, plus older design docs.

Not fixed in this security branch: would be a 52-file takeover of unrelated docs.

## Labeler

Workflow: `.github/workflows/labeler.yml`.
Not a `.github/labeler.yml` matching problem and not a missing GitHub label.
Requires repo admin to restore `GH_APP_PRIVATE_KEY` and/or `GH_APP_PRIVATE_KEY_FALLBACK`.
No workflow or ruleset change made.

## Policy

- Did not disable audit, add audit ignores, or weaken CI.
- Did not modify required checks or rulesets.
- Dependency upgrades stay on this branch, not mixed into PR #797.
