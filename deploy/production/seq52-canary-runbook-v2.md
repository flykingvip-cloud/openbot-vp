# seq52 Canary Runbook v2 (REVIEW ONLY)

Status: **REVIEW ARTIFACT — NOT an authorization to deploy.** No production container, Control
UI root, GHCR tag, release ledger, image, Stage gate, or flag is changed by this document or
by producing it. Execution requires a granted deployment lock (see
`seq52-deployment-lock-request.md`) and the gates below.

Prepared by: `kiro-release-authority` · 2026-09-01 (UTC)

## Final verdict: **HOLD** (qualification GREEN; execution blocked on operator/prod-side items)

Re-qualified 2026-09-01 against `origin/main` tip `b915cb93cf5b7056b636cd2e1bc89ea58d24bd98` (#885).

- **Not NO-GO — no candidate defect.** All delivery gates pass for `b915cb93cf`
  (`ledger:audit` 0 errors; `check-sot --use-release-record-live --sot-ref origin/main` =
  `allow`; `verify-forward-only` = `allow`, no regressions; `verify-delivery-alignment` PASS).
  The image is digest-verified (`sha256:991c64d0…`, OCI `image.revision` + `/app/dist/build-info.json`
  commit both == candidate, full gateway + Control UI, linux/amd64). Candidate UI static
  integrity smoke passed. The `ci.yml` matrix red is **pre-existing trunk/runner debt** (identical
  on the current LIVE `59be5066`), **not** a candidate defect; `CI Gate` is green on the candidate.
- **Not CANARY-READY-to-execute** — blocked on: (1) deployment lock not granted (no owner /
  window); (2) LIVE env-file `/tmp/openbot-gateway-rc-seq51.env` missing (must reconstruct from
  the running container — needs prod access); (3) no immutable `provenance/sha-b915cb93cf5b`
  image on GHCR (qualified via the `main-amd64` digest; push the provenance tag or pin the
  digest); (4) full browser UI smoke + gateway-level canary rollback rehearsal for `b915cb93cf`
  pending a granted window.

Standing state (unchanged): `Production deployment: CANARY ONLY` · `Full production cutover:
NOT AUTHORIZED` · `Stage C: NOT ACCEPTED` · `Stage D/E: LOCKED` · `implementationVerified=false`
· `deployAuthorized=false`.

## Evidence already gathered (staging-only rehearsal, LIVE untouched)

- Candidate UI (from amd64 digest `sha256:991c64d0…`, SHA `b915cb93cf`): entry
  `index-DydJ4HD3.js`, index.html sha256 `59389b1c…`, **56 files / 8,247,322 bytes**, manifest
  fingerprint `a6e39526…`, self-contained (0 missing index.html refs, 0 dangling entry chunks).
  index.html + entry are hash-identical to the earlier `5daffc` rehearsal (hashed JS/CSS graph
  unchanged); the byte delta is confined to non-entry static assets.
- LIVE control-ui inventory: 174 files = 33 shared static + 141 live-only (52 stale old-build
  hashed chunks + 89 junk: macOS `._*` AppleDouble + `.js.map` source maps). **Candidate
  misses no required asset.**
- Isolated smoke (non-prod `:18795`, bridge, throwaway state, staging UI read-only): `healthz`
  live, `readyz` ready, served entry `index-DydJ4HD3.js`, entry JS / CSS / `/login` /
  `/enterprise` all 200. No prod-state write (prod control-ui mtime unchanged).
- Atomic switch rehearsal (scratch): `releases/<sha>` + `control-ui` symlink, single `mv -T`
  (`rename(2)`) switch + rollback, target always valid.

## Gates (all must pass, in order)

- **G0 · Re-lock baseline.** `git fetch`; candidate = freshest `origin/main` tip
  (currently `b915cb93cf`); `merge-base --is-ancestor <LIVE 59be…> <candidate>` (forward-only);
  `pnpm delivery:check-sot --use-release-record-live --sot-ref origin/main` = `allow` (the flag
  is `--sot-ref`, not `--trunk-ref`); resolve an **immutable digest** — either GHCR
  `provenance-<sha>-amd64` (push a `provenance/sha-<sha>` tag first) or pin the `main-amd64`
  digest and verify (OCI `image.revision` == candidate, `/app/dist/build-info.json` commit ==
  candidate, full gateway + Control UI); re-run the UI manifest (export from that exact digest).
- **G1 · Deployment lock granted** (owner + window filled in the lock request).
- **G2 · Env-file reconstructed** from the running container to a non-`/tmp` path; parity
  verified; `ct-shadow.env` retained.

## Procedure (same-SHA gateway + UI)

1. **Pull image** (no host build): `podman pull ghcr.io/gmood2008/openbot@<candidate-digest>`;
   confirm `org.opencontainers.image.revision == <candidate>` and `/app/dist/build-info.json`
   commit == candidate.
2. **Stage + atomically switch UI** (never edit the live dir in place):
   export image `/app/dist/control-ui` → `releases/<candidate>/`; because the current LIVE
   `control-ui` is a plain directory, first-time adoption converts it to a `releases/<59be…>`
   dir + a `control-ui` symlink (one-time migration), then
   `ln -s releases/<candidate> control-ui.next && mv -T control-ui.next control-ui`
   (single `rename(2)`). Interim fallback if not migrating to symlinks: back up
   `control-ui` → `control-ui.prev-59be-<ts>`, then swap in the staged dir; document the
   two-rename tradeoff. **Never** `rsync --delete` over the live root.
3. **Recreate the gateway container** (align seq44 gold-run):
   ```
   podman rename openbot-gateway-rc openbot-gateway-rc-prev-59be50660d-safety
   podman run -d --name openbot-gateway-rc --network host --user 0 --restart always \
     --ulimit nproc=4194304:4194304 \
     --env-file <reconstructed-env-file> \
     --env-file /root/.openbot-ct-shadow/ct-shadow.env \
     -v /var/lib/openbot/state:/root/.openbot \
     -v /var/lib/openbot/tenants:/root/openbot-tenants \
     <candidate-image> \
     node openbot.mjs gateway --bind loopback --port 18789
   ```

## Post-cutover checks

- `podman exec openbot-gateway-rc cat /app/dist/build-info.json` → `commit == candidate`.
- `healthz` 200 + `readyz` ready.
- Served Control UI entry == candidate index (consistent across container / loopback / public).
- Re-run forward-only + delivery alignment gates.
- **CTR dormant assertion**: detection/qualification flags OFF, allowlist empty (deploy is code
  only; no activation).

## Rollback trigger (any check fails)

```
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-59be50660d-safety openbot-gateway-rc
podman start openbot-gateway-rc
# UI: mv -T control-ui.next-out ... ; flip control-ui symlink back to releases/<59be…>
```

Then re-verify `healthz`/`readyz` + old entry `index-Dpg8P1UR.js`.

## Ledger (post-approval only)

Only **after** a successful cutover, and as a separate approved action, append `releases.jsonl`
seq 52 and update `RELEASE_RECORD.md` (build-info evidence, UI entry, rollback path). This
runbook does not write the ledger.

## Prohibited during seq52

Stage C/D/E unlock · workspace-resolver toggle · Catalog / schema v2 write · legacy retirement
· any seq52 step without a granted lock · disturbing the S01 shadow stream.
