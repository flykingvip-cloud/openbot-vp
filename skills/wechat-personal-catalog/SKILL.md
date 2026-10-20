---
name: wechat-personal-catalog
description: |
  用户要接个人微信、还没说清运营还是入库，或 OpenBot
  本机通道不够、要在官方套件与可选三方（wechat-use/wechat-cli）之间分流时使用。遇到「个人微信怎么接」「微信技能从哪开始」「运营还是入库」「能不能用
  wechat-use」务必使用。不要在公众号、企微场景用。
---

# 个人微信技能目录

个人微信能力分 **OpenBot 本机通道** 与 **可选第三方本机工具**。默认走 OpenBot；只有本机通道暂时做不到、且用户明确选择时，才调用可选技能。

这不是公众号，不是企微。OpenBot **不内置**微信协议。

## 目标（产品）

让 OpenBot 数字人尽可能具备与常见本机微信工具类似的能力：

- 收发私聊文本（运营）
- 查询/导出/分析历史（知识或只读分析）
- 稳定的 loopback 集成面（给数字人/自动化）

做法是 **借鉴契约与工作流**，不是合并两个三方技能包进官方默认路径。三方包保留为 **用户可选调用**。

## 先分流（默认）

| 用户要的                                                             | 技能                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 本机已有登录态后绑定、授权数字人收发私聊、sidecar / `127.0.0.1:3000` | [wechat-personal-ops](sand-workflow:wechat-personal-ops)                  |
| worker 离线 / `wechat-personal-worker.json` / 桌面节点               | [wechat-personal-ops](sand-workflow:wechat-personal-ops)（先探测 + 排障） |
| 导出明文入库、可引用、目录 sync                                      | [wechat-personal-kb](sand-workflow:wechat-personal-kb)                    |
| 微信快照验收 / 导出目录像不像明文                                    | kb 的 `references/snapshot-accept.md`                                     |
| 契约演进（health / 发送三态 / fromSelf）                             | ops → `references/sidecar-http-vnext.md`                                  |

一句判断：要不要 **占用登录位并由数字人回消息**？要 → ops。只要 **历史可引用** → kb。两样都要 → 先 ops 再 kb（kb 仍只用导出，不读 sidecar 会话）。

## 可选第三方通道（非默认）

仅当满足其一：

1. OpenBot ops 因 **缺少运营方 sidecar/协议引擎** 无法收发，且用户仍要本机立刻收发/查询；或
2. 用户 **明确点名** 使用 wechat-use / wechat-cli / 同类本机工具（例如「已登录电脑微信，用适配器接 3000」）。

| 用户明确要                                                            | 可选技能                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| macOS 本机发消息 + HTTP/SSE 桥（Apple Silicon）→ 再接 OpenBot `:3000` | [wechat-use](sand-workflow:wechat-use) **完整流程（含安装 CLI）**，然后 ops `references/adapter-wechatuse.md` |
| 跨平台读本地库做 sessions/history/export/分析                         | [wechat-cli](sand-workflow:wechat-cli)                                                                        |

调用前必须口头确认风险：非官方 API、可能违 ToS/封号、可能涉及本机密钥或辅助功能权限；仅限用户本人账号；禁止商用群发。确认后：

- 选了 **wechat-use** → agent **必须**按 wechat-use 技能走 **完整流程（含安装 CLI）**，再按 `adapter-wechatuse.md` 接 `:3000`；禁止「假定已安装」直接起 bridge。
- 触发样例：「已登录电脑微信，用适配器接 3000」→ 风险确认 → wechat-use 完整流程 → adapter-wechatuse。

**默认路径禁止**把三方安装、取钥、UIA 写成「唯一正确步骤」。可选技能内部步骤与 OpenBot 官方红线分离：选了可选通道 = 用户接受该工具自身要求（含安装与激活）。

## 能力对照（OpenBot 优先要对齐什么）

| 能力           | OpenBot 目标路径                                | 三方已有                             | 缺口时                             |
| -------------- | ----------------------------------------------- | ------------------------------------ | ---------------------------------- |
| 私聊发送       | ops → sidecar `sendTextMsg` → 数字人 `sendText` | wechat-use `send` / bridge           | 补运营方引擎或用户可选 wechat-use  |
| 私聊入站       | sidecar webhook → 数字人                        | wechat-use SSE                       | 同上；契约见 vNext `fromSelf`      |
| 扫码绑定/grant | 工作台 + ops RPC                                | 无同等 grant 模型                    | 保持 OpenBot                       |
| 历史检索/导出  | kb 吃明文导出                                   | wechat-cli / wechat-use query+export | 先引导导出；用户坚持解库再可选三方 |
| Agent HTTP 面  | `127.0.0.1:3000` 契约                           | wechat-use `:18400`                  | 借鉴字段；端口仍以 OpenBot 为准    |

细则：`references/capability-gap.md`（本目录技能旁）。

## 硬边界（官方默认通道）

- 禁止把知识宇宙 ingest 当 webhook，也禁止把 kbId 当成 channel binding。
- **默认通道**禁止主动推荐 DLL 注入、网页版嵌扫码、开放平台冒充个人号、公网暴露个人微信口。
- 网关 `http://127.0.0.1:18789/`；sidecar `http://127.0.0.1:3000`。两套进程不要并口。LIVE 永不直连个人微信 sidecar。
- 可选三方技能不替代 identity grant / 工作台 `bind-existing`；数字人正式运营仍应回到 ops grant 模型。
- **面向普通本地用户的指引禁止**写 Telegram、`t.me/WechatCliBot`、`@WechatCliBot`、`wechat-use auth activate`。

## 触发样例

- 「帮我把个人微信接到机器人上」→ 本目录 → 默认 ops/kb。
- 「扫码让数字人回微信」→ ops（现行前台是 `bind-existing`，不出码）。
- 普通用户问「怎么激活 / 要不要注册 Telegram」→ **不要**指向 WechatCliBot；说明 OpenBot 绑定不走 Telegram，未登录就等本机通道或改用公众号 / 邮箱 / kb。
- 「用 wechat-cli 导出再入库」→ 可选 wechat-cli 导出 → 再 kb bind 明文。
