# 智能诊断 × 统一进化控制面融合衔接计划

- 日期：2026-09-19
- 状态：**Track A / A4 Diagnosis Recheck 验收收敛。** A4 已在 `origin/main`（#1217 `b20c28825c`）。端口对照 working-style-store / Skill Lifecycle 与 Application `targetVersionAfter`；store 未变不得 RESOLVED。不 Apply，不执行 Promote/Hold/Rollback。A 类 confirm 闸门保持关闭。
- 基线：`origin/main` @ `643dcd6a4f`（含 #1211 `d9f0b6eeb8` / #1213 `f0c9e64248` / #1217 `b20c28825c`）；统一进化见 `docs/design/openbot-system-evolution-unification-plan-v1.md`
- 复核：专业团队 2026-09-19 反馈已全部纳入（见 §0.4、§9）
- 非目的：不打开生产闸门，不重写五条领域链，不新建第二份 Working DNA / Skill / Capsule

---

## 0. 给专业团队的正式反馈（初稿口径，保留备查）

总体立场不变：**诊断作为 Evidence / Candidate Producer 接入统一控制面，不再发展自己的审批、应用、验证生命周期。**

初稿把 `registerProposal` 误称为原子接口、把桥放进 `src/diagnosis`、把展示用 `pdr-*` / `ev:diag:*` 当可回查证据、把「管理员上下文」当成 evolution grant。这四条已按复核改为开工门槛，见 §1.4 与阶段 0。

### 0.1 仍采纳

三角色、默认 assist、A/B 分流、禁止 `ingestV1()` 作生产写入、桥为内部服务、确认 ≠ Apply、大白无 mutation、验证回读 SoT、禁止面、先冻 V1 再接 WDNA、阶段 6–8 外移。

### 0.2 已按复核改掉的落点

| 初稿                                                                                        | 修订                                                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `registerProposal` 是原子写入                                                               | 它是三文件顺序写；诊断活路径必须走新的幂等 `submitDiagnosisCandidate`                                              |
| 桥在 `src/diagnosis/diagnose-evolution-bridge.ts` 并 `ensureEvolutionControlPlaneStarted()` | 诊断只输出 DTO；ingest 在 `src/gateway/evolution-control/diagnosis-ingest.ts`                                      |
| 校验 `professionalReportId` + 散文 `ev:diag:*`                                              | B 类必须引用持久化 Composite Report / Finding / 真实 `DiagnosticEvidence`，或哈希封存的 `GrowthAssessmentSnapshot` |
| grant **或** 企业管理员上下文                                                               | WDNA 第一刀只复用 evolution working-dna grant + `assertEvolutionGrantBinding`；管理员身份不能代替 grant            |
| `sourceMechanismRef = diagnosis.<reportId>.<finding>`                                       | 稳定机制码，如 `diagnosis.behavior.reporting_cadence_gap`                                                          |
| 去重含 `professionalReportId`                                                               | `tenant + surface + target + mechanism + candidateVersion`；另需 commandId / 并发锁                                |
| `EvolutionSubmissionRef` 复制控制面 status                                                  | 只存不可变链接                                                                                                     |
| 阶段 0 主要靠源码字符串测试                                                                 | 依赖边界 + 假控制面端口 + 诊断后三库零变化                                                                         |
| 服务端自调用 Gateway RPC 投影状态                                                           | 服务端走控制面只读端口；UI 才调 RPC                                                                                |
| 身份/记忆/技能未使用可推 WDNA                                                               | 必须有任务结果、操作指标或 Pattern Observation，以及可复现 baseline                                                |
| 沿用工具名 `confirm_diagnose_evolution`                                                     | 用户语义 `confirm_diagnose_prescription`；旧 ID 仅内部别名，单 handler                                             |

### 0.3 仍不采取

A 类处方进 `EvolutionProposal`；`ingestV1()` 作活桥；复活诊断 V1 生命周期；靠打开 confirm / Da Bai delivery / `user.daibai.execute` 完成融合；「未安装技能」自动变安装/创作候选；第一期有限自治；跨租户或 session 参数当授权。

