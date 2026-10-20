# Waiver: wecom (readyz probe)

- **Probe:** `readyz` / channel health component `wecom`
- **Observed on:** production v69 (`85eee3e7b987…`, image `openbot:rc-amd64-v69`); also v68 per RELEASE_RECORD
- **Error summary:** readiness HTTP 503 with `failing:["wecom"]` while `healthz` remains 200
- **Impact scope:**
  - **Does not** block healthz or generic gateway liveness
  - **May** block operators who treat readyz as hard deploy gate
  - WeCom channel send/receive may be degraded; core login/chat/knowledge paths not proven blocked by this probe alone
- **Owner:** `grok-evolution-closure` (proxy release owner)
- **Expires on:** **2026-08-20** (30 days from sign-off; renew or fix before expiry)
- **Introduced/expanded by RC0?** No — pre-existing on v68/v69 production cutover; **RC0 must not expand** the failing set beyond `{wecom}` without a new waiver
- **Compensating controls:**
  - Monitor `healthz` + application error rates
  - Track WeCom credential/config as separate ops ticket
  - Convergence staging may deploy with same known-fail
- **Maintainer sign-off for staging:** **PROXY-SIGNED** 2026-07-20 (`grok-evolution-closure`)
- **Maintainer sign-off for production (carry-forward of existing v69 state):** **PROXY-SIGNED** 2026-07-20 — only for **continuing** current known-fail; **not** for a new production cutover that adds failures

## Forbidden uses

- Do not treat this as permanent auto-exempt.
- Do not land changes that add new readyz failures without a separate waiver.
