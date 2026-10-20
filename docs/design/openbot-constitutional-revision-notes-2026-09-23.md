# 修订说明（2026-09-23）

| 字段       | 值                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| 受众       | 架构专家 / 领导层                                                                                                   |
| 涉及文件   | `01-…feasibility.md`；`02-…execution-plan.md`；本说明                                                               |
| 第一轮裁决 | **有条件通过方向；不批准原 P0–P9 全量计划** → 改为 A–D                                                              |
| 第二轮裁决 | 修订已实质到位；计划 = **可控治理发现项目**；下一步 = 两周事实收敛 + 冻结 web_read 可度量合同；**不**建 schema/新包 |

---

## 第一轮修订（有条件通过后）

### 为何改

专家保留「防止错误统一」论旨，纠正「再建设一套更高层统一系统」的冲动。OpenBot 正式定位为**企业 Agent OS**；Meta-Schema 是治理**手段**，须用失败场景与量化收益挣得席位，不能默认变成四产品终态。

### Doc 01（盘点）改了什么

1. 文首增加「专家评审后修订」横幅；产品定位改为企业 Agent OS，Meta-Schema = 治理目标/手段。
2. 纠正 Pi 热路径措辞：已有多层治理包络，缺的是跨面统一模型、合法轨迹与全局权威；**禁止**「裸执行」表述。
3. C11 按域拆分（技能交付/演进 near-conforming；普通聊天 partial；跨域 fail），取消单一全局 fail 概括。
4. 「四个工程产品」降为可选包装（优先 `constitutional-contracts`）；Runtime 门面复用编排/预检。
5. 显式**三基线**：产品合同 / main@f1c7efece… / 生产 seq96；主张须标 code-present / runtime-enabled / production-proven。
6. 保留全部「不要盲目统一」约束（Fabric 默认 OFF、Bridge 未批准、sessionKey≠Path、双 Profile 等）。

### Doc 02（执行方案）改了什么

1. **废止** P0–P9 作为批准计划；改为 **A–D**。
2. 压缩原 P0–P4 为 A 的四件产出；B 复用既有 task-orchestration shadow。
3. C 为硬门：≥3 真实失败场景 + 可度量收益；失败则停在既有收敛。
4. D 仅门后启动；先单契约包；拆产品推迟。
5. 原 P8「path=unset 成功」废止 → **P8a/P8b/P8c**。
6. 废弃「W18–W22 才有首次运行时反馈」。
7. 度量补全 false allow/completion、分歧率、回放确定性等。
8. 原 P0–P9 仅附录映射。

### 未改动的底线

不重写 Pi、不默认开 Fabric、不批准 Bridge MVP、不并 Profile、不做 Registry 大合并、不把 sessionKey 当 Path、不擅自 `ORCHESTRATION_LIVE_INVOKE=true`。

---

## 第二轮修订（2026-09-23）— 编码三项强制修正 + A/B 指导 + 授权表

### 为何再改

第二轮专家裁决：第一轮修订**实质到位**；计划已是可控治理发现项目。正确下一步是**两周事实收敛 + 冻结 web_read 只读切片的可度量合同**，**不是**创建 schema 或新包。Thomas 批准纳入本轮修订。

### 三项强制修正

| #                             | 修正                                                                                                                                                                                                                                                             | 落点                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **1. C11 目标重写**           | 废弃「跨域单一写权威」/ 全局完成状态机（**已纠正谬误**）。技能/聊天/协作/演进/发布 = 不同域。最终目标：`Domain-local single authority + explicit cross-domain finalization protocol`。上层仅只读聚合，永不通用写者。                                             | Doc 01 §2.2 / §7.1 / 附录 A；Doc 02 §1.1 / §4 / 附录 C |
| **2. BaselineManifest**       | `main@f1c7efece…` 与 seq96 = **本轮评审快照**，非六周常量。A 必须产出 Manifest；阶段验收再生；进 B / 进 C 前再冻结。最低字段：`assessedAt`、`productContractRevision`、`mainSha`、`productionSeq`、`productionGatewaySha`、`productionUiSha`、`evidenceSource`。 | Doc 01 §3；Doc 02 §3                                   |
| **3. Phase B 度量需地面真值** | 无标注集则 false allow/completion 不可算；无阈值则 C 印象化。必须回答：谁标注、分母、shadow/legacy 谁为真值、样本来源、进 C 阈值。                                                                                                                               | Doc 02 §7.5–7.6 / §10                                  |

### Phase A / B 指导（写入 Doc 02）

- **A**：独立任务于 `.kiro/specs/constitutional-governance-discovery/`；**Loom 登记唯一 Owner** 后方可编辑；**仅四份文档**（`terminology-and-non-equivalence.md`、`execution-entry-inventory.md`、`authority-evidence-baselines.md`、`web-read-shadow-slice.md`），优选各 ≤300 行；**不**建 schema/新包。
- **B 首切面冻结：`web_read`**（不选 node_exec / 外部写 / 消息发送）；引用 types.ts ~L36/~L66、surface-binding.ts ~L77、dispatch.ts ~L165；范围 = 只读网页检索意图 → shadow → web_read 决策 → gap → 结构化报告 → **不**调用 web_search/web_fetch；**v1 不写生产 ledger**。
- **B 编码前合同**：目标面 + ≥60 标注（20/20/20）+ 阈值 + 报告落点；双标注分歧由架构 Owner 裁决；确定性 / 跨租户零误归属 / 对 baseline 零差异；p95 附加延迟示例 ≤10 ms（未达 → C 视成本为反证）。
- **C 输出仅** GO / NO-GO / REVISE；**不预提交 GO**。

### 授权表（两文文首对齐）

| Phase                                | Status                                  |
| ------------------------------------ | --------------------------------------- |
| **A**                                | **正式批准启动**                        |
| **B 设计**                           | **批准**                                |
| **B 编码**                           | 补齐目标面/标注语料/阈值/报告落点后批准 |
| **C**                                | **保留独立评审权**                      |
| **D / contracts / Path / Gate 收紧** | **当前均不批准**                        |

### 确认

- Phase A 已标 **正式批准启动**。
- Phase D / constitutional-contracts / 真实 Path / Gate 收紧已标 **当前均不批准**。
- 原 P0–P9 **未**作为批准计划重新引入。
- Phase A **未**授权 schema 或新包创建。
