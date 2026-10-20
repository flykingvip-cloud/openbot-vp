# Fence / CF adapters (Stage D + E2a + E2b-C Aliyun skeleton + E2b-O1 OpenAPI wiring + E2b-O2 SG dry paths)

Real Fence / Cloudflare **adapter modules + config contracts + dry-run/mock tests**.
E2a: **`HA_AWS_LIVE_MUTATE`** (default `0`) + staging target gate + preflight/staging_dry_run.
E2b-C (Owner scope **C** hybrid): **Aliyun = PRIMARY** Network/Compute skeleton +
`HA_ALIYUN_LIVE_MUTATE` (default `0`); **AWS = lab-compat only**. Auto Failover remains
**OFF / NOT APPROVED**. No OpenAPI/boto3 success path in this slice.

### E2b-O1 scope (Aliyun OpenAPI client wiring — no mutate)

- `aliyun_openapi.py`: stdlib signed-HTTP ECS RPC client (signature v1, HMAC-SHA1,
  API `2014-05-26`); no SDK dependency. Injectable transport → unit tests are **fully
  mocked** (zero real OpenAPI calls).
- Credentials resolved **lazily at call time** from env only (secret-store injected
  `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` [+
  `ALIBABA_CLOUD_SECURITY_TOKEN`]) or an **ECS RAM role name** (`HA_ALIYUN_RAM_ROLE_NAME`,
  alias `ALIBABA_CLOUD_ECS_METADATA`) → instance-metadata STS. Never in git; `repr` redacts.
- Action allowlist: **read-only** (`DescribeSecurityGroupAttribute`,
  `DescribeSecurityGroups`, `DescribeInstances`). Mutate actions (`RevokeSecurityGroup`,
  `AuthorizeSecurityGroup`, `StopInstance`, …) are refused **before** credentials /
  signing / transport.
- `AliyunNetworkFenceClient`:
  - `live=False` (default, `HA_ALIYUN_LIVE_MUTATE=0`) → dry_skeleton, no OpenAPI.
  - `live=True` without `live_target=staging` → `RuntimeError` refuse (no creds, no call).
  - `live=True` + staging gates → one read-only `DescribeSecurityGroupAttribute` probe,
    then honest refuse (`AliyunNetworkMutateNotImplemented`, a `RuntimeError`) —
    **SG isolate/restore mutate is O2/O3** (Owner-approved staging window).
- `AliyunComputeFenceClient` unchanged (still refuses live; StopInstance = O4).
- Optional `HA_ALIYUN_ECS_ENDPOINT` (e.g. VPC endpoint). Preflight reports
  `aliyun_cred_source` (presence only: `env_ak|env_sts|ecs_ram_role|none`) and still
  makes zero cloud calls.
- `HA_ALIYUN_LIVE_MUTATE` stays **0**. Auto Failover **OFF / NOT APPROVED**; O1 is not
  Auto FO admission.

### E2b-O2 scope (Aliyun SG snapshot / isolate / restore — dry paths only)

- `aliyun_sg.py` (pure; never signs/sends): snapshot schema
  `ha.e2b.aliyun_sg_snapshot/v1` (normalized rules + per-rule fingerprint + sha256
  digest, tamper-checked) and receipt schema **`ha.e2b.aliyun_sg_receipt/v1`**
  (`op` = `snapshot_sg|isolate|restore`, `idempotency_key=<exec>:FENCING_NETWORK:<op>`,
  `dry_run=true`, **`mutate_issued=false`** invariant, `openapi_calls_issued` limited to
  the read-only allowlist, `intended_openapi_calls` = Revoke/Authorize param shapes,
  `auto_fo="OFF / NOT APPROVED"`; validator rejects secrets/tampering).
- Blast radius = `IsolatePolicy`: revoke only ingress `accept` TCP/ALL rules overlapping
  `HA_ALIYUN_ISOLATE_PORTS` (default `5432/5432`); rules overlapping
  `HA_ALIYUN_PROTECT_PORTS` (default `22/22`) are **never** revoked (reported as
  `blocked_protected_overlap`); isolate∩protected policy is refused. Owner decision #2
  (HK SG rule set) still pending — defaults are placeholders.
- Restore re-authorizes exactly the revoked fingerprints from the pre-mutate snapshot;
  refuses if the snapshot doesn't contain them.
- Local snapshot file only via `HA_ALIYUN_SG_SNAPSHOT_DIR` (mode `0600`; refused inside
  any git work tree; path never printed in receipts/preflight).
