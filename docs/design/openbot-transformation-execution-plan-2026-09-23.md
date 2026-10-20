# 《OpenBot 企业 Agent OS：治理收敛执行方案（A–D）》

> **第二轮专家评审修订（2026-09-23）**  
> 第二轮裁决：修订已实质到位；计划现为**可控的治理发现项目**。正确下一步 = **两周事实收敛 + 冻结 web_read 只读切片的可度量合同**——**不是**创建 schema 或新包。  
> 第一轮保留项继续有效；原 P0–P9 **不是**批准计划（仅附录映射）。  
> 论旨：继续「防止错误统一」；纠正「再建设一套更高层统一系统」。OpenBot = **企业 Agent OS**；Meta-Schema = **治理手段**，须挣得席位。  
> 配套盘点：`01-openbot-constitutional-gap-and-feasibility.md` · 修订说明：`REVISION-NOTES-2026-09-23.md`

## 授权状态（权威）

| Phase                                                    | Status                                        |
| -------------------------------------------------------- | --------------------------------------------- |
| **A**                                                    | **正式批准启动**                              |
| **B 设计**                                               | **批准**                                      |
| **B 编码**                                               | 补齐目标面 / 标注语料 / 阈值 / 报告落点后批准 |
| **C**                                                    | **保留独立评审权**（不预提交 GO）             |
| **D / constitutional-contracts / 真实 Path / Gate 收紧** | **当前均不批准**                              |

