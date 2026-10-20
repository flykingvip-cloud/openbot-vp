# Critical feature checklist (production + recently accepted)

Captured: 2026-07-20T09:46:11Z  
Evidence sources: `deploy/production/RELEASE_RECORD.md`, Control UI routes, knowledge-import Day0 work, execution plan §4.2 / §10.

| #   | Capability                                                     | In production (v69)?                   | Evidence source                                                       | Notes                                          |
| --- | -------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | Employee / platform login + Control UI bootstrap               | Yes (implied by cutover)               | RELEASE_RECORD v69 includes Control UI; apps employee login dirty WIP | Need parity on auth handshake                  |
| 2   | Tenant / seat context                                          | Yes (OPENBOT_MULTITENANT historically) | RELEASE_RECORD 2026-07-13 notes; tenant-context dirty locally         | Isolation is P0                                |
| 3   | Agent roster / catalog                                         | Partial / evolving                     | employee-account-agent-roster specs + dirty control-plane             | Not all adapters may be on prod SHA            |
| 4   | Chat / session history                                         | Yes                                    | session fix commits on fix-scoped after prod tip                      | Local HEAD ahead of prod                       |
| 5   | Knowledge Universe basic import (file/note/url/dataset/active) | Likely yes on RC lineage               | knowledge UI on branch; prod tip may lag                              |                                                |
| 6   | Knowledge localFolder + passive connector                      | **Local HEAD yes; prod tip unclear**   | commits `69b62c2a31`…`0c38d934d5` after prod SHA                      | **P0 gap risk if base=prod or old origin tip** |
| 7   | Billing / commercial (if enabled)                              | Was on v55 path                        | RELEASE_RECORD 2026-07-18                                             | Confirm whether still in v69 image             |
| 8   | Deploy healthz                                                 | Yes                                    | RELEASE_RECORD                                                        |                                                |
| 9   | Deploy readyz                                                  | **Failing wecom**                      | RELEASE_RECORD v69                                                    | Needs waiver policy, not permanent green       |
| 10  | Nginx edge (admin/biz/gw/apex)                                 | Yes                                    | deploy/production/proxy/nginx/\* (dirty locally)                      |                                                |

**Rule:** CI green ≠ feature complete. Parity must check each row against locked candidate SHAs.
