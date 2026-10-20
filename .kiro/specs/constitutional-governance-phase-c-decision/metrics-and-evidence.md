# Metrics and evidence

> 禁止字段填充率冒充收益。B1/B2 合成指标不得当作生产效果或 C5/C10/C11 pass。

## 1. 指标表

| metric                               | source                      | n                 | denominator                                   | baseline                                    | target                                         | method                            | fail threshold                         |
| ------------------------------------ | --------------------------- | ----------------- | --------------------------------------------- | ------------------------------------------- | ---------------------------------------------- | --------------------------------- | -------------------------------------- |
| false completion（跨域）             | 静态+未来联测               | n/a 本轮          | CTR closed 事件中「当时 hold 阻断完成宣称」数 | **未知**（无生产观测；CTR 关闭咨询 hold=0） | 联合事件率 = 0（activation∧skill-contract 时） | 代码探针 + 结构化日志（**未建**） | 任一无分母宣称 → 作废                  |
| false allow（web_read 影子）         | B1 标注/holdout             | 合成语料          | `expectedSurface=not_web_read`                | B1 合同 ≤5%（合成）                         | 保持合成门；**不**升格生产                     | offline evaluator                 | 本轮**禁止**用作 GO 业务收益           |
| unattributed side-effect entrypoints | main 静态                   | 3+ 点名文件       | Phase A 旁路表条目                            | ≥3 文件 0 预检引用                          | unknown=0（复用\|豁免\|删除）                  | grep + 清单评审                   | 仍用「只审 attempt.ts」宣告 C10 → fail |
| executions missing evidence          | preflight trace vs 工具执行 | 本轮静态          | 工具执行入口数                                | HTTP/node/enterprise 无 preflight trace     | 热路径外入口有显式证据或豁免                   | 入口×证据矩阵                     | 无矩阵却称 Evidence 统一 → fail        |
| duplicate/conflict authorities       | 域矩阵                      | 演进 v1/v2 并存等 | 域数                                          | 跨域写者=0（目标保持）；协议=缺失           | 协议显式；**禁止**合并写者                     | 设计评审                          | 出现全局 completion writer → 否决      |
| audit rebuild time                   | 无本轮测                    | —                 | 标准事故剧本                                  | unknown                                     | 有分母后再定                                   | 演练                              | 无基线不得称 D 改善                    |
| error localization time              | 无本轮测                    | —                 | 同上                                          | unknown                                     | 同上                                           | 演练                              | 同上                                   |
| policy divergence count              | A vs B 合同                 | SECURITY.md       | 互斥条款数                                    | 双 Profile 分列                             | 保持互斥；divergence 文档化                    | 安全评审                          | 合并 Profile → 否决                    |
| p50/p95 extra latency                | B2 预算例                   | 未启旗            | shadow 开 vs 关                               | 预算 p95≤10ms                               | 超预算=成本反证                                | 基准探测（未做生产）              | 超预算仍推 D → 须双签（本轮不走）      |
| run/maintain cost                    | 工程判断                    | —                 | 包/间接层/文档面                              | D 增加包与消费方                            | A/B/C 局部补丁成本更低                         | 矩阵                              | 无独特收益时选 D → fail                |

## 2. 证据接受 / 拒绝

**接受：**

- origin/main 静态复现（FC-01..03 grep）
- Phase A 入口清单与权威文（跨域协议缺失）
- 生产账本 seq98（repo ledger only）
- PR #3 / #14 / #20 / #23 merge SHA
- `runtimeEnabled=false`（影子旗 unset + LIVE_INVOKE false）

**拒绝升格：**

- B1/B2 合成语料分类成功 → 生产效果 / 业务失败证明
- production-proven（本轮无容器自报）
- C5/C10/C11 = pass
- 「有 Meta-Schema 更优雅」类收益

## 3. §7.6 阈值门与本轮

执行方案要求进入 C「考虑」前阈值达标；B1 在**合成**集上冻结了 false allow 等门，且 **Option B 移除了 false completion≤5%**（切片无 should_complete 正例）。  
本轮**没有**生产分母支撑「D 的可度量业务收益」。按方案：未达标不得主张进入 D；应 NO-GO 或 REVISE。选择 **NO-GO**（缺的不是再跑一轮合成 holdout，而是 D 独特收益本身不成立）。
