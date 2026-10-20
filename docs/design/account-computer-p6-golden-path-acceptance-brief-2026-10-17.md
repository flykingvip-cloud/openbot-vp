# Account Computer P6 — golden-path acceptance brief

**Date:** 2026-10-17 (Asia/Shanghai)  
**Tip under test:** branch `cursor/account-computer-p6-golden-path-fixture` on top of main `3ae936cce1ffb31c0b16ea6d7f29420f831e27b2` (P6a #790).  
**Audience:** 「Account Computer 本机验收」  
**Claim level:** Fixture + mocked CDP fill + real gateway handoff/await_return/releaseControl wiring. **Not** a live third-party login e2e.

## Path under proof

Secure Form → fill credentials → fixture login success marker → handoff (user holds desktop) → user taps **「交给AI」** (`releaseControl`) → `await_return` → agent continues.

Hand-back label (locked): **「交给AI」** (`computerHandBack`). Not「交还」.

## Fixture

`docs/design/account-computer-login-password-fixture.html` — static password form; submit shows `fixture-ok: … (password not echoed)`.

## Automated coverage

| Layer | File | Role |
|---|---|---|
| **Golden stitch (new)** | `src/agents/sandbox/account-computer-login-golden-path.test.ts` | Fixture DOM contract + Form→fill→handoff→给AI→await_return |
| P5a form/fill | `secure-form.test.ts`, `secure-form-fill-host.test.ts` | Pending form, fill zeroize, domain fail-closed |
| P5b handoff | `secure-form.handoff.test.ts`, `secure-form-handoff-wait.test.ts` | handoff_active, releaseControl → handoff_returned |
| UI 给AI | `secure-form-card.test.ts`, `account-computer-preview.test.ts`, `takeover-after-yield.test.ts` | Hint copy, handBack→releaseControl, YIELDED resume |
| P6a Docker honesty | `account-worker-driver.test.ts` | Dual flags default off; gated Docker e2e |

## Commands (Mac worktree)

```bash
cd "/Users/daniel/AI VP/openbot-p6-fully-met-scout"
git rev-parse HEAD   # expect 3ae936cce… or descendant with golden-path test

# Golden-path (new)
pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-login-golden-path.test.ts

# Layered secure-form / handoff
pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/secure-form.test.ts \
  src/agents/sandbox/secure-form-fill-host.test.ts \
  src/agents/sandbox/secure-form-handoff-wait.test.ts \
  src/gateway/server-methods/secure-form.handoff.test.ts \
  src/gateway/server-methods/browser-preview.test.ts \
  src/agents/tools/browser-tool.secure-form-guard.test.ts

# UI 给AI / handoff card
pnpm exec vitest run --config vitest.config.ts \
  ui/src/ui/views/secure-form-card.test.ts \
  ui/src/ui/gateway-subscriptions/secure-form.node.test.ts \
  ui/src/ui/account-computer/takeover-after-yield.test.ts \
  ui/src/ui/views/account-computer-preview.test.ts

# Optional P6a Docker e2e (not required for fixture golden-path)
export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"
OPENBOT_ACCOUNT_WORKER_DOCKER_E2E=1 pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-worker-driver.test.ts
```

## Flags

`OPENBOT_ACCOUNT_WORKER` / `OPENBOT_ACCOUNT_WORKER_DOCKER`: see **P6b** (`account-computer-p6b-production-default-on-2026-10-17.md`) for unset→ON. This golden-path brief does not claim live prod cutover.

## What this does / does not claim

| Claims | Does not claim |
|---|---|
| Fixture login success marker works | Real IdP / SSO / passkey against a third-party site |
| Fill path zeroizes secrets in receipt | Live Account Worker Docker browser filled the fixture |
| Handoff hint defaults to「交给AI」; releaseControl wakes await_return | Dual flags flipped ON |

## Results recorded (implementer Mac, 2026-10-17 Asia/Shanghai)

| Suite | Command scope | Result |
|---|---|---|
| Golden-path | `account-computer-login-golden-path.test.ts` | **4/4 PASS** |
| Layered + UI pack | 11 files (golden + secure-form + handoff + UI 给AI) | **99/99 PASS** |

Base main SHA: `3ae936cce1ffb31c0b16ea6d7f29420f831e27b2`.

## Suggested 本机验收 focus

1. Tip SHA contains P6a (`3ae936cce` ancestor) + this golden-path test.  
2. Golden-path vitest **PASS**.  
3. zh-CN `computerHandBack === "交给AI"`.  
4. Flags still default-off in code/tests.  
5. Do **not** require live third-party login for this brief.
