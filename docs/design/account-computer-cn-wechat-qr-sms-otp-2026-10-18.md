# Account Computer — 国内主流登录：微信扫码 + 短信验证码（2026-10-18）

**Date:** 2026-10-18 (Asia/Shanghai)  
**Status:** design + fixture/gated acceptance (draft). Not production cutover.  
**Audience:** 实施方 / 「Account Computer 本机验收」 / Brian  
**Resume (locked):** auto gate-clear (page `data-signed-in` / `fixture-ok` / success URL) → `await_return` resumes. No mandatory「交给AI」on the QR/SMS path. Chrome may still offer `computerHandBack`「交给AI」as a rare override.

## Why

国内站登录主流常为：

1. **微信扫码**（二维码 + 手机微信确认）
2. **手机号 + 短信验证码**（偶发再加图形验证码）

这两条**不能**（也不该）让模型代填密钥：扫码必须人眼/手机确认；短信码在用户手机上。产品路径是：数字人**默认全程 AI 接管**打开 **Account Computer（云电脑）** → 需要人介入时**仅在对话一句简短提醒**（不重复底部 handoff 卡）→ 用户在云电脑完成扫码/短信 → **系统自动识别关卡已过** → 续跑。**不需要**点「交给AI」。

与已合 main 的 **Secure Form（聊天内写 only 用户名/密码）** 互补，不替代。

## User journeys

### A. 微信扫码

1. Agent 打开云电脑浏览器，进入目标站登录页（或显式切到「微信登录」Tab）。
2. 快照信号：`qr: true`（且通常 `password: false`）。
3. `account_computer_login.plan` → **`handoff` / reason `qr`**（已有分类器行为）。
4. Gateway `secure_form.handoff`：对话里用一句简短提醒用户在云电脑扫码（可授予输入以便操作）；**不**再弹出底部 conversation handoff 提醒卡。
5. 用户用手机微信扫码并确认。
6. 系统探测页面关卡清除（`data-signed-in` / `fixture-ok` 等）→ 自动 `releaseControl` + `handoff_returned`（`resume: auto_gate_cleared`）→ `await_return` 恢复。
7. Agent 再快照：期望 `signedIn: true` → `continue`。

### B. 手机号 + 短信验证码

1. Agent 打开云电脑，进入「验证码登录 / 手机登录」页。
2. 快照信号：`sms: true`（本切片新增；表示手机号/验证码参与面可见，而非仅密码框）。
3. `plan` → **`handoff` / reason `sms`**。
4. 用户在云电脑填手机号、点获取验证码、在手机看短信、在云电脑填验证码并登录。
5. 系统自动识别关卡已过 → 同上 auto-resume 路径。
6. 再快照：`signedIn: true`。

### C. 何时仍用 Secure Form

| 页面                                       | 决策                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 仅用户名/密码框                            | **Secure Form**（聊天内填写，write-only 填入云电脑）                                               |
| 密码 + 二维码同页（首次）                  | 方法选择卡：`password` → Secure Form；`qr` → handoff                                               |
| 仅二维码 / 微信扫码                        | **handoff** `qr`                                                                                   |
| 仅手机号+短信码（或短信 Tab）              | **handoff** `sms`                                                                                  |
| 密码框 + 短信 Tab 同时可见                 | 若模型报告 `password: true`，仍可走 Secure Form；短信主路径应报 `sms: true` 且不要误报成「仅密码」 |
| 图形验证码 / passkey 且 Secure Form 完不成 | **handoff** `captcha` / `passkey`（既有）                                                          |

**本切片不把短信验证码默认改成 Secure Form OTP 卡。**  
仓库已有 `SecureFormFieldKind = "otp"` 与 `submitAfterFill`（单 OTP 域），可用于**后续**「聊天内补一格验证码」实验；国内主流产品叙述仍是 **云电脑交接**。

## Success criteria

| #   | Criterion                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------ |
| 1   | 分类器：`qr` → handoff；`sms` → handoff；密码 only → secure_form                                             |
| 2   | 夹具 HTML 存在：扫码等待面、短信 OTP 面（无真实微信/短信）                                                   |
| 3   | 网关 stitch：handoff → **auto gate clear** → `await_return` = `handoff_returned`（无需点交给AI）             |
| 4   | zh-CN handoff 提示仅保留「扫码/短信 + 自动继续」短句；对话不重复底部提醒卡；chrome 可保留 `computerHandBack` |
| 5   | 门控 env 关闭时 CI 不打外网、不启真微信/真短信；门控开启且夹具缺失 → **失败（非 soft-pass）**                |

## Claim level

| Claims                                                         | Does **not** claim                      |
| -------------------------------------------------------------- | --------------------------------------- |
| Fixture 模拟扫码等待面 / 短信 OTP 面 DOM 契约                  | 真实微信客户端扫码成功                  |
| `sms` 信号进入分类器并 handoff                                 | 真实短信网关下发 / 运营商 OTP           |
| Handoff → auto gate clear → await_return 接线                  | 某电商/社交真站 e2e 登录绿              |
| 双 Account Worker flag / `personal_local` 策略未在本 PR 改默认 | 生产切流或真设备签收                    |
| 可选门控测在本地打开夹具并走 handoff stitch                    | Docker Worker 浏览器填了真站微信/短信页 |

## Test gates

| Env                               | Role                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| （无）                            | 默认：夹具 DOM + 分类器 + handoff stitch（始终可跑）                 |
| `OPENBOT_ACCOUNT_WECHAT_QR_E2E=1` | 额外：对微信扫码夹具做浏览器打开 + handoff stitch；夹具缺失则 throw  |
| `OPENBOT_ACCOUNT_SMS_OTP_E2E=1`   | 额外：对短信 OTP 夹具做浏览器打开 + handoff stitch；夹具缺失则 throw |

也可用共享门控 `OPENBOT_ACCOUNT_CN_LOGIN_HANDOFF_E2E=1` 同时打开两路（实现上两路 OR）。

## Fixtures

| File                                                   | Role                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `docs/design/account-computer-wechat-qr-fixture.html`  | 静态「请使用微信扫码」等待面 + `data-fixture="wechat-qr"` + 模拟扫码成功按钮（人工/测） |
| `docs/design/account-computer-sms-otp-fixture.html`    | 手机号 + 验证码表单；提交后 `fixture-ok` 且**不回显**验证码                             |
| （既有）`account-computer-login-password-fixture.html` | 密码黄金路径，不变                                                                      |

## Related

- UX baseline: `account-computer-login-ux-2026-10-09.md`
- Fixture golden-path: `account-computer-p6-golden-path-acceptance-brief-2026-10-17.md`
- Demo IdP password e2e: `account-computer-live-login-e2e-acceptance-brief-2026-10-18.md`
- Worker Docker password e2e: `account-computer-worker-live-login-e2e-acceptance-brief-2026-10-18.md`
- 微信**个人号绑定**（非云电脑主路径）: `oi-intelligent-bind-s4-wechat-personal-2026-10-13.md` — **勿与本站扫码登录混淆**

## Out of scope (this PR)

- 真微信 / 真短信 / 企业 IdP
- 扩展方法选择卡增加 `sms` 选项（可后续）
- 改 `OPENBOT_ACCOUNT_WORKER*` 默认
- 合并 main（需 Brian + 本机验收 PASS）
