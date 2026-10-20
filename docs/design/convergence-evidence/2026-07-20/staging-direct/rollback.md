# Rollback

## Local sim

```bash
docker rm -f openbot-staging-rc0-sim
```

## Production (if ever deployed — NOT done this wave)

Revert to `openbot:rc-amd64-v69` @ `85eee3e7b987…` per HUMAN-PRODUCTION-CUTOVER-CHECKLIST.
