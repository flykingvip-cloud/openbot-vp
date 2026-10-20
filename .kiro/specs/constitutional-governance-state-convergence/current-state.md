# 宪法治理当前状态

authorityRole: current-state-sot
observedAt: 2026-10-14T04:10:03Z
observedAtAsiaShanghai: 2026-10-14T12:10:03+08:00
originMainSha: 19549e6629d374308405edc2c0e3036739af2393
originMainObservedAt: 2026-10-14T03:55:33Z
originMainSubject: "docs(deploy): ledger seq127 LIVE tip 5ea7e2b7 (clean DIGEST) (#697)"
phaseCCurrentDecision: no-go-accepted
phaseCDecision: NO_GO_ACCEPTED
phaseDOverallGovernanceAuthorization: no-go
productionProven: false
gateTighteningAuthorized: false
liveInvokeEnabled: false
fabricDefaultOn: false
closeGateMet: false
runningContainerSha: null
containerLedgerAligned: null
productionEqualsMain: null
profileABMerged: false
seq98ExtrapolatedToPhaseCOrDPass: false
receiptTreatedAsProof: false
pluginInstallTreatedAsCapabilityAuthorized: false
ledgerOpenLiveSeq: 127
ledgerGatewaySha: 5ea7e2b7bd33e0a9f17e99829757913659db6e9f
ledgerUiSha: 5ea7e2b7bd33e0a9f17e99829757913659db6e9f
ledgerLiveFrom: 2026-10-14T03:30:04Z
ledgerLiveTo: null
priorAuthoritySnapshot: ".kiro/specs/constitutional-governance-state-convergence/current-state.md @ aff3fd345fa53f78ff37afc4ae40a67f28dbbe4e (observedAt 2026-09-27T04:23:34Z)"
supportingMatrix: "docs/design/evidence/constitutional-governance-state-matrix-2026-10-14.json"
priorMatrixFrozen: "docs/design/evidence/constitutional-governance-state-matrix-2026-09-27.json"
refreshEvidence: ".kiro/specs/constitutional-governance-state-convergence/evidence/2026-10-14-state-refresh.md"

本文件是宪法治理阶段状态的唯一当前权威源。历史 specs、回执和账本保留为证据，不再各自充当当前状态。2026-09-27 收敛后的主干前进与有界切片包，一律经本文件吸收后才进入「当前状态」；其他最终验收文件、PR 正文或账本 LIVE tip **不是**第二个权威源。

状态词只按这个阶梯使用：code-present、authorized、runtime-enabled、production-observed、production-proven。代码已合入不等于已批准启用。回执不是证明。插件已安装不是能力已授权。影子观察不是 live execution。Phase D 再分两层：整体治理授权，以及某个切片自己的有界授权。有界切片授权不构成整体治理授权。

## 反误读（必读）

| 误读 | 正确读法 |
| ---- | -------- |
| `#170 BOUNDED_RETENTION_APPROVED` = Phase D 整体 GO | 只批准保留已合入、默认关、当时未热路径接线的有界表面；**不**推翻 Phase C NO-GO；**不**批准开旗、接线、部署 |
| `#271 C1–C3 已合入` = runtime-enabled 或 production-proven | 实现是 **default-off**；C4（开旗/生产部署）仍禁止；观察接线 ≠ 执行启用 |
| `#689 H1 文档` = H1 实现已批准合入 | 文档三件套已合入；实现需单独授权 |
| `#694` 或账本 seq 127 = Gate/Path/Fabric/live invoke 已批准 | `#694` 为 **open Draft + governance hold**，未合入；账本 LIVE tip 只描述交付，不是宪法 GO |
| 过期的 2026-09-27 `current-state.md` / 矩阵仍「跟上主干」 | 本文件与 `…-matrix-2026-10-14.json` 才是刷新后的当前叙述；09-27 矩阵保留为冻结历史证据 |

## 1. Phase A 当前状态

Phase A 发现文档在主干上（合并提交 `f475db9eb12548c6754e182e9d58bf4de4211c24`，PR #3）。三条非等价原则、执行入口清单、域内终态写权威分析和 web_read 只读切片合同都是文档事实。

Phase A 批准的是发现本身。它不授权 Meta-Schema 工程化、constitutional-contracts、真实 Path 或 Gate 收紧。

`tasks.md` 里「架构评审纪要」勾选与「会议纪要未召开」写在同一项。当前读法：文档里有授权表；没有已召开的会议回执。勾选不是会议。

