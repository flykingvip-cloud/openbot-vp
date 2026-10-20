# Production / staging smoke checklist

Mark each item when verified. Shared multi-tenant traffic also requires B4 gates
(see production-p0 plan Wave 4).

## Process & health

- [ ] Container/process starts **without** `--allow-unconfigured`
- [ ] `GET /healthz` → 200 (liveness)
- [ ] `GET /readyz` reflects readiness appropriately
- [ ] Restart recovers within `start_period` + retries

## Auth & exposure

- [ ] `OPENBOT_GATEWAY_TOKEN` (or trusted-proxy) configured
- [ ] Unauthenticated control-plane calls rejected
- [ ] Gateway port **not** reachable from public internet (only proxy/loopback)
- [ ] `controlUi.allowedOrigins` matches real HTTPS origins
- [ ] Wrong Origin → WS rejected

## Proxy / Wave 2 edge

- [ ] SPA loads over HTTPS on admin (and biz/gw if in scope)
- [ ] `GET /__openbot/control-ui-config.json` → JSON (not nginx 404)
- [ ] Platform login path returns JSON (not HTML 404)
- [ ] WS upgrade through proxy succeeds
- [ ] `deploy/production/proxy/smoke.sh --base-url https://admin...` exit 0
- [ ] Public `:18789` probe fails (`proxy/firewall.md`)
- [ ] `allowedOrigins` lists every browser host
- [ ] Gateway bind loopback + `trustedProxies` includes nginx source

## Config

- [ ] `gateway.mode` is `local`
- [ ] `data.mode` is `managed` for SaaS (or documented `local` for self-host)
- [ ] Secrets not present in image layers (`docker history` / scan)

## Security audit

- [ ] `openbot security audit` (or `--deep` on staging) — no unresolved criticals
- [ ] Sandbox / tool policy posture documented for the environment

## Multi-tenant (only after B4 merge + RC image)

Prerequisites: RC tip includes `isSharedTenantAddressingEnabled`, `pnpm check:tenant-addressing` in CI, path E2E green.

- [x] RC image rebuilt from merged `release/candidate-*` + B4 SHA recorded in `RELEASE_RECORD.md` (2026-07-13, `46023acddeca`)
- [x] `OPENBOT_MULTITENANT=0` default on staging; enable only for dedicated smoke window (verified unset on `openbot-gateway-rc`)
- [x] Tenant-import minimal slice committed for **001** and **workspace-2-87217301** (`staging-tenant-import-smoke-prep.sh`, 2026-07-13, 4 files/tenant)
- [x] `OPENBOT_MULTITENANT=1` smoke window opened 2026-07-13 (`staging-multitenant-cutover.sh 1`; healthz + edge 9/9 green)
- [x] Data-level addressing probe 6/6 (`staging-multitenant-addressing-probe.sh`: disjoint seat-assets, per-tenant users, ≠ global legacy)
- [x] Live membership→path probe 6/6 (`staging-live-tenant-addressing-probe.sh`: real staging emails → per-tenant L1/L2 paths)
- [x] L2 workspace write probe (`staging-multitenant-l2-write-probe.sh`: markers under membership user dirs only)
- [ ] **Tenant A** (`001` / upbeyond) admin **browser** login → create/list L1 asset under `tenants/001/` (**still pending human UI**)
- [ ] **Tenant B** (`workspace-2-87217301`) **browser** login → data only under own tenant tree (**still pending human UI**)
- [x] Cross-tenant **session path** negative (2026-07-13): `staging-multitenant-session-path-probe.sh` **6/6** — disjoint `sessions.json` paths + markers; L1 seatIds disjoint
- [x] Addressing probe **6/6** re-run 2026-07-13 (`staging-multitenant-addressing-probe.sh`)
- [x] Edge/proxy smoke **9/9** (`proxy/smoke.sh` admin + local health/config/login JSON)
- [x] Public `:18789` closed (connect refused)
- [x] `node scripts/check-tenant-addressing.mjs` exit 0 on RC worktree (with and without `rg`)
- [x] Scheduled projection soak **simulate** 10/10 (`node --import tsx scripts/staging-scheduled-projection-soak.ts` / `deploy/production/scripts/staging-scheduled-projection-soak.sh`, 2026-07-19)
- [x] Scheduled projection soak **inspect-selftest** / **all** (`OPENBOT_SOAK_MODE=all` or `pnpm soak:scheduled-projection:all`, 2026-07-19) — CI-safe inspect path
- [x] Knowledge-data closure package gate (`pnpm check:knowledge-data-closure`, 2026-07-19)
- [ ] Scheduled projection soak **live inspect** on MT window (`OPENBOT_SOAK_MODE=inspect OPENBOT_TENANTS_ROOT=… bash deploy/production/scripts/staging-scheduled-projection-soak.sh`) — after B4 MT smoke + ≥1 maintenance tick (ops cutover only)
- [x] `tenant-context.test.ts` R7.2 dual-tenant disk isolation (local green; 51 tests suite)
- [x] `OPENBOT_MULTITENANT=1` **live** on `openbot-gateway-rc` (`.env.docker`); **channel bots remain off** (D9)
- [ ] Authenticated **gateway RPC** cross-tenant negative (needs session cookies / operator login; not automated)
