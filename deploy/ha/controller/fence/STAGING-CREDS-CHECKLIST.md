# HA V2.1.2 E2 — Staging Fence/CF credentials & targets checklist

**Audience:** Owner / Ops (fill before any live mutate session)  
**Date opened:** 2026-10-05 (CST)  
**Baseline:** `main` @ `5d706d4b` (E1 App Fence merged)  
**Status:** placeholders only — **NO secrets in this file / git**  
**Auto Failover:** **OFF / NOT APPROVED** — E2 ≠ Auto FO admission

Fill values in a **local secret store / password manager / Ops vault**.  
Record only **IDs, names, paths, and secret-store references** below. Never paste tokens, keys, or PEM bodies into git or chat logs that get committed.

---

## 0. Session approval (required for every live window)

| Field                                                                | Owner fill | Example / placeholder                    |
| -------------------------------------------------------------------- | ---------- | ---------------------------------------- |
| Staging target named                                                 | ☐          | `staging-ha-fo-YYYYMMDD`                 |
| Change window (CST)                                                  | ☐          | `2026-__-__ __:__–__:__ CST`             |
| Owner approver                                                       | ☐          | `@________`                              |
| Approval evidence                                                    | ☐          | ticket URL / chat timestamp (no secrets) |
| Rollback owner                                                       | ☐          | `@________`                              |
| `HA_CONTROLLER_MODE`                                                 | must stay  | `manual`                                 |
| `HA_ALIYUN_LIVE_MUTATE` / `HA_AWS_LIVE_MUTATE` / `HA_CF_LIVE_MUTATE` | default    | `0` until this row is signed             |

**Hard stop:** without a filled approval row naming **staging**, do not set any `*_LIVE_MUTATE=1`.

---

## 1. Aliyun PRIMARY (Network Fence + optional Compute) — E2b-C

**PRIMARY topology.** Prefer this path for prod-form Network Fence evidence.
AWS (§2) remains lab-compat only.

| Asset                                    | Env / store key                                                | Owner fill (ID only)                                  | Notes                                                                     |
| ---------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Region                                   | `HA_ALIYUN_REGION`                                             | `________` e.g. `cn-hongkong`                         | staging / approved window                                                 |
| Security Group (isolate old primary)     | `HA_ALIYUN_SG_ID`                                              | `sg-________________`                                 | least privilege mutate                                                    |
| Old-primary instance (Compute)           | `HA_ALIYUN_INSTANCE_ID`                                        | `i-________________`                                  | enable Compute only if needed                                             |
| Cloud provider                           | `HA_CLOUD_PROVIDER`                                            | `aliyun`                                              | required for Aliyun clients                                               |
| RAM identity                             | secret store name only                                         | `aliyun/ram/________`                                 | **no** access keys in git                                                 |
| RAM role name (O1 client, preferred)     | `HA_ALIYUN_RAM_ROLE_NAME` (alias `ALIBABA_CLOUD_ECS_METADATA`) | `________` (role **name** only)                       | STS via ECS metadata; or AK/STS env injected from secret store at runtime |
| ECS OpenAPI endpoint (optional)          | `HA_ALIYUN_ECS_ENDPOINT`                                       | default `ecs.<region>.aliyuncs.com`                   | VPC endpoint if controller has no public egress                           |
| Live mutate gate                         | `HA_ALIYUN_LIVE_MUTATE`                                        | default `0`                                           | set `1` only in approved window                                           |
| Live target gate                         | `HA_ALIYUN_LIVE_TARGET`                                        | must be `staging` when mutate=1                       | refuse other values                                                       |
| Preflight snapshot path (local, not git) | `HA_ALIYUN_SG_SNAPSHOT_DIR` (O2)                               | `/local/dir/` → `aliyun-sg-snapshot-<sg>-<exec>.json` | take before mutate; refused inside git                                    |
| Isolate rule set (blast radius, O2)      | `HA_ALIYUN_ISOLATE_PORTS`                                      | default `5432/5432`                                   | Owner decision #2 pending                                                 |
| Protected ports (never revoked, O2)      | `HA_ALIYUN_PROTECT_PORTS`                                      | default `22/22`                                       | keep SSH/admin open                                                       |

Credential material lives in: **`________________`** (secret store path / name only).
E2b-C slice 1: skeleton + gates only — **no OpenAPI calls** until Owner live session.

---

## 2. AWS lab-compat (Network Fence + optional Compute)

| Asset                                    | Env / store key        | Owner fill (ID only)                                                                                       | Notes                                                        |
| ---------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Region                                   | `HA_AWS_REGION`        | `________` e.g. `ap-east-1`                                                                                | staging only                                                 |
| Security Group (isolate old primary)     | `HA_AWS_SG_ID`         | `sg-________________`                                                                                      | least privilege mutate                                       |
| Network ACL (optional)                   | `HA_AWS_NACL_ID`       | `acl-________________`                                                                                     | or leave empty if SG-only                                    |
| Old-primary instance (Compute)           | `HA_AWS_INSTANCE_ID`   | `i-________________`                                                                                       | enable Compute only if Network VERIFY fails / drill requires |
| IAM identity                             | secret store name only | `aws/role/________` or `aws/user/________`                                                                 | **no** access keys in git; prefer instance/role              |
| IAM capability notes (no secrets)        | —                      | ☐ `ec2:AuthorizeSecurityGroup* / Revoke*` ☐ `ec2:CreateNetworkAclEntry` ☐ `ec2:StopInstances` (if Compute) | document least privilege                                     |
| Live mutate gate                         | `HA_AWS_LIVE_MUTATE`   | default `0`                                                                                                | set `1` only in approved window                              |
| Live target gate                         | `HA_AWS_LIVE_TARGET`   | must be `staging` when mutate=1                                                                            | refuse other values                                          |
| Preflight snapshot path (local, not git) | —                      | `/local/path/sg-nacl-snapshot-________.json`                                                               | take before mutate                                           |

