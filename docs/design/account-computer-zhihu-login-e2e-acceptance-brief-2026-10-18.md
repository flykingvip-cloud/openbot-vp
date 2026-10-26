# Account Computer — 知乎真站登录 e2e（QR / SMS handoff）acceptance brief

**Date:** 2026-10-18 (Asia/Shanghai)  
**Audience:** 「Account Computer 本机验收」 / Brian  
**Branch tip under test:** `cursor/account-computer-zhihu-login-e2e` on top of `origin/main`  
**Claim level:** Gated live open of **zhihu.com/signin** in Account Worker Docker browser (or optional host Chrome) → DOM detect App QR / SMS / WeChat OAuth popup → classifier handoff → gateway **「交给AI」** + mocked `await_return`. **Does not** auto-scan WeChat, receive SMS, or assert a completed Zhihu session.

## Why Zhihu

Brian asked for a real CN site covering mainstream **微信扫码** and **手机验证码** participation. Fixture-level #825 proved the product path; this slice proves the **same handoff wiring against a live third-party login page** without claiming automated login success.

## Surfaces scouted (2026-10-18, Mac headless Chrome, HTTP 200)

| Surface         | How it appears                                  | Selectors / URL patterns                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry           | `https://www.zhihu.com/signin` (also `/signup`) | `.SignFlowHomepage`, `form.SignFlow.Login-content`                                                                                                                                                                                 |
| 知乎 App 扫码   | Left panel default                              | `.signQr-container` / `.Qrcode-container`; QR rendered as `canvas` (~120×120); copy「打开知乎App」「其他扫码方式：微信」                                                                                                           |
| 短信验证码      | Right form default tab「验证码登录」            | `input[name="username"][type="tel"]` placeholder「手机号」; `input[name="digits"]` maxLength 6 placeholder「输入 6 位短信验证码」; button「获取短信验证码」`.SignFlow-smsInputButton`; submit「登录/注册」`.SignFlow-submitButton` |
| 密码登录        | Tab「密码登录」                                 | `input[name="password"][type="password"]` placeholder「密码」                                                                                                                                                                      |
| 微信 OAuth 扫码 | 「其他方式登录」WeChat social button            | `button.Login-socialButton` + `svg.ZDI--Wechat24` → **popup** `https://open.weixin.qq.com/connect/qrconnect?appid=wx268fcfe924dcb171&redirect_uri=https%3A%2F%2Fwww.zhihu.com%2Foauth%2Fcallback%2Fwechat...&scope=snsapi_login`   |
| Captcha         | Not present on cold load in this scout          | `captcha.zhihu.com` exists in client config; gate must fail loud if SignFlow missing / wall blocks                                                                                                                                 |

## Gate / env

| Env                                         | Role                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E=1`         | Enable live Zhihu open + detect + handoff (required)                           |
| `OPENBOT_ACCOUNT_ZHIHU_LOGIN_URL`           | Override entry (default `https://www.zhihu.com/signin`)                        |
| `OPENBOT_ACCOUNT_ZHIHU_LOGIN_BROWSER`       | `worker` (default) or `host` (Chrome channel; for Mac without Worker image)    |
| `DOCKER_HOST`                               | Worker mode; when unset under Vitest HOME, auto-points at Docker Desktop sock  |
| `OPENBOT_ACCOUNT_WORKER_BROWSER_IMAGE`      | Optional Worker browser image override                                         |
| `OPENBOT_ACCOUNT_ZHIHU_OPEN_WECHAT_OAUTH=1` | Also click WeChat social and assert `open.weixin.qq.com` popup (still no scan) |

Ungated: brief + selector/classifier contract only. Gate on + network/SignFlow blocked / Docker unreachable (worker mode) / missing Chromium image → **throw** (not soft-pass).

## Automated coverage (this PR)

| Step                                                      | Automated?                                     |
| --------------------------------------------------------- | ---------------------------------------------- |
| Open live Zhihu signin                                    | Yes (gated)                                    |
| Detect App QR + SMS (and optional WeChat OAuth popup)     | Yes                                            |
| `classifyAccountComputerLogin` → `handoff` `qr` / `sms`   | Yes                                            |
| `secure_form.handoff` instruction contains **「交给AI」** | Yes                                            |
| Mock user return via `releaseControl` → `await_return`    | Yes                                            |
| Brian WeChat scan / SMS OTP / real session cookie         | **No — Brian must do this live**               |
| Assert logged-in Zhihu home                               | **No** (would require real credentials / scan) |

## What Brian must do for full live proof

1. Run gated vitest (or product Account Computer) so cloud/desktop browser shows `zhihu.com/signin`.
2. When handoff is active: either scan the **App/WeChat QR**, or enter **phone + SMS OTP** on the form.
3. After Zhihu shows signed-in state, tap **「交给AI」**.
4. Confirm agent resumes (this automated suite only mocks that return).

Do **not** commit phone numbers, OTP, or Zhihu cookies.

## Commands (Mac worktree)

```bash
cd "/Users/daniel/AI VP/openbot-p6-fully-met-scout"
git rev-parse HEAD

# Ungated
pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-zhihu-login.test.ts

# Live — Worker Docker (preferred)
export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.docker/run/docker.sock}"
OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E=1 pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-zhihu-login.test.ts

# Live — host Chrome fallback
OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E=1 OPENBOT_ACCOUNT_ZHIHU_LOGIN_BROWSER=host \
  pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-zhihu-login.test.ts

# Also open WeChat OAuth popup (still no scan)
OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E=1 OPENBOT_ACCOUNT_ZHIHU_OPEN_WECHAT_OAUTH=1 \
  OPENBOT_ACCOUNT_ZHIHU_LOGIN_BROWSER=host \
  pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-zhihu-login.test.ts
```

## What this does / does not claim

| Claims                                                          | Does not claim                               |
| --------------------------------------------------------------- | -------------------------------------------- |
| Live `zhihu.com/signin` reachable + SignFlow DOM                | Completed Zhihu login / `z_c0` session       |
| Detect App QR canvas + SMS fields (+ optional WeChat OAuth URL) | Automated WeChat client scan                 |
| Classifier `qr`/`sms` → handoff; instruction **「交给AI」**     | Automated SMS receive / carrier OTP          |
| Mocked `releaseControl` wakes `await_return`                    | Production device cutover / dual-flag change |
| Gate-on failures are loud                                       | Fixture-only proof (that is #825)            |

## Suggested 本机验收 focus

1. Tip contains this brief + `account-computer-zhihu-login.test.ts`.
2. Ungated vitest **PASS**.
3. With gate on (Worker or host), live detect + handoff **PASS**.
4. zh-CN hand-back remains **「交给AI」**.
5. No secrets committed.
6. 合 main 前再问 Brian；确认前勿合/undraft。