### 0.4 对第 9 节的正式答复（已锁）

1. **A/B：修订。** `identity | memory | learn_capability | review_tasks` 全部保持 A 类。未来改 `reportingCadence` 必须新增明确 structural intent，不得复用 A 类 purpose。
2. **自动提交 B 类：一期反对。** 一期只生成 preview。主人或有权管理员确认后才提交。未来高置信系统安全 Finding 可单独批准自动登记为 `DISCOVERED`，仍不得自动开实验。
3. **WDNA grant：必须复用。** `evolution-grant:` + `assertEvolutionGrantBinding`。不新增代诊管理员快捷 grant。
4. **去重：不含 reportId。** 全局未终态唯一；观察窗口只作 cooldown 元数据。内容或 `candidateVersion` 变化才能新提案。
5. **大白开实验：有条件同意。** 大白只展示并发起审批请求。`evolution.experiments.create` 的 Gateway 会话必须具备 `operator.approvals`。
6. **阶段 6–8：同意独立。** 不阻塞诊断桥，但旧 auto 未收敛前不得宣称「进化已完全单轨」。
7. **确认工具：修订。** 用户语义 `confirm_diagnose_prescription`。旧 ID 仅兼容别名；一个 handler、一个审计事件、一个状态存储。
8. **回流权威源：要注册表。** 第一期实现 WDNA 与 Skill Installation，并冻结 `surfaceId → authority recheck` 接口。其余 Surface 接入前补 read-after-write 合同。

### 0.5 第二轮实施契约（2026-09-19 复核，已锁）

四条均已对照代码核准，本修订只保留一种定义。

**P0-A 提交接口只保留对象形。** 唯一签名：

```text
submitDiagnosisCandidate({
  commandId,
  candidate,          // StructuralEvolutionCandidate DTO
  trustedContext,     // 服务端会话 / membership，非客户端权威
  grantId,
})
```

Gateway 根据 DTO + 服务端身份构建 `EvolutionProposal`、`proposalId`、`candidateRef`、`tenant`、`target`。诊断或客户端不得提交完整 Proposal。禁止 `submitDiagnosisCandidate(commandId, proposal, candidate)`。

**P0-B WAL 只做前向恢复。** Ledger 是 append-only（`ledger.jsonl`），没有跨文件事务，不能删除已写事件来“全部回滚”。固定状态：

```text
pending → proposal_written → candidate_written → ledger_written → committed
```

重试只补齐缺失步骤。`Ledger eventId` 必须唯一；同一 `commandId` 不得重复追加事件。若将来要原子回滚，只能另做单一事务快照再整体替换，不在一期范围。

**P0-C Proposal 初始状态冻结。** `start_experiment` 只接受 `APPROVED_FOR_EXPERIMENT`（`packages/evolution-core/src/state-machine.ts`）。一期：

- preview：不注册 Proposal
- 用户确认但 grant 未通过：不得注册
- 用户确认 + WDNA grant 已批准 + Authority Gate 通过：注册为 `APPROVED_FOR_EXPERIMENT`
- 开实验仍需单独 `operator.approvals`
- 用户确认不能替代 evolution grant

**P0-D A 类代理确认必须专用 grant。** 两条合法路径：

1. 本人：同 tenant 且 `callerUserId === targetOwnerId`
2. 代理：grant 同时绑定 tenant、`targetPrincipal`、`targetAgent`，且含专用 action `schedule_diagnosis_prescription`

不得复用 Working DNA `evolution-grant:` 确认 Cron 处方，也不得仅凭企业管理员角色放行。

---

## 1. 现状锚点

### 1.1 统一进化

