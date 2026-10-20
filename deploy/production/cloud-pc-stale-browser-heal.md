# Cloud PC stale browser heal (temporary)

Use this only to make a LIVE cloud PC usable **before** the host-bind fix is in the running gateway image. After that image is the gateway, the next start binds `/var/lib/openbot/tenants/...` (the directory the gateway already mounts at `/root/openbot-tenants`) and a dead browser is no longer left as `phase=RUNNING`. This heal is not part of the steady state.

Run on the host as root. Do not chown the host directory `/root/openbot-tenants`. That tree is a different inode from the gateway mount.

```bash
TENANT=001
USER=<platform-user-id>
PROFILE="/var/lib/openbot/tenants/${TENANT}/users/${USER}/state/browser"
JOURNAL="/var/lib/openbot/state/sandbox/account-worker/workers/${TENANT}/${USER}/worker.json"

# 1. Ownership of the real bind source (sandbox uid 1000).
chown -R 1000:1000 "$PROFILE"

# 2. Remove the exited browser container. Name is in worker.json browserContainerName.
podman rm -f "$(jq -r '.browserContainerName // empty' "$JOURNAL")"

# 3. Stop pretending the dead browser is RUNNING.
jq '.phase = "STOPPED"
  | .browserPid = null
  | .browserContainerName = null
  | .execContainerName = null
  | .lastFailure = "cloud PC browser exited; restart required"' \
  "$JOURNAL" > "${JOURNAL}.tmp"
mv "${JOURNAL}.tmp" "$JOURNAL"
```

Then start the cloud PC from the UI. `aw-browser-*` should stay Up, and `/sandbox/novnc/static/.../core/rfb.js` should return 200 while that browser is running.

Do not `chown` `/root/openbot-tenants` on the host. Account Worker must not bind that path.
