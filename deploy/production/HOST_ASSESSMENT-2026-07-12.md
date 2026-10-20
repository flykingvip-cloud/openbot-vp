# Host assessment — 8.217.93.71 (openbot.love)

Date: 2026-07-12  
Path: Plan A (production domains, no admin.staging.\*)

## Topology

- Deploy: npm global `@upbeyond/openbot@1.0.1` + `openbot-gateway.service`
- Gateway: loopback `127.0.0.1:18789` (public :18789 timed out from outside — OK)
- Edge: nginx + Let’s Encrypt for admin/biz/gw/www/openbot.love
- Pack: `~/openbot-production/` (rsync/tar from RC `deploy/production`)

## Smoke (this session)

| Check                                       | Result               |
| ------------------------------------------- | -------------------- |
| smoke --local-only                          | PASS                 |
| smoke --base-url https://admin.openbot.love | PASS                 |
| smoke --base-url https://gw.openbot.love    | PASS                 |
| Public :18789                               | blocked/timeout (OK) |

## Changes applied this session

1. `gateway.controlUi.allowedOrigins` includes `https://gw.openbot.love` (+ full five-host set)
2. `data.mode=managed` written into openbot.json (aligned with systemd)
3. `OPENBOT_PUBLIC_APP_BASE_URL=https://admin.openbot.love` in `/root/.openbot/.env`
4. systemd drop-in `EnvironmentFile=-/root/.openbot/.env` so Primary env is loaded
5. gateway restarted; service active

## Remaining gaps (not blocking smoke)

| Item                                                 | Severity | Note                                                           |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------- |
| Not on openbot:rc Docker image                       | Info     | Still npm 1.0.1 (1604655); RC image optional later             |
| OPENCLAW\_\* still in .env                           | Low      | Wave 3 prefers OPENBOT Primary; aliases OK if Primary set      |
| `allowInsecureAuth` / `dangerouslyDisableDeviceAuth` | **High** | Logged on boot — run `openbot security audit` and harden       |
| No GATEWAY_TOKEN in process env                      | Med      | trusted-proxy path; chrome relay warned about missing token    |
| SKIP_CHANNELS in env                                 | Info     | intentional?                                                   |
| B4 OPENBOT_MULTITENANT                               | N/A      | not enabled; shared isolation still kiro work                  |
| nginx vs Wave2 pack                                  | Info     | Existing confs already correct headers; pack kept as reference |

## Do not

- Point DNS of openbot.love away from this host without cutover plan
- Enable MULTITENANT until tenant-context P1–P4 green

## Security hardening (2026-07-12 later)

| Item                                | Result                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `allowInsecureAuth`                 | **false**                                                                                                        |
| `dangerouslyDisableDeviceAuth`      | **false**                                                                                                        |
| `OPENBOT_GATEWAY_TOKEN` in `.env`   | set (64 hex)                                                                                                     |
| `gateway.auth.token`                | SecretRef → `OPENBOT_GATEWAY_TOKEN`                                                                              |
| Browser control                     | `auth=token`                                                                                                     |
| security audit dangerous-flags warn | **cleared**                                                                                                      |
| Remaining audit critical            | `trusted_proxy_auth` (expected), `loopback_no_auth` (token inactive while mode=trusted-proxy — product behavior) |
| Smoke after harden                  | PASS admin edge 9/9                                                                                              |
| Backup                              | `/root/.openbot/hardening-backup-20260712`                                                                       |
| RC image                            | `openbot:rc` loaded; cutover **not** activated (see cutover/README.md)                                           |
