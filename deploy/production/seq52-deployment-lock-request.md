# seq52 Canary — Deployment-Lock Request (REVIEW ONLY)

Status: **REQUESTED — NOT granted.** This document is a review artifact. It does **not**
grant a lock, authorize a cutover, change any Stage gate, or touch production. Nothing in
`deploy/production/releases.jsonl` or `RELEASE_RECORD.md` is written by this document.

Prepared by: `kiro-release-authority`
Prepared at: 2026-09-01 (UTC)

## 1. What this requests

A single, time-boxed deployment lock so exactly one accountable executor may perform the
**seq52 forward-only Canary** (gateway + Control UI at the same SHA) on host `8.217.93.71`,
with rollback preserved. Approval is a human decision by the repository owner.

## 2. Live baseline (re-verified 2026-09-01)

Read from the running container (`build-info.json` is the source of truth, never a ledger):

| Field                   | Value                                                                     |
| ----------------------- | ------------------------------------------------------------------------- |
| LIVE gateway commit     | `59be50660d8ebacf867211a206c92b4300bec418`                                |
| version                 | `2026.7.12-rc.2` (builtAt 2026-08-29T12:35:31Z)                           |
| image                   | `localhost/openbot:rc-amd64-provenance-59be50660d`                        |
| image digest            | `sha256:a64adc1f04f116d7dd0e7e434f1d1a00a99601ed8de8ae8523becd2b1a470595` |
| health                  | `healthz` live · `readyz` ready (uptime ~2.6d)                            |
| ledger row              | seq 51 (OPEN) on `origin/main`                                            |
| served Control UI entry | `index-Dpg8P1UR.js` (frozen since the 76fea1fb era)                       |

## 3. Candidate (re-qualified 2026-09-01 against `origin/main` tip)

