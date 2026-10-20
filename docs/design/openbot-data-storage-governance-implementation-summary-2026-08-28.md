# OpenBot 数据存储与治理架构优化实施总结

> 文档用途：供独立安全、数据治理、存储架构及生产发布专家进行第三方验收。  
> 统计日期：2026-08-28。  
> 事实口径：以 Git 历史中的阶段验收记录、当前 `origin/main` 权威证据和生产发布账本为准。历史 handoff 中被 supersede 或 revoke 的结论不作为当前状态。  
> 当前结论：核心治理平台的 first-wave 已形成并经过分阶段验收；旧数据与旧调用路径的生产收敛仍未完成，完整 Phase 1B 和 LIVE cutover 尚未授权。

代码、组件、测试和 GitHub 审查入口见 `docs/design/openbot-data-storage-governance-code-review-index-2026-08-28.md`。

## 1. 项目背景

OpenBot 原有数据系统已经具备平台、企业租户、个人用户和运行时四层逻辑结构，但物理实现长期存在多个独立演进的数据路径：Workspace、Agent、Memory、Knowledge、Conversation、工具工作目录、协作目录和同步目录分别解析或拼接路径。

这导致系统不能始终、统一地回答以下问题：

1. 一份数据是什么资源，稳定身份是什么。
2. 数据属于个人、岗位、小组、企业还是平台系统。
3. 当前调用者是否有权访问，以及授权依据是什么。
4. 资源的规范存储绑定、实际托管方和放置策略是什么。
5. 数据如何归档、恢复、转移、导出、遗忘和删除。
6. 数据同步到本地、托管云或未来 BYOS 时如何执行策略。
7. 删除、撤销、迁移和恢复是否具有可审计、可重放的证据链。

原问题不是单纯的“文件应该放在哪个目录”，而是逻辑所有权、策略决策、规范绑定、物理强制和治理生命周期没有形成闭环。主要风险包括：

- 多路径真相：写、读、工具 cwd、预览、迁移和恢复可能指向不同根。
- 目录先于身份：业务代码根据 `tenantId/userId/agentId` 拼路径，再补权限。
- 跨租户旁路：共享根、host browse 或 legacy fallback 可能绕过租户边界。
- Runtime 被误认为无主临时数据，实际却可能含员工、客户和企业秘密。
- Memory、Conversation、Knowledge 的删除语义不一致，无法证明“已删完”。
- 云同步被简化为复制或禁止上云，缺少分类、策略、密钥和撤销传播。
- 长期数据缺少版本阶梯、恢复演练、可移植导出和连续性证明。

## 2. 目标与核心原则

本次改造保留 L0-L3 业务分层，在所有层之上增加横向 Governance Plane：

```text
                    Governance Plane
       Identity / Ownership / Authorization / Lifecycle
          Audit / Placement / Sync / Provenance / Hold
                            |
        L0 Platform -> L1 Tenant -> L2 User -> L3 Runtime
```

实施遵循以下原则：

1. **No resource exists without ownership context**：资源先有身份与所有权，再决定存储位置。
2. **Authorize before resolve**：先验证租户、成员关系、ownership proof 和 grant，再解析物理绑定。
3. **Stable identity**：以稳定 `resourceId` / `agentAssetId` 标识资产，不以目录名或可变 `agentId` 代替身份。
4. **Single canonical binding**：每个资源只能有一个有效规范写绑定；兼容绑定只能只读或承担明确迁移角色。
5. **No business path construction**：业务 handler 不得直接拼租户、用户、Agent 或 Workspace 路径。
6. **Owner scope is not owner type**：使用 personal/user、position/seat、group/team、tenant、system 等可扩展 scope，避免把资产强行压成 user/tenant/platform 三类。
7. **Runtime remains governed**：运行时数据仍有 owner、controller、custodian、classification 和 retention。
8. **Lifecycle is a domain command**：archive、restore、forget、purge、transfer、promote、revoke 等必须是可审计领域命令，不是裸文件操作。
9. **Cloud sync is policy-driven**：同步由分类、放置、密钥、地域和撤销策略决定，不采用“一律上云”或“一律不上云”。
10. **Cognitive score is not authority**：认知评分、promotion 资格和 Memory tier 不能授予访问权，也不能绕过删除与 legal hold。
11. **Fail closed**：managed enterprise 缺身份、缺绑定、歧义、跨租户或缺适配器时必须拒绝，禁止回退到猜测路径。
12. **Forward-only delivery**：生产只能从最新 `origin/main` 构建，候选必须包含 LIVE，发布身份必须由不可变 provenance 和账本证明。

## 3. 统一目标架构

