# Phase C — unique-benefit 证据包（候选清单；编码残差）

> 包 id：`phase_c_unique_benefit_evidence_pack`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-pack.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 授权：`phase-c-unique-benefit-evidence-encode-acceptance.md` + `phase-c-unique-benefit-evidence-encode-start-order.md`（#82）  
> 合格标准：`phase-c-unique-benefit-evidence-scope.md` §5 / `phase-c-unique-benefit-evidence-encode-scope.md` §5  
> 基线：encode @ `e62265ae6bd358daead48edd3a7c3ee2a7d06836`（#82 merge）；**dig 复核 tip** `main` @ `b7945a46c12d55d388cedfeb35b888ea6319e82d`（#83 merge）  
> **状态：候选清单编码完成（#83）；2026-09-26 dig 复核已追加 §9；UNIQUE 仍为 0；unique-benefit 闸门仍 FAIL；Decision NO-GO / Independent COMPLETE 仍站桩；本包不宣称 PASS / GO。**

## 0. 一句话结论（硬）

从当前 `main` 静态可复核缺口中，新立 **4** 个彼此可区分的候选案（**不是** FC-01..03 重标）。诚实判定：**UNIQUE = 0**；**WEAK = 3**；**NON-UNIQUE = 1**。  
未凑满 Doc02 §8.2 要求的 **≥3 个 UNIQUE** 合格案 → **unique-benefit 推翻闸门仍 FAIL**。  
**禁止**把本包装成 PASS、Decision GO、C GO 或整段 D GO。主张天花板：**`code-present`**。

| 汇总 | 计数 |
| --- | --- |
| 候选案总数 | 4（UB-01..UB-04） |
| **UNIQUE** | **0** |
| **WEAK** | **3**（UB-01, UB-02, UB-03） |
| **NON-UNIQUE** | **1**（UB-04） |
| 相对 A–C 可廉价替代？ | 三例 WEAK 均未能证明「不可廉价替代」；一例 NON-UNIQUE（透镜路径已在 NO-GO 下授权） |
| **unique-benefit 闸门** | **仍 FAIL** |
| Decision / Independent | **NO-GO** / **COMPLETE**（未改写） |

> **Dig 后注（§9）：** 2026-09-26 深挖后 UNIQUE **仍 = 0**；闸门 **仍 FAIL**。详见 §9；上表为 #83 encode 快照，dig **未**把任一 UB 抬成 UNIQUE。

## 1. 路径 A–C 对照（不交付）

| 路径 | 含义 |
| --- | --- |
| **A** | 接线既有预检（`buildExecutionPreflight` / hold / trace） |
| **B** | CTR 关闭前咨询交付 hold（`consultDeliveryHoldForClose`） |
| **C** | 逐入口旁路表闭合（`reuse-observe` \| `exemption+break-glass` \| `delete`） |

每个候选必须论证：为何对本案 **不足或更昂贵**，以及 Meta-Schema / 统一契约有何 **A–C 无法廉价替代** 的独特收益。  
若只能写出「多一层文档 / 更优雅」，或收益可用 inventory 加列 / 既有 API 一次接线替代 → 判 **WEAK** 或 **NON-UNIQUE**，**不得**抬成 UNIQUE。

## 2. 明确排除（不得计入胜例）

| 排除 | 原因 |
| --- | --- |
| FC-01 / FC-02 / FC-03 | 冻结包已判定对 D **无**独特不可替代优势；#81/#82 禁止重标为 unique-benefit 胜 |
| 仅复述「observe 默认关」 | FC-01 家族已用 A 类 observe 接线推进；再写一遍 = 重哈希 |
| 术语统一 / 优雅 / 未来扩展 | `decision.md` 已拒绝为 GO 收益 |
| B1/B2 合成分类成功 | 禁止当业务失败 / 生产效果 |
| 宣称 runtime-enabled / production-proven / C10 pass | 本包 ceiling = `code-present`；C10 仍不能 pass |

## 3. 候选案

### UB-01 — Profile B 闭合仍 unknown（跨 CTR / 插件装载 / Cron·subagent）

