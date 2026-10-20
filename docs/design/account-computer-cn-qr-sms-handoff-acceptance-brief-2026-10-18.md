# Account Computer — 国内扫码/短信 handoff 本机验收 brief

**Date:** 2026-10-18 (Asia/Shanghai)  
**Audience:** 「Account Computer 本机验收」  
**Branch tip under test:** `cursor/account-computer-cn-qr-sms-handoff` on top of `origin/main`  
**Claim level:** Fixture + classifier `sms`/`qr` → handoff + real gateway handoff/await_return/releaseControl wiring. Optional gated Chromium against **local fixtures only**. **Not** real WeChat / real SMS / third-party site login / device cutover.

## Path under proof

1. **微信扫码：** 云电脑打开扫码等待面 → `plan` handoff(`qr`) → 用户参与（夹具用「模拟扫码成功」）→ **系统自动识别** → `await_return`
2. **短信验证码：** 云电脑打开手机号+OTP 面 → `plan` handoff(`sms`) → 用户填码（夹具不回显 OTP）→ **系统自动识别** → `await_return`

Resume (locked): **auto gate-clear**. No mandatory「交给AI」. Complements Secure Form (password write-only); does not replace it.

## Artifacts

| Path | Role |
|---|---|
| `docs/design/account-computer-cn-wechat-qr-sms-otp-2026-10-18.md` | Design / acceptance / claim matrix |
| `docs/design/account-computer-wechat-qr-fixture.html` | QR wait fixture |
| `docs/design/account-computer-sms-otp-fixture.html` | SMS OTP fixture |
| `src/agents/sandbox/account-computer-cn-qr-sms-handoff.test.ts` | Always-on + gated tests |
| `src/agents/sandbox/account-computer-login-classify.ts` | `sms` signal → handoff |
| `src/gateway/server-methods/account-computer-login.ts` | `asSignals` passes `sms` |

## Commands (Mac worktree)

```bash
cd "/Users/daniel/AI VP/openbot-p6-fully-met-scout"
git rev-parse HEAD

# Always-on (no real WeChat/SMS; no gate)
pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-cn-qr-sms-handoff.test.ts \
  src/agents/sandbox/account-computer-login-classify.test.ts

# Optional gated fixture browser (local Chrome + fixture HTTP only)
OPENBOT_ACCOUNT_WECHAT_QR_E2E=1 OPENBOT_ACCOUNT_SMS_OTP_E2E=1 \
  pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-cn-qr-sms-handoff.test.ts

# Or shared gate
OPENBOT_ACCOUNT_CN_LOGIN_HANDOFF_E2E=1 pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-computer-cn-qr-sms-handoff.test.ts
```

Gate on + missing fixture → **throw** (not soft-pass). Gate on + no Chrome → Chromium launch fails (loud).

## What this does / does not claim

| Claims | Does not claim |
|---|---|
| `sms` / `qr` → handoff decisions | Real WeChat client scan success |
| Fixture DOM contracts (QR wait / SMS OTP, OTP not echoed) | Real SMS gateway / carrier OTP |
| Handoff hint says auto-continue; gate clear wakes await_return | Live JD/Taobao/WeChat web login e2e |
| Optional Chromium opens **local** fixtures | Account Worker Docker filled a real CN IdP |
| zh-CN hint: 自动继续 / 无需点交给AI | Dual-flag / personal_local policy change |

## Suggested 本机验收 focus

1. Tip contains design + brief + both fixtures + `account-computer-cn-qr-sms-handoff.test.ts`.  
2. Always-on vitest **PASS** (classify + handoff file).  
3. Optional: gated browser cases **PASS** on this Mac.  
4. zh-CN handoff: chat shows EXACTLY once「请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。」— no snapshot narration / method enumeration / second paraphrase; no conversation handoff reminder card; chrome may still name 交给AI.  
5. Do **not** require real WeChat or real SMS for this brief.  
6. 合 main 前再问 Brian；确认前勿合/undraft。