### 3.1 Resource Catalog

Catalog 是资源身份和规范存储绑定的治理 SoT，负责记录稳定资源身份、所有权 scope、租户边界、生命周期状态、分类和绑定。目录本身不是 SoT。

关键不变量：

- managed 资源必须具有 tenant-scoped identity。
- 一个资源最多一个 `canonical + active` 写绑定。
- compatibility binding 不得被普通 resolver 当作 canonical 写根。
- 重复、歧义、跨租户和未知归属均 fail-closed。
- Catalog 不可用时 managed 路径不得退回 host 或 legacy 猜测。

### 3.2 Data Governance Envelope

统一 Envelope 将下列治理语义附着到 Workspace、Agent、Memory、Knowledge、Conversation 和 Operational Identity：

- `resourceId`、`resourceType`
- `tenantId`
- `ownerScope`、`ownerId`
- `controllerId`、`createdBy`
- classification、lifecycle state
- canonical storage binding
- provenance、operation marker、receipt references
- retention、legal hold、sync/residency policy references（按阶段启用）

早期实现采用必填核心字段加可选策略引用，避免在策略引擎尚未成熟时伪造完整治理信息。

### 3.3 Resource Resolver 与受限 Handle

所有 managed 资源访问必须经过统一 resolver：

```text
trusted caller context
        -> ownership/membership/grant validation
        -> Catalog lookup
        -> canonical binding validation
        -> constrained resource handle
        -> storage adapter
```

Handle 仅暴露已授权操作所需能力，避免把任意绝对路径重新交给业务层。Personal Local 可以保留明确、隔离的本地模式；它不能成为 Managed Enterprise 的 fallback。

### 3.4 Lifecycle Command Plane

生命周期使用状态机、CAS、operationId、marker 和 receipt 组合执行：

- archive / restore
- memory forget
- request purge / resume purge / cancel deletion
- legal hold / release hold
- transfer / export / import
- promotion / revoke / tombstone propagation

删除采用“两阶段逻辑关闭 + 物理擦除 + 云端墓碑 + Catalog close”。物理擦除成功但 Catalog CAS 失败时进入 `recovery_required`，不得谎报完成或删除 Catalog 身份。

### 3.5 Cognitive Governance

CogniWeave 沿用既有认知系统，不新建第二套 Memory 系统。治理层补充：

- recommendation、propose、approve 的可信身份和授权。
- promotion policy 与 graph/epoch CAS fencing。
- provenance、continuity manifest 和 anchor lifecycle。
- revoke tombstone、合并排除和恢复顺序。
- orphan reclaim 与操作恢复。

### 3.6 Placement 与 Sync Fabric

放置策略将逻辑资产与物理存储解耦：

- first-wave local canonical / managed encrypted 适配面。
- promotion、CAS、tombstone、export/restore 协议。
- tenant cloud、BYOS、cold archive、dedicated region 作为 later-wave，缺适配器时 fail-closed。

### 3.7 Long-lived Operations

面向长期数字员工资产，建立：

- schema/version ladder。
- authenticated key rotation 和授权记录。
- format migration journal 与 immutable locator CAS。
- tenant exit export/import drill。
- continuity restore drill 和递归 checkpoint 验证。
- tenant longevity report 与策略 SLO。

## 4. 实施阶段与主要任务清单

### 4.1 Gate 0 与 P0：安全模型和存储身份收敛

目标是先关闭最危险的多路径与跨租户旁路：

- 冻结 Personal Local 与 Managed Enterprise 两种安全 profile。
- 建立 deployment/profile 启动约束和 managed fail-closed。
- 只读 inventory，未知归属不猜测、不迁移。
- OwnershipProof 分类器，registry 缺失或损坏时阻断写。
- Workspace resolver、受限 handle 和 handler bridge。
- 每 owner scope 单一 primary write root。
- 封禁 shared-root、host browse 和 legacy cwd fallback。
- 建立 freeze scan，防止新增路径 helper、动态包装或 Catalog 合成旁路。

阶段记录结论：Gate 0/P0 Accepted；验收记录包含 focused suite 88/91 通过。C19 live re-probe 被列为后续运维证据，不代表生产 cutover 授权。

### 4.2 P1：Envelope、Catalog 与身份链

主要交付：

- Catalog store、canonical/compatibility binding 模型。
- Workspace/Agent/Conversation 等 first-wave Envelope。
- tenant-scoped managed store 打开规则。
- OAuth/session tenant 与 caller tenant 严格一致。
- identity、lifecycle audit 保留 tenantId。
- Agent 创建失败补偿、seat unbind、primary owner release、mesh revoke。
- operation marker 与 quarantine；恢复失败 halt，禁止无 marker 整目录隔离。

