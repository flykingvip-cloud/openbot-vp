# tencent-survey scripts

## OpenBot Gateway secrets

| Env                    | Required  | Purpose                                     |
| ---------------------- | --------- | ------------------------------------------- |
| `TENCENT_SURVEY_TOKEN` | preferred | Personal token (`wjpt_…`); binds one team   |
| `WJ_API_BASE_URL`      | optional  | Default `https://wj.qq.com`                 |
| `WJ_AUTH_PAGE_URL`     | optional  | Default `https://wj.qq.com/oauth/authorize` |

Configure `TENCENT_SURVEY_TOKEN` via OpenBot Gateway secrets when possible. Never paste full tokens in chat.

## setup.sh

Canonical copy lives at skill root (`../setup.sh`) for `${SKILL_DIR}/setup.sh`. This directory holds the same script for discoverability.

```bash
# Token already in env
TENCENT_SURVEY_TOKEN=xxx bash "${SKILL_DIR}/setup.sh" wj_check_and_start_auth
# Expect: READY

# OAuth device flow
bash "${SKILL_DIR}/setup.sh" wj_check_and_start_auth
# If AUTH_REQUIRED:<url> → show user, then:
bash "${SKILL_DIR}/setup.sh" wj_wait_auth
```

Outputs: `READY` | `AUTH_REQUIRED:<url>` | `TOKEN_READY:ok` | `AUTH_TIMEOUT` | `ERROR:*`
