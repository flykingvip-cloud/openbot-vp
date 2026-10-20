# Isolation proof (blocked — N/A)

Cannot produce a live isolation table without a named staging host.

## Forbidden targets (not used)

| Production asset                | Status this wave            |
| ------------------------------- | --------------------------- |
| Host `8.217.93.71`              | **not contacted**           |
| Container `openbot-gateway-rc`  | **not touched**             |
| Image tag `rc-amd64-v69`        | **not overwritten**         |
| State `/root/.openbot`          | **not used**                |
| Domains `*.openbot.love` (prod) | **not targeted as staging** |

## Required isolation (for future SUCCESS)

| Staging must use                                                      | Production contrast                   |
| --------------------------------------------------------------------- | ------------------------------------- |
| Distinct SSH host or explicit isolation plan                          | Not silent reuse of prod IP           |
| Container ≠ `openbot-gateway-rc` (e.g. `openbot-gateway-staging-rc0`) | Prod container name                   |
| State under `/var/lib/openbot/staging` (or equiv.)                    | Not `/root/.openbot`                  |
| URL `admin.staging.*` (or staging-only IP)                            | Not `admin.openbot.love` as “staging” |