| 字段 | 内容 |
| --- | --- |
| failureId | `UB-01-profile-b-closure-unknown-cross-surface` |
| symptom | Profile B（`managed_enterprise` / Gate 0）是否被 ConversationTask 库路径、插件装载、Cron/subagent 入口**闭合**，在 inventory / FC-08d 仍为 **`unknown`**。租户文件隔离（`openTenantScopedDb`）≠ Gate 0 专用卷证明；装载器与 Cron/subagent 路径**不读** `resolveSecurityProfile`。 |
| reproducible evidence path on main | 静态（基线 `e62265ae…`）：`grep -cE 'resolveSecurityProfile\|OPENBOT_SECURITY_PROFILE\|security-profile\|managed_enterprise'` → `src/conversation-task/store.ts` = **0**；`src/plugins/loader/load-orchestration.ts` = **0**；`src/cron/isolated-agent/run.ts` = **0**；`src/agents/subagent-spawn.ts` = **0**。对照：`src/gateway/security-profile.ts` 导出 `resolveSecurityProfile` / `assertSecurityProfileAllowsStartup`（Gateway 启动 Gate 0）。书面：`docs_phase_d_sparse_unknown.md` §4；`execution-entry-inventory.md` FC-08b/c/d；`phase-c-83-c10-claim-gate-progress.md` §4 OUTSIDE。 |
| why A insufficient / not cheaply equivalent | A 接线 `buildExecutionPreflight` 解决的是预检 trace/hold 包络，**不等于** Profile B Gate 0 / 专用租户卷闭合。HTTP/capability/node 上已有 observe 预检（A 类）仍未消除 FC-08d 的 Profile B unknown。 |
| why B insufficient | B（`OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`）只覆盖 CTR 关闭×delivery-hold；默认关；不读 security-profile；不触及插件装载或 Cron/subagent。 |
| why C insufficient | C 可把格子标成 exemption/unknown，但**标记 ≠ 证明** Profile B 闭合；C10 进度已把 Profile B 列在三态语言 **OUTSIDE**。加 inventory 列是文档收敛，不能单独消掉「Trusted Plugin（A）vs 租户隔离（B）」合同张力。 |
| proposed Meta-Schema / unified-contract unique benefit | 双 Profile **表面契约**：每个执行/协作面声明 `profileInvariants`（A-only / B-only / dual-declared），并与 `SECURITY.md` Trusted Plugin ≠ 全租户进程内访问做可机器核对的矛盾检测（类比启动期 `personal_local`×`managed` data.mode 冲突，但扩展到 CTR/插件/Cron 面）。 |
| measurable outcome（禁止仅字段填充率） | 基线：Profile-B-closure=`unknown` 的已点名表面数 ≥ **3**（CTR 库路径 / 插件装载 / Cron·subagent，见 FC-08d）。目标度量：该 unknown 计数下降，且每次下降附带**可复核的闭合证明**（读到 `resolveSecurityProfile` 或等价 Gate 0 边界，或记名安全 Owner 豁免+破玻璃）——不是把格子改成绿字。 |
| uniqueness judgment | **WEAK** — 扩展既有 `assertSecurityProfileAllowsStartup` 到更多表面（A 变体）或安全 Owner 补表 + disposition（C）可追逐同一 unknown 计数；**未能**证明必须用 Meta-Schema/统一契约包且不可被 A–C 廉价替代。 |

### UB-02 — 已 observe 接线入口的 CompletionAuthority 仍未声明（多态空洞）