| 字段                     | 值                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| 文档性质                 | 可执行项目方案（分阶段、可验收、可回滚）                                                       |
| 读者                     | OpenBot 领导层 / 架构与执行负责人                                                              |
| 评估快照（示例初始冻结） | `main` @ `f1c7efece…`；生产 seq **96** — **非六周常量**；验收用 BaselineManifest 再生（见 §3） |
| 差距评估                 | PR [#1249](https://github.com/gmood2008/openbot/pull/1249)                                     |
| 时间箱                   | **相对周数**；不做假精确日历                                                                   |
| 总原则                   | 先事实收敛 → 只读垂直切片（web_read）→ 硬决策门 →（仅独立 GO 后）有界契约工程化                |

---

## 1. 评审结论：批准什么 / 不批准什么

### 1.1 有条件通过且本轮确认保留

| 保留项                 | 含义                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| 别名禁令               | Agent≠唯一 Node、sessionKey≠Path、Workflow≠Path 等               |
| 旁路显式化             | 有副作用入口必须进同一可见面；结构旁路与 break-glass 均登记      |
| 权威 / 证据分级        | 双权威有名清单；**回执 ≠ 证明**                                  |
| 双 Profile 不变量      | Personal Local / Managed Enterprise 互斥；Fail Closed 分 Profile |
| 只读影子垂直切片       | 零执行、零阻断；首切面冻结为 **web_read**                        |
| ADR 候选约束           | **Workflow ≠ Path**；**插件安装 ≠ 能力授权**；**回执 ≠ 证明**    |
| C11 目标（第二轮重写） | **域内单一权威 + 显式跨域终态化协议**（见 §4）                   |

### 1.2 明确不批准（不得再当作现行计划）

| 不批准项                                            | 替代 / 说明                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| 预设四个独立工程产品                                | 仅当 Phase C **独立** GO 后可选单一 `constitutional-contracts`；**当前不批准** |
| 「18–22 周后才有首次运行时反馈」                    | Phase B（约第 3–6 周）即只读切片反馈                                           |
| 单一全局 C1–C12 分数作为主 KPI                      | 域级判定 + BaselineManifest 标签                                               |
| 无业务失败案例与量化收益即建 Constitutional Runtime | Phase C 硬门；失败则停在既有收敛                                               |
| 以 `path=unset` 单独作为热路径收紧成功门            | 真实 Path / Gate 收紧 **当前不批准**                                           |
| 「跨域单一写权威」/ 全局完成状态机                  | **已纠正谬误**；见 C11 目标                                                    |
| Phase A 创建 schema / 新包                          | A **仅**四份事实文档（§6）                                                     |
| 原 P0–P9 全量计划                                   | 仅附录映射                                                                     |

---

## 2. 总目标与非目标

### 2.1 总目标

在**不破坏**默认聊天热路径、双 Profile 安全合同、以及在途演进/执行链工作的前提下，把 OpenBot 作为**企业 Agent OS**，将既有治理（执行预检、ConversationTask、orchestration、Fabric 可选面、演进账本等）**收敛为可证明的执行链**——其中完成权按**域**落地，跨域经**显式终态化协议**组合，上层仅允许**只读聚合判断**。仅当 Phase C **独立**证明「仅收敛不够」并裁决 GO 时，才引入有界契约包。

### 2.2 非目标（Non-goals）

| 非目标                                                           | 说明                                           |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| 不把 Pi 重写成宪法 Runtime                                       | Pi 仍是默认执行面（且**已有**治理包络）        |
| 不默认打开 Fabric                                                | `src/fabric/feature.ts` 默认 OFF               |
| 不实现未批准的 Bridge MVP                                        | B1/B2 未批准编码                               |
| 不合并 Profile A / Profile B                                     | 互斥合同必须保留                               |
| 不把 Agent 重命名为 Node / 不做 Registry 大合并                  | 见禁用别名                                     |
| 不把 sessionKey 涂装成 Path                                      | Select Path 在设计上保持「缺失」，直至另立授权 |
| 不把 `ORCHESTRATION_LIVE_INVOKE` 设为 true                       | Phase B 保持 invoke=false / enqueue=false      |
| 不新造第五套执行状态机或独立日志库                               | 不写生产账本于 B v1；门面复用既有编排/预检     |
| 不建设「跨域单一写权威」/ 全局完成状态机                         | C11 目标已重写                                 |
| 不跳过 Phase C 独立评审进入 D                                    | **不预提交 GO**                                |
| 不把原 P0–P9 当作仍有效的批准计划                                | 仅附录映射                                     |
| Phase A 不创建 schema / 新 npm 包 / 新目录树（除规定的 ≤4 文档） | 见 §6                                          |

---

## 3. 三基线与 BaselineManifest（全程约束）

| 基线         | 标识方式                                                             | 用途                      |
| ------------ | -------------------------------------------------------------------- | ------------------------- |
| **产品合同** | README / VISION / SECURITY.md；Manifest 记 `productContractRevision` | 应当如何                  |
| **当前代码** | `origin/main` @ **当时** `mainSha`                                   | 仓库里有什么              |
| **当前生产** | **当时** `productionSeq` + gateway/UI SHA                            | 线上跑什么（≠ main 前沿） |

### 3.1 BaselineManifest（动态再生）

`main @ f1c7efece…` 与生产 `seq96` 是**本轮评审快照**，**不是**六周计划固定常量。main 与生产会前进。

- Phase A **必须产出** BaselineManifest。
- **每次阶段验收再生**（禁止手抄旧 SHA 当永恒真源）。
- **进入 Phase B 前**、**进入 Phase C 前**再次冻结。

最低字段：

```yaml
assessedAt:
productContractRevision:
mainSha:
productionSeq:
productionGatewaySha:
productionUiSha:
evidenceSource:
```

任何符合性 / 成功宣称必须标注：`code-present` / `runtime-enabled` / `production-proven`，并引用当时 Manifest。

### 3.2 本轮评审示例初始冻结（仅快照）

| 字段                   | 示例值（本轮评审）                         |
| ---------------------- | ------------------------------------------ |
| `mainSha`              | `f1c7efece96d68375bf4b7fb57e77908fedfdd6c` |
| `productionSeq`        | 96                                         |
| `productionGatewaySha` | `1617926868…`（完整值写入 Manifest）       |
| 标签                   | **示例 / 初始冻结**；后续以再生为准        |

---

## 4. 原则与 ADR 候选（全程保留）

1. **Fail Closed 分 Profile**：任何 DENY/关闭语义附 A/B 冲击表。
2. **Workflow ≠ Path**（ADR 候选）。
3. **回执 ≠ 证明**（ADR 候选）。
4. **插件安装 ≠ 能力授权**（ADR 候选）。
5. **旁路清单闭合前不宣称 C10**。
6. **C11 = 域内单一权威 + 显式跨域终态化协议**（第二轮核定）：
   - 技能交付、聊天、协作任务、演进、发布 = **不同域**；
   - 每域**一个**终态写权威；
   - 跨域组合经**显式 finalization protocol**；
   - 上层可有**只读聚合判断**，**永不**成为通用写者；
   - 旧「跨域单一写权威」/ 全局完成状态机 = **已纠正谬误**。
7. **以 BaselineManifest 为准**：不以过时行号、未合并分支、不完整 README、手抄旧 SHA 当源。
8. **任务签名提交**：治理相关变更不得夹带无关大重构。
9. **默认 Pi 热路径已有治理包络**：正确缺口是跨执行面对象模型 / 合法轨迹 / 域内权威与跨域终态化——不得写成「裸执行」。
10. **Phase A 零 schema / 零新包**：只产规定文档。

---

## 5. 路线图总览（A–D）

```text
Phase A  两周事实收敛（≤2 周）          ★ 正式批准启动
            │  四件文档；BaselineManifest；web_read 切片合同
            │  不建 schema / 新包
            ▼
Phase B  四周只读垂直切片（约第 3–6 周）  设计★批准；编码待合同齐备
            │  首切面 = web_read；零执行、零阻断；v1 不写生产账本
            ▼
Phase C  硬决策门                         ★ 保留独立评审权（不预提交 GO）
            │  仅输出 GO / NO-GO / REVISE
            ▼
Phase D  有界工程化                       ★ 当前不批准
            constitutional-contracts / 真实 Path / Gate 收紧：均待 C 独立 GO
```

| 阶段  | 类型        | 量级（相对周）             | 授权               | 主要依赖                           |
| ----- | ----------- | -------------------------- | ------------------ | ---------------------------------- |
| **A** | 发现 / 设计 | ≤ 2 周                     | **正式批准启动**   | Loom 登记当前唯一 Owner 后方可编辑 |
| **B** | 只读切片    | 约 4 周（累积约第 3–6 周） | 设计批准；编码待齐 | A 四件 + 目标面/语料/阈值/报告落点 |
| **C** | 决策门      | 评审会议量级               | **保留独立评审权** | A+B 证据；不预陈述「会通过」       |
| **D** | 有界工程    | 仅 C 独立 GO 后另议        | **当前不批准**     | C = GO                             |

**已废弃：** 原「W18–W22 门面接入后才有首次运行时反馈」时间线。

---

## 6. Phase A — 两周事实收敛（★ 正式批准启动）

### 6.1 目标

把「我们缺什么、旁路在哪、权威/证据如何、基线如何动态冻结、web_read 切片合同是什么」收敛为**四件且仅四件**可评审文档。压缩原 P0–P4 叙述；**停止**并行架构故事；**禁止**创建 schema 或新包。

### 6.2 任务位置与 Loom 门禁

建议作为**独立任务**置于：

```text
.kiro/specs/constitutional-governance-discovery/
├── requirements.md
├── design.md
└── tasks.md
```

**门禁：** 编辑前**必须**经 Loom 登记当前唯一 Owner（本方案只陈述该门禁；**不发明** Loom API 细节）。未登记不得改 specs。

产出文档建议落在该任务目录下（或同级 `docs/`，由 design.md 指定），**总计 ≤4 份**，每份优选 **≤300 行**——避免再造文档树。

### 6.3 四件且仅四件产出

| #   | 文件名                               | 内容要求                                                                                                                               |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `terminology-and-non-equivalence.md` | 冻结三条 ADR：**Workflow ≠ Path**；**receipt ≠ proof**；**plugin installed ≠ capability authorized**                                   |
| 2   | `execution-entry-inventory.md`       | 每个入口必须记录：默认启用？· Profile A/B · 身份源 · 授权点 · 工具过滤点 · 完成权威 · 证据/provenance · 失败语义 · production-proven？ |
| 3   | `authority-evidence-baselines.md`    | C11 = 域内权威 + 跨域终态化协议；含**动态 BaselineManifest**（§3 字段）；标清各域写权威与只读聚合边界                                  |
| 4   | `web-read-shadow-slice.md`           | 冻结 Phase B：输入/输出/旗标/测试语料/回滚/**零副作用证明**                                                                            |

### 6.4 任务清单

- [ ] Loom 登记当前唯一 Owner
- [ ] 产出上述四份文档（≤4；优选各 ≤300 行）
- [ ] 首版 BaselineManifest 写入产出 3（本轮评审 SHA/seq 仅作示例初始冻结）
- [ ] 架构评审纪要：确认「A 批准启动；D/contracts/Path/Gate 收紧当前不批准」
- [ ] **不**创建 schema、不新建 packages、不改 feature 默认值

### 6.5 验收

- 专家无需翻代码即可引用统一名词、入口表、域级权威与 Manifest。
- 能回答：C5 / C10 / C11（终态化协议缺失）「为何仍 fail、缺口叫什么名字」。
- `web-read-shadow-slice.md` 足以支撑 B 编码前的合同齐备检查（目标面/语料/阈值/报告落点）。
- 四件齐备；**无**运行时代码偷渡；**无** schema/新包。

### 6.6 回滚

文档争议 → 争议项标 open，保持「只盘点不改造」效力。无运行时回滚。

### 6.7 明确不做

- 不新建 Meta-Schema 包 / 四产品骨架 / 任意 schema 文件
- 不改 feature 默认值；不改入口行为
- 不做类型重命名；不合并 FSM；不建设全局完成写权威
- 不新造日志库；不扩展为第五、第六份「架构长文」

### 6.8 ★ 进入 Meta-Schema / Phase D 类工程前的决策门（与 C 对齐）

> **如果不建设 Meta-Schema，仅收敛现有执行契约，哪些问题无法解决？**  
> 必须列出**至少三个可复现问题**及**量化收益**；否则**不得**启动 Phase D。

A 阶段即可开始收集候选失败场景；**C 阶段独立裁定**——**不预陈述 C 会通过**。

---

## 7. Phase B — 四周只读垂直切片（设计★批准；编码待合同齐备）

### 7.1 目标

用**既有** shadow-observe 路径证明：治理透镜能否映射**真实代码**。零执行、零阻断、不假装 Workflow 是 Path。

### 7.2 首切面冻结：`web_read`（不得改选高风险面）

**第一切片：`web_read`。** 不要选择 `node_exec`、外部写、或消息发送。

#### 事实依据（仅引用下列已核实落点，不发明更多）

| 事实                                        | 锚点                                                |
| ------------------------------------------- | --------------------------------------------------- |
| `web_read` 已在编排类型中定义               | `src/task-orchestration/types.ts`（~L36）           |
| capability ladder 包含它                    | 同文件（~L66）                                      |
| 只读 symbol 绑定                            | `src/task-orchestration/surface-binding.ts`（~L77） |
| shadow 路径保证 invoke=false、enqueue=false | `src/task-orchestration/dispatch.ts`（~L165）       |
| 低风险                                      | 适合验证 intent → surface → gap report 映射质量     |

#### 切片范围

```text
员工聊天中的只读网页检索意图
  → shadow intent normalization
  → web_read surface decision
  → policy / evidence gap
  → structured report
  → 不调用 web_search / web_fetch
```

#### v1 报告落点

- **v1：不写生产 ledger。**
- Evaluator 返回结构化结果；测试 / 离线命令生成报告。
- **仅当字段稳定后**，再决定是否挂接既有 ledger（另立小决策，不默认写）。

### 7.3 复用面（不得新造第五套执行故事）

| 复用                        | 锚点                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| task-orchestration 影子观察 | `types.ts`（ExecutionSurface、ladder、SurfaceDecision、reason codes；`ORCHESTRATION_LIVE_INVOKE = false`） |
| 派发                        | `dispatch.ts`（invoke=false、enqueue=false、fail-closed observation）                                      |
| 表面绑定                    | `surface-binding.ts`（web_read 只读绑定）                                                                  |
| 执行预检（对照）            | `src/agents/execution-preflight/`                                                                          |

### 7.4 B 编码前必须齐备的合同（否则编码不批准）

| 合同项           | 要求                                                 |
| ---------------- | ---------------------------------------------------- |
| 目标面           | 冻结为 `web_read`（上节）                            |
| 标注语料         | ≥60 标注用例（§7.5）                                 |
| 阈值             | 进入 Phase C 考虑的数值门（§7.6）                    |
| 报告落点         | v1 = 结构化返回 + 测试/离线报告；**不写生产 ledger** |
| BaselineManifest | 进入 B 前再次冻结                                    |

### 7.5 评估合同（标注与地面真值）— 编码前冻结

**没有标注集，false allow / false completion 无法计算；没有阈值，Phase C 将沦为印象主义。**

#### 语料规模与构成

- **≥60** 标注用例：
  - **20** 明确应为 `web_read`
  - **20** 明确**不应**选 `web_read`
  - **20** 模糊 / 应澄清（clarify）
- Profile A / B **各半**；若主张「判断与 Profile 无关」须书面论证并获架构 Owner 签字。
- 双标注者分歧 → **架构 Owner 裁决**。
- 每例必须含：`expected surface`、`reason code`、`是否需要 human gate`。

#### 地面真值问题（必须在 `web-read-shadow-slice.md` 写死）

| 问题                                   | 要求                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| 谁标注「false allow」的正确答案？      | 双标注 + Owner 裁决；写入语料元数据                                           |
| false completion 的分母是什么？        | 明确分母（例如：标注为「应完成/不应完成」的子集规模）；禁止无分母比率         |
| shadow / legacy 分歧时哪边是地面真值？ | **标注集**为评估真值；legacy 行为用于对照与回归，**不是**自动真值             |
| 样本来源？                             | 须声明：prod replay / synthetic / unit fixtures（可混合）；每例标注来源标签   |
| 何种阈值才允许进入 Phase C 考虑？      | 见 §7.6；未达阈值则 C 只能 NO-GO 或 REVISE（指定证据），不得「感觉还行就 GO」 |

#### 确定性与安全不变量

- **同输入重跑 → 决策必须相同**（determinism）
- **跨租户误归属必须为零**
- 用户可见输出、工具调用次数、ledger 写入必须与 **shadow 关闭基线**一致（v1 本就不写生产 ledger）
- **p95 附加延迟预算示例：≤10 ms**；若未達，Phase C **必须**将成本视为反证（counter-evidence）

### 7.6 阈值门（进入 Phase C「考虑」的最低条；非预提交 GO）

下列数值为**建议冻结门**（可在 A 产出 4 中微调，但须在 B 编码前签字冻结）：

| 度量                                     | 进入 C 考虑的建议门                                    | 地面真值 / 分母                          |
| ---------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| false allow rate（相对标注）             | ≤ 5%（或 A 产出 4 冻结值）                             | 标注「不应 web_read」为分母中的负例集    |
| false completion rate                    | ≤ 5%（或冻结值）                                       | 分母 = 标注完成相关子集；须在产出 4 写明 |
| shadow/legacy 决策分歧率                 | 报告必报；阈值由产出 4 冻结（分歧≠自动失败，但须解释） | 对照侧 = legacy；真值 = 标注             |
| replay determinism                       | **100%** 同输入同决策                                  | 固定种子 / 固定语料重放                  |
| cross-tenant misattribution              | **= 0**                                                | 多租户夹具                               |
| 用户可见 / 工具调用 / ledger vs baseline | **零差异**（shadow 关）                                | diff 门禁                                |
| p95 附加延迟                             | **≤10 ms**（示例；未达 → C 视成本为反证）              | 基准探测                                 |

**未达标：** 不得主张「可进入 D」；C 应 NO-GO 或 REVISE（仅限指名证据，不扩 scope）。

### 7.7 任务清单（编码获批后）

- [ ] 接线：观察 → 归一意图 → `web_read` surface 决策 → gap report；**invoke=false / enqueue=false**；**不调用 web_search/web_fetch**
- [ ] Evaluator 结构化结果 + 测试/离线报告生成（**不写生产 ledger**）
- [ ] 对照 §7.5 语料跑通；记录双标注分歧与 Owner 裁决
- [ ] 指标仪表：§7.6 全项；周更
- [ ] 默认聊天路径零行为变更（diff 门禁）

### 7.8 验收

- ≥60 标注集上指标可复核；专家可看结构化报告。
- 证明映射的是真代码路径（types / surface-binding / dispatch），不是虚构样例。
- 用户可见结果与 shadow-disabled 基线一致。

### 7.9 回滚

关闭观察旗标 / 卸载接线；无执行面变更 → 回滚成本应接近配置级。

### 7.10 明确不做

- 不执行、不阻断、不收紧 Gate
- 不打开 Fabric；不设 `ORCHESTRATION_LIVE_INVOKE=true`
- 不调用 `web_search` / `web_fetch`；不选 node_exec / 外部写 / 消息发送作首切
- 不把 sessionKey / Workflow 涂装为 Path
- v1 不写生产 ledger
- 不宣称 C5/C10/C11 转 pass
- 无标注集 / 无阈值 → **不批准编码**

---

## 8. Phase C — 硬决策门（★ 保留独立评审权；不预提交 GO）

### 8.1 允许的输出（三选一；不得预陈述）

| 裁决       | 含义                                                                  |
| ---------- | --------------------------------------------------------------------- |
| **GO**     | 进入**有限** Phase D（范围由本门书面限定）                            |
| **NO-GO**  | **停止** Meta-Schema 工程化；停在既有收敛；Meta-Schema 降为可选词汇表 |
| **REVISE** | **仅**补齐指明的证据；**禁止**借机扩 scope                            |

**本方案不预陈述 Phase C 将通过。**

### 8.2 考虑 GO 时须全部为真（仍须独立签字）

- [ ] 能解释 **≥3 个真实失败场景**，且 Meta-Schema（或统一契约）对其有**独特**帮助（相对「仅收敛既有预检/编排」）
- [ ] 相对既有机制有**可度量收益**（须可复核；禁止空口号；**不得**仅用字段填充率）
- [ ] **不**引入第五套状态机或新日志存储
- [ ] Schema / 透镜已映射**真代码**（Phase B / web_read 证据）
- [ ] Profile A/B 相关行为已由测试固定（或有明确测试计划与 Owner）
- [ ] §7.6 阈值门达标；或未达标项已作为**反证**写入纪要且仍选 GO 的理由经架构+安全双签（例外应极罕见）
- [ ] BaselineManifest 在进入 C 前已再次冻结

### 8.3 若 NO-GO

- **停止** Meta-Schema / 四产品 / `constitutional-contracts` 工程化。
- 继续收敛既有 execution-preflight / ConversationTask / orchestration（及文档化旁路）。
- 将 Meta-Schema **归档为可选词汇表 / 透镜**，不设工程里程碑。

### 8.4 若 REVISE

- 书面列出**仅允许**补充的证据项与截止时间箱。
- **禁止**借 REVISE 扩到新切面、写权威合并、或提前建包。

### 8.5 明确不做

- 不允许「先开工再补失败场景」
- 不允许用字段填充率单独充当「可度量收益」
- 不允许在纪要中预写「预期 GO」

---

## 9. Phase D — 有界工程化（★ 当前不批准）

> **本节仅在 Phase C 独立裁决 GO 后生效。当前授权状态 = 不批准。**  
> 下列文字是**条件路径说明**，不是开工令。

### 9.1 第一刀（仅 GO 后）：单一契约包 + 只读 read model

建议包名（可调整）：`constitutional-contracts`

| 组件           | 职责                                          | 明确不做                                      |
| -------------- | --------------------------------------------- | --------------------------------------------- |
| **schemas**    | Identity / Contract / Evidence 等机器可读草稿 | 不改热路径；不抬升 Gateway `PROTOCOL_VERSION` |
| **adapters**   | 只读适配多本源账                              | 不物理并账；安装≠授权                         |
| **read-model** | 宪法账本**视图**                              | 不写穿源账                                    |
| **evaluator**  | 只读 / shadow 符合性报告                      | 默认不 enforce 生产聊天                       |

**Runtime 门面：** 复用 `task-orchestration` / `execution-preflight`；**不是**第五套执行故事；**不是**跨域通用写权威。

### 9.2 拆独立产品：推迟

Registry / Conformance / Runtime 拆独立产品：**推迟**，直到部署边界、所有权、生命周期被证明需要分离。

### 9.3 若日后 Path 工作获批：P8a / P8b / P8c（当前不批准启动）

| 子阶段  | 内容                                       | 门禁                                 |
| ------- | ------------------------------------------ | ------------------------------------ |
| **P8a** | 显式 `no_valid_path`——**仅报告，永不执行** | 可演示缺口命名                       |
| **P8b** | ≥1 条真实合法 Path                         | **无 P8b ⇒ 不讨论热路径收紧**        |
| **P8c** | 影子决策 vs legacy 对照                    | 指标达标且旁路表闭合后，收紧另立 ADR |

**废止：**「P8 成功 = path=unset」作为进入热路径收紧的门。  
**当前：** 真实 Path 与 Gate 收紧 **均不批准**。

### 9.4 Phase D 明确不做（继承总非目标）

- 不替换 Pi；不默认开 Fabric；不实现未批准 Bridge
- 不涂装 Path；不 Registry 大合并；不并 Profile
- 不建设跨域通用写权威
- 无 P8b 不谈热路径 Gate 收紧
- 不夹带 agents/gateway/fabric/evolution-core 大重构

### 9.5 回滚

契约包与观察旗标可独立关闭；任何 enforce / 收紧必须可秒级旗标回滚，并单独 ADR。

---

## 10. 影子 / 热路径相关度量（B 必报；D 若获批再继承）

**禁止**仅用字段填充率 / 旁路逃逸率充当成功。

| 度量                                                  | 要求                      | 地面真值提示           |
| ----------------------------------------------------- | ------------------------- | ---------------------- |
| false allow rate                                      | 必报；对照标注集          | 见 §7.5–7.6            |
| false completion rate                                 | 必报；分母写死            | 见 §7.5–7.6            |
| shadow / legacy 决策分歧率                            | 必报                      | 真值=标注；legacy=对照 |
| replay determinism                                    | 必报；目标 100%           | 同输入同决策           |
| p50 / p95 附加延迟与成本                              | 必报；p95 附加示例 ≤10 ms | 未达 → C 反证          |
| audit event missing rate                              | 必报                      | —                      |
| cross-tenant misattribution                           | **必须为零**              | —                      |
| rollback recovery time                                | 必报（演练）              | —                      |
| unknown object / unknown version / legacy schema 占比 | 必报                      | —                      |
| （可选参考）字段填充率、旁路逃逸率                    | 不得单独作为门禁          | —                      |

退出条件示例：指标恶化、Profile A 违约、发现未登记旁路、与在途演进 PR 冲突、跨租户误归属非零、无标注集仍主张「可度量」。

---

## 11. 组织、RACI 与冲突规避

### 11.1 建议角色

| 角色              | 职责                                                             | 主要阶段        |
| ----------------- | ---------------------------------------------------------------- | --------------- |
| 架构 Owner        | 别名/禁止动作/阶段门签字；裁决标注分歧；否决假性对齐与全局写权威 | A–C（D 若获批） |
| 安全 Owner        | Profile A/B 冲击；C9/C10 旁路与 break-glass                      | A、B、C         |
| 演进/执行链 Owner | 避免与 `evolution-core`、预检热路径冲突                          | A、B            |
| 文档/契约 Owner   | 四件产出、ADR 候选、Manifest 再生                                | A（D 若获批）   |
| 工程实现 Owner    | Phase B 切片接线（编码获批后）                                   | B               |
| Loom 唯一 Owner   | A specs 编辑前登记                                               | A 门禁          |

### 11.2 与在途演进 / 执行链工作的冲突规避

- A 阶段仅文档；优先落在 `.kiro/specs/constitutional-governance-discovery/` 规定产出。
- B 仅挂 shadow；避免无必要触碰 `packages/evolution-core` 转移表与 `attempt.ts` 预检主路径。
- 若必须触及热点：拆最小 PR、任务签名、与演进/执行链 Owner 双签。
- Bridge MVP、orchestration live invoke、Fabric 默认值、contracts 包、Path、Gate 收紧：**须单独批准**（当前后四项不批准）。

### 11.3 决策记录最低字段

1. 决策问题
2. 选项与否决理由（引用旁路表 / C5/C10/域级 C11 / Phase C 三态）
3. 对 Profile A / B 的冲击
4. 回滚方式（工程须写旗标）
5. 有效基线（BaselineManifest）与关联阶段（A–D）
6. 若涉 C11：写明域边界与终态化协议，**禁止**写「跨域单一写权威已达成」

### 11.4 节奏

- Phase A：文档评审；两周内四件产出；Loom Owner 门禁。
- Phase B：合同齐备后编码；可演示的只读报告；周更指标。
- Phase C：书面三态裁决；**不预提交 GO**。
- Phase D：仅独立 GO 后；每增量可演示、可回滚。

---

## 12. 成功标准总览

| 阶段        | 可验证成功                                                                 | 失败信号                                                    |
| ----------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A           | 四件文档评审通过；Manifest 可引用；web_read 合同字段齐全                   | 产出变成运行时代码 / schema 包 / 第五份架构长文             |
| B           | web_read 只读切片映射真代码；标注集可算指标；零执行零阻断；不写生产 ledger | 活 invoke；调用 web_fetch；无标注仍报 false allow；选错切面 |
| C           | 明确 GO / NO-GO / REVISE                                                   | 「先建再补故事」；预写预期 GO                               |
| D（若获批） | 单契约包 + 只读模型；门面复用既有编排/预检；无跨域通用写者                 | 第五状态机/新日志库；无 P8b 谈收紧；当前无授权却开工        |

阶段门：**C 未独立 GO 不得进入 D 的实现类任务**（词汇表维护除外）。

---

## 13. 阶段「不做」速查

| 阶段 | 明确不做                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------- |
| A    | 新建引擎/schema/包；改默认旗标；类型重命名；并行新架构长文；手抄旧 SHA 当永恒基线                    |
| B    | 执行/阻断；开 Fabric；live invoke；web_search/web_fetch；写生产 ledger；涂装 Path；无语料/阈值即编码 |
| C    | 跳过失败场景；用填充率冒充收益；预提交 GO；借 REVISE 扩 scope                                        |
| D    | （当前整阶段不批准）替换 Pi；默认开 Fabric；Bridge MVP；并账；跨域通用写权威；无 P8b 收紧            |

---

## 附录 A：原 P0–P9 → A–D 映射（已取代，非批准计划）

> **本附录仅供追溯。原 P0–P9 不是现行批准路线。**

| 原阶段                    | 去向                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| P0 基线冻结               | **并入 A**（术语/别名 + BaselineManifest）                              |
| P1 旁路显式化             | **并入 A**（产出 2）                                                    |
| P2 权威普查               | **并入 A**（产出 3；C11 目标重写）                                      |
| P3 证据对照               | **并入 A**（产出 3）                                                    |
| P4 单对象草图             | **压缩进 A**（产出 4 = web_read 切片）+ 由 B 用真代码验证               |
| P5 Meta-Schema            | **推迟至 D**（且仅 C 独立 GO）；**当前不批准**                          |
| P6 Conformance            | **推迟至 D**；只读 evaluator                                            |
| P7 Registry 分账          | **推迟至 D**；独立产品推迟                                              |
| P8 Runtime 门面           | **推迟至 D**；复用 orchestration/preflight；P8a/P8b/P8c；**当前不批准** |
| P9 热路径影子/收紧        | **不早于 D + P8b**；**当前不批准**                                      |
| 原 W18–W22 首次运行时反馈 | **废弃**；改由 Phase B 提供只读反馈                                     |

## 附录 B：关键路径速查（只读，勿当改造清单）

| 主题                       | 路径                                                                              |
| -------------------------- | --------------------------------------------------------------------------------- |
| Fabric 默认关              | `src/fabric/feature.ts`                                                           |
| Fabric decide              | `src/fabric/policy-runtime.ts`                                                    |
| 嵌入式预检与包络           | `src/agents/pi-embedded-runner/run/attempt.ts`；`src/agents/execution-preflight/` |
| 编排休眠 / 影子 / web_read | `src/task-orchestration/types.ts`；`surface-binding.ts`；`dispatch.ts`            |
| 演进状态机 / 血缘          | `packages/evolution-core/src/state-machine.ts`；`lineage.ts`                      |
| 安全双 Profile             | `SECURITY.md`；`src/gateway/security-profile.ts`                                  |
| Bridge 未批准              | `docs/design/bridge-mvp.md`                                                       |
| 工具旁路                   | `src/gateway/tools-invoke-http.ts`                                                |
| 设备 Node                  | `src/gateway/node-registry.ts`                                                    |

## 附录 C：与 C5 / C10 / C11 的宣称限制

| 不变量                    | 允许宣称的最早阶段                              | 宣称内容限制                                                                 |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| C5 Valid Path             | 不早于（若获批的）D·P8a；**转 pass 不早于 P8b** | 可宣称「缺口已命名」；不可宣称已符合；**当前不批准 Path 工程**               |
| C10 No Hidden Bypass      | 不早于 A 旁路表闭合 + 登记流程运行一个迭代      | 可宣称「主旁路已显式化」；break-glass 未登记则不可 pass                      |
| C11 域内权威 + 跨域终态化 | 不早于 A 域级清单；终态化协议另立项目           | 可宣称「域级权威已知」；**不可**宣称「跨域单一写权威已建成」（该目标已废弃） |

## 附录 D：配套文档

- 全栈盘点与可行性：`01-openbot-constitutional-gap-and-feasibility.md`
- 透镜摘要：`constitutional-meta-schema-brief.md`
- 源评估：PR #1249 / `openbot-constitutional-meta-schema-gap-assessment-2026-09-23.md`
- 修订说明（含第二轮）：`REVISION-NOTES-2026-09-23.md`