## 2. B1 当前状态

B1 离线 evaluator 在 `src/task-orchestration/web-read-shadow-eval.ts`，由 `25863bb272489c5994600801f7afec769599e149`（PR #14）合入。校准语料 60 行：web_read / not_web_read / clarify 各 20；Profile A / B 各 30；来源 synthetic 48、unit-fixture 12；没有 prod-replay。Blind holdout 文件在语料目录，并有 Owner 签署记录。

这是离线夹具。它不是生产效果，也不是 C5、C10 或 C11 通过。

## 3. B2 当前状态

B2 运行时接线在主干上（`65ffc350d737e747175d64b6daa9b78ac79a55e9`，PR #20；收敛记录 `2b9776708832d2cd3e533f0bf03a8498b0fc3f4a`，PR #23）。`observeWebReadShadowFromChat` 只在 ORCH_SHADOW 与 `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW` 同时为真时观察。两个条件默认都关。观察结果把 enqueue、invoke、wroteLedger、invokedTool 固定为 false。安全 sink 打日志，不写生产 ledger，不入队，不调用工具。

`tasks.md` 里「不 push / 不开 PR / 等待 Codex 验收」是接线当时的历史句子。代码后来已经合并。那些句子不再描述当前发布状态。

## 4. Phase C 最终决定

当前决定：**NO-GO accepted**（`phaseCDecision: NO_GO_ACCEPTED`）。本刷新 **不** 推翻该决定。

依据是已进入主干的三方回执，而不是材料草案里的 REVISE 段落：

| 槽位                                                                       | 回执                                | SHA-256                                                            |
| -------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Architecture `codex-architecture`                                          | `reviews/architecture-review.md`    | `df95c2344e2cf6e8ebfed886526a2e3b84c6c5914c7ab0d0581b5a152cab84b9` |
| Security `security-reviewer:profile-ab-tenant`                             | `reviews/security-review.md`        | `6e8505ab22b394fa50407185e15229d9a3adf981f7e206fa2377a3181838aa39` |
| Execution-chain `conversation-task-runtime:kiro-conversation-task-runtime` | `reviews/execution-chain-review.md` | `d6132d46d25eb427b13df8642edc43dabc8d9004acb86fd8153c6f6b7065a8d3` |

2026-09-27 在 `origin/main` `30fde26fdf8531259c18c4e2610c93df37206387` 上重算这三个文件的 SHA-256，与 `final-acceptance.md` 一致。回执落地提交是 `4bc5566b95f551c71d86a8c70d92ea4df9f10519`（PR #26）。当时评审的 `reviewedMainSha` 是 `2b9776708832d2cd3e533f0bf03a8498b0fc3f4a`，它是当前 `origin/main` 的祖先，不是当前主干。

`decision.md` 后部的 REVISE / pending / unsigned 段落按字节保留，并标明已被 final-acceptance 取代。它不是第二个当前决定。

NO-GO 的理由仍然有效：旁路与跨域终态协议不能靠新包自动消失；Meta-Schema 没有被证明相对既有模块有不可替代的收益；Profile A 与 Profile B 不合并；不新建第五套状态机、新生产日志库或跨域单一写权威。

Phase C 这次接受本身不授权整段 Phase D、真实 Path 的生产执行、Gate 收紧、live invoke 或 Fabric 默认开启。其后入库的有界切片文档与实现 **不推翻** 这句。回执不是生产证明。

## 5. Phase D：整体治理授权与有界切片授权

整体治理授权（Phase D as a whole）是 **no-go**。约束是 Phase C **NO-GO accepted**。没有找到推翻三方 NO-GO 的新回执。`#170` 的 Owner 有界 supersede（`SUPERSEDE_PHASE_C_BOUNDED` / `BOUNDED_RETENTION_APPROVED`）只覆盖「保留已合入表面」这一窄带，**不是** 整段 Phase D GO。

有界切片授权是另一层。`sliceConstitutesOverall` 与 `constitutesOverallGovernanceAuthorization` 都是 false。切片授权不构成整体治理授权。

每个 Phase D 组件的 runtimeEnabled（enforce / live invoke / Fabric default-on 意义下）、productionObserved（宪法执行路径）、productionProven、Gate 收紧仍为否。2026-10-14 复核源码常量仍是关闭（见 §6），没有触发硬停止。

### 5.1 截至 2026-09-27 已登记的 Phase D 组件（仍有效）