| 字段 | 内容 |
| --- | --- |
| failureId | `UB-02-completion-authority-undeclared-on-observe-entries` |
| symptom | 多条副作用入口已离开 preflight `unknown`、落入 **explicit reuse-observe**（旗标默认关），但 inventory 仍记完成权威为 **none** / 域局部 / 不挂 completion hold。观察态预检 **≠** 完成权威对齐；「已治理观察」叙事与完成语义空洞并存。 |
| reproducible evidence path on main | `src/gateway/tools-invoke-http.ts`：存在 `OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE` + `buildExecutionPreflight`，observe 失败只 `logWarn`，**不**挂 hold。`src/gateway/enterprise-data/capability-agent-invoke-runtime.ts`、`src/gateway/server-methods/nodes.ts`、`src/organization/inter-agent-bus.ts`、`src/auto-reply/reply/dispatch-acp.ts` 同模式（import `buildExecutionPreflight` + observe env）。对照 inventory §10：上述入口「完成权威」多为 none / 不挂 completion hold；证据「旗标开才有 preflight trace；不是 proof」。 |
| why A insufficient | A **已经**在这些入口接线 observe；再加一次 `buildExecutionPreflight` 不创造共享 `CompletionAuthority` 类型，也不消掉「observe-on ∧ completionAuthority=none」联合语义。 |
| why B insufficient | B 只服务 CTR×delivery；不给 HTTP/node/capability/ACP/inter-agent 定义完成权威。 |
| why C insufficient | 旁路三态回答「是否复用预检 / 豁免 / 删除」，**不**回答「完成权威是什么」；把 completion 塞进 disposition 列会扩大 C 语义，仍是逐入口表格，不是跨面契约。 |
| proposed Meta-Schema / unified-contract unique benefit | 统一 `CompletionAuthority` + `EvidenceSink` 声明义务：每个副作用入口必须枚举 `none \| hold-bound \| domain-local \| exempt+break-glass`，并禁止在 `none` 时对外宣称与 attempt 热路径「完成包络对等」。 |
| measurable outcome | 基线：inventory 中「预检三态=explicit reuse-observe ∧ 完成权威=none/不挂 hold」的入口数（当前 ≥ **4**：tools-invoke / capability / node.invoke / inter-agent；ACP 进程内同类）。目标：该联合计数 → 0，或每条改为显式 `domain-local`/`exempt` 并附带审计可查的非对等声明（不是字段填满率）。 |
| uniqueness judgment | **WEAK** — `alternatives-matrix.md` 已对「入口登记契约」判文档价值高、运行时低，且可用旁路表维护替代；本案度量可用 C 加列廉价逼近，**未**证明 D 不可替代。 |

### UB-03 — 跨域证据种类不可等同残差（receipt ≠ proof ≠ validation receipt ≠ preflight trace）

| 字段 | 内容 |
| --- | --- |
| failureId | `UB-03-evidence-kind-non-equivalence-residual` |
| symptom | 演进域已区分 receipt / proof（`ledgerEventIsReceiptNotProof`）；技能交付有 `issueValidationReceipt`；预检有 request-local trace；观察刀明文「不是 proof」。ADR-2 禁止抬升，但**代码面没有**跨域 `EvidenceKind` 契约阻止把 validation receipt / preflight trace / 投递回执误当作 evolution effect proof 或发布证明。 |
| reproducible evidence path on main | `packages/evolution-core/src/lineage.ts`：`EvolutionEffectProof`、`ledgerEventIsReceiptNotProof`、`receiptOnly` 投影。`src/agents/execution-preflight/`（validation / trace / completion-claim）与观察入口注释「不是 proof」。书面：`terminology-and-non-equivalence.md` ADR-2；inventory 多行「投递回执 ≠ proof」。 |
| why A insufficient | A 增加预检调用只增加 **又一种** request-local 证据对象，不编码与 evolution proof 的不可等同约束。 |
| why B insufficient | B 咨询 delivery-hold / validation receipt，恰恰是最易被误升格的对象之一；咨询本身不建立跨域 EvidenceKind 边界。 |
| why C insufficient | 旁路表不管理证据种类抬升；exemption 行不能代替「receipt≠proof」机器约束。 |
| proposed Meta-Schema / unified-contract unique benefit | `EvidenceKind` 枚举 + 禁止边（validation-receipt ↛ effect-proof；preflight-trace ↛ publish-provenance；announce-ack ↛ completion-proof），供静态检查 / 评审闸共用同一张非等同表。 |
| measurable outcome | 基线：独立证据子系统 ≥ **3**（evolution lineage / preflight validation+trace / 投递·announce 回执）。目标：跨子系统「禁止抬升」边的静态违规数 = 0（例如校验器回执标识流入 `classifyEvolutionEffectProof` 输入的调用点数）；或设计/PR 审查中 receipt→proof 错误等同发现率可门禁——**不是** ADR 字数。 |
| uniqueness judgment | **WEAK** — ADR-2 + 评审清单已是 NO-GO 授权的**透镜**路径；lint/类型别名隔离可在不建 Meta-Schema 工程包的情况下追逐同一违规计数。**未**证明 D 工程化相对该路径有不可廉价替代优势。 |

### UB-04 — 多流程词并存且无合法轨迹空间（ADR-1 / C5）

