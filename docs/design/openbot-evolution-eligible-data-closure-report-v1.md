# OpenBot Evolution — Eligible Data Closure Report V1

> 日期：2026-09-07  
> 任务：`openbot-evolution-unification:cursor-evolution`  
> Agent：`cursor-evolution`  
> 关联设计：`docs/design/openbot-evolution-control-state-mapping-v1.md`

## 1. 五条链路实际状态

| 链路               | Surface                             | eligible 数据闭环    | 证据                                                                                                                   |
| ------------------ | ----------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Working DNA        | `agent.working-dna`                 | 通过                 | `src/gateway/evolution-control/working-dna-live-loop.test.ts`、`working-dna-promote-loop.test.ts`                      |
| Organization       | `organization.task-routing`         | 通过                 | `src/gateway/evolution-control/organization-live-loop.test.ts`                                                         |
| Runtime Governance | `system.runtime-binding-governance` | 通过                 | `src/gateway/evolution-control/runtime-live-loop.test.ts`                                                              |
| Skill Installation | `capability.skill-installation`     | 通过                 | `src/gateway/evolution-control/skill-installation-live-loop.test.ts`                                                   |
| Capsule（新数据）  | `knowledge.experience-capsule`      | 通过                 | `src/gateway/evolution-control/capsule-eligibility.test.ts`、`packages/evolution-core/src/capsule-eligibility.test.ts` |
| Capsule（旧数据）  | `knowledge.experience-capsule`      | **永久 unavailable** | 缺 `failureClusterRef` → `legacy_missing_failure_cluster`；不迁移、不推断                                              |

## 2. eligible 数据完成口径

五链完整生产闭环按 **eligible data** 判定：

- 具备可信 provenance 的数据进入实验和验证。
- 历史不可证明的数据明确 excluded / unavailable。
- unavailable 不等于失败，也不进入指标分母。
- 不要求通过伪造、迁移或推断历史证据实现 100% 数据覆盖。

**eligible 数据闭环：已通过阶段验收。**  
**全历史数据闭环：不可能完成**（旧 Capsule 证据缺失必须保留）。

## 3. Capsule legacy exclusion 口径

| 条件                                   | 结果                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| 缺 `failureClusterRef`                 | `legacy_missing_failure_cluster` → unavailable               |
| 缺 `clusterProvenance=native`          | `insufficient_lineage` → unavailable                         |
| `tool_error` / `run_failed` 作为 cause | 不可 compose native cluster → unavailable                    |
| sourceIds / text / embedding 推断      | `untrusted_cluster_reference` → unavailable                  |
| UI                                     | `observation unavailable`，`recurrenceRate: null`（不是 0%） |

禁止：迁移脚本、批量写回、推断补造 `failureClusterRef`。

新数据必须携带：`failureClusterRef` + `clusterProvenance=native` + mechanismVersion + 可信机制 cause。

## 4. Verifier Surface Registry

| Surface                             | Verifier                              | 状态        |
| ----------------------------------- | ------------------------------------- | ----------- |
| `agent.working-dna`                 | `working-dna-read-after-write`        | supported   |
| `capability.skill-installation`     | `skill-installation-read-after-write` | supported   |
| `capability.skill-spec`             | none                                  | fail-closed |
| `knowledge.experience-capsule`      | none / legacy-ineligible              | fail-closed |
| `knowledge.managed-memory`          | none                                  | fail-closed |
| `organization.task-routing`         | none                                  | fail-closed |
| `organization.team-composition`     | none                                  | fail-closed |
| `system.diagnosis-contract`         | none                                  | fail-closed |
| `system.runtime-binding-governance` | none / general verifier unavailable   | fail-closed |

代码真源：`packages/evolution-core/src/surfaces.ts` + `src/gateway/evolution-control/verifiers/catalog.ts`。

## 5. APPLIED / EFFECT_VERIFIED / OUTCOME_VERIFIED / PROMOTED

```
APPLIED          → Adapter 执行完成（application receipt 不是效果证明）
EFFECT_VERIFIED  → 独立 RAW verifier 确认目标状态
OUTCOME_VERIFIED → 统计 Verification improved（proposal.status === VERIFIED）
PROMOTED         → 治理 promote 授权 + OUTCOME_VERIFIED +（required 时）EFFECT_VERIFIED
```

- external `contradicted` → 禁止 VERIFIED / PROMOTED
- external `inconclusive` → 保持 CANARY / HELD
- external `verified` 但统计不足 → 不得 PROMOTED
- 统计 improved alone → 不得 VERIFIED（若 surface requires external effect）

## 6–9. 各域闭环证据摘要

### Working DNA

- RAW：直接读 `working-style.json`，不调用 Working DNA Adapter
- Verifier ID：`working-dna-read-after-write`
- Live loop：baseline → canary apply → treatment outcomes → verify → rollback drill → promote（promote loop）

### Organization

- 真实 task persist writer + routing policy SoT
- Live loop：baseline tasks → canary routing → treatment → drill → re-apply → verify → promote

### Runtime Governance

- 官方 Tick runner，非 deterministic fixture
- Live loop：baseline tick evidence → canary → rollback → retry → verify → governed hold

### Skill Installation