- `AliyunNetworkFenceClient.snapshot_sg / isolate / restore`:
  - `live=False` (default): zero OpenAPI calls; snapshot from offline input
    (`offline_permissions`) or `not_captured`; dry receipts. `isolate_old_primary`
    keeps `dry_skeleton` and adds `o2_receipts`.
  - `live=True` ungated → refuse before creds (all ops).
  - `live=True` + staging gates → `snapshot_sg` = read-only `DescribeSecurityGroupAttribute`;
    `isolate`/`restore` build plan + receipt then raise `AliyunNetworkMutateNotImplemented`
    (`.receipt`, `.probe`) — **real mutate is O3**. Mutate actions stay outside the
    OpenAPI client allowlist.
- CLI: `python -m fence.aliyun_sg_dry_run --permissions-json <offline describe json>`
  (forced `live=False` even if `HA_ALIYUN_LIVE_MUTATE=1`; zero OpenAPI).
- Preflight (presence/locality only): `aliyun_o2_dry_paths`, `aliyun_sg_snapshot_dir`
  (unset=warn, inside git=fail), `aliyun_cred_presence` (LIVE=0, source class only).
- `HA_ALIYUN_LIVE_MUTATE` stays **0**. Auto Failover **OFF / NOT APPROVED**.

| Red line                   | Status                                    |
| -------------------------- | ----------------------------------------- |
| Production Auto Failover   | **NOT APPROVED / OFF**                    |
| Default `HA_FENCE_BACKEND` | **`lab`** (Stage B LabFenceAdapter)       |
| Real cloud / CF            | **OFF** unless enable flags + env present |
| Secrets in git             | **Forbidden** — tokens/certs via env only |
| Business table gates       | Unchanged (not this stage)                |

## Layout

```
fence/
  config.py              FenceCfConfig from env; defaults OFF/lab
  factory.py             build_adapter(cfg) → Lab | DryRun | Composite
  app_fence.py           Protocol + Mock + HTTP /internal/fence (mTLS knobs)
  network_fence.py       Protocol + Mock + AWS SG/NACL skeleton + Aliyun SG (O1 OpenAPI wiring, gated)
  aliyun_openapi.py      E2b-O1 signed ECS RPC client; env/RAM-role creds; read-only allowlist
  aliyun_sg.py           E2b-O2 SG snapshot/isolate/restore plans + receipt schema (pure)
  aliyun_sg_dry_run.py   E2b-O2 CLI: offline dry receipts (zero OpenAPI)
  compute_fence.py       Protocol + Mock + AWS/Aliyun stop skeletons (live=False)
  cloudflare_cutover.py  remove-old → add-new; §12.5 epoch refuse-overwrite
  promote.py             Mock promote
  composite.py           Step dispatch; terminate/VERIFY = real SQL
  dry_run.py             Intended calls only; ok receipts
  http_util.py           stdlib JSON HTTP
  tests/                 unittest + urllib mocks; fixtures/*.json (no secrets)
```

## Backends

| `HA_FENCE_BACKEND` | Behaviour                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `lab` (default)    | `LabFenceAdapter` from `deploy/ha/drills/` — Network/CF stubs, real terminate/VERIFY SQL |
| `dry_run`          | `DryRunFenceAdapter` — no SQL / cloud / CF; would-do receipts                            |
| `real`             | `CompositeFenceAdapter` — refuses start unless ≥1 enable flag + required env             |

Enable flags (default `0`): `HA_FENCE_ENABLE_{APP,NETWORK,COMPUTE,CF,PROMOTE}`.

Cloud provider: `HA_CLOUD_PROVIDER=mock|aws|aliyun`.

- **Aliyun (PRIMARY for E2b-C):** factory sets `live=` from **`HA_ALIYUN_LIVE_MUTATE`**
  (default `0` → dry_skeleton). `HA_ALIYUN_LIVE_MUTATE=1` requires
  **`HA_ALIYUN_LIVE_TARGET=staging`**. O1 wires the signed OpenAPI client; gated
  `live=True` issues only a read-only probe then **refuses mutate** (no fake cloud success). Env IDs: `HA_ALIYUN_REGION`, `HA_ALIYUN_SG_ID`,
  `HA_ALIYUN_INSTANCE_ID` (values via secret store — never git).
- **AWS (lab-compat only):** factory sets `live=` from **`HA_AWS_LIVE_MUTATE`**
  (default `0` → dry_skeleton). `HA_AWS_LIVE_MUTATE=1` requires
  **`HA_AWS_LIVE_TARGET=staging`**. E2a still **refuses boto3** when `live=True`.
