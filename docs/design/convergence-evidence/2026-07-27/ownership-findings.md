# Ownership findings from the trunk restoration (2026-07-27)

Three attribution problems surfaced while making `main` the sole trunk. None can be fixed by the
agent that found them; each needs its rightful owner. Recorded here so they are not lost.

## 1. `deploy/production/RELEASE_RECORD.md` is claimed by five tasks

```
enterprise-ai-model-governance:codex-production-release
enterprise-data-capability-ia-redesign:codex-production-v114
enterprise-ui-baseline:codex-v111-recovery
platform-pricing-gateway-instability:codex-v112-platform-recovery
wecom-bundled-plugin-loading:codex-v113-wecom-integrity
```

`pnpm loom lint` reports this as six of its eight `ownership-overlap` warnings — the repo's own
tooling had already flagged it. It is the machine-visible form of the same defect that produced two
divergent copies of this file differing by 1123 insertions / 219 deletions, and that made merge-back
of the running commit fail with a conflict.

**Structural half is done:** authority moved to `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` plus the
`provenance/sha-*` tags, and the Markdown file now declares itself the human view. **Attribution half
is not:** five tasks still claim write ownership of a file that should have one owner, or none because
it is generated.

**Needs:** the five owners to drop the claim, or one of them to take it. Deliberately not reassigned
unilaterally — reassigning another agent's claim is exactly the behaviour the ownership rules forbid.

## 2. `.loom/registry.yaml` has diverged between the trunk and the shared worktree

The copy on `origin/main` and the copy in the shared worktree differ by **2546 diff lines**, and they
disagree on task ordering from the very first entry, so they descend from different lineage states
rather than one being a superset.

Consequence: registry-based attribution answers differently depending on which copy you read — the
same class of failure as the forked release record, in the file whose whole purpose is to say who owns
what.

**Not reconciled here.** Uploading either copy over the other would clobber concurrent work from
several agents, and `.loom/**` belongs to the `D` (Pure Guardrails) landing stream. The registry owner
must reconcile, likely with `pnpm loom task reconcile`.

## 3. This governance work ran unattributed for its first 19 commits

`delivery-baseline-governance:kiro-baseline-governance` was registered only after the fact. Before
that, 19 commits landed with **no `Task:` / `Agent:` trailers and no loom session**, both mandatory
under `AGENTS.md`.

Cause: commits went through the GitHub Contents and Git Data APIs to avoid touching the shared dirty
worktree. That reason is defensible; bypassing attribution was not, and commit messages are immutable,
so the debt stands recorded rather than repaired.

**Follow-up worth having:** a `prek` / `commit-msg` check that rejects commits missing
`Task:` / `Agent:` trailers. Today's evidence is that discipline by convention does not hold — the
agent doing attribution governance skipped attribution.

## Paths this task does claim

```
scripts/delivery/**
https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl
docs/design/convergence-evidence/2026-07-27/**
docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md
.github/workflows/trunk-follow.yml
```

## Paths this task touched but does not claim

| Path                                  | Rightful owner                       | Why touched                                                                                                                                            |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy/production/RELEASE_RECORD.md` | contested, see 1                     | recorded the trunk restoration and fixed a duplicated `## Latest cutover`; the file had two "latest" sections and neither described the running commit |
| `AGENTS.md`                           | landing stream `ME`                  | added the "Trunk and Deployment Baseline" section                                                                                                      |
| `git-hooks/**`, `.gitignore`          | landing stream `D` (Pure Guardrails) | ported the hooks from `rescue/l0-unique-20260726` to the trunk so they take effect; authorship is that agent's, blobs are byte-identical               |