The seq52 candidate is now `origin/main` tip `b915cb93cf5b7056b636cd2e1bc89ea58d24bd98`
(#885), re-qualified 2026-09-01. At qualification time the candidate **equals** the freshly
fetched `origin/main` tip (no further re-lock needed unless the trunk advances again).

| Field                               | Value                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| candidate SHA                       | `b915cb93cf5b7056b636cd2e1bc89ea58d24bd98`                                                      |
| amd64 image digest                  | `sha256:991c64d0f42b5174e40081f1e2ed34571ad7b4eb08c8a679a1a58d116a013ae3`                       |
| OCI `image.revision`                | `b915cb93cf5b7056b636cd2e1bc89ea58d24bd98` (== candidate)                                       |
| `/app/dist/build-info.json` commit  | `b915cb93cf5b7056b636cd2e1bc89ea58d24bd98` (== candidate)                                       |
| image kind / arch                   | full gateway + Control UI, linux/amd64 (`2026.7.12-rc.2`, builtAt 2026-09-01T04:31:43Z)         |
| Control UI entry                    | `index-DydJ4HD3.js`                                                                             |
| index.html sha256                   | `59389b1c58e23f5b7c80253dd41cee2d118339d31996203df89d7eb95d37b7fc`                              |
| UI file count / bytes / manifest fp | 56 files / 8,247,322 bytes / `a6e39526d893cd57a03aa9f042bec185521236a4e0bc57999c406ad34b6d2abb` |

> **Immutable-image gap.** No `provenance/sha-b915cb93cf5b` git tag exists, so GHCR has **no**
> `provenance-b915cb93cf5b-amd64` tag (that tag is built only when a `provenance/sha-*` tag is
> pushed; run #33469975027 was a plain `main` push and only published the moving `main-amd64`).
> The candidate was qualified from the **`main-amd64` moving tag resolved to its immutable
> digest** `sha256:991c64d0…` (OCI revision == candidate, build-info.commit == candidate). For
> a clean, immutable release identity, push an annotated `provenance/sha-b915cb93cf5b` tag and
> let Docker Release publish `provenance-…-amd64` before cutover, or pin the digest in the lock.

> **UI vs prior `5daffc` rehearsal.** index.html and the entry chunk (`index-DydJ4HD3.js`) are
> hash-identical to the earlier rehearsal, so the hashed JS/CSS dependency graph is unchanged;
> the byte delta (8,247,322 vs 8,259,610, same 56-file count) is confined to non-entry static
> assets. A fresh static integrity smoke on this exact export passed (0 missing index.html
> refs, 0 dangling entry chunks); a full browser smoke on this export is recommended at G0.

## 4. Protected containers

| Container                        | Role                          | Net    | Restart | Ports                 | State mount                                 |
| -------------------------------- | ----------------------------- | ------ | ------- | --------------------- | ------------------------------------------- |
| `openbot-gateway-rc`             | LIVE production               | host   | always  | 18789 / 18791 / 18792 | `/var/lib/openbot/state` → `/root/.openbot` |
| `openbot-gateway-s01-shadow-obs` | S01 Stage B shadow (isolated) | bridge | none    | host 18793 → 18789    | `/var/lib/openbot/s01-stage-b-shadow-obs/*` |

The S01 shadow stream is **isolated** (separate net, state, env, port) and is owned by a
different stream. seq52 must **not** disturb it.

Resource-level conflict-free: `rc` and `s01-shadow-obs` share no port, state dir, env file,
or control-ui root.

## 5. Env files (existence + integrity)

| Env file                                 | Status                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/root/.openbot-ct-shadow/ct-shadow.env` | **EXISTS** · sha256 `f4ee6510d2dbafa6f69b2560f04d257071a1a5f1f417f5e36d2d458c403b36a0` (2 lines; CT-shadow HMAC key + id) |
| `/tmp/openbot-gateway-rc-seq51.env`      | **MISSING** (was ephemeral under `/tmp`)                                                                                  |

> **Blocker B1 — env-file must be reconstructed.** The LIVE container was created with
> `--env-file /tmp/openbot-gateway-rc-seq51.env`, which no longer exists. A recreate cannot
> reuse it. Before any recreate, extract the running container's environment
> (`podman inspect openbot-gateway-rc --format '{{.Config.Env}}'`), materialize it to a
> **non-`/tmp`** path, and verify parity item-by-item (tokens, SMTP, `OPENBOT_MULTITENANT`,
> supervisor flags, CT-shadow key, public base URLs). Do not lose the CT-shadow key or the
> gateway/agent tokens.

## 6. Rollback plan

- Container: before recreate, `podman rename openbot-gateway-rc openbot-gateway-rc-prev-59be50660d-safety` and keep it.
- Image (rollback target): `localhost/openbot:rc-amd64-provenance-59be50660d` (digest `sha256:a64adc1f04f1…`).
- Control UI: flip the `control-ui` symlink back to `releases/<59be…>` (or restore the pre-swap backup dir).
- Existing older safety containers present: `openbot-gateway-rc-prev-33fc87c582-safety`, `openbot-gateway-rc-prev-1a6de1be5c-safety` (seq49/50; Exited 0).

## 7. Lock fields to be filled + approved by the owner

```
owner:              <repository owner / single accountable RC executor>
soleRcExecutor:     <same as owner>   # exactly one accountable executor; S01 stays with its owner
windowStart:        <UTC / Asia-Shanghai>
windowEnd:          <UTC / Asia-Shanghai>
liveShaVerifiedAt:  2026-09-01 (ledger seq51 build-info.commit=59be50660d…)  # re-verify immediately before cutover
candidateSha:       b915cb93cf5b7056b636cd2e1bc89ea58d24bd98        # == origin/main tip @ 2026-09-01; re-qualify if trunk advances
candidateDigest:    sha256:991c64d0f42b5174e40081f1e2ed34571ad7b4eb08c8a679a1a58d116a013ae3  # amd64; publish provenance tag or pin this digest
conflictFree:       true (resource level)
grant:              PENDING
```

## 8. Blockers before the lock can be granted

1. **env-file reconstruction** (`/tmp/openbot-gateway-rc-seq51.env` missing) — §5. Needs prod access.
2. **Immutable provenance image not published** — no `provenance/sha-b915cb93cf5b` tag → no
   GHCR `provenance-b915cb93cf5b-amd64`; qualified via the `main-amd64` digest
   `sha256:991c64d0…` (§3). Push the provenance tag (preferred) or pin the digest in the lock.
3. Owner + maintenance window not yet declared.

### Cleared since #885

- **Candidate re-lock** — candidate now == `origin/main` tip `b915cb93cf` (was `5daffc`);
  re-qualified 2026-09-01 (§3).
- **Delivery SoT anchor PR #884** — **MERGED** 2026-09-01T03:23:50Z as `af5970ad93`. This is a
  **code merge only, not a production cutover**: the ledger is unchanged and LIVE is still
  seq51 `59be5066` (`releases.jsonl` untouched by #884).
- **Delivery gates (2026-09-01)** — `delivery:ledger:audit` 51 releases / **0 errors** / 24
  historical warnings; `delivery:check-sot --use-release-record-live --sot-ref origin/main` =
  **allow** (candidate contains LIVE); `verify-forward-only --candidate b915cb93cf` = **allow**
  (deleted=[], reverted=[]); `verify-delivery-alignment` PASS=3/WARN=3/FAIL=0.
- **CI** — `CI Gate` is **green** on the candidate. The full `ci.yml` matrix is red on **every**
  recent trunk commit including the current LIVE `59be5066` and #884 `af5970ad` — identical
  failures (markdown-lint debt in pre-existing docs, extensions/windows test-env, `skills-python`
  ruff ×2, android `checkDebugAarMetadata`). These are **pre-existing trunk/runner debt, not a
  candidate defect**; required status checks are intentionally not enabled per repo policy.

## 9. Explicit non-authorizations

This request does **not** authorize: the seq52 cutover, any LIVE container swap, any Control
UI change, any `releases.jsonl` / `RELEASE_RECORD.md` write, image publish, S01 changes, or
any change to Stage C/D/E, `implementationVerified`, or `deployAuthorized`.