| 字段 | 内容 |
| --- | --- |
| failureId | `UB-04-multi-workflow-vocab-without-path-space` |
| symptom | 至少五套流程词并存（Lobster / Fabric 图 / AOR 图 / 休眠编排 / 知识 kind `"workflow"`）；`sessionKey` 是路由身份不是 Path；C5 Valid Path = fail。易出现 Workflow=Path / sessionKey=Path 假等同。 |
| reproducible evidence path on main | 书面锚：`terminology-and-non-equivalence.md` ADR-1（含禁止表）。代码锚：`src/routing/session-key.ts`（路由身份）；`src/fabric/feature.ts`（Fabric 默认关）；`src/task-orchestration/types.ts`：`ORCHESTRATION_LIVE_INVOKE = false`；AOR / Lobster / 知识 workflow 分属不同目录（见 ADR-1 依据列表）。 |
| why A / B / C insufficient | A/B/C 均不定义合法轨迹空间，也不消除假等同；预检与旁路表回答的是入口治理，不是 Path 宪法对象。 |
| proposed Meta-Schema / unified-contract unique benefit | schema→代码透镜：强制映射「流程词 → 非 Path」，禁止设计文档把五套词收成合法轨迹空间。 |
| measurable outcome | 设计/PR 中 sessionKey=Path 或 Lobster/AOR/Fabric=Path 空间的假等同违规数可门禁。 |
| uniqueness judgment | **NON-UNIQUE**（相对推翻闸门）— `decision.md` / §8.3 产品确认已授权把 Meta-Schema **归档为可选词汇/透镜（无工程里程碑）**。本案收益正是该透镜路径，**不能**再拿来证明「必须 GO 做 D 工程包」；用本案撑 UNIQUE 会把已授权的 NO-GO 透镜偷换成 overturn PASS。 |

## 4. 与 FC-01..03 / 现行 NO-GO 的关系

| 项 | 说明 |
| --- | --- |
| FC-01..03 | **未**编入本包胜例；其 A–C 可替代结论仍有效 |
| 本包 UB-01..04 | 新缺口家族（Profile 闭合 / 完成权威多态 / 证据种类 / 流程词透镜）；**仍未**交出 ≥3 UNIQUE |
| `final-acceptance.md` | **不**因本包改写；Decision **NO-GO** / Independent **COMPLETE** |
| 五份冻结正文 / digests | **未**改写 |

## 5. 闸门判定（本 encode）

| 门 | 结果 |
| --- | --- |
| ≥3 真实可复现新案（候选） | **是**（4 案；均有 main 静态路径） |
| ≥3 **UNIQUE** vs A–C | **否**（UNIQUE=0） |
| 可度量且非仅字段填充率 | 部分写出度量，但因 WEAK/NON-UNIQUE 不计入胜 |
| 未把 FC-01..03 当胜 | **遵守** |
| **unique-benefit（Doc02 §8.2 首条）** | **仍 FAIL** |
| Decision GO / C GO / 整段 D | **未宣称；仍不批准** |

## 6. 主张天花板与禁止

- 天花板：**`code-present`**（文档 + 静态指认）。  
- **禁止：** unique-benefit PASS；Decision GO；C GO；整段 D GO；C10 pass；改写冻结 C；`src/` / `packages/` / 旗标；Path / Gate / enforce / live invoke / Fabric-on；静默改 `final-acceptance`。

## 7. 残差（本包之后；须另文）

- ~~等待首次 dig~~ → **已做**（§9，2026-09-26）；结果仍 UNIQUE=0 / 闸门 FAIL  
- 若未来出现真正 UNIQUE 新案：另 PR 增补本包或版本化副本；仍须独立接受，**不得**本文件自行改判 PASS  
- 若无新的 main 结构性缺口家族：建议停止重复 unique-benefit dig（见 §9.4）  
- **后续（2026-09-26）：** Owner 已选 Doc02 **§8.3** 运营路径（见 `phase-c-83-operate-path-confirmation-scope.md`）；**停止**重复 dig / Meta-Schema 工程化；**不**宣称 unique-benefit PASS  
- Material Owner 对新包的 GO 草稿（仅当 UNIQUE≥3 且其余推翻条件齐）  
- 三方新鲜 AGREE_GO；新 final-acceptance Decision GO  
- Doc02 §9 激活（仅独立 C GO 之后）

## 8. 验收提示（独立验收；本 PR 不呼叫 bot）

**PASS（本 encode 形态）：**

