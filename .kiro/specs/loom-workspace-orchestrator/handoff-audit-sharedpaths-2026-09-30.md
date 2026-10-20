# Handoff: the landing audit ignores `sharedPaths`

> **To:** owner of `.kiro/specs/loom-workspace-orchestrator/`
>
> **From:** `kiro-convergence-registry` (task `computer-network-capability-architecture`)
>
> **Date:** 2026-09-30
>
> **Ask:** one integration point in `scripts/loom/audit.ts`. No registry data changes, no new vocabulary.

---

## 1. The ask in one paragraph

`sharedPaths` already resolves, at the ownership layer, the question "who lands this shared file" — 252 registrations, each naming a `landerTask`. The landing gate then re-asks the same question at the `landingStreams` layer, answers it from declaration order, and blocks the commit when the two answers differ. `scripts/loom/audit.ts` contains zero references to `sharedPaths`. Teaching `findRiskyMix` to skip entries already covered by a `sharedPaths` registration removes the false blocks, with no measured regression.

## 2. What I got wrong first, so it is not repeated

I came at this from 208 `stream-path-duplicate` warnings and concluded the registry needed a new "shared structural paths" landing stream. I built one (`SHARED`, `landingPolicy: parallel`, declared first, claiming `.loom/registry.yaml` plus the repo manifests), measured it, then **deleted it**. Three reasons it was wrong:

1. **It already exists.** `sharedPaths` is exactly this mechanism, built and populated. `scripts/loom/lint.ts:249` already excludes the overlaps it covers.
2. **All four paths I "added" were already registered** — `.loom/registry.yaml` x2, `package.json` x3, `pnpm-lock.yaml`, `tsconfig.json`.
3. **My version was strictly worse.** I wrote `owner: unassigned`; `sharedPaths` names a `landerTask`. Mine destroyed accountability, which `AGENTS.md` section 5 treats as a first principle, and it would have shadowed the real landers.

Also wrong in that framing: **the 208 overlap warnings are not a defect.** `RegistrySchema` says so directly — `landingStreams` is _"Audit partition (landing). Overlap-OK, first-match."_ Chasing those warnings was chasing designed behavior. Nothing in this handoff proposes changing them.

The working tree has been restored; nothing from the discarded prototype remains.

## 3. The actual defect

The registry has two partitions with deliberately different rules, per `RegistrySchema`:

| Partition        | Rule                                                                             | Conflict resolution                  |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| `tasks`          | "Ownership partition (attribution + lifecycle). Exclusive: >1 match = CONFLICT." | `sharedPaths` names the `landerTask` |
| `landingStreams` | "Audit partition (landing). Overlap-OK, first-match."                            | declaration order                    |

`findRiskyMix` blocks when two or more non-`parallel` streams appear in one staging set. For a file whose ownership conflict `sharedPaths` has **already settled**, the gate still counts a second competing primary, derived from declaration order, which knows nothing about the registration.

The disagreement is concrete and currently live:

| Path                            | `sharedPaths` says lands it                         | Landing audit routes it to |
| ------------------------------- | --------------------------------------------------- | -------------------------- |
| `src/gateway/method-scopes.ts`  | `guidance-orchestrator:codex-guidance-orchestrator` | `LDRG`                     |
| `src/gateway/server-methods.ts` | `guidance-orchestrator:codex-guidance-orchestrator` | `LDRG`                     |
| `.loom/registry.yaml`           | `loom-workspace-orchestrator:kiro-loom`             | `GOV_P3_ENTRY`             |
| `package.json`                  | `tenant-context-propagation:cursor-fable`           | `WPL`                      |
| `pnpm-lock.yaml`                | `openbot-evolution-unification:cursor-evolution`    | `MRR`                      |
| `tsconfig.json`                 | `openbot-evolution-unification:cursor-evolution`    | `AOR`                      |

The failure is asymmetric and misattributed: whichever stream happens to be declared first lands fine; every other agent who legitimately touches the same file is blocked, and the error names a stream unrelated to their work.

This friction is already costing other tasks. `.kiro/specs/capability-lifecycle-closure/handoff-landing-stream-config.md` is an entire handoff document written to get four finished, passing files past the same gate.

## 4. Evidence

Measured by driving the real `deriveRules` / `classify` / `findRiskyMix` against the real registry. No files mutated, nothing staged.

