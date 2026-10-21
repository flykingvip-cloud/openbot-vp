# CT-shadow HMAC root — 1Password vault migration (mechanism A1), operator runbook + design

> Status: **runbook / design (prospective)** — no production or secret action has been taken by
> authoring this file. Execution of steps ② ③ is done by the **release operator** on the deploy host;
> the AI/reviewer never generates, reads, injects, or echoes the secret value.
> Closes governance gate **AC-cond-1** (root delivered via key management, never on host disk) for the
> P2.5 CTR shadow HMAC root. Pairs with the `kiro-privacy-reviewer` sign-off in
> `.kiro/specs/conversation-task-runtime/p2-5-ac-a1-privacy-signoff-request.md`.

## 0. Scope and hard constraints

- Migrates **only** the shadow HMAC root (`OPENBOT_CT_SHADOW_HMAC_KEY`) from the interim on-host
  openssl file (`/root/.openbot-ct-shadow/ct-shadow.env`, seq 44) to **1Password-managed** delivery.
- **Shadow stays DORMANT throughout**: detection/qualification flags OFF, tenant allowlist empty. This
  migration **enables nothing** — it only changes where the root comes from.
- **`production rollout (to activation) = NOT APPROVED`.** No allowlist/flag/activation/projection/authorization.
- Same image `76fea1fb0669357fa7ed8c4c882bc4588b614cab`, same `--user 0`, same binds. Only the key
  source and `keyId` epoch change.

## 1. Chosen mechanism — A1 (entrypoint-time `op read`)

Rationale: `podman run -e VALUE=...` persists the resolved value into the on-host container config
(`.../containers/storage/.../config.json`), so a naive "vault → env at `podman run`" would still leave
the root on host disk. A1 avoids that:

- The container **entrypoint** runs `op read` at start and exports `OPENBOT_CT_SHADOW_HMAC_KEY` into its
  own process env, inherited by `node`. The value lives **only in process memory** — never in a file,
  never in the podman container config.
- Trust-root tradeoff (unavoidable on a single host): a **1Password service-account token**, scoped
  read-only to just this one item, is bind-mounted read-only into the container (mode 600 on host). The
  HMAC root never lands on disk; the revocable, scoped SA token does. This tradeoff is disclosed to and
  accepted by `kiro-privacy-reviewer` (see sign-off doc).
- Requirement: `op` (1Password CLI) must be available to the entrypoint. Since the gateway image does
  not ship `op`, bind-mount a host `op` binary read-only (no image rebuild, so image provenance
  `76fea1fb0669` is unchanged).

## 2. 1Password layout (create from a trusted workstation, NOT the deploy host)

- Item: `op://Private/openbot-ct-shadow-root` with field `credential` = a freshly generated
  **≥256-bit CSPRNG** value (use 1Password's generator; the value never touches the deploy host or any
  developer terminal). This replaces the interim openssl root.
- Service account: scoped **read-only** to the single item above. Issue an `OP_SERVICE_ACCOUNT_TOKEN`.
  It must be independently revocable and rotatable, and it is the only secret material placed on the host.

## 3. Operator runbook (run on the deploy host; single-line commands)

> `KEY_ID` new epoch = `ct-2026-09-vault`. Rotating the epoch = idempotent reset (fingerprint chain
> break, by design). Do NOT print the root value at any step.

### ② provisioning + entrypoint wrapper

Install op (rootful podman host; adjust for your distro):

```
curl -sSfL https://cache.agilebits.com/dist/1P/op2/pkg/v2.30.3/op_linux_amd64_v2.30.3.zip -o /tmp/op.zip && unzip -o /tmp/op.zip op -d /usr/local/bin && chmod 0755 /usr/local/bin/op && op --version
```

Place the scoped SA token (mode 600; paste value into the prompt so it is not in shell history):

```
install -m 700 -d /root/.openbot-ct-shadow && umask 077 && read -rs OP_TOKEN && printf '%s' "$OP_TOKEN" > /root/.openbot-ct-shadow/op-sa-token && unset OP_TOKEN && chmod 600 /root/.openbot-ct-shadow/op-sa-token && ls -l /root/.openbot-ct-shadow/op-sa-token
```

Verify the token can read the item WITHOUT printing the value (expect a number > 0):

```
OP_SERVICE_ACCOUNT_TOKEN="$(cat /root/.openbot-ct-shadow/op-sa-token)" op read op://Private/openbot-ct-shadow-root/credential | wc -c
```

Create the entrypoint wrapper (root fetched at runtime, never written to disk):