阶段记录结论：P1 first wave 和 P1-2 Accepted；定向验收记录为 29 files、204 passed、5 skipped。P2 解锁仅表示允许实现生命周期，不代表生产部署授权。

### 4.3 P2：生命周期闭环

主要交付：

- P2-a 生命周期基础状态机、receipt 和 actor matrix。
- P2-b Conversation Archive archive/restore/hold。
- P2-c Memory Forget 两阶段闭环。
- P2-d Purge：`deletion_pending -> purge_execute -> cloud_tombstone -> catalog_close -> purged`。
- P2-e Workspace、Agent、Knowledge、Operational Identity 的 adapter contract。
- destructive failure、CAS lose、restart recovery、missing cloud adapter 全部 fail-closed。

验收边界：first-wave 生命周期核心经过逐切片 Accept。RPC 全接线、所有领域 bridge、对象存储/BYOS 成功适配器不在 P2 first-wave 完成范围内。

### 4.4 P3：认知治理和连续性

主要交付：

- 可信 recommendation auth，wire 不得写 tenant/owner/executedBy/requestedBy。
- 企业 membership、ownership proof 和 delegation grant 校验。
- propose/approve 与 conflict blocking。
- graph reservation、epoch/CAS、TOCTOU fencing。
- promotion/revoke/tombstone 和 finalize-only recovery。
- continuity manifest、pointer CAS、orphan reclaim。
- anchor propose/activate/supersede/revoke。
- active anchor 阻止不安全 merge。

阶段记录显示 P3 a-g 经多轮 CR 和切片 Accept，最终 Gate B/P3 Accepted。这里的 Accepted 是认知治理 first-wave 的实现结论，不自动解除 Memory/Workspace Phase 1B 的生产锁。

### 4.5 P4：放置、晋升和导出恢复

first-wave 交付：

- P4-a placement resolver。
- P4-b cognitive promotion protocol。
- P4-c storage adapter、CAS 和 tombstone。
- P4-d export/restore。
- cross-tenant false allow=0、revoke/tombstone 顺序、offline local canonical、统一 promotion decision。
- later adapter unavailable 时 fail-closed。

阶段记录结论：P4 first-wave Accepted，定向验收 7 files、172 tests 通过。明确未自动解锁 tenant-cloud、BYOS、cold archive 或 dedicated regional adapters。

P4 Later（L-a/L-b/L-c/L-d）随后建立了 later-wave 的规划、决策和验收包，但其 go-live 必须单独满足生产资格；不能从 first-wave closure 推导已开启云端/BYOS。

### 4.6 P5：长期运维与可恢复性

主要交付：

- P5-a schema ladder。
- P5-b authenticated key rotation 与 key-management authorization。
- P5-c restore drill、format migration journal、immutable locator CAS 和 path safety。
- P5-d tenant exit import drill。
- P5-e continuity restore drill 与 recursive checkpoint validation。
- P5-f tenant longevity report 与 policy SLO。

阶段记录显示 P5 a-f 经逐切片 CR/Accept 后形成 P5 Accepted。其含义是长期运维能力的 first-wave 合同与实现完成，不等于当前所有生产数据已迁移或所有云适配器已启用。

### 4.7 M0-M4：旧数据迁移优先计划

在 v2 first-wave 后，工作重点转向旧数据和真实运行路径：

- M0：冻结迁移威胁模型、基线、inventory 和 dry-run 规则。
- M1：识别 legacy roots、重复 binding、未知归属和 quarantine 集合。
- M2：建立 canonical target、可重放 copy/verify receipt 和禁止双写约束。
- M3：按资源切读、只读兼容窗口、差异验证和 rollback fence。
- M4：旧根退役、tombstone、恢复演练和关闭证明。

迁移原则是 forward-only、无猜测归属、无隐式创建、禁止同时把新旧根当作写 SoT。共享树无法安全执行“一次发布原子切换”时，采用写冻结、双读验证、resolver 切写、兼容只读、最终退役的可观测步骤。

### 4.8 Memory/Workspace Phase 0、1A、1B

该工作流用于把 v2 设施真正接入既有 Memory 与 Workspace 生产路径：

- Phase 0：调用点 inventory、LIVE 根分类、SQLite 风险、freeze gate 和 v1 root guard。
- Phase 1A：Catalog/Membership/Binding/Memory 边界设计及七角色签署。
- Phase 1B：运行时 Catalog、精确 agentAssetId、tool cwd、schema v2、切写和旧调用点 retirement。

当前 canonical 状态：

