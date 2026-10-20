# Supply-chain review: Earendil Pi SDK 0.84.4

Date: 2026-08-29  
Evaluator: cursor (v3 worktree; independent of v2 uncommitted tree)  
Registry query: `npm view @earendil-works/<pkg>@0.84.4`  
Attestations: `https://registry.npmjs.org/-/npm/v1/attestations/@earendil-works%2f<pkg>@0.84.4`

## Pin

All four packages are pinned to exact `0.84.4` (no `^`/`~`). Mario 0.57.1 is removed together. Mixing families is forbidden.

| Package                         | Current | Candidate                                | npm latest | License | engines.node |
| ------------------------------- | ------- | ---------------------------------------- | ---------- | ------- | ------------ |
| `@mariozechner/pi-coding-agent` | 0.57.1  | `@earendil-works/pi-coding-agent@0.84.4` | 0.84.4     | MIT     | `>=22.19.0`  |
| `@mariozechner/pi-agent-core`   | 0.57.1  | `@earendil-works/pi-agent-core@0.84.4`   | 0.84.4     | MIT     | `>=22.19.0`  |
| `@mariozechner/pi-ai`           | 0.57.1  | `@earendil-works/pi-ai@0.84.4`           | 0.84.4     | MIT     | `>=22.19.0`  |
| `@mariozechner/pi-tui`          | 0.57.1  | `@earendil-works/pi-tui@0.84.4`          | 0.84.4     | MIT     | `>=22.19.0`  |

Repository for all four: `git+https://github.com/earendil-works/pi.git`.

## Integrity

| Package                | sha512 integrity                                                                                  | shasum                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| pi-coding-agent@0.84.4 | `sha512-jmOlrqUmvhh/siNWFRXjYLJzhKFIHNsAQaysRwzQPQFnPAaV/vhqHsLH/MBsIISA1Rjj7WTUFR3nJrpXoLx39w==` | `3a2f04bfc5e463b4cfa36b174a586d11a0bdf9ad` |
| pi-agent-core@0.84.4   | `sha512-HyUnjaOXj6oN/6SNcr8A1J/ElRQA50FtIE0XUTSKAQVqmdlb9qdojOyUQwF/jULE5+yOEtGuVgi/N1RnBiNG+g==` | `451e9e76b6c7fecd2a49ed5bf905f8dd6c7ce876` |
| pi-ai@0.84.4           | `sha512-AClAZxf5+c4RRu44NJPS6wyQy+Nmq+Mzyyrdvm4ZVMNuixelO02RZX4G4Aq1F145Yzp43wnM5S+hLlSI7ypfVw==` | `348f1be5c2a0f4d17cc167fe1e5a7cabb191d079` |
| pi-tui@0.84.4          | `sha512-nPUnwDkLtupPXnZQYrCwPFcuTydCDqTY6ZbFqhsL4S4kVq0AT418kPa/6uXwtaCD+MjBNBltb7ScTYX65yeE1w==` | `1b5bee5f22ba90539beaddac4e4ee7ad81c8a279` |

Canonical tarball URLs (npmjs, not a mirror):

- `https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-0.84.4.tgz`
- `https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.84.4.tgz`
- `https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-0.84.4.tgz`
- `https://registry.npmjs.org/@earendil-works/pi-tui/-/pi-tui-0.84.4.tgz`

Each package has **2** attestations: npm publish v0.1 + SLSA Provenance v1.

## extract-zip

Mario `@mariozechner/pi-coding-agent@0.57.1` depends on `extract-zip@^2.0.1` ([GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv); patched versions `<0.0.0`).

Isolated `/tmp/pi-sdk-v3-session/earendil` install of the four 0.84.4 packages: `extract-zip` is **not resolvable**. Isolated Mario 0.57.1 install pulls `extract-zip`.

No `pnpm.auditConfig.ignoreCves`, no risk waiver, no CI skip.

## Node engine note

Earendil 0.84.4 declares `engines.node >= 22.19.0`. OpenBot currently declares `>=22.12.0`; this evaluator ran session tests on Node v22.18.0 (npm printed `EBADENGINE` warnings only). Phase B does not bump OpenBot engines unless install/runtime actually fails. CI uses `22.x`.

## Inter-package alignment

Earendil coding-agent 0.84.4 depends on `@earendil-works/pi-agent-core`, `pi-ai`, and `pi-tui` at `^0.84.4`. Pinning all four to exact `0.84.4` keeps the family aligned. `extensions/matrix` currently pins `@mariozechner/pi-agent-core@0.57.1` and must move with the family.

`AuthStorage` exists in `dist/core/auth-storage.d.ts` but is **not** on the public export map (only `.`, `./rpc-entry`, `./client`). Phase B must not deep-import that path; use `ModelRuntime` + a typed `CredentialStore`.

## Verdict

**PASS.** MIT, official successor repository, provenance present, integrity recorded, `extract-zip` absent from 0.84.4, no family mix required.