| 对象               | 真名                                   | 事实                                                                                                                                                               |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 核心模型 / Surface | `@openbot/evolution-core`              | `packages/evolution-core/src/{types,surfaces,state-machine}.ts`                                                                                                    |
| 控制面             | `createEvolutionControlPlane`          | `src/gateway/evolution-control/control-plane.ts`                                                                                                                   |
| 启动               | `ensureEvolutionControlPlaneStarted()` | `server-methods.ts` 约 114 行（111 是旧治理调度）                                                                                                                  |
| `registerProposal` | 顺序写                                 | `proposals.put` → `candidates.put` → `ledger.append`（559 行起）；持久化分文件：`proposals.json` / `candidates.json` / `ledger.jsonl`（`persistent-store.ts:150`） |
| `ingestV1()`       | 只投影 V1                              | 不封存 Candidate；活路径禁用                                                                                                                                       |
| 领域 Adapter       | 五类                                   | `adapters/{working-dna,skill,capsule,organization,runtime-governance}.ts`                                                                                          |
| WDNA 授权          | `assertEvolutionGrantBinding`          | `src/gateway/evolution-control/evolution-grant.ts`；purpose 前缀 `evolution-grant:`，`surfaceId` 固定 `agent.working-dna`                                          |
| 写 RPC             | `evolution.*`                          | `evolution-control.pack.ts`；写操作需 `operator.approvals`                                                                                                         |
| 治理默认           | `assist`                               | `auto` 才允许旧 tick 直写 runtime                                                                                                                                  |

### 1.2 智能诊断

| 对象           | 真名                                      | 事实                                                                                              |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 专业报告 ID    | `professionalReportId()`                  | `pdr-` + 对 tenant/sourceReportIds/window/mode 的派生 hash，主要随 RPC 返回，**不是**已存储权威行 |
| Producer 证据  | `ev:diag:*`                               | 对 `kind+subject+summary+pdr` 散文 hash，**不是** `DiagnosticEvidence`                            |
| 处方           | `EvolutionPrescription`                   | A 类四个 purpose；确认灰盒关闭                                                                    |
| 确认           | `confirmDiagnoseEvolutionPrescription`    | 接收 `callerUserId` 但 `runConfirm` **未校验**其与 `targetOwnerId` / grant 的关系                 |
| 诊断图证据     | `DiagnosticEvidence`                      | `src/diagnosis/types.ts` 已有权威形状；成长面尚未纳入 Diagnosis Graph                             |
| 投影快照       | `composite_diagnosis_projection_snapshot` | P26.5 有 persist/read，**不是** Report DB，也尚未被专业报告 Producer 当作 B 类证据源              |
| 诊断 V1 提案机 | `evolution-proposal.ts`                   | 冻结为兼容 DTO                                                                                    |

### 1.3 衔接裂缝（初稿未写全）

1. Producer 把 A 类 purpose 编成报告内 candidate。
2. `registerProposal` 非事务，不能当诊断提交接口。
3. 若桥放进 `src/diagnosis` 并启动控制面，Evidence Plane 获得写能力，并与 `evolution-control → diagnosis/evolution-proposal` 形成环。
4. 没有可回查的封存 Finding，桥无法证明报告/租户/证据。

### 1.4 四项 P0（阶段 0 必须完成，否则禁止活 ingest）

**P0-1 幂等提交服务。** 新增 Gateway 所有的 `submitDiagnosisCandidate({ commandId, candidate, trustedContext, grantId })`。服务端构建 Proposal。WAL 前向恢复（§0.5 P0-B）。禁止把现有 `registerProposal` 称为原子接口；禁止调用方传入完整 Proposal。Pattern Detection 现网调用可暂留，诊断不得复用其半提交语义。

**P0-2 桥不在 `src/diagnosis`。**

```text
src/diagnosis/
  只输出 StructuralEvolutionCandidate DTO
  不得 import gateway/evolution-control 或领域 Adapter

src/gateway/evolution-control/diagnosis-ingest.ts
  校验授权、解析目标、调用 submitDiagnosisCandidate
```

**P0-3 可校验事实源。** B 类必须引用：

- 已持久化的 Composite Diagnosis Report，或
- Diagnosis Graph 中的 Finding + 真实 `DiagnosticEvidence`，或
- 不可变、哈希封存的 `GrowthAssessmentSnapshot`

不得用 `pdr-*` 展示 ID 或 `ev:diag:*` 散文 hash 充当 evidenceRef。

