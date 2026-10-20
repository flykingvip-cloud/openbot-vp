# ConversationTask Runtime — P2 运维评审

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-prereview.md`(§1/§2)、`./execution-plan.md`(§14/§16)、`./p0-p1-acceptance.md`、`./p2-admission-package.md`、`./p2-design-freeze.md`
> 状态: **实施团队自评 = 完成;独立运维评审 = 已签署(条件通过),reviewer id = `kiro-ops-reviewer`(≠ 实施 agent)。本文仅为设计 / 验收材料,不实现 Activation runtime,未开任何 flag。**

## 0. 治理说明

- 本文 §1–§4 含两层:**实施团队自评(self-assessment)** 由实施 agent `kiro-conversation-task-runtime` 提出;**独立运维评审** 由独立 reviewer `kiro-ops-reviewer` 逐项裁定。
- 独立 reviewer 身份:`kiro-ops-reviewer`(id ≠ `kiro-conversation-task-runtime`),已在 Loom 登记可追踪 reviewer session `kiro-ops-reviewer-p2-20260824`(角色 reviewer,**非 owner / 非 lander**;task owner 仍为实施 agent)。
- 前置条件类别:**〔A〕= 开始 P2 编码前必须冻结的设计**;**〔B〕= P2 合并或开启 `activation` flag 前必须实现并验证**。
- P2 范围(见 `./p2-admission-package.md`):仅 Activation Gate + Task store + 个人 ConversationTask;不接 Progress Ledger、不产生真实副作用、不实施 Mission;`authorization`/`projection` flag 持续 OFF。

## 1. 议题 O1 — flag 热读方式与缓存 TTL

- **实施团队自评裁定**:热读 + 进程内缓存 **TTL=3s(硬上限 5s)** + config 写入即 `invalidate`;flag/config 读取异常一律 **fail-safe-off**;禁止 activation/projection/authorization 做成「仅重启生效」。
- 前置条件:〔B〕fail-safe-off 实现 + 单测(≤3s 生效 / 读异常⇒OFF / 缓存 invalidate)。
- **独立运维评审裁定(kiro-ops-reviewer · 2026-08-24)**:**条件通过**。**明确接受 TTL=3s(硬上限 5s)**。附加条件:①「读异常⇒OFF」须覆盖 config 文件损坏 / 权限不足 / 读超时三类并各有用例;② 缓存失效须有单测证明 config 写入后旧值不再被读到。

## 2. 议题 O2 — activation 关闭后既有任务冻结语义

- **实施团队自评裁定**:采纳 **freeze-read-only**——activation off ⇒ 停止新建任务/Activation;既有 active 任务不删/不推进/不写新执行事件/不通知,状态可读;Projection 标「已暂停」且不强于账本(Ledger I8);重开从冻结点继续,不重放;冻结期副作用仍走 Human Gate;冻结 ≠ 完成 ≠ 取消。
- 前置条件:〔A〕freeze-read-only 语义写入 design;〔B〕验收用例(off 期间零新任务/事件/通知;on 从冻结点续;Projection 不强于账本)。
- **独立运维评审裁定(kiro-ops-reviewer · 2026-08-24)**:**条件通过**。接受 freeze-read-only。附加条件:①须暴露可观测指标「被冻结任务数」;②重开(on)恢复须幂等,避免重复恢复或重复通知。

## 3. 议题 O3 — 指标阈值、告警渠道、是否自动关闭 activation

- **实施团队自评裁定**:`Upgrade Precision`(滚动 7 天或最近 N=200)**< 95% → 告警 + 自动 `activation=off`**;误升级率 **> 2% 告警 / > 5% 自动 `activation=off`**;**Reminder 误升级率 > 0 → 告警**;重复任务创建率 **> 1% → 告警**;渠道 = 内部控制通道 + 运维值班;自动降级可人工覆盖并记录 reason code。
- 前置条件:〔B〕指标管道接 `decisionVersion`+reason codes;自动降级可配置/可人工覆盖/可审计;完成告警 + 自动降级演练。
- **独立运维评审裁定(kiro-ops-reviewer · 2026-08-24)**:**条件通过**。**明确接受上述自动降级阈值**(Upgrade Precision<95% 或误升级>5% ⇒ 自动 `activation=off`)。附加条件(独立):①自动降级须带**防抖 / 滞回(hysteresis)+ 最小触发间隔**,避免 flag 抖动;②触发自动降级后**重新开启 `activation` 必须人工确认,不得自动回升**;③`Reminder 误升级 > 0` 须先完成 RCA 再恢复。

## 4. 议题 O4 — shadow 日志存储 / TTL / 删除 / HMAC 密钥来源与轮换

- **实施团队自评裁定**:按 `tenantId` 分区(参照 `src/gateway/tenant-store-paths.ts`),仅评估/审计角色可读、不进用户面、仅落脱敏字段(永不落原文/实体);TTL 默认 **30 天**(可配);随 Conversation 生命周期删除,支持按 `conversationId`/`tenantId` 硬删除;`inputFingerprint` 升级为**租户级 keyed HMAC**(密钥源 `src/secrets/**`,不落日志/代码,轮换 ≤90 天,轮换即断链)。
- 前置条件:〔A〕脱敏字段清单与分区模型冻结;〔B〕「日志不含原文」+ TTL/级联/硬删 + HMAC 轮换测试;密钥轮换流程入运维手册。
- **独立运维评审裁定(kiro-ops-reviewer · 2026-08-24)**:**条件通过**。**明确接受 shadow TTL=30 天(默认)与 HMAC 轮换 ≤90 天**及租户级 keyed HMAC。附加条件:①对有更严格合规保留要求的租户,TTL 须可**按租户下调**并以租户配置为准;②HMAC 须有 **break-glass + 轮换 runbook**,轮换事件可审计;③删除须产出可审计凭据(与安全评审 S7 的 purge receipt 对齐)。

## 5. 结论与签署

实施团队自评签署:

- reviewer id:**kiro-conversation-task-runtime(实施团队自评,非独立评审)**
- 日期:**2026-08-24**
- 自评结论:**条件通过(建议)**

独立运维评审签署:

- reviewer id(≠ 实施 agent):**kiro-ops-reviewer**(Loom reviewer session `kiro-ops-reviewer-p2-20260824`,角色 reviewer,非 owner/lander)
- 日期:**2026-08-24**
- 逐项 decision:**O1 条件通过 · O2 条件通过 · O3 条件通过 · O4 条件通过**
- 明确接受:**TTL=3s(≤5s)· 自动降级阈值(Upgrade Precision<95% 或误升级>5% ⇒ activation=off)· shadow TTL=30 天 · HMAC 轮换≤90 天**
- 结论:**条件通过**
- 附加条件(须并入准入包 §4.B 验收):O1 读异常三类用例 + 缓存失效证明;O2 冻结任务数指标 + 幂等恢复;O3 滞回/最小间隔 + 重开人工确认 + Reminder RCA;O4 租户级 TTL 下调 + HMAC break-glass runbook + 删除审计凭据。
- 透明性说明:本独立运维评审由 Loom 登记的独立 reviewer 会话 `kiro-ops-reviewer` 履行,身份区别于实施 owner,不接管 owner、不作为 lander。

> 运维放行 ≠ P2 批准;P2 进入仍需专家最终书面批准(见 `./p2-admission-package.md`)。本轮仅更新设计/验收材料,未改 runtime、未开 flag。
