# COLLAB CSC persistent env-file divergence (2026-08-24)

Read-only root-cause audit (P1). Finding: the production host's persistent env files
carry five inbound/CSC flags set to `1`, while the running gateway container has none of
them. This documents the divergence, its cause, impact, and remediation. No production
change was made during this investigation.

- LIVE_TOUCHED: NO
- FLAGS_CHANGED: NO
- SHADOW_ENABLED: NO

## Env files (SHA256 + mtime)

- `/root/.openbot/.env` — sha256 `5560f129bbeb79c54188572885d125772dba4366255d35ad7e46e948870dcd30`, mode 600, size 1732, mtime 2026-08-20 13:54:15 +0800
- `/root/.openbot/.env.docker` — sha256 `a3f49149f16bdba99d69f45fbeb557152f5eaa359305cb6cd254a0ad5d40ecdf`, mode 644 (world-readable), size 1682, mtime 2026-08-22 21:13:45 +0800

## Residual flags (variable names + status)

Both `.env` and `.env.docker` contain these five keys set to `1`:

- `OPENBOT_CHAT_INBOUND_PERSIST_EARLY=1`
- `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1`
- `OPENBOT_CHAT_INBOUND_DEPTH_ROUTER=1`
- `OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY=1`
- `OPENBOT_CHAT_INBOUND_TOOL_POLICY=1`

`.env.docker` additionally carries `OPENBOT_PROGRESS_LEDGER_ENABLED` (added by the
2026-08-22 edit; see snapshot history).

## Historical recreate snapshots (count, range, inbound-flag counts)

In `/root/.openbot/` there are 11 historical `.env.docker.recreate-*` / `.env.docker.bak-*`
snapshots spanning 2026-07-22 to 2026-07-25, and each has an inbound-flag count of 0 (none
of the five flags). The two recent artifacts carry all five: the current `.env.docker`
(2026-08-22) and `.env.docker.bak-pre-ledger-flag-20260822T131345Z`. So the five inbound
flags were introduced after the July recreate era (present by 2026-08-20), and the
2026-08-22 edit only added the progress-ledger key (confirmed by a name-level diff against
the pre-ledger-flag backup).

## Running container

- created: 2026-08-24 06:37:47 +0800
- started: 2026-08-24 06:37:47 +0800
- image: `localhost/openbot:rc-amd64-provenance-a12e4c59e575` (label `org.opencontainers.image.revision=a12e4c59e575`)
- command: `docker-entrypoint.sh` then `node openbot.mjs gateway --bind loopback --port 18789`
- build-info commit: `a12e4c59e5754e0c280b423c68c989c6973ac9b0`
- healthz 200, readyz `{ready:true, failing:[]}`

## Runtime flag state

The running container's environment (45 variables) contains none of the five inbound flags;
all are unset. Production has therefore been correctly shadow-off despite the env-file
contents.

## Container env-source judgment (with evidence)

The running container was NOT started from the current `.env` or `.env.docker`:

- Both env files' mtimes (2026-08-20 / 2026-08-22) predate the container's creation
  (2026-08-24), yet the container lacks the five flags they contain.
- Variable-name set differencing: the running container's variable set equals
  `.env.docker`'s set minus exactly `{the five inbound flags + OPENBOT_PROGRESS_LEDGER_ENABLED}`
  (`.env.docker` names in-common with runtime = 35 of 41; the 6 missing names are precisely
  those flags). `.env` names in-common with runtime = 22 of 33.
- Conclusion: the container was recreated on 2026-08-24 from a deliberately flag-stripped
  env snapshot, which is why runtime is clean. The exact snapshot/command was not found in
  root shell history.
- Management: the container runs under podman with `--restart always`. The systemd unit
  `openbot-gateway.service` is masked (symlinked to `/dev/null`, inactive); its historical
  drop-in referenced `EnvironmentFile=-/root/.openbot/.env`. No compose/quadlet labels are
  present on the container.

## Recreate-source / automation check

- Active root cron: only `verify-ghost-bot-health.sh` (every 6h). It performs health checks
  and does not recreate, restart, stop, or `--env-file` the gateway container, and makes no
  reference to the inbound flags. So there is no automated path that would re-enable the
  flags on a schedule.
