# 权威、证据与基线（Phase A）

> C11 目标以第二轮修订为准。旧「跨域单一写权威」不得再作为成功判据。

## 1. C11 目标

**最终措辞：** `Domain-local single authority + explicit cross-domain finalization protocol`

（域内单一终态写权威 + 显式跨域终态化协议。）

上层可以有只读聚合判断，**没有**通用写者。技能交付、聊天、协作任务、演进、发布是不同域。

### 已拒绝的写法

| 已废弃                      | 为什么错                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------ |
| 跨域单一写权威              | 会把不同域的终态写进同一作者，造成假对齐和跨域误写                                   |
| 全局完成状态机              | 各域 FSM 不能假装成一个完成机                                                        |
| 用 C11 全局 `fail` 概括一切 | 技能交付与演进在子系统内接近 near-conforming；缺的是协议，不是「还没建成的全局写者」 |

跨域终态化协议今天**缺失**。这是协议层缺口，不是开工令。Phase A 只点名，不设计协议包。

## 2. 域矩阵

写权威 = 谁可以落下该域终态。只读聚合 = 可以查看、不得回写。

| 域                      | 判定（相对当前代码基线）              | 终态写权威                                                                                              | 只读聚合可以看什么               | 不得做                                                                |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| 技能交付                | near-conforming                       | `src/agents/execution-preflight/` 的交付决议与 `issueValidationReceipt`。宿主登记校验器，模型不能自登记 | 回执、产物哈希、decision code    | 把 validation receipt 写成 effect proof；替聊天或发布落终态           |
| 普通聊天回合            | partial                               | **无单一所有者。** Pi 回合结束 + 预检/输出门。完成语气可来自模型                                        | 转录、预检 trace（进程内）       | 宣布「聊天已完成」为网络终态；调用 Fabric `decide()` 当作已包住热路径 |
| 协作 / ConversationTask | 局部权威                              | ConversationTask 存储与协作 `TaskStateMachine`（`packages/collaboration-core`）各自为政                 | 任务状态投影                     | 合成一个跨域写者；把 task 状态涂成 Path                               |
| 演进                    | near-conforming（v2）；v1 并行        | `packages/evolution-core` 状态机 + authority recheck。v1：`src/diagnosis/evolution-proposal.ts`         | lineage 投影（含 `receiptOnly`） | 合并 v1/v2 以追求全局完成机；把 receipt-only 事件当证明               |
| 发布                    | 局部权威（发布流程，不是 Agent 回合） | forward-only 门：候选须为 LIVE 后代（`deploy/production/scripts/verify-forward-only.sh`）               | ledger seq、gateway/UI SHA       | 用发布祖先代替交付回执或聊天完成                                      |

子代理登记、会话存储、Fabric `RunPhase`（仅当 Fabric 开启）也是局部状态，上表不把它们并进聊天写权威。

**跨域终态化协议：** Phase A 记录为无实现。Phase C 对 FC-02 裁决 NO-GO，不建协议包。后续 A/C 切片只增加默认关闭的只读观察：`consultDeliveryHoldForClose`，旗标 `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`。打开时记录咨询，不推迟 CTR `closed`，不产生跨域写者。未设旗标时运行时咨询次数仍为 0。

## 3. 证据分级

精神来自 `ledgerEventIsReceiptNotProof`（`packages/evolution-core/src/lineage.ts:30`）：事件类型落在 receipt-only 集合内则 `receiptOnly: true`。`verification.completed` 不在该集合。`EvolutionEffectProof` 另有 `none | linked-only | verified`。

| 等级        | 例子                                                            | 允许的宣称                     | 禁止的升格               |
| ----------- | --------------------------------------------------------------- | ------------------------------ | ------------------------ |
| proof（窄） | 演进 `verified`；发布「候选是 LIVE 的后代」且 LIVE 来自运行制品 | 该子系统内效果或祖先关系被核验 | 外推成每次工具调用的证明 |
| receipt     | 演进 `application.applied` 等；`issueValidationReceipt`         | 某步骤被记录或校验器签了字     | 标成 proof               |
| 请求内痕迹  | `execution-preflight/trace.ts`                                  | 本次进程里发生过预检           | 跨进程回放               |
| 审计链      | `src/infra/execution-chain-provenance.ts`；知识 lineage         | 血缘可追溯                     | 当成授权或 Path          |
| 模型文本    | 助手说「完成了」                                                | 用户可见输出                   | 状态转移或证据           |

三套 provenance（执行链、知识、发布）schema 不同，且不覆盖每次工具调用（C7 = partial）。

## 4. BaselineManifest

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

再生规则：每次阶段验收重读，禁止手抄旧 SHA 当永恒真源。进入 Phase B 前、进入 Phase C 前各冻结一次。生产事实优先读运行容器自报；本草案没有容器探测，因此生产列只代表**仓库账本在该 mainSha 上的末行**。账本与容器冲突时以容器为准，并把 Manifest 标过期。

