# Account Computer — live-site login e2e acceptance brief

**Date:** 2026-10-18 (Asia/Shanghai)  
**Audience:** 「Account Computer 本机验收」  
**Branch tip under test:** `cursor/account-computer-live-login-e2e` on top of `origin/main`  
**Claim level:** Gated Chromium + CDP + **production** Secure Form fill host against a **public demo IdP**. Not corporate SSO / passkey / Account Worker Docker browser / device cutover.

## Why this slice

P6 fixture golden-path (#793) used **mocked** CDP fill. This brief covers the next honest step: **real browser** fills a **real public login page** through the same Secure Form fill host used in production, then stitches handoff → **「交给AI」** → `await_return`.

## Default demo IdP (no Brian personal credentials)

| Item | Default |
|---|---|
| URL | `https://authenticationtest.com/simpleFormAuth/` |
| Host | `authenticationtest.com` |
| E-Mail | `simpleForm@authenticationtest.com` (printed on the page) |
| Password | `pa$$w0rd` (printed on the page) |
| Success | URL matches `loginSuccess`; body contains `Success! You are now logged in` |

These credentials are **public documentation on the IdP**, not secrets. Override with env when pointing at staging (never commit staging secrets).

`the-internet.herokuapp.com` was probed from this Mac and **timed out** (Asia/Shanghai network); do not use it as the default here.

## Gate / env

| Env | Role |
|---|---|
| `OPENBOT_ACCOUNT_LIVE_LOGIN_E2E=1` | Enable the live Chromium case (required) |
| `OPENBOT_ACCOUNT_LIVE_LOGIN_URL` | Optional login page URL |
| `OPENBOT_ACCOUNT_LIVE_LOGIN_HOST` | Optional expected host (else derived from URL) |
| `OPENBOT_ACCOUNT_LIVE_LOGIN_USER` / `_PASSWORD` | Optional overrides |
| `OPENBOT_ACCOUNT_LIVE_LOGIN_EMAIL_SELECTOR` / `_PASSWORD_SELECTOR` / `_SUBMIT_SELECTOR` | Optional CSS selectors |
| `OPENBOT_ACCOUNT_LIVE_LOGIN_SUCCESS_URL_RE` | Optional success URL regexp (default `loginSuccess`) |

Ungated default suite: brief + gate contract only (no network). Live case uses `describe.runIf(gate)`.

## Automated coverage

| File | Role |
|---|---|
| `src/agents/sandbox/account-computer-live-login.test.ts` | Gate doc + live Chromium fill + handoff→给AI |
| (existing) `account-computer-login-golden-path.test.ts` | Fixture + mocked fill (unchanged) |

## Commands (Mac worktree)

```bash
cd "/Users/daniel/AI VP/openbot-p6-fully-met-scout"
git rev-parse HEAD

# Ungated (always)
pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-live-login.test.ts

# Live (needs Chrome channel + network to authenticationtest.com)
OPENBOT_ACCOUNT_LIVE_LOGIN_E2E=1 pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-live-login.test.ts
```

Requires local Google Chrome (`playwright-core` `channel: "chrome"`). Does **not** require Docker Account Worker images for this claim.

## What this does / does not claim

| Claims | Does not claim |
|---|---|
| Real Chromium CDP reachable; fill host peeks account CDP port | Account Worker Docker browser filled the page |
| Production `createSecureFormFillDeps` filled `#email`/`#password` | Corporate Okta/Azure AD/WeChat SSO |
| Site submit → public demo success page | Passkey / QR / captcha takeover |
| Handoff instruction uses **「交给AI」**; `releaseControl` wakes `await_return` | Dual-flag / personal_local policy change |
| Receipts / broadcasts do not echo password or VNC secret | Production device signed cutover |

## Suggested 本机验收 focus

1. Tip contains this brief + `account-computer-live-login.test.ts`.  
2. Ungated vitest **PASS** (brief/gate only).  
3. With `OPENBOT_ACCOUNT_LIVE_LOGIN_E2E=1`, live case **PASS** on this Mac.  
4. zh-CN hand-back remains **「交给AI」** (not the retired hand-back label).  
5. No secrets committed; demo defaults match the public IdP page.  
6. Do **not** require Brian personal IdP credentials for this brief.
