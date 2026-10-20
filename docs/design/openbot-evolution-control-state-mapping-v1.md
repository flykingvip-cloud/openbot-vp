# Evolution Control 状态映射 V1

> 日期：2026-09-06  
> 对应方案：`docs/design/openbot-system-evolution-unification-plan-v1.md` Phase 0  
> 约束：只读映射。不回写 Diagnosis v1，不把历史 `APPLIED` / `VERIFIED` 升级为效果证明。

## 1. 对象所有权

| 对象                                                  | 唯一真相源                                        | 控制平面保存                      |
| ----------------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| Diagnosis Proposal v1                                 | `src/diagnosis/evolution-proposal.ts`             | 无正文副本，仅投影                |
| Proposal v2 / Experiment / Application / Verification | `@openbot/evolution-core`                         | 完整对象                          |
| Working DNA                                           | `src/gateway/agent-growth/working-style-store.ts` | ID、版本、快照引用                |
| Capsule / Learning Asset                              | Collaboration Learning                            | ID、版本、状态引用                |
| Skill                                                 | Skill Lifecycle                                   | skillId、version、installationRef |
| Organization routing policy                           | `src/organization/routing-policy.ts`              | groupId、revision、changeRef      |
| Runtime action 快照                                   | Evolution Governance                              | actionRef、rollbackRef            |
| 跨域谱系                                              | Evolution Ledger                                  | 不可变事件和对象引用              |

## 2. v1 状态 → v2 状态

| Diagnosis v1       | 控制平面 v2                                | 备注                                    |
| ------------------ | ------------------------------------------ | --------------------------------------- |
| `SUGGESTED`        | `SUGGESTED`                                |                                         |
| `PENDING_APPROVAL` | `PENDING_AUTHORITY`                        |                                         |
| `APPROVED`         | `APPROVED_FOR_EXPERIMENT`                  | 不授予真实应用                          |
| `APPLIED`          | `ACTIVE`                                   | 不等于 `VERIFIED`                       |
| `VERIFIED`         | `ACTIVE` + `legacy.linkedVerificationOnly` | v1 `outcome: "linked"` 只表示对象已关联 |
| `ROLLED_BACK`      | `ROLLED_BACK`                              |                                         |
| `REJECTED`         | `REJECTED`                                 |                                         |
| `EXPIRED`          | `EXPIRED`                                  |                                         |
| `REVOKED`          | `REVOKED`                                  |                                         |

禁止转换：

- v1 `APPROVED` 不得映射为 `APPROVED_FOR_APPLICATION` / `ACTIVE` / `VERIFIED`
- v1 `APPLIED` 不得映射为 `VERIFIED` / `PROMOTED`
- v1 `VERIFIED` 不得映射为 v2 `VERIFIED` 或 `PROMOTED`
- `APPROVED_FOR_EXPERIMENT` 不得直接 `apply_canary` / `activate` / `verify`
- `ACTIVE` / `CANARY` 不得直接 `promote`

## 3. v1 domain → v2 target / surface

| v1 `targetDomain`       | v2 `target.domain` | 默认 Surface                        |
| ----------------------- | ------------------ | ----------------------------------- |
| `agent_working_dna`     | `agent`            | `agent.working-dna`                 |
| `collaboration_capsule` | `knowledge`        | `knowledge.experience-capsule`      |
| `skill`                 | `capability`       | `capability.skill-spec`             |
| `fabric_feedback`       | `organization`     | `organization.task-routing`         |
| `evolution_governance`  | `system`           | `system.runtime-binding-governance` |

## 4. 首批 Surface

九个 Surface 见 `@openbot/evolution-core` 的 `listEvolutionSurfaces()`。全部 `autoApply: false`。默认 Surface 自治为 `assist`；`critical` 永不自动应用。

不得注册：模型权重、生产 cutover、核心身份、安全授权、密钥管理。

## 5. 完成定义（eligible data）

五链完整生产闭环按 **eligible data** 判定，不按历史全量覆盖判定：

