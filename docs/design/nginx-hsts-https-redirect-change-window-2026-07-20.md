# Nginx HSTS + HTTP→HTTPS redirect — production change window

**Branch:** `wip/ops-nginx-hsts-https-redirect`  
**Commit:** see branch tip (`ops(nginx): enable HSTS and HTTP→HTTPS redirect on edge hosts`)  
**Scope:** `deploy/production/proxy/nginx/{admin,apex,biz,gw}.openbot.love.conf`  
**Status:** **not applied to production** until this checklist is completed and owner approves.

## What changes

1. Enable `Strict-Transport-Security: max-age=31536000; includeSubDomains` on admin/apex/biz/gw.
2. Inside each `location /`, add HTTP→HTTPS: `if ($scheme = http) { return 308 https://$host$request_uri; }`.

## Preconditions (must all be true)

- [ ] TLS terminates on the edge (nginx/CDN) for admin/apex/biz/gw; certificates valid ≥ 30 days.
- [ ] No production health probe or monitor depends on **plain HTTP 200** for these vhosts (expect 308 or use HTTPS probes).
- [ ] Internal tools / callbacks that still call `http://` are inventoried and acceptable to redirect, or allowlisted elsewhere.
- [ ] Current running nginx configs on host are backed up (`/etc/nginx` or deploy path copy + timestamp).
- [ ] Rollback command rehearsed (restore previous conf + `nginx -t` + reload).

## Apply procedure (manual; no auto execute)

1. SSH to production edge host (Plan-A / proxy host — not the gateway container alone if nginx is host-level).
2. Copy the four conf files from this branch into the live nginx conf.d (or rsync from a checked-out tree at the ops branch tip).
3. `nginx -t` — must pass.
4. `nginx -s reload` (or site-specific reload).
5. Smoke (from outside + inside VPC as applicable):
   - `https://admin|biz|gw|apex.../healthz` or known health paths → **200**
   - `http://` same hosts → **308** to `https://` with same host/path
   - Response headers include `Strict-Transport-Security`
6. Confirm gateway containers still healthy (`openbot-gateway-rc` healthz/readyz; wecom readyz waiver unchanged).

## Rollback

1. Restore pre-change conf from backup.
2. `nginx -t && nginx -s reload`.
3. Re-check HTTP access behavior matches pre-window baseline.

## Merge plan

| Step | Action                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 1    | Keep changes only on `wip/ops-nginx-hsts-https-redirect` until window.                                            |
| 2    | After successful apply, open PR → `release/rc-convergence-2026-07-20` or current release branch (docs+conf only). |
| 3    | Do **not** bundle with employee roster or wecom feature PRs.                                                      |
| 4    | Tag optional: `ops-nginx-hsts-YYYYMMDD` after live apply for audit.                                               |

## Out of scope

- Gateway container image cutover
- Application HSTS headers inside Node
- Changing wecom readiness waiver

## Owner sign-off

| Role             | Name | Date | Result |
| ---------------- | ---- | ---- | ------ |
| Edge/proxy       |      |      |        |
| Production owner |      |      |        |
| Executor         |      |      |        |
