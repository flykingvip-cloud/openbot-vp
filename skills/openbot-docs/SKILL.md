---
name: openbot-docs
description: >-
  解答怎么用 OpenBot：工作台、数字人、技能、Gateway、设置与排障。
  遇到「怎么用 OpenBot」「OpenBot 设置」「数字人怎么配」「技能怎么用」「Gateway」「工作台」务必使用本技能。
  不要在通用软件/编程任务、纯 Codex/OpenAI API（除非与 OpenBot 对比）场景用。
---

# openbot-docs（OpenBot 自助文档）

给用户与 agent 提供**可引用的 OpenBot 用法指导**：工作台 / Control UI、数字员工、技能路由、本机 Gateway、渠道与排障。

**先文档、后记忆。** 读零或一份主参考；回答前优先查 OpenBot 官方或仓库内文档。

## 首要动作（docs-first）

1. 用用户原话提炼 2–6 个关键词，在可用的 OpenBot 文档源中搜索：
   - 仓库：`docs/`（尤其 `start/`、`gateway/`、`tools/skills*.md`、`channels/`、`help/`、`web/`、`zh-CN/`）
   - 已发布站点或站点索引（若会话里可 fetch）
2. **实际打开/读取**匹配页面，再作答；不要只凭搜索摘要或记忆编造 UI 路径。
3. 官方/仓库文档未覆盖时：明说不确定；**禁止**用 Grok Bot `app-ui.md` 冒充 OpenBot UI。
4. 泛软件任务（与 OpenBot 无关）直接答，不走本技能。

**唯一例外：** 用户明确要「整体怎么用 / 系统地图 / 交叉主题导览」时，可读 `references/routes.md` 选路由后再展开；单一功能、设置、报错、引用仍 docs-first。

## 选一条主路由（最多读一份）

按**第一个匹配**执行；仅当任务需要该工作流时才打开对应 reference：

| 意图                                   | 读                                                                                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 不确定该读哪份 / 要系统地图            | [routes.md](references/routes.md)                                                                                                                                                                                      |
| 工作台、数字人、员工设置入口           | 人类入口是 https://www.openbot.love/help/workbench 。点按事实先读本技能 `references/workbench/`；仓库副本在 `docs/help/workbench/`。点按步骤再读 `user-guidance-protocol` 的 employee YAML。不要指向 docs.openbot.love |
| Control UI、18789 控制台               | [workbench-basics.md](references/workbench-basics.md) 里的 Control UI 段，不要把它当成员工侧栏                                                                                                                         |
| 该用哪个技能（微信/可视化/PDF/出图等） | [skills-routing.md](references/skills-routing.md)                                                                                                                                                                      |
| Gateway `18789`、loopback、本机启动    | [gateway-local.md](references/gateway-local.md)                                                                                                                                                                        |
| 连不上、扫码失败、渠道离线、doctor     | [troubleshooting.md](references/troubleshooting.md)                                                                                                                                                                    |

不要一次打开全部 reference。辅助技能（`wechat-*`、`visualize`、`canvas` 等）只在路由表指向时移交，本技能不重写其正文。

## 硬边界

- **个人微信：** 默认交给 `wechat-personal-catalog` 分流；**禁止**把 `wechat-use` 当默认推荐。运营闭环 → `wechat-personal-ops`；历史入库 → `wechat-personal-kb`。
- **企微 / 飞书 / 钉钉：** 走 OpenBot 官方渠道文档与企业控制台「消息渠道」，不是个人微信技能。
- **已有技能：** `canvas`、`nano-pdf`、`openai-image-gen`、`visualize`、`openbot-platform-ops`、`independent-work` 等已覆盖的交付/运维，**指路不要重做**。
- **独立干活（浏览器 / 本机 / 服务器）：** 编排走 `independent-work`；扫码循环仍 `browser-scan-proxy`；Mac GUI 仍 `peekaboo`。不要把 Grok Bot / Box 的 `request_user_form`、`request_box_help` 当成 OpenBot 工具。
- **Grok Bot ≠ OpenBot：** Grok Bot 设置路径仅见宿主 `app-ui.md`；OpenBot 工作台 / Gateway / 数字人路径只引用 OpenBot 文档。
- 用户可见答复可说「OpenBot 文档」或「仓库 docs」；引用写清相对路径或官方 URL；缺证则标不确定。

## 输出约定

- 先给可执行下一步（打开哪页 / 跑哪条命令 / 交给哪个技能）。
- 引用具体文档页；少大段抄录。
- UI 步骤只复述文档或用户环境中已核实的标签；不要发明菜单。

## 触发样例

- 「怎么用 OpenBot / 工作台在哪」
- 「数字人怎么配 / Gateway 18789」
- 「技能怎么装、该用哪个技能」
- 「个人微信怎么接」（→ catalog，本技能只指路）

## 完成标准

已尝试 docs-first；最多一份主 reference；微信默认不指向 wechat-use；未把 Grok Bot UI 当成 OpenBot；未复述专有 Codex/OpenAI 文档正文。

## 参考

- `references/routes.md` — 问法 → 文档/技能
- `references/workbench-basics.md` — 工作台与数字人入门
- `references/skills-routing.md` — 意图 → 技能
- `references/gateway-local.md` — 本机 Gateway 要点
- `references/troubleshooting.md` — 排障入口
- `ATTRIBUTION.md` — 来源说明
