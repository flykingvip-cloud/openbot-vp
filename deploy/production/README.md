# Production deployment pack（Wave 1）

> **Audience**: platform / SRE  
> **Topology (Gate 0)**: Production Managed Enterprise runs a **dedicated Gateway per tenant
> (or per trust boundary)** — own `OPENBOT_TENANTS_ROOT` subvolume, own credentials/token,
> own browser state/queues/caches, never sharing a process with another tenant. A
> multi-tenant **shared Gateway** must not carry production Managed traffic until
> tenant-context **P1+P2+P4** are green **and** shared-process I3 isolation is separately
> proven and approved (see `src/gateway/security-profile.ts`); until then it is
> pre-prod / canary-candidate only.  
> **Related**: `docs/design/production-p0-blockers-remediation-plan-2026-07-12.md` ·
> `SECURITY.md` (Operator Trust Model, Profile A/B) · `src/gateway/security-profile.ts` ·
> `docs/design/openbot-architecture-data-cloud-security-review-2026-08.md` (F-2) ·
> `docs/design/tenant-context-propagation-plan-2026-07-11.md` ·
> `docs/design/hybrid-gateway-isolation-future-plan-2026-07-11.md` (parked)

This directory is the **production-safe** entrypoint. Dev/e2e paths may still use
`--allow-unconfigured`; production must not.

---

## Sandbox docker bake (P0)

- Gateway images bake Docker CLI by default (`OPENCLAW_INSTALL_DOCKER_CLI=1`).
- Prefer `deploy/production/scripts/run-gateway.sh` which mounts `docker.sock` when present and fails if neither CLI nor socket is available.
- Multitenant startup refuses ready when both CLI and engine socket are missing (`DG0_MANAGED_DOCKER_RUNTIME_UNAVAILABLE`).

## Inbound depth greyscale (P2 — env only)

- Code defaults keep `OPENBOT_CHAT_INBOUND_DEPTH_ROUTER` **off**. Do not bake ROUTER=`1` into the image or compose defaults.
- Shadow may already be on LIVE; enabling the router is a host-`.env` + recreate decision after shadow evidence is clean.
- Runbook: [`exec-efficiency-inbound-depth-greyscale.md`](./exec-efficiency-inbound-depth-greyscale.md).
- Dashboards: `docs/design/exec-efficiency-p2-observability-dashboards-2026-10-12.md`.

