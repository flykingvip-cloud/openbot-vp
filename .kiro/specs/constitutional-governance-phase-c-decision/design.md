# Design：Phase C 独立决策方法

> Owner：`grok-bot` · Reviewers：见 requirements 角色表 · 未提交

## 1. 方法

1. 自 `origin/main`（含 PR #23）冻结三基线。
2. 阅读 Phase A 入口清单 / 权威文、B1/B2 合同与 main 代码锚点（preflight、CTR、orch、旁路）。
3. 候选失败场景必须落到**具体代码缺口**；禁止命名不一致、禁止用 B1/B2 合成分类成功当业务失败证明。
4. 对每场景比较 A/B/C/D；仅当 D 有不可被 A–C 廉价替代的可度量优势才考虑 GO。
5. 过否决表与量化门；写 `decision.md` 固定结构。

## 2. 备选定义（A/B/C/D）

| 代号  | 含义                                                          |
| ----- | ------------------------------------------------------------- |
| **A** | 仅修补既有模块局部缺口（例如给 `/tools/invoke` 接上预检）     |
| **B** | 收敛 / 扩展 execution-preflight 覆盖面                        |
| **C** | 扩展 ConversationTask / task-orchestration 协作与关闭协议     |
| **D** | 引入统一契约 / Meta-Schema（有限 `constitutional-contracts`） |

## 3. 评分维

coverage · file/boundary blast · 新状态/日志/权威计数 · Profile A/B · migration · rollback · perf · maintenance · 是否第五状态机 · 是否重复 Registry/Evidence/Decision。

## 4. 否决表（任一 → 不得 GO）

| 否决                           | 本轮观察                    |
| ------------------------------ | --------------------------- |
| 第五套执行状态机               | D 若引入独立完成机 → 否决   |
| 新独立生产日志库               | D 若要求新 ledger DB → 否决 |
| 合并 Profile A/B               | 任何方案若合并 → 否决       |
| sessionKey 作 Path/authz 边界  | 否决                        |
| Workflow 命名为 Path           | 否决                        |
| 插件安装=能力授权              | 否决                        |
| receipt→proof                  | 否决                        |
| Fabric 默认开                  | 否决                        |
| `ORCHESTRATION_LIVE_INVOKE` on | 否决                        |
| 物理合并 Registries            | 否决                        |
| 新统一权威写多域终态           | 否决（违 C11）              |
| 无配置级回滚                   | 否决                        |
| 相对既有无独特收益             | **本轮触发 → 阻断 GO**      |

## 5. B1/B2 使用边界

**允许：** 合同↔代码映射；prediction≠scorer；默认关影子接线；安全投影；Profile A/B 租户夹具；perf 预算示例。

**禁止：** 生产效果；C5/C10/C11 已过；runtime-enabled；production-proven；Meta-Schema 必须产品化。

## 6. 决策逻辑（本轮结论预告）

核心问题的诚实答案：仅收敛三模块后，**旁路副作用入口**与**跨域终态化协议缺失**仍在。但这些缺口：

- 多数可用 **A/B/C** 在既有模块上廉价修补或显式登记；
- 有限 GO 所允许的 D（仅规划契约包）**既不授权 Path/Gate，也不自动闭合旁路表**；
- B1/B2 未提供生产 false-allow / false-completion 业务分母，不得充当 D 独特收益。

因此 **独特收益门失败** → 推荐 **NO-GO**（详见 `decision.md`）。

## 7. 回滚与本轮工件

本轮仅文档 + 未提交 Loom 草稿。回滚 = 丢弃工作树改动。无旗标、无部署、无包。