**P0-4 授权只复用 WDNA grant。** 服务端 membership + agent ownership proof + `evolution-grant:` + `assertEvolutionGrantBinding` + Surface Authority Gate。企业管理员身份不是 evolution grant。

---

## 2. 目标闭环

```text
运行事实
    │
    ▼
src/diagnosis  READ_ONLY
  专业报告（展示）
  A. EvolutionPrescription
  B. StructuralEvolutionCandidate DTO（preview，未提交）
    │
    ├─ A → 对话芯片 / 1:1 / confirm_diagnose_prescription（灰盒）
    │      → CronService → 运行证据
    │
    └─ B preview
         主人或有权管理员确认
         │
         ▼
src/gateway/evolution-control/diagnosis-ingest.ts
  回查封存 Report/Finding/Evidence 或 GrowthAssessmentSnapshot
  membership + ownership + evolution working-dna grant
  submitDiagnosisCandidate({ commandId, candidate, trustedContext, grantId })
  服务端构建 Proposal，注册 APPROVED_FOR_EXPERIMENT
         │
         ▼
控制面 Proposal + Candidate + Ledger（WAL 前向补齐）
  Experiment（另需 operator.approvals）→ Adapter Apply → Verify
         │
         ▼
EvolutionVerificationRef（不可变链接）
  authority recheck 注册表回读领域 SoT
  诊断再解释原问题是否消失
```

原则：

- A/B 写路径不得交叉。
- `src/diagnosis` 永不调用 Adapter `apply*`，永不启动控制面。
- ingest 失败 fail-closed：报告仍可发布，B 类保持 `preview` / `not_submitted`。
- `EvolutionSubmissionRef` 只存 `proposalId` / `candidateRef` / `commandId` / 内容 hash，**不复制**控制面 status。展示状态由组装层当场只读查询。

---

## 3. 契约

### 3.1 诊断侧 DTO（`src/diagnosis` 唯一出口）

```text
StructuralEvolutionCandidate = {
  schemaVersion: 1
  mechanismRef          // 稳定码，如 diagnosis.behavior.reporting_cadence_gap
  surfaceId             // evolution-core 已有 ID
  targetHint            // agentId 等提示，非权威
  baselineHash          // 可复现 baseline
  proposedChange        // { field: reportingCadence, value: on_completion|milestone|periodic|on_request }
                        // daily|weekday_daily|weekly 是 Cron/处方周期，不是 Working DNA 字段值
  candidatePayloadHash  // = candidateVersion
  candidateVersion      // hash(schemaVersion, intent, proposedChange, mechanismRef, surfaceId, targetHint, baselineHash)
  evidenceRefs          // provenance；不得进入 candidateVersion
  snapshotRef           // provenance；不得进入 candidateVersion
  reportRef             // provenance；不是 pdr 展示 ID；不得进入 candidateVersion
  findingRef            // provenance；不得进入 candidateVersion
  observedWindow        // provenance；不得进入 candidateVersion，也不得进入 cooldownKey
  cooldownKey           // hash(intent, proposedChange, targetHint, surfaceId)
  structuralIntent      // 显式枚举；不得等于 A 类 purpose
}
```

`identity | memory | learn_capability | review_tasks` 不得出现在 `structuralIntent`。改 `reportingCadence` 必须是新 intent，例如 `adjust_reporting_cadence`。`proposedChange.value` 必须是 Working DNA `ReportingCadence`：`on_completion | milestone | periodic | on_request`。Track B 可直接构造 `delta: { reportingCadence: proposedChange.value }`。禁止 `daily | weekday_daily | weekly`。

WDNA 候选不得仅由身份缺口、记忆文件数或「技能未使用」推出。必须同时具备：

- 任务结果、操作指标或 Pattern Observation；
- 可复现 baseline（现有 working-style 读值）。

### 3.2 Gateway ingest（唯一提交签名）

```text
submitDiagnosisCandidate({
  commandId,                 // 幂等键；并发同一 commandId 只生效一次
  candidate: StructuralEvolutionCandidate,
  trustedContext,            // 服务端会话 / membership，非客户端权威
  grantId,                   // WDNA 第一刀：evolution working-dna grant
})
```

