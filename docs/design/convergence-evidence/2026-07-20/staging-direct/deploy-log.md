# Deploy log (local)

1. Tip worktree `openbot-rc0-staging` @ `9aceda7349` verified (LOCKED_BASE ancestor).
2. Reused image `openbot:rc-convergence-20260720` (already built; version 9aceda7).
3. First run failed: non-loopback Control UI without allowedOrigins.
4. Second attempt bind loopback only — healthz empty reply (Docker port map needs 0.0.0.0 inside container).
5. Final run: `--bind lan` + `controlUi.allowedOrigins` for 127.0.0.1:18799 → **healthy**.
6. No production SSH/deploy.

Config fix applied only in ephemeral `/tmp/openbot-staging-rc0.*` state (not committed secrets).
