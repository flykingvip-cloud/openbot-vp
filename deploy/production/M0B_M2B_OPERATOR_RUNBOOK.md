# M0b / M2b operator runbook

Audience: production operator with host access to `8.217.93.71` / `openbot-gateway-rc`.

This file is **commands only**. It does not authorize a cutover, container swap,
`PRODUCTION_GO`, nginx/env edits, or a host build. Do not put secrets, tokens, or
env-file contents here.

Gates and writer rules: `docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md`
§6.1.1. Status of what already shipped: `docs/design/openbot-aliyun-prod-v2-implementable-2026-08-28.md`.

## Tracker (OP-3 closed — no GitHub issue)

In-repo SoT for the three operator items (browser audit 2026-08-28: no open
issue tracks these). Check them off only on
`docs/design/openbot-aliyun-prod-v2-implementable-2026-08-28.md` after host
evidence lands in the ledger / `RELEASE_RECORD.md`. OP-1/OP-2 landed in #796.

| Id   | Item                                                                         | This runbook                  |
| ---- | ---------------------------------------------------------------------------- | ----------------------------- |
| OP-1 | Independently `--verify-live` seq 45 on `8.217.93.71` / `openbot-gateway-rc` | §1 done (PASS; no `--record`) |
| OP-2 | Ledger the unrecorded seq 46 rollback with `--intentional-revert`            | §2 done (seq 46+47 recorded)  |
| OP-3 | Next GHCR cutover is `--verify-live --record`, not a backfill                | §3 done (seq 51 LIVE)         |

#777 was CLOSED (not merged). Replacement **#794** is merged: CTR seq-45 B
CONDITIONAL PASS docs are on `main`. This runbook does not touch those files.
§1 and §2 below are historical completed commands. Do not re-run them against
the closed seq 45 digest `ee132a30…`. Current LIVE is seq 51 / digest
`sha256:a64adc1f…` (`liveVerified=true`). OP-3 is done. Do not --record seq 51 again.

## Current LIVE (ledger SoT)

Do **not** treat the OP-2 reconstruction table below as LIVE. Current LIVE is seq **51**.
This leftover still does not authorize a cutover.

| Field            | In-repo claim (ledger `releases.jsonl`; host identities from last verified cutover)                |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| LIVE row         | seq **51** / `59be50660d8ebacf867211a206c92b4300bec418`                                            |
| Image            | `rc-amd64-provenance-59be50660d`                                                                   |
| Digest           | `sha256:a64adc1f04f116d7dd0e7e434f1d1a00a99601ed8de8ae8523becd2b1a470595`                          |
| Tag              | `provenance/sha-59be50660d8e`                                                                      |
| Host / container | `8.217.93.71` / `openbot-gateway-rc`                                                               |
| Evidence         | `liveVerified=true`; pulled from GHCR; no host build; liveFrom `2026-08-29T13:15:53Z`; no `liveTo` |
| Next cutover     | Explicit PRODUCTION_GO only. A later `origin/main` image is **not** LIVE until recorded.           |

## Historical ledger claim after OP-2 reconstruction (seq 47; superseded by seq 48–51)

| Field            | Historical in-repo claim (host identities from operator `podman inspect` on `8.217.93.71`)                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| LIVE row         | seq **47** / `21e1e8392f0ff5808563727eaa8f66e6ad9ed148`                                                     |
| Image            | `rc-amd64-provenance-21e1e8392f0f`                                                                          |
| Digest           | `sha256:715122a14a8805c40f071c078a99132addbbb00633be21eabb55da7b85f65a5b`                                   |
| Tag              | `provenance/sha-21e1e8392f0f`                                                                               |
| Host / container | `8.217.93.71` / `openbot-gateway-rc`                                                                        |
| Seq 47 evidence  | OP-1 `--verify-live` PASS. `liveVerified=true`. `--intentional-revert` of seq 46.                           |
| Seq 45           | Closed `liveTo=2026-08-28T05:40:36Z`. Historical GHCR backfill digest `sha256:ee132a30…`.                   |
| Seq 46           | Closed `liveTo=2026-08-28T05:51:33Z`. Historical ~11min forward `471b3a2c3099` / digest `sha256:1aaa7406…`. |

## 0. Preconditions

- Checkout contains `8a6066a` (M0b writer: `--live-verified` / `--unverified-backfill`).
- Prefer `OPENBOT_PRODUCTION_SSH_HOST=local` when already on the host.
- From a laptop, `OPENBOT_PRODUCTION_SSH_HOST=root@8.217.93.71` only for **read** probes.
- Do **not** run `--stage` or execute printed swap/recreate commands from this leftover.

```bash
export OPENBOT_PRODUCTION_SSH_HOST=local
export OPENBOT_PRODUCTION_CONTAINER=openbot-gateway-rc
```

## 1. M0b — independently `--verify-live` seq 45

Read-only. Expected candidate is the current ledger LIVE SHA. Do **not** pass
`--record` here: recording would close seq 45 and append a duplicate LIVE row.

```bash
./deploy/production/scripts/cutover-from-ghcr.sh \
  --verify-live \
  --candidate 21e1e8392f0ff5808563727eaa8f66e6ad9ed148 \
  --digest sha256:ee132a30aea0461b71e8d98395e17ebae13f8224f20c3a14b6b818406b75ecb2 \
  --image-tag rc-amd64-provenance-21e1e8392f
```

R9 identity (also read-only):

