# 个人私有数字身份智能化（S6）— 七站社媒 verified_live + 真机 E2E

日期：2026-10-19（Asia/Shanghai）  
Repo：`upbeyond/openbot`  
承接：S0–S5（#684 / #685 / #687 / #688 / #691）+ S5 live-path 诚实标注  
分支建议：`feat/oi-intelligent-bind-s6-social-live`  
范围：用户已选**全七站**社媒推进 `verified_live` 取证与编排诚实性；**禁止空口翻旗**。

## 七站名单

| provider | skill | 回写 |
|----------|-------|------|
| xiaohongshu | oi-bind-xiaohongshu | credentials.bind（social_account） |
| douyin | oi-bind-douyin | credentials.bind（social_account） |
| weibo | oi-bind-weibo | credentials.bind（social_account） |
| bilibili | oi-bind-bilibili | credentials.bind（social_account） |
| zhihu | oi-bind-zhihu | credentials.bind（social_account） |
| kuaishou | oi-bind-kuaishou | credentials.bind（social_account） |
| x-twitter | oi-bind-x-twitter | oauth.start / oauth.status / callback（PKCE） |

（wechat-official 已在 S5 `verified_live`；**不在**本切片七站内。）

## 目标

1. **七站各至少一条真机/云电脑 E2E 证据条目**（日期 Asia/Shanghai、环境、步骤、失败点），写入各 skill `references/live-evidence.md`（及 path-map / oauth-path 指针）。
2. **仅当**绑定关键路径 live 成功（至 `credentials.bind` 成功，或 x-twitter `oauth.*` 至 completed / 个人授权页 active）才允许 `verified_live: true` + `path_unstable: false`。
3. **编排**：`oi-orchestrate-personal-identity` 默认推荐仍**仅**真正 `verified_live` 项；未达标保持 `path_unstable`（可显式点名）。
4. **回写禁区不变**：仅 OI gateway API；密钥/Cookie/Token 禁进聊天、PR、EffectiveAccess 投影；禁止直接改 OI JSON。
5. **契约测**：扩展 `oi-intelligent-bind-s0-s1.contract.test.ts`（S6 describe）覆盖翻旗诚实性与证据文件存在性；本侧可独立复跑绿。
6. **交付**：开 PR → 通知「私有数字身份智能化验收」独立验收；**不自行合入 main**。

## 本切片实机结论（2026-10-19，Asia/Shanghai）

| 通道 / 站 | 结论 | 诚实标注 |
|-----------|------|----------|
| 本机 Mac worktree | 可写设计/证据/契约；**无**可用 Control UI 云电脑会话；**无**七站真实社媒账户 Token 可供 bind | 环境：`UPBEYONDdeMacBook-Pro` worktree `openbot-oi-intelligent-bind-s6` |
| weibo | 承继 S5 Cloud PC：GeeTest / **111001** measured；绑定仍未成 | `path_unstable: true` / `verified_live: false` |
| zhihu | 相关：Account Computer #827 登录页 QR/SMS detect（**不等于** OI `credentials.bind` 成功） | `path_unstable: true` / `verified_live: false` |
| xiaohongshu / douyin / bilibili / kuaishou | S6 本切片未取得 Cloud PC 绑定成功证据 | 仍 unstable / not verified_live |
| x-twitter | 应用内 OAuth 产品路径仍 `path_unstable: false`；OHBE/真机 OAuth 完成仍缺 | `verified_live: false` |
| 七站翻旗合计 | **0 / 7** 本切片翻为 verified_live | 优先诚实增量，禁止伪造全七站 live |

## verified_live 取证标准（闸门）

须同时满足才允许翻旗：

1. 可复现证据：真机或云电脑跑通绑定关键路径（社媒至 `credentials.bind` 成功；x-twitter 至 oauth completed / 授权页 active）。
2. 证据含：**日期（Asia/Shanghai）**、环境/云电脑、步骤表、失败点（若有）。
3. **measured 阻断码 ≠ live 成功**（weibo GeeTest/111001 先例）：见到验证码页或登录 detect **不得**冒充 `verified_live`。
4. Account Computer 登录 e2e（如 zhihu #827）** alone 不等于** OI 凭证绑定成功。

未取证：保持 `path_unstable: true` / `verified_live: false`（x-twitter 保持 `path_unstable: false` 且 `verified_live: false`）。

## 回写与禁区（不变）

- 社媒：`user-operational-identity.credentials.bind`（`accountHandle` + `accessToken`）。
- x-twitter：`user-operational-identity.oauth.*`（禁止 credentials.bind 绑 X）。
- **禁止**直接改 OI JSON / secrets；**禁止**密钥、Cookie、Token 进聊天 / PR / EffectiveAccess **投影**。
- **禁止**用云电脑会话冒充已 enrollment；**禁止**伪造未测 provider 的 `verified_live: true`。

## 非目标

- feishu-personal；改社交执行后端；store 合并；双轨发版  
- 密钥进本 PR / 聊天 / 日志  
- 自行合入 main  
- 空口把七站全部标成 verified_live

## 交付清单

1. 本文档  
2. 七站各 `references/live-evidence.md` + path-map / oauth-path / SKILL 指针  
3. `oi-orchestrate-personal-identity` catalog-map + SKILL：S6 默认推荐规则与七站诚实状态  
4. 扩展 `oi-intelligent-bind-s0-s1.contract.test.ts`（S6 describe）  
5. PR（不 merge）

## 残余人工 / 云电脑步骤（翻旗前置）

对每一站，人工需在 Cloud PC（或等价隔离真机）完成：

1. 打开对应开放平台 / 授权页（见各 path-map）。  
2. 越过登录与人机验证（weibo：须越过 GeeTest/111001）。  
3. 取得可用 Access Token / Cookie（或完成 x-twitter OAuth 同意），**不进聊天**。  
4. 经工作台或 gateway 完成 `credentials.bind` / `oauth.*`，个人授权页显示 active。  
5. 将成功步骤回写进该站 `live-evidence.md`，再允许翻 YAML 旗帜。

## 验收闸门（独立审核｜缺一即 FAIL）

阻断：

- [ ] S6 设计与 catalog / path-map / live-evidence 一致  
- [ ] 七站均有带日期的 E2E 证据条目（成功或诚实失败/阻断均可；不得缺站）  
- [ ] **未**在无 bind 成功证据时把任一首站翻为 `verified_live: true`  
- [ ] 编排默认推荐只含真正 verified_live；未达标可显式点名  
- [ ] 回写仅 OI gateway API；密钥/投影禁区  
- [ ] 契约测独立可绿；PR 已开且未自行合入 main  

非阻断：Cloud PC 本切片未连上；七站仍全部未 verified_live；发版未做。