Gateway **必须**从 DTO + `trustedContext` + grant 构建，调用方不得传入：

- 完整 `EvolutionProposal`
- `proposalId` / `candidateRef`
- 权威 `tenantId` / `target`

服务端生成：`proposalId`、`candidateRef`（= `candidateVersion`）、`tenantScope`、`target`、`surfaceId`、`sourceMechanismRef`、`sourceEvidenceRefs`、`status: APPROVED_FOR_EXPERIMENT`（仅当确认 + grant + Authority Gate 均已通过）。

步骤（前向恢复，不是回滚）：

1. 占用 `commandId` receipt = `pending`。已是 `committed` / `deduped` 则原样返回。
2. 回查 `reportRef` / `findingRef` / `evidenceRefs` 或 `snapshotRef`；租户不一致则拒绝，receipt 保持非 committed。
3. `getEvolutionSurface`；禁止面拒绝。
4. membership + ownership proof + `assertEvolutionGrantBinding` + Authority Gate。任一失败：**不注册 Proposal**。
5. 锁内按 `tenant+surface+target+mechanism+candidateVersion` 查未终态；命中则 receipt=`deduped`。
6. WAL：`pending` → 写 proposal → `proposal_written` → 写 candidate → `candidate_written` → 写 ledger（`eventId` 对 commandId 唯一）→ `ledger_written` → `committed`。
7. 崩溃后重试：只补齐缺失步骤，不得删除 ledger 行，不得对同一 `commandId` 再 append 一条 `proposal.created`。
8. 返回 `{ proposalId, candidateRef, commandId, deduped }`。

禁止：客户端权威字段；cron schedule；裸 `registerProposal`；`submitDiagnosisCandidate(commandId, proposal, candidate)`。

### 3.2.1 提交后状态（冻结）

| 条件                                               | 控制面                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| preview                                            | 无 Proposal                                                              |
| 用户确认，grant 未通过或 Authority Gate 失败       | 不得注册                                                                 |
| 用户确认 + WDNA grant 已批准 + Authority Gate 通过 | 注册为 `APPROVED_FOR_EXPERIMENT`                                         |
| 开实验                                             | 另需会话 `operator.approvals`，命令 `start_experiment` → `EXPERIMENTING` |
| 用户确认本身                                       | 不能替代 evolution grant，不能 Apply                                     |

一期不注册 `DISCOVERED` / `SUGGESTED` / `PENDING_AUTHORITY`。未来高置信系统安全 Finding 若单独批准自动登记，也只能进 `DISCOVERED`，仍不得自动 `start_experiment`。

### 3.3 机制码与去重

- `sourceMechanismRef`：稳定码 `diagnosis.<domain>.<intent>`，例如 `diagnosis.behavior.reporting_cadence_gap`。
- `sourceEvidenceRefs`：封存证据 / snapshot / observation id。report、finding 放这里，不放进 mechanism。
- 去重键：`tenant + surface + target + mechanism + candidateVersion`。
- 去重必须持锁或靠 `commandId` 占位，禁止先 list 再 register。
- 观察窗口只写入 cooldown 元数据，不进入去重键。

### 3.4 第一期 Surface

| 发现                                                 | Surface                         | 第一期                          |
| ---------------------------------------------------- | ------------------------------- | ------------------------------- |
| 有 observation/指标 + 可复现 baseline 的行为偏好缺口 | `agent.working-dna`             | 阶段 2，且仅 preview→确认后提交 |
| 对已有 skillId 的明确安装意图                        | `capability.skill-installation` | 阶段 4                          |
| 创建/改 Skill                                        | `capability.skill-spec`         | 不做                            |
| 四个 A 类 purpose                                    | 无                              | 处方                            |
| Capsule / 组织 / runtime governance                  | 对应 Surface                    | 阶段 8，且先补 recheck 合同     |
| 禁止面                                               | —                               | 永不                            |

### 3.5 确认两扇门

