# Data Governance v2 — Gate 0 / P0 Codex Handoff

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/data-governance-v2-p0`  
**Overall:** **Accepted**  
**P1:** unlocked for planning and implementation

## Status board

| Gate                | Status                                                             |
| ------------------- | ------------------------------------------------------------------ |
| Gate 0              | **Pass**                                                           |
| P0-a … P0-e         | **Pass**                                                           |
| Focused suite       | **88 passed / 0 failed**                                           |
| Managed fail-closed | **Pass** (legacy fallback / host browse / group cwd)               |
| C19 live re-probe   | **Ops tracking** (explicitly non-blocking for this stage Accepted) |
| Codex Accepted      | **Accepted** (baseline `0382ee2a42`)                               |
| P1 unlock           | **Unlocked** (planning + implementation allowed)                   |

## Acceptance baseline

| Item                         | Value                                        |
| ---------------------------- | -------------------------------------------- |
| Accepted branch              | `cursor/data-governance-v2-p0`               |
| Accepted commit (pre-rebase) | `0382ee2a42`                                 |
| Post-rebase tip              | `3263b4a86a` (on `origin/main` `e398edbd13`) |
| Ancestry                     | **OK** — `is-ancestor(origin/main, HEAD)`    |
| Focused suite after rebase   | **91 passed / 0 failed**                     |

## C19 disposition

Per final Codex verdict (with user approval): C19 live re-probe is an **operations tracking item** and does **not** block Gate0/P0 Accepted.

Follow-on ops (non-blocking): keep Managed stateDir binding/quarantine/freeze aligned; deploy P0 gateway overlay so application-level shared-root deny matches the data plane.

Optional later evidence (post-Accepted, not required for this stage):  
`docs/design/evidence/workspace-isolation-20260810-c19-live.summary.json`

## P0 code surface (Accepted)

- Security profiles (Gate 0)
- Workspace inventory / classifier / resolver / cutover / handler bridge
- Managed fail-closed: no legacy cwd fallback; host browse deny; group tool cwd ACL
- Focused regression suite green at acceptance

## Next

1. Push `cursor/data-governance-v2-p0` and open PR → `main`.
2. Start P1 planning/implementation under a new task ownership trail as needed.