- 具备可信 provenance 的数据进入实验和验证。
- 历史不可证明的数据明确 `excluded` / `unavailable`。
- `unavailable` 不等于失败，也不进入指标分母，不得显示为 `0%`。
- 不要求通过伪造、迁移或推断历史证据实现 100% 数据覆盖。

冻结结论：

1. **Capsule 新数据闭环属于完成。** 新 Capsule 仅在写入时盖上 `failure:<diagnoser-or-domain>:<trusted-cause>:<version>` 且 `clusterProvenance=native` 后才 eligible。
2. **Capsule 旧数据属于永久 eligibility exclusion。** 缺 `failureClusterRef`、缺 `clusterProvenance=native`、`tool_error` / `run_failed`、以及 sourceIds / text / embedding 推断，一律 `unavailable`。禁止迁移、推断或补造。该限制不再作为待修 Bug，也不影响“eligible 新数据闭环”的完成判定。
3. **通用生产外部 Effect Verifier 框架 + 两个真实领域 verifier** 是原先唯一未完成的工程项；本轮完成后，eligible 数据上的五链生产闭环成立。
4. **“完整闭环”** 表示每个受支持 Surface 都有明确的：
   - 独立 verifier；或
   - fail-closed `externalVerificationPolicy: "unsupported"`。
   - 不得为无 verifier 的 Surface 自动回退 Working DNA verifier。

## 6. External Verifier SPI

`ExternalEffectVerifier` 定义在 `@openbot/evolution-core`，不依赖 Control Plane。

Context 只提供只读能力：trusted tenant、只读领域 reader、当前时间、credential resolver、receipt verifier。不提供 Adapter.apply/rollback，不提供领域 mutation store。

Applicator 与 Verifier 不得为同一对象或互相调用。Service 按 Registry ID `resolve`，禁止 `verifierId` if/else 特判。未注册或无实现返回 `inconclusive`。不允许动态加载未授权模块路径。

## 7. Registry 与防篡改

公开 Registry 只暴露 `get` / `list` / `resolve`。安装方法留在 composition-root handle（`gateway-plane.ts`）。Control Plane 与 Gateway RPC 不暴露 `register`。

内置清单是代码固定值：

| Surface                         | requiredVerifierId                    | 政策        |
| ------------------------------- | ------------------------------------- | ----------- |
| `agent.working-dna`             | `working-dna-read-after-write`        | required    |
| `capability.skill-installation` | `skill-installation-read-after-write` | required    |
| 其余 7 个首批 Surface           | （无）                                | unsupported |

持久化 JSON 被手工篡改时：未在固定清单中的 verifier 不加载；record identity 不匹配 fail closed；`status=active` 不单独授予能力。平台扩展 verifier 本轮保持 disabled。

内置 verifier `trustedBy=code-identity`。未来外部 verifier `trustedBy=credential`；credential resolver 未实现时一律 inconclusive。字符串前缀不是凭证证明。

## 8. Receipt 与写入口

- `applicationReceiptRef` 不是效果证明。
- `observationReceiptRef` 由 verifier implementation 产生，并绑定 requestId / applicationId / target / tenant。
- Result 保存 implementation version 与 observed target version/hash。
- 重放到其他 Request 必须失败。
- `submitResult()` 永久 fail closed。只有 Registry 解析出的 implementation 可以产出 Result。
- verifier 返回的 requestId / verifierId / target / tenant 不得覆盖 Request。
- duplicate Result 幂等；conflicting Result 进入单独冲突记录，不覆盖首个结果。

## 9. 尚未支持 external verification 的 Surface

以下 Surface 明确 fail-closed unsupported，不是缺口伪装成完成：

- `knowledge.experience-capsule`
- `knowledge.managed-memory`
- `capability.skill-spec`
- `organization.task-routing`
- `organization.team-composition`
- `system.diagnosis-contract`
- `system.runtime-binding-governance`

## 10. Capsule 旧数据永久策略（冻结）