| 门     | 用户可见名                      | 实现                                  | 写入                           |
| ------ | ------------------------------- | ------------------------------------- | ------------------------------ |
| A 处方 | `confirm_diagnose_prescription` | 仅两条路径，见 §3.5.1；开启前必须落地 | Cron                           |
| B 提交 | 确认 preview                    | ingest；一期不自动                    | `submitDiagnosisCandidate`     |
| 开实验 | 大白只发起审批                  | Gateway 会话持 `operator.approvals`   | `evolution.experiments.create` |
| Apply  | 控制面                          | Adapter                               | 领域 SoT                       |

旧工具 ID `confirm_diagnose_evolution` 仅内部别名，映射同一 handler、同一审计事件、同一处方存储。

#### 3.5.1 A 类处方确认授权（冻结）

开启 `DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED` 之前必须实现，且只能二选一：

1. **本人确认：** `caller.tenantId === prescription.tenantId` 且 `callerUserId === targetOwnerId`。
2. **代理确认：** 存在已批准 grant，同时绑定：
   - `tenant` = 处方租户
   - `targetPrincipal` = 处方主人（`targetOwnerId`）
   - `targetAgent` = 处方 `targetAgentId`
   - `action` = `schedule_diagnosis_prescription`（专用，**不是** `evolution-grant:` / Working DNA 的 diagnose/suggest/apply）

拒绝：

- 仅企业管理员 / steward 角色、无上述 grant
- 用 WDNA `evolution-grant:` 确认 Cron
- `callerUserId` 缺失
- 跨租户

### 3.6 验证回流

```text
EvolutionVerificationRef = {      // 不可变链接，不存 status 副本
  proposalId, experimentId, applicationId, verificationId, rollbackRef
}

authorityRecheckRegistry[surfaceId] → 读领域 SoT
```

第一期注册：

- `agent.working-dna` → `working-style-store` 字段 + 效果窗口
- `capability.skill-installation` → skill lifecycle 安装关系

`VERIFIED` 但 SoT 未变 → `authorityRecheck: still_open`，不得关闭原 finding。Capsule / Organization / Runtime Governance 在接入前补合同，否则路由拒绝。

---

## 4. 分阶段实施

未列闸门保持 false。阶段 0 未绿之前，禁止阶段 1 以外的控制面写入。

### 阶段 0 — P0 契约 + A/B 拆分（开工门槛）

**目标：** 四项 P0 落地，诊断运行不产生控制面对象。

1. **P0-1 / P0-A / P0-B** 实现对象形 `submitDiagnosisCandidate`。WAL 状态机按 §3.2 前向补齐。单测：
   - 中断在 `proposal_written`：重试只写 candidate + ledger，最终 `committed`，ledger 仅一条创建事件
   - 中断在 `candidate_written`：重试只补 ledger
   - 同一 `commandId` 二次调用不新增 ledger 行
   - 调用方传入完整 Proposal 的类型/运行时拒绝
2. **P0-2** 依赖边界测试：`src/diagnosis/**` 不得 import `src/gateway/evolution-control/**`。假控制面端口给诊断测试。
3. **P0-3** `GrowthAssessmentSnapshot` 或 Graph Finding + 真实 `DiagnosticEvidence`。`pdr-*` / `ev:diag:*` 不得作 ingest 主键。
4. **P0-4 / P0-C** ingest 只在确认 + WDNA grant + Authority Gate 通过后注册 `APPROVED_FOR_EXPERIMENT`。单测：仅 tenantAdmin、无 grant → 零 Proposal；preview → 零 Proposal。
5. 拆 Producer：A 类只留处方；structural DTO 默认为空。
6. **P0-D** 处方确认实现 §3.5.1 两条路径（闸门仍 false）。单测：admin 无专用 grant 拒绝；WDNA grant 不能确认处方；本人 owner 可通过。
7. 工具：用户名 `confirm_diagnose_prescription`，旧名别名。
8. **零变化测试：** 跑完整诊断（无 B 确认）后 Proposal / Candidate / Ledger 行数不变。