- Other cron entries referencing the gateway/UI are disabled or frozen (commented out).
- No active systemd/quadlet unit manages the container.

## Root cause

Legacy CSC experimentation left the five inbound flags set to `1` in both persistent env
files. The current gateway was recreated from a flag-stripped snapshot, so the live process
is clean, but the persistent files diverge from the running state.

## Impact

The immediate risk has converged from "wrong running state" to "future mis-enable risk":
any future container recreate that uses `--env-file /root/.openbot/.env` or
`/root/.openbot/.env.docker` would silently enable four prohibited flags
(`PERSIST_EARLY`, `DEPTH_ROUTER`, `KNOWLEDGE_POLICY`, `TOOL_POLICY`) plus `DEPTH_SHADOW`,
rather than a shadow-only change. The `csc-shadow-recreate.sh plan` assumption of
`--env-file .env.docker` is therefore unsafe as-is.

## Remediation (recommended)

1. Remove the five inbound keys from `/root/.openbot/.env` and `/root/.openbot/.env.docker`
   in a scoped, reversible edit (backups kept), with no container restart/recreate, so the
   persistent config matches the clean running state.
2. After cleanup, re-verify runtime is unchanged (build-info still `a12e4c59e575`, healthz
   200, readyz ready, inbound flags unset, container StartedAt unchanged).
3. Only after the persistent config is trustworthy, redesign shadow-only enable to reproduce
   the running container's actual environment (which lacks these flags) and add only
   `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1`, with health-gate + identity-drift + auto-rollback.

## Prohibitions (this stage)

No container restart/recreate, no shadow enable, no P2/P3, no `RELEASE_RECORD.md` or
`releases.jsonl` change, no LIVE ledger row.

## Confidence

- HIGH: the persistent env files diverge from runtime and would re-enable the prohibited
  flags if used for a recreate (proven by variable-set differencing).
- HIGH: no active automation recreates/restarts the gateway (no scheduled auto-enable risk).
- MEDIUM: the exact env source/command used for the 2026-08-24 clean recreate is not
  positively identified (not present in root shell history).

## Remediation executed (Authorization 2, 2026-08-25)

Scoped, reversible cleanup of the five inbound keys from both env files, with no container
restart/recreate. A strict per-file diff-guard confirmed only those five keys were removed
(no other line changed; `OPENBOT_PROGRESS_LEDGER_ENABLED` and all other `OPENBOT_*` keys
preserved). Backups kept as `<file>.before-inbound-cleanup.20260825T042112Z` (mode 600).

- `/root/.openbot/.env`: sha256 `5560f129…dcd30` to `8241cf425a94eae5b2f99e1de615b3bdb266938c405b26c09a9c8966b50723ea`; inbound flags 5 to 0; mode 600 preserved.
- `/root/.openbot/.env.docker`: sha256 `a3f49149…ecdf` to `030f738f71f1b51a0d1fb035bb63611753a61d7e79f788a058f2ecd08b5f4a36`; inbound flags 5 to 0; `OPENBOT_PROGRESS_LEDGER_ENABLED` retained; mode 644 preserved.

### Runtime unchanged after cleanup

- build-info commit `a12e4c59e5754e0c280b423c68c989c6973ac9b0` (unchanged)
- healthz 200; readyz `{ready:true, failing:[]}`
- runtime inbound/CSC flags: all unset
- container `StartedAt` 2026-08-24 06:37:47 +0800 (unchanged); `RestartCount` 0 (not restarted or recreated)

### Audit artifact disposal

- `/root/openbot-gateway-rc.inspect.readonly.json` (secret-bearing, sha `a8a0894b…`) securely deleted with `shred -u`.
- `/root/openbot-gateway-rc.env-names.readonly.txt` deleted.
- `csc-shadow-recreate.sh` retained but marked non-executable, pending re-review against the cleaned env.

Persistent config now matches the clean running state. Shadow remains OFF; no container
change; `RELEASE_RECORD.md` / `releases.jsonl` untouched. A future shadow-only enable
requires a fresh plan (the prior script is quarantined, not to be reused as-is).