```
umask 077 && cat > /root/.openbot-ct-shadow/entrypoint.sh <<'SH'
#!/bin/sh
set -eu
OP_SERVICE_ACCOUNT_TOKEN="$(cat /run/ct-shadow/op-sa-token)"; export OP_SERVICE_ACCOUNT_TOKEN
OPENBOT_CT_SHADOW_HMAC_KEY="$(op read op://Private/openbot-ct-shadow-root/credential)"; export OPENBOT_CT_SHADOW_HMAC_KEY
OPENBOT_CT_SHADOW_HMAC_KEY_ID="ct-2026-09-vault"; export OPENBOT_CT_SHADOW_HMAC_KEY_ID
unset OP_SERVICE_ACCOUNT_TOKEN
exec node openbot.mjs gateway --bind loopback --port 18789
SH
chmod 700 /root/.openbot-ct-shadow/entrypoint.sh && echo wrapper-ready
```

### ② recreate `openbot-gateway-rc` (same image; drop ct-shadow.env; bind op + token + wrapper)

Keep a rollback handle, then recreate (single line):

```
podman rename openbot-gateway-rc openbot-gateway-rc-prev-preAcCond1 && podman stop openbot-gateway-rc-prev-preAcCond1 && podman run -d --name openbot-gateway-rc --network host --user 0 --restart always --env-file /root/openbot-maint-cutover-cf7ceb40a7/env.list -v /root/.openbot:/root/.openbot -v /root/openbot-tenants:/root/openbot-tenants -v /usr/local/bin/op:/usr/local/bin/op:ro -v /root/.openbot-ct-shadow/op-sa-token:/run/ct-shadow/op-sa-token:ro -v /root/.openbot-ct-shadow/entrypoint.sh:/run/ct-shadow/entrypoint.sh:ro --entrypoint /run/ct-shadow/entrypoint.sh 27742d7be6c3955415ab7a9baa7ac29dc90edd352ae144cc7d5f855f1ff49825 && for i in $(seq 1 20); do sleep 6; c=$(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:18789/healthz); echo "t+$((i*6))s=$c"; [ "$c" = "200" ] && break; done
```

Verify health + KEY_ID epoch + value NOT persisted anywhere:

```
curl -s 127.0.0.1:18789/readyz; echo; podman exec openbot-gateway-rc printenv OPENBOT_CT_SHADOW_HMAC_KEY_ID; podman exec openbot-gateway-rc sh -lc 'echo len=${#OPENBOT_CT_SHADOW_HMAC_KEY}'; podman inspect openbot-gateway-rc --format '{{json .Config.Env}}' | grep -c OPENBOT_CT_SHADOW_HMAC_KEY= ; echo "^ expect 0 (value must NOT be in container config)"
```

Confirm still DORMANT (expect empty):

```
podman logs --since 10m openbot-gateway-rc 2>&1 | grep -iE 'shadow|detect|qualif|hmac|conversation-task' | tail
```

### ③ retire the interim openssl root

Confirm zero shadow writes during the interim root's lifetime (dormant evidence), then destroy it:

```
shred -u /root/.openbot-ct-shadow/ct-shadow.env 2>/dev/null || rm -P /root/.openbot-ct-shadow/ct-shadow.env; ls -l /root/.openbot-ct-shadow/ct-shadow.env 2>&1; grep -rl 'ct-shadow.env' /root/openbot-maint-* 2>/dev/null || echo "no remaining references"
```

If healthy check fails at any point, roll back (instant):

```
podman stop openbot-gateway-rc 2>/dev/null; podman rm openbot-gateway-rc 2>/dev/null; podman rename openbot-gateway-rc-prev-preAcCond1 openbot-gateway-rc && podman start openbot-gateway-rc
```

## 4. Ledger (after ② ③ succeed) — recorded by executor via PR, value never recorded

Append a new `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` row (or a seq-44 revision note) with evidence:
`root now 1Password-managed (op://Private/openbot-ct-shadow-root); interim openssl root
retired/destroyed (shred); OPENBOT_CT_SHADOW_HMAC_KEY_ID=ct-2026-09-vault; injection A1 =
entrypoint op read (value never on host disk / not in podman config); SA token scoped read-only,
mode 600, revocable; shadow default-DORMANT; verify-forward-only=allow;
verify-delivery-alignment re-run PASS`. **The key value is never written to the ledger or logs.**

## 5. Rotation policy (AC-cond-3, ongoing)

- Rotate the 1Password item value on a **≤ 90 day** cadence (aligns with code `HMAC_KEY_MAX_AGE_MS`),
  bump `OPENBOT_CT_SHADOW_HMAC_KEY_ID` to a new epoch, recreate the container. Expiry is fail-closed
  (`hmac_key_expired`); rotation = idempotent epoch reset (design frozen).
- Rotate/revoke the SA token independently on the same or tighter cadence.

## 6. Boundary (restated)

This migration enables nothing. Activation (opening allowlist/detection flag) is **handoff C** and
remains **NOT APPROVED**; it additionally requires AC-cond-4 (post-enable alert/metric de-identification
sampling). Executor `kiro-collab-csc` != implementation owner `kiro-conversation-task-runtime`; the
privacy sign-off is authored solely by `kiro-privacy-reviewer` (no self-sign).