**验收：** P0 四条各有失败夹具；依赖边界红绿明确；诊断后三库零变化。

### 阶段 1 — Preview only

**目标：** 合格 B 类只生成 DTO preview，不提交。

1. `diagnosis-ingest.preview(candidate)` 做校验，不写 receipt。
2. 报告展示「需确认后提交统一控制面」，不含 `proposalId`。
3. 契约：跨租户、禁止面、A 类 intent、缺 snapshot/evidence、无 baseline、仅身份/记忆/未使用技能 → 拒绝 preview。

**验收：** 无控制面脏写；preview 失败不影响 A 类报告发布。

### 阶段 2 — WDNA 确认后提交

**目标：** 确认 preview 后走 `submitDiagnosisCandidate`。

1. 复用 `WorkingDnaCandidate` 形状与 `proposeWorkingDnaFromObservation` 的 grant。
2. `sourceMechanismRef` 用稳定码。
3. 注册状态固定 `APPROVED_FOR_EXPERIMENT`；不自动 `startExperiment` / `applyWorkingDna`。
4. `EvolutionSubmissionRef` 只存不可变链接。

**验收：** 幂等 commandId；去重键命中不新建；无 grant 拒绝；诊断模块仍零控制面 import。

### 阶段 3 — 只读投影与开实验审批

**目标：** 报告能看到控制面状态，仍不 Apply。

1. 服务端报告组装调用控制面 **只读端口**（`getProposal` / `getExperiment`），禁止 Gateway 自调 RPC。
2. UI 通过 Gateway RPC 读同一状态。
3. 大白展示「申请开实验」；真正 `evolution.experiments.create` 要求会话 `operator.approvals`。

**验收：** 无 approvals 的管家会话不能开实验；报告 status 与控制面当场读取一致，且 submission ref 内无 status 副本。

### 阶段 4 — Skill 安装

明确已有 `skillId` 的安装意图才允许 `capability.skill-installation`。无 skillId 的「未安装」观察零提交。去重与确认规则同阶段 2。接入前登记 recheck 适配器。

### 阶段 5 — 验证回流

实现 `EvolutionVerificationRef` + 第一期 recheck 注册表。伪造 `VERIFIED`、store 未变的夹具必须失败。

### 阶段 6–8 — 控制面单轨（独立任务）

6. 旧 runtime auto 改为统一 Application。
7. skill auto 改为控制面 worker。
8. Capsule / Organization / Runtime Governance：先补 recheck 合同再接诊断 B 类。

未完成前不得宣称系统进化已完全单轨。

### 阶段 9 — 有限自治

按 Surface 书面批准。默认不在本里程碑。

---

## 5. 明确不做

- [ ] 不把 `registerProposal` 当作诊断提交原子 API
- [ ] 不接受 `submitDiagnosisCandidate(commandId, proposal, candidate)` 或调用方完整 Proposal
- [ ] WAL 不删除 ledger、不对同一 commandId 重复 append
- [ ] preview / grant 失败不注册 Proposal；注册态只能是 `APPROVED_FOR_EXPERIMENT`
- [ ] 不用 WDNA grant 或管理员角色确认 A 类 Cron
- [ ] `src/diagnosis` 不 import `evolution-control` / Adapter
- [ ] 不用 `pdr-*` / `ev:diag:*` 作为 ingest 证据
- [ ] 不用租户管理员身份代替 evolution grant
- [ ] 不去重键加入 `professionalReportId`
- [ ] 不复制控制面 status 到诊断存储
- [ ] 不自动提交 B 类（一期）
- [ ] 不翻转 confirm / Da Bai delivery / agentToAgent / sessions.visibility
- [ ] 不新增 `user.daibai.execute` 作为 Apply
- [ ] 不把处方 merge 进 `EvolutionProposal`
- [ ] 不调用 `ingestV1()` 作为活桥
- [ ] 服务端不自调用进化 RPC 来拼报告

---

## 6. 仓库落点

