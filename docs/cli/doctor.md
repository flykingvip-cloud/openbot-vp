---
summary: "CLI reference for `openbot doctor` (health checks + guided repairs)"
read_when:
  - You have connectivity/auth issues and want guided fixes
  - You updated and want a sanity check
title: "doctor"
---

# `openbot doctor`

Health checks + quick fixes for the gateway and channels.

Related:

- Troubleshooting: [Troubleshooting](/gateway/troubleshooting)
- Security audit: [Security](/gateway/security)

## Examples

```bash
openbot doctor
openbot doctor --repair
openbot doctor --deep
```

Notes:

- Interactive prompts (like keychain/OAuth fixes) only run when stdin is a TTY and `--non-interactive` is **not** set. Headless runs (cron, Telegram, no terminal) will skip prompts.
- `--fix` (alias for `--repair`) writes a backup to `~/.gmood2008/openbot.json.bak` and drops unknown config keys, listing each removal.
- State integrity checks now detect orphan transcript files in the sessions directory and can archive them as `.deleted.<timestamp>` to reclaim space safely.
- Doctor also scans `~/.openbot/cron/jobs.json` (or `cron.store`) for legacy cron job shapes and can rewrite them in place before the scheduler has to auto-normalize them at runtime.
- Doctor deletes credential files left behind by removed features. The cloud drive knowledge import (baidu / aliyun / quark) stored encrypted OAuth tokens at `~/.openbot/knowledge/cloud-drive-credentials.json` alongside its key file; doctor removes both, because nothing refreshes or revokes those tokens once the feature is gone. Revoke the grant at the provider as well.
- Doctor includes a memory-search readiness check and can recommend `openbot configure --section model` when embedding credentials are missing.
- If sandbox mode is enabled but Docker is unavailable, doctor reports a high-signal warning with remediation (`install Docker` or `openbot config set agents.defaults.sandbox.mode off`).

## macOS: `launchctl` env overrides

If you previously ran `launchctl setenv OPENBOT_GATEWAY_TOKEN ...` (or `...PASSWORD`), that value overrides your config file and can cause persistent “unauthorized” errors.

```bash
launchctl getenv OPENBOT_GATEWAY_TOKEN
launchctl getenv OPENBOT_GATEWAY_PASSWORD

launchctl unsetenv OPENBOT_GATEWAY_TOKEN
launchctl unsetenv OPENBOT_GATEWAY_PASSWORD
```