- RAW：读 Skill Lifecycle SoT（`listRobotSkillAssets` / `getPersonalSkillAssetDetail`），不调用 Skill Adapter
- Verifier ID：`skill-installation-read-after-write`
- Live loop：真实 draft/skill → experiment → canary install → EFFECT_VERIFIED → 统计 VERIFIED → promote → 重启恢复

## 10. unsupported Surface fail-closed 证据

- `packages/evolution-core/src/surfaces.ts`：`externalVerificationPolicy: "unsupported"`，无 `requiredVerifierId`
- `src/gateway/evolution-control/control-plane.ts`：仅 `requiredVerifierIdForSurface()` 触发外部验证，无 DNA 回退
- `src/gateway/evolution-control/external-effect.test.ts`：空 registry → inconclusive，不 VERIFIED
- `packages/evolution-core/src/external-effect.ts`：`canEnterOutcomeVerification` / `canPromoteWithExternalEffect` 阻断 contradicted

## 11. External Verifier 安全收口确认

| #   | 要求                                                           | 状态                             |
| --- | -------------------------------------------------------------- | -------------------------------- |
| 1   | `submitResult()` 永久 fail closed                              | ✓ `external-effect-service.ts`   |
| 2   | Control Plane 不暴露 verifier register                         | ✓ 无 `registerPlatformVerifier`  |
| 3   | Registry 仅 composition root 安装固定 builtin                  | ✓ `gateway-plane.ts` + guardrail |
| 4   | Registry JSON 注入未知 verifier 无效                           | ✓ `external-effect.test.ts`      |
| 5   | `credentialRef` 不接受 plaintext token                         | ✓ `external-effect-registry.ts`  |
| 6   | verifier ≠ applicator                                          | ✓ `assertVerifierMaySubmit`      |
| 7   | request/application/proposal/experiment/target/tenant 严格绑定 | ✓ `assertExternalEffectBinding`  |
| 8   | duplicate result 幂等                                          | ✓ `external-effect.test.ts`      |
| 9   | conflicting result 不覆盖首个                                  | ✓ `listConflicts()`              |
| 10  | 过期/撤销/tenant/target mismatch fail closed                   | ✓ 负向测试                       |
| 11  | `applicationReceiptRef` 不是 effect proof                      | ✓ core + verifier                |
| 12  | RAW 只证明目标状态，不证明业务收益                             | ✓ 设计 + promote 门控            |

## 12. 验证命令结果（2026-09-07）

| 命令                                                  | 结果                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm --dir packages/evolution-core test`             | 52 passed                                                                                                     |
| `pnpm --dir packages/evolution-core typecheck`        | pass                                                                                                          |
| `pnpm build:evolution:packages`                       | pass                                                                                                          |
| 聚焦 evolution 套件（47 files）                       | **354 passed**                                                                                                |
| `pnpm tsgo`                                           | **阻断 — 外部 WIP**（`ui/src/ui/ports/enterprise/**`、`ui/src/ui/views/**` 等 TS 错误；evolution 路径无错误） |
| `pnpm check`                                          | **阻断 — 外部 WIP**（`package.json`、`skills/**` 共 9 文件格式；本任务 design doc + guardrail 已格式化）      |
| `pnpm build`                                          | **pass**                                                                                                      |
| `git diff --check`                                    | **pass**                                                                                                      |
| `bun scripts/agent-attribution.ts --fail-on-conflict` | **pass**（0 CONFLICT）                                                                                        |

### 归因说明

- **本任务 lander**：`cursor-evolution`（evolution-control、evolution-core、相关 UI 面板等）
- **共享热文件 lander 不变**：evolution-governance SoT → `grok-evolution-closure`；skill-invocation/lifecycle → 现有 lander
- **5 个 UNATTRIBUTED `skills/**`\*\*：不认领、不修改，由其他任务处理
- **`docs/design/openbot-evolution-eligible-data-closure-report-v1.md`**：本任务交付物，已登记为 cursor-evolution

## 13. 最终声明

> OpenBot 已完成 **eligible 数据范围内**的统一进化控制平面和闭环验证；历史 Capsule 数据因缺失 `failureClusterRef` 永久保持 unavailable；未注册 External Verifier 的 Surface 按 fail-closed 处理；生产部署仍需遵循正式发布流程。

明确**未**完成：

- Capsule 旧数据恢复 / 批量补造
- 未支持 Surface 的自动验证或晋升
- 生产部署（本轮未执行 commit / push / PR / cutover）

## 14. 不通过项处置

| 项                               | 验收结论       | 处置                                                                                    | 是否阻塞 eligible 发布门 |
| -------------------------------- | -------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| 全历史数据闭环                   | **不通过**     | `accepted_permanent_exclusion`（`legacy_missing_failure_cluster`，`recoverable=false`） | 否                       |
| 未支持 Surface 的自动验证 / 晋升 | 不在完成口径内 | 继续 fail-closed                                                                        | 否                       |

处置约束：

- 不得迁移、推断、写回或批量补造旧 Capsule `failureClusterRef`。
- 不得把该不通过项重新列为待修 Bug。
- 不得宣称“五链全历史生产闭环已完成”或“所有 Capsule 都可计算 recurrence”。
- UI 对排除观察显示 `observation unavailable`，`recurrenceRate: null`，不是 `0%` 或 `failed`。

代码真源：`packages/evolution-core/src/historical-closure.ts`。