| 阶段                  | 路径                                                                                         | 流          |
| --------------------- | -------------------------------------------------------------------------------------------- | ----------- |
| 0 P0-1                | `src/gateway/evolution-control/submit-diagnosis-candidate.ts`（名可微调）                    | 控制面      |
| 0 P0-2/3              | `src/diagnosis/*-snapshot*`、`structural-evolution-candidate.ts`；禁止桥文件出现在 diagnosis | ODIAG       |
| 0 P0-4 + ingest       | `src/gateway/evolution-control/diagnosis-ingest.ts`                                          | 控制面      |
| 0 确认校验 / 工具别名 | `diagnose-evolution-prescription.ts`、confirm tool                                           | ODIAG / MRR |
| 1–2                   | ingest preview/submit + 测试                                                                 | 控制面      |
| 3                     | 报告组装只读端口；UI RPC                                                                     | ODIAG / UI  |
| 4–5                   | ingest 路由 + recheck 注册表                                                                 | 控制面      |
| 6–8                   | `evolution-governance` / skill auto                                                          | 独立任务    |

`src/diagnosis/diagnose-evolution-bridge.ts` **不得创建**。

---

## 7. 一句话

智能诊断只输出可封存的 A 类处方与 B 类 DTO。Gateway 用 `submitDiagnosisCandidate({ commandId, candidate, trustedContext, grantId })` 构建 Proposal，WAL 只前向补齐。B 类一期只 preview；确认 + WDNA grant + Authority Gate 通过后注册为 `APPROVED_FOR_EXPERIMENT`。A 类确认仅本人或 `schedule_diagnosis_prescription` 专用 grant。Apply 只走领域 Adapter。

本轮四项实施契约未写入测试前，阶段 0 不得宣称开工完成。契约已冻结，可以按阶段 0 清单开工。

---

## 8. Track A → Track B 接口（A0 已冻结，B 不得复制类型）

B 必须从下列文件 import，不得在 `evolution-control` 复制一份 DTO。

| 合同                         | 文件                                              | 导出                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| StructuralEvolutionCandidate | `src/diagnosis/structural-evolution-candidate.ts` | `StructuralEvolutionCandidate`, `StructuralProposedChange`, `validateStructuralEvolutionCandidate`, `buildStructuralEvolutionCandidate`                                         |
| SkillInstallationCandidate   | `src/diagnosis/skill-installation-candidate.ts`   | `SkillInstallationCandidate`, `SkillInstallationProposedChange`, `validateSkillInstallationCandidate`, `buildSkillInstallationCandidate`, `skillInstallDeltaFromProposedChange` |
| GrowthAssessmentSnapshot     | `src/diagnosis/diagnose-growth-snapshot.ts`       | `GrowthAssessmentSnapshot`, `readGrowthAssessmentSnapshot`, `validateGrowthAssessmentSnapshot`                                                                                  |

只读语义：

- `readGrowthAssessmentSnapshot({ tenantId, snapshotId, configDir })` 校验哈希、租户、过期、symlink、path traversal。
- Snapshot 是 Evidence projection，不是新的业务事实源。
- DTO 不含权威 `tenantId` / `proposalId` / `candidateRef` / grant。租户只由 B 的 `trustedContext` 决定。
- 普通诊断 `structuralCandidates = []` 且 `skillInstallationCandidates = []`。仅显式 `StructuralPreviewFact` / `SkillInstallationPreviewFact` 且具备 observation + baseline + 真实 evidence/snapshot + 可解析 target hint 才出 preview。
- Skill 安装只接受已有 `skillId` 的明确安装意图，surface 必须是 `capability.skill-installation`。`capability.skill-spec`、unused-skill、无 skillId、已安装均不得出候选。
- A 类四个 purpose 永不进入 DTO。

B 仍须实现，A 未做：

- `submitDiagnosisCandidate({ commandId, candidate, trustedContext, grantId })`
- WAL / 恢复扫描
- `src/gateway/evolution-control/diagnosis-ingest.ts`
- Authority Gate 接线
- Evaluation / Recheck Registry

A0 剩余 blocker：打开 A 类 confirm 闸门、开实验审批、Apply。A2 只做确认后 submit，不 startExperiment。
