# Rollback (blocked — no host deploy)

No staging-host container was started; no rollback drill required this wave.

When a host deploy lands, execute or dry-run:

```bash
ssh "$STAGING_SSH" 'docker rm -f openbot-gateway-staging-rc0'
# optionally re-run previous staging image
```

Production rollback reference (not executed): LOCKED_BASE `85eee3e7…` / `openbot:rc-amd64-v69` / `openbot-gateway-rc` — see `../staging/rollback.md`.