- CF live pool mutate additionally requires `HA_CF_LIVE_MUTATE=1` (default off).
- Manual controller only (`HA_CONTROLLER_MODE=manual`). This PR is **not** Auto FO admission.

`HA_CONTROLLER_MODE=auto` is refused.

## What still needs live creds / prod-form (deferred)

1. Live Cloudflare API token + pool mutate runbook (`HA_CF_*`, `HA_CF_LIVE_MUTATE`)
2. Live **Aliyun** SG isolate/restore mutate (O3 Owner staging window) + ECS stop (O4). O1 = client wiring; O2 = dry paths + receipts (mocked tests only)
   2b. Live AWS SG/NACL + EC2 stop **boto3** (lab-compat; E2a gates only)
3. ~~App node `/internal/fence` server~~ → **E1 reference:** `deploy/ha/app_fence/` (TS gateway in-process still documented in GATEWAY-INTEGRATION.md)
4. Production-form drills **16–18** (real Network Fence + write-peak soak)
5. Managed PG vendor kill + sync-repl Lost=0 matrix
6. Multi-AZ / controller failure-domain soak
7. Production Auto Failover admission (**not** this PR)

## E2a preflight / staging dry-run (no cloud mutate)

```bash
cd deploy/ha/controller

# Validate env presence + gate consistency — zero Aliyun/AWS/CF API calls
python -m fence.preflight
python -m fence.preflight --json

# Print redacted would-do plan + DryRunFenceAdapter receipts
python -m fence.staging_dry_run
```

Owner/Ops fill staging IDs in `.cursor-ha-docs/HA-E2-STAGING-CREDS-CHECKLIST.md` (or
`fence/STAGING-CREDS-CHECKLIST.md` copy) — **secret store names only**, never tokens in git.

## Tests

```bash
# Unit (no PG, no network)
cd deploy/ha/controller
python -m unittest discover -s fence/tests -v

# Stage B lab drills must stay green on default lab backend
HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 \
  PG_BIN=/usr/local/opt/postgresql@14/bin \
  bash deploy/ha/drills/tests/run-ephemeral.sh

# Stage C Dual Controller (if present)
PG_BIN=/usr/local/opt/postgresql@14/bin \
  bash deploy/ha/controller/tests/run-ephemeral.sh
```

## Env cheat-sheet (never commit values)

```bash
export HA_FENCE_BACKEND=lab          # lab|dry_run|real
export HA_FENCE_ENABLE_NETWORK=0
export HA_FENCE_ENABLE_CF=0
export HA_CLOUD_PROVIDER=mock        # mock|aws|aliyun (PRIMARY=aliyun)
export HA_APP_FENCE_URL=
export HA_APP_MTLS_CERT= HA_APP_MTLS_KEY= HA_APP_MTLS_CA=
export HA_CF_API_TOKEN= HA_CF_ACCOUNT_ID= HA_CF_POOL_ID=
export HA_CF_OLD_ORIGIN= HA_CF_NEW_ORIGIN=
export HA_CF_LIVE_MUTATE=0
export HA_AWS_LIVE_MUTATE=0          # lab-compat only
export HA_AWS_LIVE_TARGET=           # must be staging when LIVE_MUTATE=1
export HA_ALIYUN_LIVE_MUTATE=0       # PRIMARY; default OFF
export HA_ALIYUN_LIVE_TARGET=        # must be staging when LIVE_MUTATE=1
export HA_ALIYUN_REGION=             # e.g. cn-hongkong (secret store / env)
export HA_ALIYUN_SG_ID=
export HA_ALIYUN_INSTANCE_ID=
export HA_ALIYUN_ECS_ENDPOINT=       # optional (e.g. VPC endpoint); default ecs.<region>.aliyuncs.com
export HA_ALIYUN_RAM_ROLE_NAME=      # ECS RAM role *name* (preferred); or AK/STS env from secret store
export HA_ALIYUN_ISOLATE_PORTS=      # O2 blast radius; default 5432/5432
export HA_ALIYUN_PROTECT_PORTS=22/22 # O2 never revoked (admin/SSH)
export HA_ALIYUN_SG_SNAPSHOT_DIR=    # O2 local pre-mutate snapshot dir (outside git)
export HA_CONTROLLER_MODE=manual     # auto refused; Auto FO OFF / NOT APPROVED
```
