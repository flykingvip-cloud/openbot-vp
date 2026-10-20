# Phase D P8b — 真实合法 Path（书面范围；**accepted-for-knife1-only**；非整段开工）

> 书面范围：`phase_d_p8b_written_scope`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-p8b-written-scope.md`。  
> 日期：2026-09-26（Asia/Shanghai）  
> 基线：`main` @ `731aed0cc2db568f0ae04e7e4e8207ad6a957d23`（#70 merge）或其后。  
> 对照：Doc02 §9.3；`phase-d-p8b-p8c-deferred.md` §4；`phase-d-p8a-no-valid-path.md`；`terminology-and-non-equivalence.md` ADR-1；`phase-c-83-product-confirmation.md`  
> **状态：`accepted-for-knife1-only`**（2026-09-26 Asia/Shanghai）。记名接受记录：`phase-d-p8b-written-scope-acceptance.md`。  
> #71 入库时本页为草稿待接受；#71 验收 bot APPROVE 仅为 draft-into-repo，**不是**工程门接受。  
> 本页**仍不是**整段 P8b / 整段 Phase D 开工令。Knife1 编码仅在接受记录 + `phase-d-p8b-knife1-start-order.md` 两段门之后授权。

## 1. 一句话

在 Phase C **独立 NO-GO 仍有效**、Doc02 整段 Phase D **仍不批准**的前提下，本页把「若要做 P8b」所需的最低书面范围要素写齐。**记名接受（见 acceptance 记录）仅覆盖 Knife1 工程门**；接受本页 ≠ 批准整段 P8b 开工 ≠ 整段 D GO。主张天花板停在 **`code-present`**（相对已有 P8a）。**不得**借本页打开 enforce / Gate 收紧 / live invoke。

## 2. 前置与依赖（站桩）

| 项 | 状态 |
| --- | --- |
| Phase C Decision | **NO-GO**（`final-acceptance.md`；产品确认已锁定） |
| Doc02「D 当前不批准」 | **仍有效**；本范围是分刀草稿，不是整段 D 启动 |
| P8a（#59） | 已落地：`no_valid_path` 仅报告；合法 Path 集为空；`executed=false` |
| P8b / P8c（deferred） | **整段仍不批准启动**。父范围已 `accepted-for-knife1-only`；**仅** Knife1（选中-only）经 acceptance + start-order 窄授权。P8c 与其余 P8b 刀仍 defer |
| C5 / C10 | C5 不因本草稿转 pass；**C10 仍不能 pass** |
| 有界 D #58–#70 | 已收口 / 已合入；**不得**重开为下一刀清单 |

## 3. 合法 Path 的定义（本范围若接受后的语义）

**Path**（本范围用语）：一次**被显式选中**、且必须落在**预先命名的合法轨迹集合**上的执行意图。选中是可审计决策；未选中不得执行。

相对 P8a：

| | P8a（已落地） | P8b（本草稿；未开工） |
| --- | --- | --- |
| 合法 Path 集合 | **空** | **≥1** 条可指认、可版本化的合法轨迹 |
| `selectedPath` | 恒 `null` | 仅当选中落在合法集合时非空 |
| `executed` | 恒 `false` | 仅当「选中 ∧ 旗标允许 ∧ 边界内」可为 `true`；默认仍应为关 |
| 成功叙事 | 「缺口可命名」 | 「至少一条真实合法 Path 可被选中」；**仍 ≠** C5 全面 pass / Gate 收紧 |

### 3.1 非涂装清单（禁止等同）

下列**一律不是** Path（继承 ADR-1 / P8a OUT；本草稿不得放松）：

- `sessionKey` / 路由身份
- Lobster 流程、AOR 图、Fabric 图、休眠编排（`task-orchestration`）、知识资产 kind `"workflow"`
- 休眠 `PathKind` 类型存在 ≠ 已选中合法轨迹
- `ExecutionPlan`、执行链 provenance / 审计链
- Workflow 名称空间、插件已安装、回执（receipt）

涂装任一项为 Path → **本范围 FAIL**。

### 3.2 选中 / 执行边界与 `executed` 语义

若本范围日后被接受并另发开工令，实现须满足：

1. **选中**：仅从合法 Path 集合选取；集合外候选 → 保持 P8a 缺口报告路径；不得静默映射。
2. **执行边界**：执行面不得越过本范围书面列出的调用点；默认**不得**挂到 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook 热路径主决策。
3. **`executed`**：仅表示「在本范围边界内、且显式 opt-in 旗标允许时，选中轨迹的副作用被允许发生」。`executed=true` **不得**解读为 enforce 生产聊天、Gate 收紧、或 C5/C10 pass。
4. **与 C5**：P8b 至多支撑「存在 ≥1 条可被选中的合法轨迹」的局部证据；**禁止**把 P8b 合并叙事写成 C5 全面 pass。C5 转 pass 不早于（若获批的）完整合法轨迹空间与旁路表闭合——本页不定义该闭合。

### 3.3 回滚旗标

- 任何 P8b 实现必须可经**独立、默认关**的旗标秒级回滚到 P8a 行为（合法集为空 / `executed=false` / 仅报告）。
- 回滚不得依赖删库或热路径残留调用。
- 本草稿**不**命名新旗标字符串；命名留待开工令 / ADR。

### 3.4 Profile A / B 冲击

| Profile | 本范围要求 |
| --- | --- |
| A | Path 选中 ≠ session 路由授权；不得把 Path 写成逐用户授权边界替代品 |
| B | 不得借 Path 给插件打开对全部租户数据的无限制进程内访问；A/B 合同保持互斥，**禁止合并 Profile** |
| 主张 | 冲击分析在开工前书面写出；本草稿只要求「必须写」，不声称已写完 |

## 4. 明确不授权（OUT）

本页**即使被接受为书面范围**，也**仍不**授权下列项；开工令另议且不得偷渡：

- **enforce** 默认开；热路径 **Gate / Path 收紧**
- `ORCHESTRATION_LIVE_INVOKE` / **live invoke** = true
- Fabric default-on；为观察打开 Fabric
- **P8c**（影子 vs legacy 对照；收紧另立 ADR）
- **Tier H**（enforce 旗标、热路径收紧、并账、Fabric default-on、Bridge、替换 Pi 等）
- 重开有界 D **#58–#70** 为「下一刀」
- 整段 Phase D GO；把 Doc02「D 当前不批准」改成全局 GO
- 静默把 Phase C **NO-GO 翻成 GO**；改写五份冻结正文 / digests
- 新 soft-observe 刀；ACP stdio 软观察；AOR core 预检 import；Cron/subagent 新观察旗标
- 宣称 C10 pass / C5 全面 pass / 产品已拆

## 5. 主张等级

- 本页本身：书面范围正文；状态 `accepted-for-knife1-only`（非草稿待接受）。
- 相对已有 P8a 代码：天花板 **`code-present`**。
- 禁止：`runtime-enabled` / `production-proven` /「整段 P8b 已启动」/「Path 已存在于热路径」。Knife1 `code-present` 选中 API ≠ 整段 P8b 启动。

## 6. 接受与开工（两段门）

| 门 | 含义 | 记名落点（Knife1） |
| --- | --- | --- |
| **接受本书面范围** | 确认本页要素齐全；**宽度可收窄**（本轨为 Knife1-only） | `phase-d-p8b-written-scope-acceptance.md`（已记） |
| **开工令** | 另文；明确基线 SHA、实现落点、旗标名、测试与回滚；**本页不是开工令** | `phase-d-p8b-knife1-start-order.md`（已记；仅 Knife1） |

未过第一门不得编码。过第一门未过第二门仍不得编码。  
**整段 P8b / P8c / 整段 D** 仍须各自的接受 + 开工令；不得用 Knife1 两段门偷渡。

## 7. 范围内文件与后继指针

| 项 | 文件 |
| --- | --- |
| 本书面范围 | `phase-d-p8b-written-scope.md`（本页；`accepted-for-knife1-only`） |
| 记名接受记录 | `phase-d-p8b-written-scope-acceptance.md` |
| Knife1 开工令 | `phase-d-p8b-knife1-start-order.md` |
| 交叉引用 | `phase-d-p8b-p8c-deferred.md`：整段 P8b/P8c 仍 defer；Knife1 窄开工另标 |

## 8. 成功标准（对本 docs 刀）

| 标准 | 判定 |
| --- | --- |
| 草稿齐全 | 合法 Path 定义、非涂装、选中/执行/`executed`、回滚、Profile、OUT、两段门均写明 |
| 非整段开工 | 叙事明确：即便 accepted-for-knife1-only，本页仍非整段 P8b/D 开工令 |
| 站桩 | C NO-GO、整段 D 不批准、C10 不能 pass、无 soft-observe、五冻结未动 |
| 主张 | 仅 `code-present`；无 enforce/Gate/live invoke 授权 |
| OUT | P8c、Tier H、重开 #58–#70 均排除 |

**PASS（#71 docs 刀，历史）：** 草稿要素齐全且非开工。  
**PASS（本修订）：** 状态改为 `accepted-for-knife1-only` 并指向 acceptance + Knife1 start-order；整段 P8b/P8c/D 仍不批准。  
**FAIL：** 把本页写成整段 D GO、整段 P8b 已启动、或勾选/宣称 Path 已在热路径。

## 9. 验收交接

独立验收 bot：按本页 §8 + `phase-c-83-product-confirmation.md` 非授权清单审阅。  
Material Owner 不自合并；**不**直接呼叫验收 bot。工程门接受以 `phase-d-p8b-written-scope-acceptance.md` 为准（Owner via network-of-network）；不得用实现 PR 自声称接受。