1. 新立本证据包；encode-scope 残差最小 xref（可选 product-confirmation 一短注）；无冻结正文改写。  
2. ≥3 新候选；**明文** UNIQUE/WEAK/NON-UNIQUE 计数；**明文** unique-benefit **仍 FAIL**。  
3. 未宣称 PASS/GO；未把 FC-01..03 当胜；无 `src/` / 旗标 / Path/Gate/enforce/live invoke。  
4. 主张天花板 `code-present`；NO-GO COMPLETE 站桩。

**FAIL：** 伪造 UNIQUE 凑满 3；宣称闸门 PASS / Decision GO；改写冻结包；夹带代码。

## 9. Dig 复核（2026-09-26；v2 注；仍 FAIL）

> Dig id：`phase_c_unique_benefit_evidence_dig`。  
> 分支意图：`docs/phase-c-unique-benefit-evidence-dig`。  
> Tip 确认：`origin/main` = `b7945a46c12d55d388cedfeb35b888ea6319e82d`（#83 merge；docs-only，相对 #82 **未**改 `src/`）。  
> 方法：本地 + `gh` 静态复读 tip inventory / C10 进度 / C11 章程 / terminology / authority baselines，并对 tip 源码做 `gh api contents` 核对；**禁止**把 UB-01..04 抬成 UNIQUE；**禁止**重标 FC-01..03；**禁止**宣称 PASS / GO / C10 pass。

### 9.1 Dig 一句话

在 #83 包（UB-01..04 = UNIQUE **0**）之上，又深挖了 C11 协议层、演进双权威、三套 provenance、ADR-3 安装≠授权、knowledge capability 面、constitutional façade 热路径缺席、CTR↔collaboration 双局部权威、多 Decision 词等**新缺口家族**。诚实结果：**仍找不到 ≥1 个相对路径 A–C 不可廉价替代的 UNIQUE 案** → **UNIQUE 仍 = 0**；unique-benefit 闸门 **仍 FAIL**。

### 9.2 Dig 候选（均未升 UNIQUE）

| Dig 候选 | 指认（tip `b7945a46…`） | 相对 A/B/C | 判定 | 为何不是 UNIQUE |
| --- | --- | --- | --- | --- |
| DIG-01 C11 跨域终态化协议缺失 | `phase-c-c11-finalization-charter.md`：协议层 fail；域内权威 + 显式 handshake/consult；**禁**跨域单写。先例仅 CTR×delivery `consultDeliveryHoldForClose`（默认关） | A=预检包络≠跨域握手；B=单例 consult；C=旁路三态≠终态协议 | **NON-UNIQUE** | 章程 §6–§7 **明文**：复用既有模块 / consult 形状，**禁止**为 C11 新建协议工程包，**不**把 C11 绑到 Meta-Schema GO。授权路径正是 A/C 扩展 consult，不是 D 包 |
| DIG-02 演进 v1/v2 双写权威并存 | inventory §7；`authority-evidence-baselines.md` §2；`packages/evolution-core` + `src/diagnosis/evolution-proposal.ts` 并行 | A/B/C 均不定义演进权威合并边界 | **WEAK** | 禁止合并可用 ADR + 评审/lint（透镜）追逐；C11 已要求保持域内权威。**未**证明必须 Meta-Schema 工程包 |
| DIG-03 三套 provenance schema 不可等同（exec-chain / knowledge / publish）+ C7 partial | `terminology-and-non-equivalence.md` ADR-2；`src/infra/execution-chain-provenance.ts`；knowledge / enterprise lineage stores；发布 forward-only | A 只加 request-local trace；B 咨询 delivery；C 不管理 provenance 抬升 | **WEAK** | 与 **UB-03** 同家族（证据种类非等同）。ADR-2 + 类型别名隔离已是 NO-GO 授权透镜；新建统一 provenance 契约包相对该路径无不可廉价替代证明。**不**另立胜例，**不**抬 UB-03 |
| DIG-04 ADR-3 插件安装≠能力授权 / 多登记簿合并张力 | tip：`load-orchestration.ts` 装载门与 `registerTool` 分离；能力分账于 tool-policy / capability-governance / skill-lifecycle / AOR registry | A 接线预检≠安装合同；C 可将装载行列豁免但不编码「禁合并登记簿」 | **WEAK** | `decision.md` 已否决 Registry 物理合并；SECURITY.md + inventory 已分列。文档/评审闸可维护禁令，**不必** D 工程里程碑 |
| DIG-05 `knowledge.capability.invoke` 无 live connector 却已登记 | tip `capability-invoke-runtime.ts` 注释：materialized data，live-connector 另轨；C10 进度 §3.2 已 **exemption+break-glass** | A 可再挂 observe；C **已**处置 | **NON-UNIQUE** | 旁路表路径 C 已覆盖；破玻璃=另立 live-connector 轨道，不是 Meta-Schema 独特收益 |
| DIG-06 constitutional façade / Path-gap **code-present** 但热路径未 import | inventory Phase D 后记；适配文件 `src/task-orchestration/constitutional-runtime-facade.ts`、`src/agents/execution-preflight/constitutional-runtime-facade.ts` 存在；gateway chat / tool invoke / ACP / AOR 主决策 **未** import | — | **NON-UNIQUE（反例）** | 有界 D 脚手架已在 NO-GO 下以 `code-present` 存在却无热路径可度量收益 → **削弱**「必须再开 Meta-Schema 工程里程碑」主张，不能当 UNIQUE 胜 |
| DIG-07 CTR 存储权威 ↔ collaboration-core `TaskStateMachine` 双局部权威无握手 | tip：`packages/collaboration-core/src/state-machines/task.ts` 独立转移表；CTR `store` / reply-completion **不** consult collaboration SM | A/B 不覆盖协作 SM；C 不定义跨局部权威协议 | **WEAK** | 与 DIG-01/C11 同结论：应用既有 consult 形状（A/C）即可推进；章程禁止为此新建 Meta-Schema 协议包 |
| DIG-08 多 Decision 词假等同（evolution ≠ Fabric `PolicyDecision` ≠ 协作 Decision） | `terminology-and-non-equivalence.md` 禁用别名表 | A/B/C 不消词表假等同 | **NON-UNIQUE** | 与 **UB-04** 同属已授权 **透镜**路径（`decision.md`：Meta-Schema 归档为可选词汇/透镜、无工程里程碑）。不能再拿来撑 overturn UNIQUE |

