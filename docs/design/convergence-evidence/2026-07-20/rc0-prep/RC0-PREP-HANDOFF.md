# RC0-PREP-HANDOFF

**From:** `cursor-convergence-rc0-prep`  
**Date:** 2026-07-20  
**Worktree:** `/Users/daniel/AI项目/openbot-convergence`  
**Branch:** `convergence/2026-07-20`  
**Status:** REWORK after prior FAIL (missing `rc0-prep/` + missing agent commit)

---

## 1. RECOMMENDED_RC0_TIP

```text
RECOMMENDED_RC0_TIP=9aceda7349da2190e00bb2fbb029175a517ecde7
```

- LOCKED_BASE is ancestor (verified).
- `git rev-list --count LOCKED_BASE..TIP` = **51**.
- Branch HEAD `08027a7006` has **6** post-D4 monthly-usage UI/spec commits — **do not tag** as RC0 unless maintainers accept pollution (see `candidate-tip.md`).

## 2. Regression table (re-run this wave)

| Gate                                      | Result                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| `pnpm build`                              | **PASS** exit 0 (~39.7s)                                      |
| `tenant-context.test.ts`                  | **PASS** 29                                                   |
| `local-folder-import.golden-path.test.ts` | **PASS** 6 (K1–K6)                                            |
| `chat.history-d3.test.ts`                 | **PASS** 2                                                    |
| `chat-checkpoints.d3.test.ts`             | **PASS** 3                                                    |
| Aggregate vitest                          | **PASS** 40/40                                                |
| `pnpm tsgo`                               | **RECORD** 78 error lines on HEAD (above historic ceiling 77) |

## 3. RISK list

| Area                                 | Level         | Notes                                                    |
| ------------------------------------ | ------------- | -------------------------------------------------------- |
| Data restore rehearsal on prod clone | HIGH for prod | Checklist + fixture only; blocks PRODUCTION_GO           |
| Android / iOS/macOS compile          | MEDIUM        | Toolchain present; builds not run — web-first staging OK |
| Path A vs Path B image               | MEDIUM        | v69 Dockerfile ≠ full tip UI rebuild                     |
| Tip pollution if tagging HEAD        | HIGH          | Prefer `9aceda7349`                                      |
| wecom readyz                         | KNOWN         | Waiver valid until 2026-08-20; must not expand           |

## 4. Staging recommendation

```text
STAGING_GO=GO_WITH_GATES
```

**Gates:**

1. Deploy / tag **`9aceda7349`**, not polluted HEAD.
2. Full staging image rebuild if Control UI from tip is required (do not reuse v69 layer Dockerfile blindly).
3. Smoke: healthz / login / chat.history / localFolder K1–K2 sample.
4. Accept only `{wecom}` on readyz.
5. Maintainer written GO before staging deploy brief.

## 5. Production recommendation

```text
PRODUCTION_GO=NO
```

Hard-coded this wave. No production cutover, no registry push, Production Sign-off blank in DRAFT.

## 6. Pollution commits

See `candidate-tip.md` table: `a478f29e29` → `08027a7006` (org monthly-usage UI + spec note).

## 7. Not done

- Staging deploy
- Production cutover
- Docker image push
- Mobile `gradlew` / `xcodebuild`
- Full production-data restore drill

## 8. Self-check (rework)

```bash
WORKTREE=/Users/daniel/AI项目/openbot-convergence
OUT=docs/design/convergence-evidence/2026-07-20/rc0-prep
test -d "$WORKTREE/$OUT" && ls -la "$WORKTREE/$OUT"
test -f "$WORKTREE/$OUT/RC0-PREP-HANDOFF.md"
# after commit:
git -C "$WORKTREE" log -1 --format='%h %s%n%b'
# must contain: Agent: cursor-convergence-rc0-prep
```

| Check                | Expected                      |
| -------------------- | ----------------------------- |
| Files in `rc0-prep/` | **≥ 12** prescribed           |
| Agent trailer        | `cursor-convergence-rc0-prep` |
| Production deploy    | none                          |