| 项目                                        | 当前状态                     |
| ------------------------------------------- | ---------------------------- |
| Phase 0                                     | 已完成设计/证据/止损门禁     |
| Phase 1A                                    | 设计和 owner sign-off 已完成 |
| minima / implementation / retirement unlock | 已签发相应有限实施许可       |
| full Phase 1B unlock                        | `not-issued`                 |
| Item 7                                      | `not-met`                    |
| `liveWriteWatchIndex`                       | 10，目标 0                   |
| `phase1bExecutionBlocked`                   | `true`                       |
| `deployAuthorized`                          | `false`                      |
| `wiredToProductionResolver`                 | `false`                      |
| LIVE cutover                                | `false`                      |

有限 implementation/retirement unlock 只允许继续施工，不能解释为 full unlock、Item 7 met、生产授权或 LIVE cutover。

## 5. 当前剩余的 10 个生产调用点

当前退休扫描仍保留 10 个 live write/index/sync sites，主要分为：

1. Stage B：`get-reply.ts` 的两个 Workspace 写路径残留。
2. Stage C：Memory backend、CogniWeave、MemoryIndexManager、QMD 等五个 index 路径。
3. Stage D：`manager-sync-ops.ts` 的 S33/S34/S35 三个同步路径。

Stage C 已完成可信身份线程和 managed fail-closed 基础能力，也提供了默认关闭的 shadow evaluator；但 canonical evidence 明确记录 C1-C5 仍保留 legacy placement，production switch=false。

Stage D 已实现持久 fencing/recovery store、local-only adapter、dark canary 和 readiness evaluator；但 S33/S34/S35 尚未从扫描退役，controlled write 仍是 shadow-only，cloud/BYOS=false。

## 6. 已形成的安全与治理设施

第三方验收应重点确认以下设施不是“仅有文档”，而是在生产代码路径或可执行测试中存在：

| 设施                    | 验收关注点                                                               |
| ----------------------- | ------------------------------------------------------------------------ |
| Security profile        | managed 与 personal 的信任边界、启动校验、共享进程限制                   |
| OwnershipProof          | tenant、actor、membership、seat/group/user scope 不可由 wire 伪造        |
| Resource Catalog        | tenant scoped、唯一 canonical、CAS、歧义和 miss fail-closed              |
| Resource Resolver       | authorize-before-resolve、无业务拼路径、受限 handle                      |
| Freeze scanner          | 禁止新增 legacy helper、包装旁路、动态 import 绕过、Catalog 合成         |
| Lifecycle state machine | operationId、marker、receipt、legal hold、两阶段删除和 recovery_required |
| Cognitive governance    | promotion/revoke、graph/epoch fencing、anchors、continuity manifest      |
| Placement fabric        | policy decision、adapter capability、CAS/tombstone、export/restore       |
| Long-lived operations   | schema/key/format ladder、exit/restore drill、longevity SLO              |
| Delivery governance     | origin/main only、forward-only、provenance tag、release ledger、rollback |

## 7. 验收边界与明确未完成项

以下内容不得被阶段性 Accepted 或 v2 first-wave closure 掩盖：

1. 旧数据迁移尚未以全量生产数据完成并关闭。
2. Item 7 仍有 10 个调用点，尚未达到 target=0。
3. Stage C 生产 resolver 切换尚未完成。
4. Stage D 三个同步点尚未切换，cloud/BYOS 未启用。
5. full Phase 1B unlock 未签发，`deployAuthorized=false`。
6. tenant-cloud、BYOS、cold archive、dedicated regional adapter 不属于已启用 first-wave。
7. 当前发布账本审计仍报告历史 seq 28/29 identity mismatch，需要修复或形成正式、可审计的处置。
8. 部署前必须从实际运行容器获得 LIVE SHA；无法解析 LIVE 时 forward-only gate 必须 exit 21 fail-closed。
9. 当前共享工作树存在多团队 WIP，绝不能作为生产构建输入。
10. 所有生产候选必须在部署前重新 fetch，并等于当时最新 `origin/main`；旧验收 SHA 在 trunk 前进后自动失效。

## 8. 建议第三方验收矩阵

### A. 身份与隔离

- 同一 userId/agentId/groupId 在两个 tenant 下不得解析到相同 managed handle。
- tenant mismatch、missing membership、invalid ownership proof、forged actor 均零副作用拒绝。
- managed 缺 Catalog binding 时不得回退 personal/host/legacy path。
- compatibility target 必须通过专用、受控 target-binding 查询，不能被普通 canonical resolver 冒充。

### B. Catalog 与 Resolver