`legacy_missing_failure_cluster` 是**永久证据缺失状态**，不是待修 Bug，也不是可批量修复的数据质量问题。

**官方处置（2026-09-07 阶段验收）**：`accepted_permanent_exclusion`。全历史数据闭环保持 `not_achieved`；`recoverable=false`。该不通过项已结项，不再进入修复 backlog。代码真源：`packages/evolution-core/src/historical-closure.ts`。

| 规则     | 说明                                                                        |
| -------- | --------------------------------------------------------------------------- |
| 不迁移   | 禁止为旧 Capsule 批量写入 `failureClusterRef` 或 `clusterProvenance`        |
| 不推断   | 禁止从 sourceIds、title/body 相似度、embedding 相似度推断 cluster           |
| 不写回   | 禁止“修复脚本”把 unavailable 行改写成 eligible                              |
| 不进分母 | 旧 Capsule 不进入 recurrence 统计分母                                       |
| UI 语义  | 显示 **observation unavailable**，不是 `0%`、不是 `failed`、不是 `improved` |

**eligible 数据闭环**与**全历史数据闭环**是两个不同完成口径：

- **eligible 数据闭环（已完成）**：新写入 Capsule 携带可信 provenance 后可进入实验与统计。
- **全历史数据闭环（不可能完成）**：旧 Capsule 因缺失 `failureClusterRef` 永久 unavailable；不得伪造历史证据达成 100% 覆盖。

新 Capsule 写入时必须携带：

1. `failureClusterRef` — 形如 `failure:<diagnoser-or-domain>:<trusted-cause>:<mechanismVersion>`
2. `clusterProvenance=native`
3. `mechanismVersion` — 与 cluster ref 末段一致
4. **可信机制 cause** — 封闭词表（如 `timeout`、`security`、`authorization`、`permission`、`routing`、`tenant_context_unresolved`）；`tool_error` / `run_failed` 不是机制，不得 eligible

## 11. Verifier Surface Registry（冻结）

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

一致性要求：

- Surface Registry（`@openbot/evolution-core`）、本表、错误码（`external_effect_required` / `external_effect_contradicted`）一致。
- `requiresExternalEffectVerification=true` 的 Surface 没有 resolve 出的 verifier 时只能 **inconclusive**，不得 VERIFIED / PROMOTED。
- 统计 `improved` **不得**绕过外部效果要求。
- unsupported Surface **不得**自动回退 Working DNA verifier。

## 12. 生命周期阶段（APPLIED → PROMOTED）

| 阶段               | 含义                           | 证明来源                                                        |
| ------------------ | ------------------------------ | --------------------------------------------------------------- |
| `APPLIED`          | Adapter 报告执行完成           | Application receipt（不是效果证明）                             |
| `EFFECT_VERIFIED`  | 独立 RAW verifier 确认目标状态 | Registry 解析的 verifier implementation                         |
| `OUTCOME_VERIFIED` | 统计实验确认业务改善           | Verification（`proposal.status === VERIFIED`）                  |
| `PROMOTED`         | 治理批准扩大或固化             | Promote 授权 + OUTCOME_VERIFIED +（如 required）EFFECT_VERIFIED |

RAW verifier 只能证明**目标状态**（字段/版本/installation relation），不能证明业务收益。业务收益只属于 OUTCOME_VERIFIED。

## 13. 最终完成声明（eligible data）

> OpenBot 已完成 **eligible 数据范围内**的统一进化控制平面和闭环验证；历史 Capsule 数据因缺失 `failureClusterRef` 永久保持 unavailable；未注册 External Verifier 的 Surface 按 fail-closed 处理；生产部署仍需遵循正式发布流程。

不得宣称：

- “五链全历史生产闭环已完成”
- “所有 Capsule 都可计算 recurrence”
- “所有 Surface 都有外部 verifier”
- “本地聚焦测试通过即代表已部署”

未执行事项（本轮范围外）：

- Capsule 旧数据恢复 / 批量补造
- 未支持 Surface 的自动验证或晋升
- 生产 cutover / 部署
