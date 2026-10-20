# PHASE-D4-HANDOFF — toward RC0

**From:** `cursor-convergence-phase-d4`  
**Date:** 2026-07-20  
**Worktree:** `/Users/daniel/AI项目/openbot-convergence`  
**Branch:** `convergence/2026-07-20`

---

## 1. Final HEAD

- Pre-D4: `5b0f6fba0e` (D3 tip)
- D4 tip: branch `HEAD` after D4 commits (`git rev-parse HEAD`)

## 2. K1–K6

See `matrix.md`. All six automated in `local-folder-import.golden-path.test.ts` (6/6 green).

```bash
pnpm exec vitest run src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts --pool=forks
```

## 3. Gates

| Gate         | Result      |
| ------------ | ----------- |
| `pnpm build` | **0**       |
| `pnpm tsgo`  | **77 → 77** |

## 4. RC0 preparation?

### `YES_WITH_GATES`

Gates still expected before staging/prod:

1. Data upgrade dry-run
2. Client protocol gate checklist
3. Release record draft
4. **No production cutover without explicit maintainer confirmation**

## 5. Uncovered import kinds

Deferred: one-shot file upload, web/url, dataset, gitRepo, cloudDrive, mailAttachment, full connector productization.

## 6. No monthly-usage in D4

Unrelated monthly-usage / `app.ts` WIP was restored/discarded; D4 commits only knowledge localFolder + evidence docs + scopes/list wiring.
