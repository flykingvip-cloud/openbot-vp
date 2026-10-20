# Rollback + data drill evidence

Date: 2026-07-25 ~23:47 CST (container) · 2026-07-26 staging sanitized drill

## Container rollback drill — DONE

Log: `openbot-rollback-drill-v116-20260725T234705.log`

| Step                     | Result                                                                               | Time    |
| ------------------------ | ------------------------------------------------------------------------------------ | ------- |
| Live before              | `rc-amd64-v116-baseline-recovery` healthz live                                       | —       |
| Fail over to v115 safety | `rc-amd64-v115-pending-admin-activations`, UI `index-B4ez0wvV.js`, healthz+readyz OK | **18s** |
| Restore v116             | healthz+readyz OK, UI `index-CA6HLrrO.js`, wecom.js present, build-info `127fc543f0` | **15s** |
| Total drill              | restored production to v116                                                          | **33s** |

## Sanitized production data / migration — DONE (same-host isolated staging)

Script: `deploy/production/scripts/staging-sanitized-data-drill.sh`  
Host report: `/var/lib/openbot-staging/evidence/STAGING_DATA_DRILL_20260726T074512.md`  
Repo copy: `deploy/production/evidence/STAGING_DATA_DRILL_LATEST.md`

| Item       | Result                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolation  | Independent host paths `/var/lib/openbot-staging/{state,snapshot-pre-migrate}`; container `openbot-gateway-staging`; port `127.0.0.1:18790` |
| Prod mount | **NOT mounted** (`/root/.openbot` used only as rsync/tar **copy source**)                                                                   |
| Scrub      | Removed SecretRef vaults, `.env*`, `auth-profiles.json`, `*.key`; staging-only gateway token in `/var/lib/openbot-staging/staging.env`      |
| Image      | `localhost/openbot:rc-amd64-provenance-225de96b270f`                                                                                        |
| Tenants    | **6** (ids recorded in host evidence JSON)                                                                                                  |
| File sum   | **2115** stable across pre-migrate / post-restart / post-rollback                                                                           |
| Restart    | staging healthz OK; file counts unchanged                                                                                                   |
| Rollback   | Restored from `snapshot-pre-migrate`; counts match snapshot                                                                                 |
| readyz     | Acceptable `failing=["wecom"]` (channel secrets intentionally absent in staging)                                                            |

## Gate-order note

Prod cutover preceded the original container-only drill. The sanitized staging drill closes the prior **NOT DONE** gap without sharing the production state volume.