```bash
./deploy/production/scripts/verify-live-image-identity.sh \
  --container openbot-gateway-rc \
  --ssh-host local

./deploy/production/scripts/verify-delivery-alignment.sh \
  --prod-sha 21e1e8392f0ff5808563727eaa8f66e6ad9ed148 \
  --candidate-sha 21e1e8392f0ff5808563727eaa8f66e6ad9ed148 \
  --live-image
```

PASS means: `build-info.commit` equals `21e1e839…`, healthz 200, readyz
`ready:true` / `failing:[]`, and the image OCI `revision` matches.

If verify-live fails, **stop**. Do not write a verified row. Reconcile host vs
ledger before any `delivery:cutover:record`.

## 2. M0b — reconstruct then ledger the unrecorded seq 46 rollback

`pnpm delivery:cutover:record` only closes the open row and appends **one** row.
The tree does not name the rolled-back SHA. Observe the host; **do not invent**.

```bash
podman exec openbot-gateway-rc cat /app/dist/build-info.json
podman ps -a --filter name=openbot-gateway-rc
podman images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}'
```

Look for leftovers such as `openbot-gateway-rc-prev-<sha>` or a briefly used
`rc-amd64-provenance-<sha>` that is not `21e1e839` / `76fea1fb`.

### 2a. Intermediate SHA not identified

Leave the gap. Do not append a fabricated seq 46. Note the observation (or lack
of it) in the next `RELEASE_RECORD.md` edit after a real host check.

### 2b. Intermediate SHA identified

Call it `INTERMEDIATE`. Use host `StartedAt` / live windows, not "now".

1. Record the missing **forward** (closes seq 45). If that container is no longer
   running, use `--unverified-backfill`, not `--live-verified`.
2. Record the **rollback** `INTERMEDIATE` → `21e1e839…` with
   `--intentional-revert`. Use `--live-verified` only after §1 verify-live PASS.

```bash
# Step A — missing forward. Replace every REPLACE_* from host evidence.
pnpm delivery:cutover:record -- \
  --gateway-sha REPLACE_INTERMEDIATE_40HEX \
  --ui-sha REPLACE_INTERMEDIATE_40HEX \
  --build-mode full-dist \
  --artifact-kind image \
  --artifact-id rc-amd64-provenance-REPLACE_INTERMEDIATE_10HEX \
  --artifact-digest sha256:REPLACE_OBSERVED_64HEX \
  --tag provenance/sha-REPLACE_INTERMEDIATE_12HEX \
  --live-from REPLACE_HOST_STARTEDATE_Z \
  --evidence "host leftover of unledgered forward before rollback" \
  --executor REPLACE_OPERATOR_ID \
  --notes "historical reconstruction; not a new cutover" \
  --unverified-backfill "seq 46 forward was not independently verify-live at cutover time" \
  --ledger deploy/production/releases.jsonl

# Step B — rollback to 21e1e839 (only after §1 PASS)
pnpm delivery:cutover:record -- \
  --gateway-sha 21e1e8392f0ff5808563727eaa8f66e6ad9ed148 \
  --ui-sha 21e1e8392f0ff5808563727eaa8f66e6ad9ed148 \
  --build-mode full-dist \
  --artifact-kind image \
  --artifact-id rc-amd64-provenance-21e1e8392f \
  --artifact-digest sha256:ee132a30aea0461b71e8d98395e17ebae13f8224f20c3a14b6b818406b75ecb2 \
  --tag provenance/sha-21e1e8392f0f \
  --live-from REPLACE_ROLLBACK_TIME_Z \
  --evidence "verify-live PASS on openbot-gateway-rc; rollback of unledgered seq 46" \
  --executor REPLACE_OPERATOR_ID \
  --notes "intentional revert to seq 45 SHA after unledgered forward" \
  --live-verified \
  --intentional-revert "approved rollback of unledgered seq 46 attempt; restore 21e1e839" \
  --ledger deploy/production/releases.jsonl

pnpm delivery:ledger:audit
```

Land the ledger + `RELEASE_RECORD.md` update via PR. Do not hand-append v1 JSONL.
Do not force-push.

If you are instead recording a rollback you just executed (not historical),
`--verify-live --record` already passes `--live-verified`:

```bash
./deploy/production/scripts/cutover-from-ghcr.sh \
  --verify-live --record \
  --candidate 21e1e8392f0ff5808563727eaa8f66e6ad9ed148 \
  --digest sha256:ee132a30aea0461b71e8d98395e17ebae13f8224f20c3a14b6b818406b75ecb2 \
  --intentional-revert "approved rollback of unledgered seq 46 attempt; restore 21e1e839"
```

## 3. M2b — independently `--verify-live` a GHCR cutover (not a backfill)

M2b is the **next** authorized GHCR swap, recorded by `delivery:cutover:record`
after the running container is observed. It is not a backfill of seq 45.

This leftover does not swap. After an authorized operator has already swapped:

```bash
./deploy/production/scripts/cutover-from-ghcr.sh \
  --verify-live --record \
  --candidate REPLACE_NEW_40HEX \
  --digest sha256:REPLACE_NEW_DIGEST
```

That path is the M2b proof: `--verify-live` observed the container; `--record`
writes v2 with `--live-verified`. Do not use `--unverified-backfill` for M2b.

## 4. Out of scope

- `PRODUCTION_GO`, container recreate, image pull/stage, host `podman build`
- Inventing `INTERMEDIATE` SHAs, digests, or `liveFrom` timestamps
- Re-doing in-repo M0a / M0b gates (#774 / #778 / #786)
- Rewriting #777 / #794 CTR B-signoff files under `.kiro/specs/conversation-task-runtime/`
