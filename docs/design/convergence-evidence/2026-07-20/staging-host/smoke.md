# Smoke (blocked)

Full staging-host smoke **not executed** — no `STAGING_BASE_URL`.

| #   | Check                     | Result      |
| --- | ------------------------- | ----------- |
| 1   | healthz                   | **SKIPPED** |
| 2   | readyz                    | **SKIPPED** |
| 3   | login                     | **SKIPPED** |
| 4   | chat.history live         | **SKIPPED** |
| 5   | localFolder K1/K2 on host | **SKIPPED** |
| 6   | rollback drill on host    | **SKIPPED** |

Prior **local sim** evidence (PARTIAL) remains under `../staging/smoke.md` — not a substitute for SUCCESS here.