## Red lines (must not ship)

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **No** `--allow-unconfigured` on production process command / image default CMD                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| R2  | Gateway **must** load a real config with `gateway.mode: "local"` (host runs the gateway)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| R3  | Public exposure only via reverse proxy; Gateway bind **`loopback`** unless you have a documented network policy + forced auth                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R4  | Auth required: `gateway.auth` token/password **or** trusted-proxy (with `trustedProxies` + `allowedOrigins`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R5  | `controlUi.allowedOrigins` must be explicit production HTTPS origins (no `*`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R6  | Secrets only via env / secret manager — never bake tokens into the image                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| R7  | **Shared-Gateway multi-tenant traffic is forbidden in production** until **tenant-context P1+P2+P4** gates are green (B4) **and** shared-process I3 isolation is separately proven/approved. Until then a shared Gateway is pre-prod / canary-candidate only                                                                                                                                                                                                                                                                                                                |
| R8  | Do not copy host `memory/`, `groups/`, or local `.openclaw` into the image                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R9  | **No hot overlay of `/app/dist` in a running container.** Every cutover must **recreate** the container from an image built at a provenance tag (`provenance/sha-*`), so that running `build-info.commit` == image OCI `revision` label. Emergency break-glass requires an explicit `RELEASE_RECORD.md` entry (mirror of the `--intentional-revert` escape hatch) — never the default path                                                                                                                                                                                  |
| R10 | Production Managed (`OPENBOT_SECURITY_PROFILE=managed_enterprise`, or `data.mode=managed` which derives it) **must run a dedicated tenant execution boundary** (`OPENBOT_TENANT_EXECUTION_BOUNDARY=dedicated` + `OPENBOT_TENANTS_ROOT`). `shared_process` is rejected at startup (`SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY`). **Never** work around the gate by downgrading to `personal_local` while keeping `data.mode=managed` — the code rejects that too (`SECURITY_PROFILE_CONFLICT`), and doing so would put multi-tenant traffic inside a single trust boundary |

---

## Topology: dedicated per tenant is the production unit (Gate 0)

The production Managed Enterprise scaling unit is **one Gateway per tenant (or per trust
boundary)** — this is what `src/gateway/security-profile.ts` already enforces at startup
(fail-closed), and what `SECURITY.md` Profile B documents:

- Each tenant gets its own Gateway process/container with its own
  `OPENBOT_TENANTS_ROOT` subvolume, own gateway token/credentials, own browser state,
  and own queues/caches. Nothing tenant-scoped is shared across processes.
- `OPENBOT_SECURITY_PROFILE=managed_enterprise` +
  `OPENBOT_TENANT_EXECUTION_BOUNDARY=dedicated` + `OPENBOT_TENANTS_ROOT` is the only
  startup combination that serves Managed traffic today (see R10 and
  `env.production.example`).
- A **shared Gateway** serving multiple tenants from one process stays pre-prod /
  canary-candidate until tenant-context **P1+P2+P4** are green **and** the
  shared-process I3 isolation claim is separately proven and approved. Getting those
  gates green is what would later unlock relaxing the startup check — do not relax the
  docs (or the env) ahead of the code.

**Scope note**: the Gate 0 **dedicated execution boundary** required here (one process
per tenant, a security gate that applies now) is **not** the same thing as the future
VIP dedicated **product entitlement / upgrade-downgrade flows** described in
`docs/design/hybrid-gateway-isolation-future-plan-2026-07-11.md` — that plan stays
**parked** until the shared path P0–P4 is stable. Nothing in this pack starts a
per-tenant orchestrator.

---

## Overlay ban (R9) — how it is enforced

An overlay rewrites `/app/dist` inside the running container, so the LIVE authority
(`build-info.commit`, read via `podman exec … cat /app/dist/build-info.json`) and the
container image's `org.opencontainers.image.revision` label diverge. That split breaks
rollback identity and the audit chain (see the OHBE ledger seq 34–41 notes, including
the unledgered `47d6934c34` window recorded on seq 40/41:
https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl).

- **Machine gate**: `scripts/verify-live-image-identity.sh` asserts running
  `build-info.commit` == image OCI revision, fail-closed (exit `20` = identity split /
  overlay detected, `21` = LIVE or label unreadable). Run it after every cutover;
  `scripts/verify-delivery-alignment.sh --live-image` includes it in the alignment gate.
- **Ledger timeline must have no holes**: every instant between a row's `liveFrom` and
  the next row's `liveFrom` must be covered — close the previous row's `liveTo` at
  cutover time, and never let an artifact run without its own ledger row.
  `pnpm delivery:ledger:audit` reports `timeline-gap` findings (unclosed spans, gaps,
  overlaps) as delivery debt.
- **Break-glass**: if a hot overlay is truly unavoidable, register it explicitly in
  `RELEASE_RECORD.md` **before** it goes live and record the ledger row with an
  acknowledgement — explicit, reasoned, never default. Historical overlay rows stay in
  the OHBE ledger (https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl)
  untouched; the ban is forward-looking. This repo no longer stores that JSONL
  (`deploy/production/LEDGER.md`).

---

## Session maintenance (hosted)

Hosted / long-running deployments must run with `session.maintenance.mode: "enforce"`
plus an explicit disk budget (`maxDiskBytes`), as set in
`openbot.production.example.json5`. The code default stays `"warn"` for personal
installs; `warn` on a managed host means unbounded session/transcript growth until the
data volume fills (availability incident, not governance). The same applies to the
`fly.toml` / `render.yaml` samples — their small volumes fill first.

---

## Files

| File                               | Purpose                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `openbot.production.example.json5` | Config skeleton (copy → host state dir as `openbot.json` / `openclaw.json` per install) |
| `env.production.example`           | Primary env vars for compose/k8s/fly                                                    |
| `docker-compose.prod.yml`          | Production-oriented compose (auth required, no unconfigured)                            |
| `smoke-checklist.md`               | Staging / prod smoke list                                                               |
| `RELEASE_RECORD.md`                | Human release notes in this repo (not the machine ledger)                              |
| `LEDGER.md`                        | Pointer to the OHBE production ledger; do not recreate `releases.jsonl` here            |
| `M0B_M2B_OPERATOR_RUNBOOK.md`      | M0b/M2b verify-live + seq 46 rollback record (commands only; no secrets; no swap)       |

---

## Quick start (container)

```bash
# 1) Build from RC worktree (not a dirty WIP tree)
docker build -t openbot:prod .

# 2) Prepare state
mkdir -p /var/lib/openbot/{state,workspace}
cp deploy/production/openbot.production.example.json5 /var/lib/openbot/state/openclaw.json
# Edit: auth token, allowedOrigins, trustedProxies, data.mode=managed for SaaS
# (managed also requires the Gate 0 boundary env — see R10 + env.production.example)

# 3) Env
cp deploy/production/env.production.example /var/lib/openbot/.env
# Set OPENBOT_GATEWAY_TOKEN to a long random value (openssl rand -hex 32)

# 4) Run
export OPENBOT_CONFIG_DIR=/var/lib/openbot/state
export OPENBOT_WORKSPACE_DIR=/var/lib/openbot/workspace
docker compose -f deploy/production/docker-compose.prod.yml --env-file /var/lib/openbot/.env up -d
```

Gateway listens on **loopback inside the container** by default in this pack.
Put nginx/Caddy in front; see `deploy/admin-subdomain/` and
`docs/gateway/trusted-proxy-deployment-examples.md`.

---

## Image CMD policy

| Context                       | Command                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| **Production image default**  | `node openclaw.mjs gateway` (**no** `--allow-unconfigured`)    |
| **Fly / public prod process** | same; require mounted config + `gateway.mode=local`            |
| **Dev / e2e only**            | may pass `--allow-unconfigured` (scripts under `scripts/e2e/`) |

If the process exits with “Missing config” or “set gateway.mode=local”, that is
**correct** — fix the volume/config, do not re-add the flag in prod.

---

## Sandbox note

Default product sandbox mode is `off` (host exec). For shared SaaS:

- Prefer `agents.defaults.sandbox.mode: "all"` when tool exec is enabled for untrusted users
- Or strictly deny runtime tools via tool policy

Document the chosen posture in the tenant runbook.

---

## B4 reminder

Shared-Gateway multi-tenant **isolation is incomplete** until kiro finishes
`tenant-context-propagation` P1–P2–P4. Those gates (plus a separately proven
shared-process I3 isolation claim) are what could later make a shared Gateway a
production candidate — they do **not** change today's production unit, which is a
dedicated Gateway per tenant (R10). This pack only hardens **process exposure**, not
tenant addressing.

## HA Dual Controller (opt-in profile `ha`)

Inventory Stage 5 closed the previous **部署未接线** gap with an opt-in compose
service. This is **not** Production Auto Failover approval.

| Item | Value |
| --- | --- |
| Service | `openbot-ha-controller` in `docker-compose.prod.yml` |
| Profile | `ha` (default `up -d` does **not** start it) |
| Image | `deploy/ha/controller/Dockerfile` → `OPENBOT_HA_CONTROLLER_IMAGE` |
| Command | `python -m controller heartbeat-loop` |
| Mode | `HA_CONTROLLER_MODE=manual` (default); `auto` refused |
| Env | commented block in `env.production.example` |

```bash
docker compose -f deploy/production/docker-compose.prod.yml \
  --env-file /path/to/.env --profile ha up -d
```

Red line: Production Auto Failover stays **NOT APPROVED / OFF**. See
`deploy/ha/controller/README.md`.