主张标签：`code-present` / `runtime-enabled` / `production-proven`。未探测不得写 production-proven。

### 4.1 评审快照（示例 / 初始冻结 only）

来自可行性文 §3.2。**不是六周常量。** 不要用它验收本 PR 之后的代码。

| 字段                    | 值                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| assessedAt              | 2026-09-23（评审日；文档未给更细时刻）                                                            |
| productContractRevision | 评审文未单列 blob。不要补造                                                                       |
| mainSha                 | `f1c7efece96d68375bf4b7fb57e77908fedfdd6c`                                                        |
| productionSeq           | 96                                                                                                |
| productionGatewaySha    | `1617926868e64b3d65e1b2f37e488ba6e8fb08f0`                                                        |
| productionUiSha         | `1617926868e64b3d65e1b2f37e488ba6e8fb08f0`（评审文截断；完整值来自后来账本的 seq 96 行）          |
| evidenceSource          | 可行性文 §3.2 + 当时账本叙述                                                                      |
| 标签                    | **example / initial freeze only — regenerate at each acceptance; re-freeze before Phase B and C** |

### 4.2 Phase A 草案（对照当时的 origin/main）

与 §4.1 分开。第一次起草时 `origin/main` 仍是 `0c16055c29ac48d608cd6690ee85129e6c4b5544`，账本末行仍是 seq 96。推送前 trunk 前进到 #1254，账本末行变为 seq 97。下表是那次再生的草案，不是六周常量。它是否仍等于当前 `origin/main`，只以 §4.3 的 `git fetch` 为准。main 或生产再前进则本块过期。

```yaml
assessedAt: 2026-09-23T18:19:08+08:00
productContractRevision: README.md@1f3584d3774237c73cf94471a6ce147a94dad0d9+VISION.md@cc29ae3dfa48699345fd266dada8ad0b9407c372+SECURITY.md@2a86d29045bafe9ffef12b024365aa5fb427b7f6
mainSha: 526180af99f162f5a941cd1a7ef21a0b51791660
productionSeq: 97
productionGatewaySha: f1c7efece96d68375bf4b7fb57e77908fedfdd6c
productionUiSha: f1c7efece96d68375bf4b7fb57e77908fedfdd6c
evidenceSource: https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl seq 97 at mainSha (repo ledger only; no container probe); RELEASE_RECORD.md L3 identity matches this seq
```

说明：

- `mainSha` 是 `Delivery: record seq97 evolution cutover (#1254)`。相对评审快照，中间还有 #1251（上级文档）、#1253、#1250、#1255、#1254。
- seq 97 的 `liveFrom` 为 `2026-09-22T23:37:05.235Z`，`liveVerified: true`。账本证据是 `verify-live` 与 `build-info=f1c7efece96d`。这不是本任务对容器的复测。
- 生产 gateway/UI SHA 等于评审快照的 `mainSha`，不等于当前 trunk。seq 96（`1617926868e64b3d65e1b2f37e488ba6e8fb08f0`）已是上一行。
- `ORCHESTRATION_LIVE_INVOKE = false`、`isFabricEnabled`、`ledgerEventIsReceiptNotProof`、`defaultRuntime` 在该生产 SHA 上已存在（`code-present` 于生产源）。#1255 的交付收紧不在该生产 SHA 内，技能交付的新完成语义 production-proven = `unknown`。
- **seq 97 只是这个 assessedAt 的账本末行。** 验收、进 B、进 C 时必须重读账本或容器。不得把 96 或 97 抄进后续阶段当常量。

### 4.3 新鲜核对（`git fetch origin`，不是文件时间）

读取时刻：`2026-09-23T19:08:06+08:00`。本工作区先执行 `git fetch origin`，再执行 `git rev-parse origin/main`。

| 项                   | 值                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| 当前 `origin/main`   | `526180af99f162f5a941cd1a7ef21a0b51791660`                                                              |
| 与 §4.2 `mainSha`    | 相同。fetch 后 trunk 没有前进，所以该 SHA 在这一刻就是当前 main，不是过期标签                           |
| 历史评审快照         | 仍是 §4.1 的 `f1c7efece96d68375bf4b7fb57e77908fedfdd6c` / seq 96。不得把评审快照的 main 叫做当前 main   |
| 生产账本末行         | 同一时刻读取工作区 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` 最后一行：seq 97                                  |
| gateway SHA / UI SHA | 均为 `f1c7efece96d68375bf4b7fb57e77908fedfdd6c`                                                         |
| 账本证据字段         | `verify-live PASS: build-info=f1c7efece96d`；`liveVerified: true`；`liveFrom: 2026-09-22T23:37:05.235Z` |
| 容器                 | 未读 `openbot-gateway-rc`。上述 SHA 是仓库账本，不是本任务对运行容器的复测                              |

seq 96 与 seq 97 都只是被读到的账本行，不是长期常量。

## 5. 本文件不做

不指定跨域协议的消息格式，不新增完成写者，不修改 ledger，不宣称 C5/C10/C11 转 pass。