### 9.3 Tip 静态复核（抽样；与 #83 包一致处不重开案）

| 核对 | 结果（`b7945a46…`） |
| --- | --- |
| `resolveSecurityProfile` / `managed_enterprise` 在 `src/conversation-task/store.ts` | **0**（UB-01 仍成立；本 dig **不**抬 UNIQUE） |
| 同上于 `src/plugins/loader/load-orchestration.ts` / `src/cron/isolated-agent/run.ts` / `src/agents/subagent-spawn.ts` | **0** / **0** / **0** |
| `src/gateway/tools-invoke-http.ts` | 已有 `OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE` + `buildExecutionPreflight`（observe；不挂 hold）— UB-02 家族，**不**重标 |
| C10 进度页 | IN 含 reuse-observe + 多条 exemption；OUTSIDE 仍含 CTR 整行三态不适用、Profile B unknown、production-proven unknown；**C10 仍不能 pass** |
| #83 相对 tip | 仅三份 discovery 文档；**无** `src/` / 旗标变更 |

### 9.4 汇总（dig 后；诚实）

| 项 | 计数 / 状态 |
| --- | --- |
| #83 候选 UB-01..04 | UNIQUE **0** / WEAK **3** / NON-UNIQUE **1**（**未改判**） |
| 本 dig 新候选 DIG-01..08 | UNIQUE **0**；WEAK **4**（02/03/04/07）；NON-UNIQUE **4**（01/05/06/08，含 06 反例） |
| **累计 UNIQUE** | **仍 = 0**（< 3） |
| unique-benefit（Doc02 §8.2 首条） | **仍 FAIL** |
| Decision / Independent | **NO-GO** / **COMPLETE**（未改写冻结正文） |
| 建议 | 继续 A/B/C 收敛与旁路文档化；**不要**为凑 UNIQUE 伪造案；若无新的结构性缺口家族，宜停止重复 dig 或仅在出现**新** main 可复现、且 A–C 可度量更贵的缺口时再开刀 |

### 9.5 明确非升格（本 dig PR）

- **不**宣称 unique-benefit PASS / Decision GO / C GO / 整段 D GO / C10·C11 pass  
- **不**改写五份冻结正文 / digests / `final-acceptance.md` 决策位  
- **不**把 FC-01..03 或 UB-01..04 抬成 UNIQUE  
- **无** `src/` / `packages/` / 旗标 / Path / Gate / enforce / live invoke / Fabric-on  
- 主张天花板仍 **`code-present`**

