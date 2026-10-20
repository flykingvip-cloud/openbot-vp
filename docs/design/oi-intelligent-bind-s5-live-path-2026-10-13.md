# 个人私有数字身份智能化（S5）— live-path 加固（verified_live）

日期：2026-10-13（CST）  
Repo：`upbeyond/openbot`  
承接：S0–S4（#684–#688）+ 云电脑接管/首帧 inert 修复（#690 / `6cc6afe8`）  
范围：把诚实 `path_unstable` 社媒与公众号云电脑取证，收成可验收的 **verified_live 最小集**，并回写编排目录。

## 目标

1. **公众号（wechat-official）**：云电脑 live runbook 证据化（SCAN_MP → AppID/Secret → BIND → IP → verify）；标注 `verified_live` + 日期；密钥仍禁进聊天/投影。
2. **微博（weibo）**：把 GeeTest / 错误码 **111001** 等从 UNKNOWN 升为**实测步骤**；**仅当绑定路径 live 成功时**才允许 `path_unstable: false` + `verified_live: true`。本切片未完成 Token 绑定成功 → **保持** `path_unstable: true` / `verified_live: false`。
3. **编排**：`oi-orchestrate-personal-identity` 默认推荐 **仅** `verified_live: true` 的 registrationReady 项；其余社媒仍 `path_unstable`，可显式点名。
4. **契约测**：catalog / path-map 的 `path_unstable` / `verified_live` 诚实性可测；禁止未测 provider 伪称 verified_live。
5. **#690 备注（可选、不扩 UX）**：接管后首帧/stall 恢复须进 INTERACTIVE；Control 运行包需含 #690。本 PR **不**改全屏接管按钮。

## 实机结论（2026-10-13，Cloud PC）

| 通道 | 结论 | 诚实标注 |
|------|------|----------|
| Control UI 云电脑 | 可连接；人接管后键鼠可进桌面（#690 修 inert） | 运维依赖：运行包含 #690 |
| wechat-official | console-map + SCAN_MP→…→PROBE 路径在云电脑可走；密钥只交大白/secret store | `verified_live: true`（路径）；账户状态（如 revoked）不伪造为已绑定成功 |
| weibo | `security.weibo.com/captcha/geetest` 弹「请先验证身份」；错误码 **111001 请重新尝试** | 步骤 **measured**；`path_unstable: true`；`verified_live: false` |
| 其它五社媒 | 未本切片 live | 仍 `path_unstable: true` / `verified_live: false` |
| feishu-personal | registrationReady=false | 不做 |

## 回写与禁区（不变）

- 回写仅 gateway `user-operational-identity.*`（公众号 / 社媒：`credentials.bind`）。
- **禁止**直接改 OI JSON / secrets；**禁止**密钥、Cookie、AppSecret、Token 进聊天或 EffectiveAccess **投影**。
- **禁止**用云电脑会话冒充已 enrollment；**禁止**伪造未测 provider 的 `verified_live: true`。

## 非目标

- feishu-personal；七社媒全部 live；改社交执行后端 / 内置微信协议栈  
- 密钥进本 PR / 聊天 / 日志  
- 通知双轨发版（须本切片合入后由主控另交）  
- 扩大全屏接管/交还按钮 UX

## 交付清单

1. 本文档  
2. `skills/oi-bind-wechat-official/references/cloud-pc-live-evidence.md` + SKILL / console-map 指针  
3. `skills/oi-bind-weibo/references/path-map.md` 实测升级（111001 / GeeTest）  
4. `oi-orchestrate-personal-identity` catalog-map + SKILL：默认推荐仅 verified_live  
5. 扩展 `oi-intelligent-bind-s0-s1.contract.test.ts`（S5 describe）  
6. 最小 docs / guidance 接线（不扩平台）

## 验收闸门（独立审核）

阻断：

- [ ] S5 设计与 catalog / path-map 一致  
- [ ] wechat-official 有 `verified_live` 证据日期；或 weibo 有可复现实测阻断码（本切片两者皆有）  
- [ ] weibo **未**在未完成绑定成功时翻 `path_unstable: false`  
- [ ] 其它五社媒仍 unstable；未伪称 verified_live  
- [ ] 回写仅 OI gateway API；密钥/投影禁区  
- [ ] 契约测独立可绿；worktree `git rev-parse HEAD` 正常  

非阻断：真机 AppSecret 未出现在 CI；发版未做；全屏按钮未改。
