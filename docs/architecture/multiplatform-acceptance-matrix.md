# Multi-platform acceptance matrix

> **Status:** Stage 55 / Stage 54 Mac Web shell login/deeplink deepen (canonical zh-CN)  
> **Date:** 2026-10-08 (Asia/Shanghai)  
> **Canonical (zh-CN):** [`multiplatform-acceptance-matrix.zh-CN.md`](./multiplatform-acceptance-matrix.zh-CN.md)  
> **Base:** `main` @ `a0303a926` (includes merged [#306](https://github.com/upbeyond/openbot/pull/306) through iOS stage50)

Short stub. The feature × platform table (Chat, Tasks, Knowledge, Me, and Me secondary pages) is maintained in Chinese.

**What changed since Stage 45:** iOS cells for strip / capsules / stop / tasks / knowledge / Me deepen are now **有** (or intentional **部分** / calibrated **无**), citing `apps/ios/docs/evidence/stage46-*` … `stage50-*`. Tokens check remains `design/mobile-tokens.json` + `node scripts/check-mobile-tokens.mjs`.

Android / iOS cells are 有 / 部分 / 无 with evidence paths read in this checkout.

## Stage 52–54 note

Desktop path is **decided: Web shell** ([`desktop-ui-adr.zh-CN.md`](./desktop-ui-adr.zh-CN.md), Daniel / 2026-10-07). Stage 53 Mac employee Web shell POC + Stage 54 login / deep-link / notification tap-through to the employee window (`apps/macos/docs/evidence/stage54-mac-employee-web-shell-login-deeplink/`). Desktop cells with Web-employee behavior cite **有（Web shell 复用）**; companion-only stays **N/A（伴侣非员工面）**. **Not** native four-tab. Canonical table remains Chinese.

Stage 55 Windows Web shell host evidence: `apps/windows/docs/evidence/stage55-windows-employee-web-shell-host/`.