| Scenario                                       | Now         | With fix |
| ---------------------------------------------- | ----------- | -------- |
| gov agent: own file + `.loom/registry.yaml`    | ok          | ok       |
| ldrg agent: own file + `.loom/registry.yaml`   | **BLOCKED** | ok       |
| ldrg agent: own file + `package.json`          | **BLOCKED** | ok       |
| ui agent: own file + `package.json` + lockfile | **BLOCKED** | ok       |
| cnca agent: own file + `package.json`          | ok          | ok       |
| ldrg: own files + shared gateway table         | ok          | ok       |
| two real feature streams collide               | ok          | ok       |
| genuinely unowned path                         | ok          | ok       |

Three false blocks removed. No scenario changes from ok to blocked. The unowned-path case stays caught by `--fail-on-unmatched`, which is a separate gate and untouched.

Independently: adding and removing the prototype left every `loom lint` finding-type count identical (738 `ownership-overlap`, 571 `stream-path-shadowed`, 228 `active-task-no-issue`, 208 `stream-path-duplicate`, 36 `impossible-glob`, 6 `duplicate-shared-glob`, 3 `active-task-no-paths`, 1 `duplicate-task-id`, 1 `dangling-can-land-with`), confirming the harness was not perturbing lint state.

## 5. Suggested shape

`findRiskyMix(classified)` takes only classified entries, so it cannot see `sharedPaths`. Both call sites already hold a `Registry`:

- `scripts/worktree-audit.ts` — `activeRegistry` is in scope where `rules` is built
- `scripts/loom/check.ts:91`

Preferred: extend `findRiskyMix` with an optional second argument and filter before `distinctStreams`, so one change serves both call sites and existing callers are unaffected.

```ts
// scripts/loom/audit.ts
export function findRiskyMix(
  classified: ClassifiedEntry[],
  sharedPaths: readonly SharedPath[] = [],
): RiskyMix | null {
  const shared = sharedPaths.map((entry) => globToRegExp(entry.glob));
  // A path with a sharedPaths lander has already had its ownership settled.
  // Re-adjudicating it here from landingStreams declaration order is what
  // produces the false block, so it must not contribute a competing primary.
  const competing = classified.filter((entry) => !shared.some((re) => re.test(entry.path)));
  const active = distinctStreams(competing);
  // ...unchanged from here
}
```

Deliberately **not** proposed: changing classification itself. Each file should keep resolving to exactly one landing stream for reporting and attribution; only the primary-competition count changes.

Test surface already exists: `scripts/__tests__/loom/audit.test.ts` has six `findRiskyMix` cases to extend, plus `scripts/__tests__/loom/repo-agnostic.test.ts`.

## 6. Interaction with the existing plan

`.loom/README.md` tracks promoting `loom check --strict` from warn-only to a required CI check after a clean observation window. Two notes:

- `loom lint --strict` currently exits non-zero on pre-existing findings, including 36 `impossible-glob` and one each of `duplicate-task-id` and `dangling-can-land-with`. Those look like they want triage before strict becomes required, independent of this change.
- This change alters `findRiskyMix`, which `check.ts` uses for its parity verdict. It should land before the promotion, or the observation window restarts.

Related low-priority observation, not part of the ask: `exclusive` and `serial` are indistinguishable to the gate. `findRiskyMix` only special-cases `parallel` (exempt) and `manual` (must land alone); the other two are both just "primary". 107 of 117 streams carry one of two labels the enforcement cannot tell apart, which invites the incorrect assumption that `exclusive` confers a stronger guarantee.

## 7. Risk

Low and reversible. It relaxes exactly one thing: two agents editing the same `sharedPaths`-registered file in one window are no longer forced to serialize. For append-only registration tables and manifests that is the intended behavior — correctness there rests on types, tests and git conflict resolution, not on landing order. Any file that genuinely requires serialization should not carry a `sharedPaths` registration in the first place, and `reviewAfter` exists to force periodic re-examination of that judgment.

## 8. Open questions

1. Optional parameter on `findRiskyMix`, or a sibling function plus call-site filtering?
2. Should `summarizeByRule` and the printed report mark shared entries, so the manifest shows why a file did not count as a primary?
3. Are the duplicate registrations (`package.json` x3, `.loom/registry.yaml` x2, and three `.kiro` / `docs` handoff docs) worth collapsing, or is `duplicate-shared-glob` acceptable as a standing warning?

I have not modified `scripts/loom/**`. My only registry edit was removing one path from my own `CNCA` stream, which was shadowing the shared registry file for 26 other streams. Happy to implement the change above if you would rather delegate it.