Credential material lives in: **`________________`** (secret store path / name only).

---

## 3. Cloudflare (pool cutover)

| Asset                                | Env / store key     | Owner fill                                      | Notes                                  |
| ------------------------------------ | ------------------- | ----------------------------------------------- | -------------------------------------- |
| Account ID                           | `HA_CF_ACCOUNT_ID`  | `________________`                              | staging account                        |
| Zone / LB context (label only)       | —                   | `________`                                      | human label; not necessarily env       |
| Staging pool ID                      | `HA_CF_POOL_ID`     | `________________`                              | **staging pool only**                  |
| Old origin name/addr                 | `HA_CF_OLD_ORIGIN`  | `________`                                      |                                        |
| New origin name/addr                 | `HA_CF_NEW_ORIGIN`  | `________`                                      |                                        |
| API base                             | `HA_CF_API_BASE`    | default `https://api.cloudflare.com/client/v4`  |                                        |
| API token                            | `HA_CF_API_TOKEN`   | **secret store name only:** `cf/token/________` | never paste token here                 |
| Live mutate gate                     | `HA_CF_LIVE_MUTATE` | default `0`                                     | `1` only after GET evidence + approval |
| Preflight pool JSON snapshot (local) | —                   | `/local/path/cf-pool-________.json`             | restore on rollback                    |

---

## 4. App Fence (E1 sidecar / node)

| Asset                   | Env / path            | Owner fill                               | Notes              |
| ----------------------- | --------------------- | ---------------------------------------- | ------------------ |
| Fence URL               | `HA_APP_FENCE_URL`    | `https://________:8443/internal/fence`   | staging node       |
| Shared token (optional) | `HA_APP_FENCE_TOKEN`  | secret store: `app/fence-token/________` |                    |
| mTLS client cert path   | `HA_APP_MTLS_CERT`    | `/path/to/________.crt`                  | path only          |
| mTLS client key path    | `HA_APP_MTLS_KEY`     | `/path/to/________.key`                  | path only          |
| mTLS CA path            | `HA_APP_MTLS_CA`      | `/path/to/________-ca.crt`               | path only          |
| Enable flag             | `HA_FENCE_ENABLE_APP` | default `0`                              | `1` for L5 session |

---

## 5. SQL terminate / VERIFY (staging)

| Asset             | Env                                          | Owner fill                          | Notes                     |
| ----------------- | -------------------------------------------- | ----------------------------------- | ------------------------- |
| Staging DSN       | `DATABASE_URL`                               | secret store: `pg/staging/________` | Managed PG or staging lab |
| Terminate timeout | `HA_TERMINATE_TIMEOUT_MS`                    | default `2000`                      |                           |
| Wait / confirm    | `HA_FENCE_T_WAIT_S` / `HA_FENCE_T_CONFIRM_S` | defaults `5` / `1`                  |                           |

---

## 6. Controller / fence backend (safe defaults)

```bash
# Copy to local env file — do NOT commit filled values
export HA_CONTROLLER_MODE=manual
export HA_FENCE_BACKEND=lab          # then dry_run → real only under approval
export HA_CLOUD_PROVIDER=mock        # aws only for live Network/Compute work
export HA_FENCE_ENABLE_APP=0
export HA_FENCE_ENABLE_NETWORK=0
export HA_FENCE_ENABLE_COMPUTE=0
export HA_FENCE_ENABLE_CF=0
export HA_FENCE_ENABLE_PROMOTE=0
export HA_AWS_LIVE_MUTATE=0
export HA_AWS_LIVE_TARGET=           # must be "staging" when LIVE_MUTATE=1
export HA_CF_LIVE_MUTATE=0
```

---

## 7. Preflight commands (no cloud mutate)

After E2a code lands on the branch/PR:

```bash
cd deploy/ha/controller
# Validates env presence / gate consistency; does NOT call AWS or CF APIs
python -m fence.preflight

# Prints would-do Network/CF/App actions from current env (dry)
python -m fence.staging_dry_run
```

Exit non-zero if `HA_CONTROLLER_MODE=auto`, or if `*_LIVE_MUTATE=1` without required IDs / `HA_AWS_LIVE_TARGET=staging`.

---

## 8. Owner decision log (check when ready)

| Decision                                                   | Ready? |
| ---------------------------------------------------------- | ------ |
| Staging AWS SG/NACL/instance IDs filled                    | ☐      |
| IAM least-privilege notes filled (no secrets)              | ☐      |
| CF staging pool + origin IDs filled; token in secret store | ☐      |
| App Fence URL + cert **paths** filled                      | ☐      |
| Staging `DATABASE_URL` in secret store                     | ☐      |
| Written approval for first live window                     | ☐      |
| Authorize implementer to run L3 (AWS) / L4b (CF) under E2b | ☐      |

Until this section is complete, E2 **live** sessions stay blocked.  
E2a code (gates + preflight + docs) may merge independently with Auto FO **OFF / NOT APPROVED**.
