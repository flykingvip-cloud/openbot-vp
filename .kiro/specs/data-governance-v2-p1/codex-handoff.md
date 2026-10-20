# Data Governance v2 — P1-2 Codex Handoff — **Accepted**

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/data-governance-v2-p0` (PR #320)  
**Status:** **P1-2 Accepted** (Round 8). Phase C closed. **P2 Lifecycle Command unlocked.**

## Acceptance record (Codex, 2026-08-12)

Codex independently confirmed Round-8 tip:

- Managed OAuth session tenant must strictly equal caller tenant.
- Managed mode only opens canonical store for authenticated `{tenantId, ownerId}`.
- `tenantId: null` + managed `storePath` rejected.
- `otherTenant` + original managed `storePath` rejected.
- Identity + lifecycle audit retain `tenantId`.
- Directed suite: **29 files, 204 passed / 5 skipped**.
- P1-2 ownership-path `tsgo`: **zero errors**.
- No new P0/P1 defects. Repo-wide `tsgo` noise outside ownership is out of scope.

## Baselines

| Milestone                       | Tip                                                             |
| ------------------------------- | --------------------------------------------------------------- |
| P0 / Gate 0 Accepted            | `0382ee2a42`                                                    |
| P1-1 First wave Accepted        | `995e60ec71`                                                    |
| P1-2 Gate Accepted              | `ec85ef1f9c`                                                    |
| P1-2 Phase C Accepted (Round 8) | `1596cb15af` (code) / `652d79fe94` (handoff) / tip `5779ffb1e4` |

## Unlock

**P2 Lifecycle Command** (archive / restore / forget / purge / legal hold / tombstone propagation) is authorized for planning and implementation. Follow a new P2 execution instruction before coding.

## Residual (non-blocking)

- Repo-wide `tsgo` may still fail on non–P1-2 paths (wecom, unrelated UI, etc.).
- Personal / `__local__` CogniWeave may still omit governance in some paths.