| 组件                       | 整体  | 切片设计           | 切片实现              | 授权文件 / 实现摘要 |
| -------------------------- | ----- | ------------------ | --------------------- | ------------------- |
| constitutional-conformance | no-go | bounded-authorized | landed                | #62 脚手架 |
| constitutional-registry    | no-go | bounded-authorized | landed                | #62 |
| constitutional-runtime     | no-go | bounded-authorized | landed                | #62（非 façade） |
| constitutional-contracts   | no-go | bounded-authorized | landed                | #58 |
| runtime façade             | no-go | bounded-authorized | landed                | #60 影子门面；另见 §5.2 `#271` 旁挂观察接线 |
| Path select                | no-go | bounded-authorized | landed                | #74 / #77 |
| Path report                | no-go | bounded-authorized | landed                | #59 |
| bounded execute opt-in     | no-go | bounded-authorized | landed                | #108 / #111 |
| P8c shadow compare         | no-go | bounded-authorized | authorized-not-landed | #119；实现未找到 |
| Path-Gate owner track      | no-go | bounded-authorized | docs-only             | #101 |
| orchestration shadow       | no-go | not-found          | not-found             | B2 不升为 Phase D 切片 |
| ORCHESTRATION_LIVE_INVOKE  | no-go | not-found          | not-found             | 常量仍 false |
| Fabric                     | no-go | not-found          | not-found             | `FABRIC_DEFAULT_ON = false` |
| Gate tightening            | no-go | not-found          | not-found             | `readyToTighten` 固定 false |

Path select 附加有界刀（#103/#104、#106/#107）仍不构成整体授权。

### 5.2 Post-2026-09-27 packets absorbed

以下包在 2026-09-27 权威矩阵的 14 个 Phase D 组件列表之外（或更新既有行的附加切片）。它们已由本刷新吸收进 SoT；**均不** 翻转 `phaseDOverallGovernanceAuthorization`。

| 包 | PR | 状态 | 天花板（claim ceiling） | 明确不授权 |
| -- | -- | ---- | ----------------------- | ---------- |
| Phase D bounded retention 批准 | #170 MERGED `cdcf9a0a…` | docs/governance | code-present、default-off、not-runtime-enabled、not-production-proven；Owner `SUPERSEDE_PHASE_C_BOUNDED` 仅保留表面 | 继续 Phase D 开发、接线、开旗、live execute、Fabric default-on、部署、生产使用 |
| Checkpoint B cycle-2 | #204 MERGED `364c2e81…` + closeout #213 MERGED `966372cc…` | docs；`AGREE_SHADOW_WIRING` | `checkpointCImplementationAuthorized=true` **仅**允许新建 default-off 实现任务；`runtimeEnabled=false` | 开旗、生产接线、SELECT/EXECUTE、部署、production-proven |
| Checkpoint C1–C3 实现 | #271 MERGED `d0a485eb…` | code-present + default-off 接线 | 旁挂 `observeConstitutionalRuntimeShadow`；default-off | C4 开旗/生产部署；enforce；live invoke |
| H1 热路径 façade observe 文档三件套 | #689 MERGED `43ed4241…` | docs-only | 书面范围/验收/开工令；default-off observe 设计 | Gate/Path 收紧、enforce、live invoke、Fabric default-on、H1 实现代码 |
| H1 热路径 façade observe 实现（ACP 一处） | #694 **OPEN Draft**（governance hold） | **未合入** | PR 自称天花板 `runtime-enabled (observe-only)` — **在合入并单独授权前不得记入 SoT 为已启用**；当前 SoT 记为 open / not-landed | 在状态未收敛且无单独用户授权前 **禁止 Ready/merge**；不合入不等于已批准 |

`constitutional-governance-closure`（模型调用入口 E15–E19 等）是另一套「治理」叙事，名称易与宪法治理混淆；**不是** 本 SoT 的 Phase D 整体授权，也不改写上表。

机器可读副本：`docs/design/evidence/constitutional-governance-state-matrix-2026-10-14.json`（支撑证据）。2026-09-27 矩阵与生产基线 JSON **冻结保留**，不覆盖。

## 6. 所有执行开关

以下都是源码常量或默认关闭的读取器（2026-10-14 对 `origin/main` `19549e66…` / 此前 tip `5ea7e2b7…` 只读核对），不是本 VM 上的进程环境采样：

