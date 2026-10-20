# Domain and origin checklist

## Host → surface

| DNS name             | UI surface  | Notes                                                     |
| -------------------- | ----------- | --------------------------------------------------------- |
| `admin.openbot.love` | platform    | Platform operators; primary `OPENBOT_PUBLIC_APP_BASE_URL` |
| `biz.openbot.love`   | enterprise  | Enterprise admin console                                  |
| `gw.openbot.love`    | employee    | Employee workbench                                        |
| `openbot.love`       | public home | Marketing / entry; no identity headers                    |
| `www.openbot.love`   | public home | Same as apex                                              |

Source of truth in code: `ui/src/ui/routing/subdomain-resolver.ts` (`SUBDOMAIN_PORT_MAP`).

## `allowedOrigins` (must match browser scheme+host)

```text
https://admin.openbot.love
https://biz.openbot.love
https://gw.openbot.love
https://openbot.love
https://www.openbot.love
```

Staging example (replace with real staging hosts):

```text
https://admin.staging.example.com
https://biz.staging.example.com
https://gw.staging.example.com
```

## Env

| Variable                      | Example                      | Why                                                                   |
| ----------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `OPENBOT_PUBLIC_APP_BASE_URL` | `https://admin.openbot.love` | Public platform login route allowlist                                 |
| `OPENBOT_GATEWAY_TOKEN`       | (secret)                     | Optional for CLI/token surfaces; trusted-proxy is primary for browser |
| `OPENBOT_STATE_DIR` / volume  | `/data`                      | Config + state persistence                                            |

## DNS

| Record               | Target                            |
| -------------------- | --------------------------------- |
| A/AAAA for each host | Edge host (or LB) that runs nginx |
| Optional CAA         | Your ACME issuer                  |

Do **not** publish a public A record pointing at the Gateway process port.
