# Handoff: PR797 CI 与生产依赖安全整改

Owner: cursor
Branch: `cursor/pr797-ci-security-remediation`
Base: `origin/main` `959b367d7eb00545093b4d4dbcd028a48e412100`
Worktree: isolated, clean at start.
Task: `pr797-ci-security-remediation:cursor`

This is an **independent security PR** (#800). It does **not** mix into PR #797.
Link this PR from the #797 handoff after it exists. Do not rebase #797 until this lands on main (or Codex decides otherwise).

## 1. Files changed

- `.kiro/specs/pr797-ci-security-remediation/tasks.md`
- `.kiro/specs/pr797-ci-security-remediation/ci-failure-evidence.md`
- `.kiro/specs/pr797-ci-security-remediation/codex-handoff.md`
- `.loom/registry.yaml` (task row only)
- `package.json` (direct deps + `pnpm.overrides`)
- `pnpm-lock.yaml`
- `ui/package.json` (`vite` 7.3.1 → 7.3.5)
- `extensions/diagnostics-otel/package.json` (OTel 0.213/2.6 → 0.217/2.9)
- `extensions/matrix/package.json` (`music-metadata` 11.12.1 → 11.12.3)

## 2. Vulnerability remediations

| Package                              | Was             | Fix                                  | Path                                 | Verify                                        |
| ------------------------------------ | --------------- | ------------------------------------ | ------------------------------------ | --------------------------------------------- |
| `@whiskeysockets/baileys`            | 7.0.0-rc.9      | 7.0.0-rc12                           | direct                               | lock has `@whiskeysockets/baileys@7.0.0-rc12` |
| `protobufjs`                         | 7.5.4           | override 7.6.1                       | `@larksuiteoapi/node-sdk>protobufjs` | lock has `protobufjs@7.6.1`                   |
| `tar`                                | 7.5.11          | 7.5.21 + override                    | direct                               | lock updated                                  |
| `vite`                               | 7.3.1           | 7.3.5                                | `ui>vite`                            | lock has `vite@7.3.5`                         |
| `basic-ftp`                          | 5.2.0           | override 5.3.1                       | `pi-ai>proxy-agent>…>basic-ftp`      | lock has `basic-ftp@5.3.1`                    |
| `axios`                              | 1.13.5          | override 1.18.0                      | `@larksuiteoapi/node-sdk>axios`      | covers GHSA-gcfj-64vw-6mp9                    |
| `hono`                               | 4.12.7          | 4.12.25 + override                   | direct                               | CORS advisory                                 |
| `form-data`                          | 2.5.4           | override 2.5.6                       | existing override bump               | CRLF                                          |
| `fast-xml-parser`                    | 5.3.8           | override 5.5.6                       | existing override bump               |                                               |
| `ws`                                 | 8.19.0          | 8.21.0 + override                    | direct                               | GHSA-96hv-2xvq-fx4p                           |
| `undici`                             | 7.22.0 / 8.3.0  | `undici@7` 7.29.0, `undici@8` 8.9.0  | direct + dingtalk                    |                                               |
| `@grpc/grpc-js`                      | 1.14.3          | override 1.14.4                      | diagnostics-otel → sdk-node          |                                               |
| `@opentelemetry/sdk-node`            | 0.213.0         | 0.217.0                              | diagnostics-otel                     |                                               |
| `@opentelemetry/exporter-prometheus` | 0.213.0         | override 0.217.0                     | via sdk-node                         |                                               |
| `@opentelemetry/propagator-jaeger`   | 2.6.0           | override 2.9.0                       | via sdk-node                         |                                               |
| `brace-expansion`                    | 5.0.4           | override 5.0.9                       | discord voice → glob                 |                                               |
| `fast-uri`                           | 3.1.0           | override 3.1.5                       | `ajv>fast-uri`                       |                                               |
| `ip-address`                         | 10.1.0 / 10.2.0 | override 10.3.1                      | transitive                           |                                               |
| `linkify-it`                         | 5.0.0           | override 5.0.2                       | `markdown-it`                        |                                               |
| `lodash`                             | 4.17.23         | override 4.18.0                      | transitive                           |                                               |
| `music-metadata`                     | 11.12.1         | 11.12.3                              | extensions/matrix                    |                                               |
| `nanoid`                             | 3.3.11 / 5.1.6  | `nanoid@3` 3.3.18, `nanoid@5` 5.1.16 | matrix postcss / others              |                                               |
| `path-to-regexp`                     | 0.1.12 / 8.3.0  | `0.1.13` / `8.4.0`                   | express / slack bolt                 |                                               |
| `picomatch`                          | 4.0.3           | override 4.0.4                       | `ui>vite`                            |                                               |
| `postcss`                            | 8.5.6           | override 8.5.18                      | matrix sanitize-html                 |                                               |
| `sharp`                              | 0.34.5          | ^0.35.0 (resolved 0.35.4)            | direct                               | native libvips advisories                     |
| `simple-git`                         | 3.32.3          | override 3.36.0                      | `node-llama-cpp`                     |                                               |

Commands:

```sh
pnpm audit --prod --audit-level=high --registry https://registry.npmjs.org
```

Before: `193 vulnerabilities` / `68 high` / `3 critical`.
After: `45 vulnerabilities` / `2 high` / `0 critical`.

### Remaining high (no patched version)

| Package                         | Current | Patched  | Advisory                                                                 | Why not changed                                                                                                                                      |
| ------------------------------- | ------- | -------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mariozechner/pi-coding-agent` | 0.57.1  | `<0.0.0` | [GHSA-jfgx-wxx8-mp94](https://github.com/advisories/GHSA-jfgx-wxx8-mp94) | npm latest 0.73.1 still in `>=0.50.0 <=0.73.1`. Package deprecated toward `@earendil-works/pi-coding-agent` (rename, not a min patch). Not migrated. |
| `extract-zip`                   | 2.0.1   | `<0.0.0` | [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) | Latest still 2.0.1 (2020). Transitive of pi-coding-agent.                                                                                            |

No audit ignore, no CI skip, no severity downgrade.

`pnpm-audit-prod` will still fail until those two have upstream patches or an approved successor migration.

## 3. CI failure root causes

Evidence: `.kiro/specs/pr797-ci-security-remediation/ci-failure-evidence.md`

- **CI / secrets**: production audit on **main**, not unique to PR #797 docs. Fixed all patchable high/critical on this branch.
- **CI / check-docs**: `markdownlint-cli2` 242 issues in 52 files. PR #797's two governance docs are **not** in the list. Trunk-wide design-doc debt. Not bulk-edited here.
- **Labeler / label** and **label-issues**: GitHub App `private-key` secret empty (`GH_APP_PRIVATE_KEY` / `GH_APP_PRIVATE_KEY_FALLBACK`). Not a labeler.yml or missing-label bug.

## 4. Infra / permissions — not modified

- Did not restore GitHub App secrets.
- Did not edit `.github/workflows/labeler.yml` or required checks.
- Did not edit rulesets.
- Did not force-push or merge.
- Did not claim `package.json` / `pnpm-lock.yaml` / `ui/package.json` in Loom (already multi-owned hot files). Scope declared in `tasks.md` Agents.

## 5. Gates

| Gate                                            | Result                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `git status --short` at start                   | empty                                                                              |
| `git merge-base --is-ancestor origin/main HEAD` | yes                                                                                |
| `pnpm install --lockfile-only`                  | success                                                                            |
| `pnpm audit --prod --audit-level=high`          | 0 critical; 2 unpatched high recorded                                              |
| `git diff --check`                              | clean                                                                              |
| `oxfmt` / `oxlint` / `tsgo`                     | no TS/runtime source edits; JSON/YAML/MD only. Did not claim runtime tests passed. |
| Related tests                                   | not run (lockfile/manifest only)                                                   |

## 6. PR identity

- Security PR: https://github.com/gmood2008/openbot/pull/800
- Head SHA: `796f825774e910eba16dd82511999fa0cd6e9777`
- PR #797 remains `codex/openbot-data-governance-implementation-summary` / `f05d660cae…` until rebased onto a main that contains #800.

## 7. Declarations

- Did **not** bypass branch protection.
- Did **not** modify required checks or rulesets.
- Did **not** deploy production.
- Did **not** claim PR #797 Accepted.
- Did **not** mix this lockfile into PR #797.
- Did **not** add audit ignores or disable `secrets` / `check-docs` / Labeler.

Waiting for Codex review.

## 8. Recheck 2026-08-29 09:21 (Changes Required)

Reviewer evidence (`baileys 7.0.0-rc.9`, `tar 7.5.11`, `vite 7.3.1`, `basic-ftp 5.2.0`) is from **PR #797 / then-main**, not from this security branch. #797 was docs-only and is now **MERGED** (`beab22ed37542cb5a4ba512807ba5907f317f0b8`, 2026-08-29T01:20:00Z). This agent did not merge it and does **not** approve it or any production deploy.

On `cursor/pr797-ci-security-remediation` (this PR), the named packages are already patched:

| Package                   | Reviewer cited | This branch    | Path                                                              |
| ------------------------- | -------------- | -------------- | ----------------------------------------------------------------- |
| `@whiskeysockets/baileys` | 7.0.0-rc.9     | **7.0.0-rc12** | direct `package.json` + lock `@whiskeysockets/baileys@7.0.0-rc12` |
| `tar`                     | 7.5.11         | **7.5.21**     | direct + override; lock `tar@7.5.21`                              |
| `vite`                    | 7.3.1          | **7.3.5**      | `ui/package.json`; lock `vite@7.3.5`                              |
| `basic-ftp`               | 5.2.0          | **5.3.1**      | override; lock `basic-ftp@5.3.1`                                  |
| `protobufjs`              | need 7.5.5+    | **7.6.1**      | override; lock `protobufjs@7.6.1` via `@larksuiteoapi/node-sdk`   |

Re-ran `pnpm audit --prod --audit-level=high --registry https://registry.npmjs.org`:

- 0 critical
- **2 high remain**, both `patched_versions: <0.0.0` (no upstream patch): `@mariozechner/pi-coding-agent@0.57.1` (GHSA-jfgx-wxx8-mp94), `extract-zip@2.0.1` (GHSA-jmr9-qjv8-65gv)
- Therefore **high/critical is not zero**. `CI / secrets` will still fail. No ignore added.

`origin/main` was merged into this branch (no force-push) so ancestry holds after #797 landed.

**Cannot approve PR #797, cannot approve this PR, cannot deploy production.** Labeler still fails on missing GitHub App private-key secret. `check-docs` trunk debt is unchanged.