- `CONSTITUTIONAL_CONTRACTS_ENFORCE = false`（`packages/constitutional-contracts/src/flags.ts`）
- `CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE = false`（同文件）
- `CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON = false`（同文件）
- `ORCHESTRATION_LIVE_INVOKE = false`（`src/task-orchestration/types.ts`）
- `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW` 未设置时 `isWebReadShadowEnabled` 为 false
- B2 还要求 orchestration shadow 旗为真；组合门默认不进入观察
- `OPENBOT_CONSTITUTIONAL_SHADOW`、`OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`、`OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`、`OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT` 只在调用方传入的快照里解释；未设置则为关
- Checkpoint C / H1 相关观察（含 `#271` 已合入的 runner 旁挂）在旗关时 inert；**不等于** runtime-enabled（执行）或 production-proven
- `OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE` 与 `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT` 默认关。它们是观察钩子，不推翻 Phase C，也不是 Gate enforce

## 7. 当前生产事实

当前 `origin/main` tip：`19549e6629d374308405edc2c0e3036739af2393`（2026-10-14T03:55:33Z / 北京时间 2026-10-14 11:55:33 CST，#697）。该 tip 为账本 seq127 文档合入；其父链含 LIVE tip `5ea7e2b7bd33e0a9f17e99829757913659db6e9f`（#696）。

账本 `deploy/production/releases.jsonl` **只读**解析：最后一条开放 LIVE 为 **seq 127**（无 `liveTo`），`gatewaySha` 与 `uiSha` 均为 `5ea7e2b7bd33e0a9f17e99829757913659db6e9f`，`liveFrom` `2026-10-14T03:30:04Z`（北京时间 2026-10-14 11:30:04 CST）。seq 98 的 B2 shadow 记载仍是历史证据，**不得**外推为 Phase C/D 通过。本刷新 **不修改** 账本文件。

`runningContainerSha`：**null**（本刷新未获得生产容器自证；不得用账本 SHA 顶替）。

账本 LIVE tip `5ea7e2b7…`（seq 127）是交付记录，不是宪法 `production-proven`，也不授权打开高风险开关。`closeGateMet` 仍是 false。

## 8. 未解决风险

- 运行容器 SHA 仍不可用；三项容器对齐字段保持 null。
- 主干 tip（`19549e66…`，#697）领先账本 LIVE tip（`5ea7e2b7…`，seq 127）；领先部分主要为账本/文档合入。未做 `rev-list` 全量计数（无本地 clone）。不得用账本 tip 填写 `runningContainerSha`。
- Phase D 整体治理授权仍然是 no-go。后继有界包（#170/#204/#271/#689）易被误读为整体 GO 或 runtime-enabled。
- `#694` 开放 Draft：若在 SoT 未合入刷新前 Ready/merge，会再次拉大「代码合入」与「权威状态」缺口。
- 跨域关闭、B1 无生产回放分母、Phase A 会议未召开等问题仍在。
- 名称易混淆的 `constitutional-governance-closure` 包可能被误当成宪法 SoT 更新。

## 9. 下一允许动作

- 合入本状态刷新（docs/evidence only；Draft PR；不翻转 GO）。
- 在 SoT 收敛前，继续将 `#694` 保持 Draft / hold；合并需**单独**用户授权与独立门禁评审。
- 继续把高风险开关保持关闭。
- 若要改旁路或关闭握手，只能在既有模块里做明确授权的补丁，并单独评审。那不是本任务，也不是 Phase D 整体开工许可。
- 取得生产主机只读权限后，可另开任务补证 `runningContainerSha`（仍不得用账本 SHA 顶替）。

## 10. 明确禁止动作

- 打开 `ORCHESTRATION_LIVE_INVOKE`、constitutional live invoke、enforce 或 Fabric default-on
- 启用真实 Path 执行、收紧 Gate、自动 enqueue 或 invoke
- 把 Phase D code-present、有界切片授权、`BOUNDED_RETENTION_APPROVED`、C1–C3 接线或 H1 文档写成整体治理授权、runtime-enabled（执行）或 production-proven
- 把 seq 98 / seq 127 或任何账本 LIVE 写成 Phase C 或 Phase D 通过
- 在无单独授权时将 `#694` 标 Ready 或 merge
- 合并 Profile A 与 Profile B
- 把 receipt 写成 proof，或把插件安装写成能力授权
- 新建第五套状态机、生产日志库或跨域单一写权威
- 修改 `deploy/production/releases.jsonl`、新增 release seq、改生产容器或部署（本刷新包禁止触碰）
- 用账本 SHA 填写 `runningContainerSha`
- force-push `main`
