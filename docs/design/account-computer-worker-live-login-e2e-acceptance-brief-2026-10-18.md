# Account Computer — Worker Docker browser live-login e2e acceptance brief

**Date:** 2026-10-18 (Asia/Shanghai)  
**Audience:** 「Account Computer 本机验收」  
**Branch tip under test:** `cursor/account-worker-docker-live-login-e2e` on top of `origin/main`  
**Claim level:** Gated **Account Worker Docker browser** + published CDP + **production** Secure Form fill host against a **public demo IdP**. Not corporate SSO / passkey / host-Chrome-only / device cutover.

## Why this slice

Live-login #820 (`account-computer-live-login.test.ts`) used **host Chrome** (`channel: "chrome"`) with an allocated CDP port. This brief covers the next honest step: the same Secure Form fill → success → handoff → **「交给AI」** path, but Chromium runs **inside the Account Worker Docker browser container** (`aw-browser-*`), with CDP reached via Docker’s published host port map (`readDockerPort` → container `9222`).

## Default demo IdP (no Brian personal credentials)

| Item | Default |
|---|---|
| URL | `https://authenticationtest.com/simpleFormAuth/` |
| Host | `authenticationtest.com` |
| E-Mail | `simpleForm@authenticationtest.com` (printed on the page) |
| Password | `pa$$w0rd` (printed on the page) |
| Success | URL matches `loginSuccess`; body contains `Success! You are now logged in` |

These credentials are **public documentation on the IdP**, not secrets. Override with the same `OPENBOT_ACCOUNT_LIVE_LOGIN_*` env vars as #820 when pointing at staging (never commit staging secrets).

## Gate / env

| Env | Role |
|---|---|
| `OPENBOT_ACCOUNT_WORKER_LIVE_LOGIN_E2E=1` | Enable the Worker Docker live case (required) |
| `DOCKER_HOST` | Optional; when unset under Vitest isolated HOME, auto-points at Docker Desktop sock |
| `OPENBOT_ACCOUNT_WORKER_BROWSER_IMAGE` | Optional browser image override (must be a real Chromium sandbox image) |
| `OPENBOT_ACCOUNT_LIVE_LOGIN_URL` / `_HOST` / `_USER` / `_PASSWORD` / selectors / `_SUCCESS_URL_RE` | Same optional overrides as host live-login #820 |

Ungated default suite: brief + gate contract only (no Docker). When the gate is on, an unreachable daemon or missing real browser image **throws** (not soft-pass / alpine-smoke).

## Automated coverage

| File | Role |
|---|---|
| `src/agents/sandbox/account-computer-worker-live-login.test.ts` | Gate doc + Worker Docker CDP fill + handoff→给AI |
| `src/browser/account-browser-namespace.ts` | `registerAccountBrowserCdpPortForTests` for Docker-mapped host CDP |
| (existing) `account-computer-live-login.test.ts` | Host Chrome live-login (unchanged) |
| (existing) `account-worker-driver.test.ts` | Docker driver unit + optional daemon smoke (unchanged) |

## Commands (Mac worktree)

```bash
cd "/Users/daniel/AI VP/openbot-p6-fully-met-scout"
git rev-parse HEAD

# Ungated (always)
pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-worker-live-login.test.ts

# Live Worker Docker (needs daemon + openbot/openclaw-sandbox-browser image + network)
export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.docker/run/docker.sock}"
OPENBOT_ACCOUNT_WORKER_LIVE_LOGIN_E2E=1 pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-worker-live-login.test.ts
```

Requires Docker daemon + **real** sandbox browser image (`openbot-sandbox-browser:bookworm-slim` or alias). Does **not** claim enterprise IdP / Okta / Azure AD.

## What this does / does not claim

| Claims | Does not claim |
|---|---|
| `createDockerAccountSandboxDriver().startBrowser` → `aw-browser-*` | Host Chrome alone filled the page |
| Docker-published CDP (`readDockerPort` → container 9222) registered for fill-host peek | Corporate Okta/Azure AD/WeChat SSO |
| Production `createSecureFormFillDeps` filled via that CDP | Passkey / QR / captcha takeover |
| Site submit → public demo success page | Dual-flag / personal_local policy change |
| Handoff instruction uses **「交给AI」**; `releaseControl` wakes `await_return` | Production device signed cutover |
| Gate-on + unreachable Docker → **throw** (not soft-pass) | Alpine-smoke image is enough for this claim |

## Suggested 本机验收 focus

1. Tip contains this brief + `account-computer-worker-live-login.test.ts`.  
2. Ungated vitest **PASS** (brief/gate only).  
3. With `OPENBOT_ACCOUNT_WORKER_LIVE_LOGIN_E2E=1` (+ `DOCKER_HOST` if needed), live case **PASS** on this Mac.  
4. Container name matches `aw-browser-*`; fill path uses published CDP (not host `channel: "chrome"` launch).  
5. zh-CN hand-back remains **「交给AI」**.  
6. No secrets committed; demo defaults match the public IdP page.  
7. Do **not** require Brian personal IdP credentials for this brief.