- 重复 canonical binding、ambiguous query、inactive binding 均 fail-closed。
- handler、tool cwd、preview、collaboration、memory index 和 sync 不得自行拼根。
- Catalog unavailable 的只读降级必须符合 profile；写路径不得 fallback。
- cache key 必须包含 tenant/resource/epoch，失效不能造成跨租户复用。

### C. 生命周期与删除

- archive/restore/forget/purge/hold 的 actor matrix 正负例。
- destructive erase 失败后 Catalog 仍保持 `deletion_pending`。
- erase 成功但 close CAS 失败时生成 recovery receipt，不能谎报 purged。
- legal hold 阻断删除；解除 hold 必须由 operator/system。
- cloud/object storage 无适配器时 purge fail-closed，不得使用 success stub。

### D. Cognitive 与同步

- recommendation tenant/actor/executedBy 只能来自品牌化服务端 auth。
- delegation 缺失时代理 requestedBy 拒绝。
- promotion graph CAS、anchor、revoke tombstone 与 orphan reclaim 顺序正确。
- Stage D idempotency 必须 resource-bound 且跨进程持久。
- cloud/BYOS flag 关闭时不得产生外部写入。

### E. 迁移与恢复

- inventory 未知项进入 quarantine，不根据目录名补 owner。
- copy/verify/cutover 每步具有 operationId、digest 和 receipt。
- 切写后旧根只读，禁止双写。
- rollback 只能回到“旧根只读/禁止双写”的安全状态。
- export/import、format migration、checkpoint restore 在干净环境可复演。

### F. 发布与生产

- 候选严格等于 freshly fetched `origin/main`。
- `verify-forward-only.sh`、delivery alignment、ledger audit 全部通过。
- provenance tag、OCI revision、`build-info.commit`、ledger SHA 四者一致。
- full-dist 同时包含 gateway 与 UI；不得丢失已上线 overlay。
- health/ready/smoke、负向隔离、数据恢复和 rollback drill 全绿。
- 切换后重新读取运行容器 identity，并落地 release record 和 merge-back/SoT 检查。

## 9. 关键证据入口

第三方团队可从以下文件开始复核：

- 总体 Memory/Workspace 收敛设计：`docs/design/memory-workspace-identity-remediation-2026-08-14.md`
- P0 验收：`.kiro/specs/data-governance-v2-p0/codex-handoff.md`
- P1 验收：`.kiro/specs/data-governance-v2-p1/codex-handoff.md`
- P2 验收包：`.kiro/specs/data-governance-v2-p2/codex-handoff-p2-accepted.md`
- P4 first-wave closure：`.kiro/specs/data-governance-v2-p4/codex-handoff-p4-closure.md`
- P4 later-wave 设计与门禁：`.kiro/specs/data-governance-v2-p4-later/`
- Memory/Workspace 执行账本：`.kiro/specs/memory-workspace-platform-remediation/tasks.md`
- 当前 Item 7 扫描：`docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json`
- 当前 unlock 指针：`docs/design/evidence/memory-workspace-phase1b-unlock-current.json`
- Stage C shadow 证据：`docs/design/evidence/memory-workspace-phase1b-item7-stage-c-prod-identity-wiring-shadow.json`
- Stage D readiness：`docs/design/evidence/memory-workspace-phase1b-item7-stage-d-prod-readiness.json`
- 发布账本：`deploy/production/releases.jsonl`
- 人工发布记录：`deploy/production/RELEASE_RECORD.md`
- 发布标准：`docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md`

## 10. 整体评价

本次工作已经把 OpenBot 从“按目录管理聊天和 Agent 数据”推进到“以稳定资源身份、所有权、策略、生命周期和审计证据管理数字员工资产”的架构基础。最重要的成果不是新增了多少目录或数据库，而是形成了可验证的治理不变量和 fail-closed 执行设施。

就架构和 first-wave 平台能力而言，P0-P5 已形成较完整的 Identity -> Ownership -> Authorization -> Resolution -> Lifecycle -> Placement -> Continuity 链路。就生产收敛而言，项目仍处在最后一段：必须优先完成旧数据迁移、剩余 10 个 legacy 调用点退役、Stage C/D 真实切换、完整 unlock 和发布血缘修复。

因此，建议第三方团队给出两个分离的结论：

1. **架构/first-wave 实施验收**：评价已落地设施是否满足设计原则及分阶段合同。
2. **生产 go-live 验收**：在 Item 7=met、full unlock issued、deployAuthorized=true、LIVE/candidate/ledger 全部可证明后单独裁决。

在第二项完成前，不应把“P0-P5 first-wave Accepted”解释为“所有旧数据已迁移”或“新治理路径已全面生产启用”。
