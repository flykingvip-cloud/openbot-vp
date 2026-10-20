# 员工首页四卡 → 常驻“值班”能力 设计评审稿（2026-06-29）

状态：评审稿（Draft for design review）。本稿仅设计，不含实现。

> **2026-07-29 现状**：首页每日概览已收敛为两张卡——**今日日程 / 待办事项**
> （`WorkbenchSignalCardKey = "schedule" | "todos"`）。下文「四张卡片」仅描述评审时
> 的历史形态；实现以 `ui/src/ui/ports/employee/views/workbench-signals.ts` 为准。

## 0. 背景与问题

员工“每日概览”首页顶部（评审时）有四张卡片：今日日程 / 待处理任务 / 即将协作 / 重要通知
（构建于 `ui/src/ui/ports/employee/views/workbench-signals.ts`，数据由
`ui/src/ui/ports/employee/views/workbench-home-model.ts` 喂入）。

产品诉求：能否让“每张卡片背后都是一个系统启动后就一直在值班、主动工作的独立机器人”。

本稿目标：给出可行性判断 + 与现有运行时地基对齐的目标形态，供设计评审。

## 1. 结论（先行）

- **不做“4 个常驻进程级机器人”。** 运行时没有“长生命周期 daemon per agent”这一层，
  agent 都是“被唤醒 → 跑一轮 isolated turn → 结束”。强行做 4 个常驻 LLM 循环是反地基、
  且多租户成本不可控。
- **采用“统一 steward 表层 + （事件 / 读模型 / 例程）底座”。** 由内置大白管家（agent id
  `main`）代言 4 张卡；其中**系统级信号走已有 maintenance 循环 + 读模型投影 + broadcast 推送**，
  **用户级主动提醒走 cron + isolated turn（事件驱动优先）**。

代码支持该方向：内置大白即 `main`（`src/agents/builtin-steward/identity.ts:16`）、主动唤醒走
heartbeat wake（`src/infra/heartbeat-wake.ts`）、cron isolated turn 以 `cron:<jobId>` 会话执行并在
企业归属下占商业并发槽（`src/gateway/server-cron.ts`）。

## 2. 现状勘误（评审反馈收紧）

### 2.1 商业闸口：企业归属的 cron run 已接闸口（原表述过弱，修正）

企业归属的 isolated cron run 在真正跑模型前**已经过商业闸口**：`runPrompt` 调
`tryAcquireEnterpriseAgentRun({ runId, agentId, modelGateInput })`
（`src/cron/isolated-agent/run.ts`），后者委托
`authorizeCommercialRun({ action: "agent_run" })`
（`src/gateway/billing/agent-run-governance.ts:38` → `src/gateway/billing/authorize-commercial-run.ts:149`），
完成 订阅 / 预算 / credits / 并发槽（agent-run-registry）/ model gate 校验。

**真实风险**（应据此表述）：**仅当解析不出 `enterpriseId` 时**会 `skipped` / fail-open；
因此真正的隐患是 **“新增的 duty routine 不复用这条链路”或“归属解析失败”** 时才会绕过闸口——
而不是“cron 路径未接闸口”。

### 2.2 常驻引擎不止 cron（原表述过满，修正）

网关启动时常驻的不止 cron。`src/gateway/server.impl.ts` 同时拉起：

- **Cron 服务**（cron job 调度）：`buildGatewayCronService`（`:547`）+ `cron.start()`（`:652`）。
- **Maintenance timers**：`startGatewayMaintenanceTimers`（`:605`）。其 60s 维护循环除 keepalive/health
  外，还周期驱动 `tickKnowledgeGovernanceJobs()` / `tickDueWebSourceRefreshes()` /
  `tickAgentKnowledgeGeneration()`（`src/gateway/server-maintenance.ts`，均带 in-flight 去重）。
- **Heartbeat runner**：`startHeartbeatRunner`（`src/infra/heartbeat-runner.ts:1010`），自维护定时唤醒。

准确表述应为：**“Cron 是唯一负责 cron job 调度的常驻服务”，不是“唯一常驻调度引擎”。**

### 2.3 卡片不是空壳，只是未接目标读模型（修正）

四卡已接入通用运行时信号：`cronNext`、sessions、contacts、agents、groups、accounts、
onlineInstances、lastError（`workbench-home-model.ts` → `workbench-signals.ts`），文案也明确写了
“在真实日历接入前，先用当前系统信号填充首页节奏”。

准确表述应为：**尚未接入“目标业务读模型”** —— `src/organization/task-assignment.ts`、
`src/organization/presence.ts`、协作 operating-state（`src/gateway/collaboration-learning/`）、
知识治理（待治理）。

## 3. 目标架构

### 3.1 原则

1. **单一 steward 身份代言**（`main` = 大白管家），不增殖 4 个常驻进程 / 人格。
2. **系统级状态复用现有底座**：健康 / 知识治理 / 连接等已由 maintenance 循环周期维护——
   **不要再复制成 per-card cron job**（避免重复调度，采纳 F4）。卡片消费其读模型投影 +
   `broadcast` 推送。
3. **用户级主动提醒走事件 / cron**：待办、待确认邀请、协作待回应等用户私有信号，**事件驱动优先**，
   必要时 cron + `runCronIsolatedAgentTurn`（**必须复用** `tryAcquireEnterpriseAgentRun` 闸口）。
4. **LLM 仅用于“排序 / 措辞 / 摘要建议”**，聚合一律用确定性读模型；无“值得说的变化”不调用模型、
   不推送、不烧 token。

### 3.2 两类底座

- **底座 A — 系统级（read-model + maintenance + broadcast）**：服务 重要通知 卡与治理类信号。
  复用 `server-maintenance.ts` 既有 governance/web/health tick 的产物，做成读模型投影后 `broadcast`。
- **底座 B — 用户级（cron + isolated turn / 事件）**：服务 待处理任务 卡、即将协作 卡里“需要你回应”
  的提醒。cron job（`every` / 事件触发）→ `runCronIsolatedAgentTurn`（已过闸口）→ 写
  task-assignment/presence 或 `broadcast`。

### 3.3 四卡映射（系统级 vs 用户级 / 何时才用 LLM）

| 卡片       | 底座    | 数据源                                                                                     | 触发                    | 是否需 LLM                   |
| ---------- | ------- | ------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------- |
| 今日日程   | B（轻） | cron 今日 / 下次触发列表（+未来日历）                                                      | cron 状态变化           | 几乎不需要                   |
| 待处理任务 | B       | `task-assignment`（pending/ackRequired）+ 待治理成果 + 待确认协作邀请                      | 任务 / 治理 / 邀请事件  | 仅“先做哪条”的排序与理由     |
| 即将协作   | B       | 协作 operating-state（进行中 / 待回复 / 待决策）+ 未读                                     | 协作事件                | 仅“哪个群需要你”的摘要       |
| 重要通知   | A       | 员工端：知识治理冲突 + 连接健康（用户作用域）。额度/计费 + 渠道掉线 → 企业管理员面（见下） | 治理事件 + 45s 周期收敛 | 基本纯规则，可选做严重度归并 |

> **作用域拆分（2026-06-29，产品确认）**：原表把 网关健康 / 额度·计费 / 渠道掉线 都画在员工「重要通知」卡里。
> 经产品确认，**员工端只保留用户作用域的知识治理 + 连接健康**（install 全局健康、渠道掉线、企业财务额度对普通员工
> 既不安全也无意义）；**额度/计费 + 渠道掉线移交企业管理员面**（`enterprise.notices.list` + `enterprise-system-notices-card`，
> 仅企业管理员可见，按租户作用域）。M2 验收口径据此更新——员工卡 = 治理 + 连接健康;管理员卡 = 财务 + 渠道。详见 §6 M2 落地记录。

### 3.4 “在岗”的呈现

用 presence（`online` / `currentTask`，`src/organization/presence.ts`）+ operating-state 给用户
“机器人在值班”的感知，底层其实是 maintenance + cron + steward。若产品上要“4 个具名值班机器人”
（市场 / 日程 / 协作 / 运维管家），在 **UI / 身份层包装为 4 个分身**即可，运行时仍复用同一底座——
形态包装与运行机制解耦。

## 4. 成本与治理

- 用户级 run 一律经 `authorizeCommercialRun` / agent-run-registry（注意非企业路径 fail-open）。
- 节流：事件优先于轮询；静默时段不跑 LLM；去重（无变化不推送）；借鉴 maintenance 的 in-flight guard。
- 多租户：N 用户 × 4 卡**不得**退化为 4N 个常驻 LLM 循环——系统级共享 maintenance，用户级按需触发。

## 5. 风险 / 开放问题

1. **闸口复用是硬约束**：任何新 duty routine 必须复用 `tryAcquireEnterpriseAgentRun`，否则在
   企业归属解析失败 / 旁路时会绕过商业闸口（F1 的真实风险）。
2. **避免重复调度**：系统级信号继续走 maintenance 循环，不要再起 per-card cron（F4）。
3. **新增投影 + 推送通道**：task-assignment / operating-state → 卡片的读模型投影与 `broadcast`
   事件需新增（当前 home model 未消费这些源）。
4. **新用户 freshSurface 态**：保持引导优先，不为空工作台启动常驻例程。

## 6. 分期落地建议

- **M1（最小验证）**：待处理任务 卡接 `task-assignment` + 待治理 + 待确认邀请（纯确定性，先不接 LLM），
  经 `broadcast` 推送到卡片。目的：打通“业务读模型 → 卡片”的投影与推送通道，且不引入模型成本。
- **M2**：重要通知 卡接 maintenance 的 health/governance 产物（系统级底座 A）。
  - **落地记录（2026-06-29）**：已落地为网关侧确定性读模型投影 `workbench.notices.list`
    （`src/gateway/workbench/notices-read-model.ts` + `src/gateway/server-methods/workbench.ts`），
    按已登录员工 actor（`resolveEmployeeWorkbenchActor`）作用域，解析不出 actor 返回空（绝不回退
    install 级视图）。当前消费的**唯一员工安全信号**是用户作用域知识治理摘要（开放冲突 + 待关注），
    复用与 `knowledge.governance.summary` 完全一致的 per-user 索引路径（`getUserGovernanceSummary`）。
  - **作用域决策（刻意收窄，附理由）**：设计表 3.3 列出的另外三类信号——**渠道掉线 / install 级
    健康探针**（runtime 为 install 全局）与**计费 / 额度告警**（企业管理员 / 财务作用域）——**刻意排除**
    在员工端 重要通知 卡之外。它们的运行时 / 数据是 install 全局或管理员级，若按员工会话直出会违反工作台
    其余面（sessions / deliverables / spaces）已强制的多租户隔离（参见新用户 HYB 越权排查）。这些信号
    应落在企业 / 管理员面，而非个人员工首页。**网关连接健康**（连接态，而非 install 数据）由前端从 websocket
    直接呈现（`connected` / `lastError`），不纳入本读模型。
  - **刷新 / 清理（与 M1 加固共用）**：卡片不再仅随 `collaboration.spaces.list` 共载入——
    `refreshWorkbenchSignals` 由 45s 独立定时器（`startWorkbenchSignalsRefresh`）周期刷新，请求失败清空为
    `null`，断连时在 `handleDisconnected` 重置，避免跨上下文残留陈旧计数。
  - **门禁**：`notices-read-model.test.ts`（纯投影）+ `server-methods/workbench.test.ts`（actor 作用域 /
    无 actor 返回空 / 索引不可用回退空）+ `controllers/spaces.node.test.ts`（共载入 + 失败清空）。
  - **企业管理员对应面（2026-06-29 追加）**：被排除的 install/管理员级信号（计费/额度 + 渠道掉线）改在
    **企业管理员**侧落地，普通员工仍看不到。新增 `enterprise.notices.list`（读模型
    `src/gateway/workbench/enterprise-notices-read-model.ts` + 处理器
    `src/gateway/server-methods/enterprise-notices.ts`），**仅企业管理员可调**（`requireEnterpriseScope`
    解析租户后再用 `scope.isEnterpriseAdmin` 显式拒绝普通员工——`requireEnterpriseScope` 本身不校验管理员）。
    聚合三类财务信号（预算 `computeBudgetStatus.level` alert/exceeded、超额
    `getOverAllocationState.status==="over_allocated"`、额度 `resolveTenantCreditsStatus` 低/耗尽，均按
    `scope.enterpriseId` 租户作用域）+ 渠道掉线（`src/gateway/workbench/tenant-channel-health.ts`：按租户已配置渠道账户
    枚举，用 `evaluateChannelHealth` 判定 not-running/disconnected/stuck/stale-socket；运行时快照全局,
    Phase 8 前与 `channels.status` 同口径)。UI 用自包含卡片
    `ui/src/ui/ports/enterprise/views/enterprise-system-notices-card.ts` 嵌入企业总览（紧邻 supervisor 卡片），
    无告警/非管理员/未连接时渲染空(加法式)。门禁:`enterprise-notices-read-model.test.ts`(纯)+
    `server-methods/enterprise-notices.test.ts`(管理员鉴权/员工拒绝/聚合)+ `enterprise-system-notices-card.browser.test.ts`(渲染/空态隐藏/错误隐藏)。
- **M3**：即将协作 卡接 operating-state（“需要你回应”的群）。
- **M4**：引入 steward 建议层（LLM，过闸口）+ 可选“具名分身”UI 包装。**设计细化见 §7**。
  - **M4a 已落地（2026-06-30）**：确定性建议层 + RPC + UI 建议条（零 token），见 §7.6。
  - **M4b 暂缓**：gated LLM 待企业→员工计费 / 用量统计口径确定后再接，见 §7.7。

## 7. M4 设计:steward 建议层(大白 / `main`)

> 状态:M4a 已落地(§7.6);M4b 暂缓(§7.7,待计费 / 用量统计口径确定)。

### 7.1 目标

由内置大白(`BUILTIN_STEWARD_AGENT_ID = "main"`,展示名 `大白管家`、🐳)在员工首页顶部呈现
**一条**“今天先看哪条、为什么”的简短建议(steward 建议条)。建议的**事实与聚合一律来自 M1/M2/M3
的确定性读模型**;LLM **仅**用于“排序 / 措辞 / 摘要”。**无“值得说的变化”→ 不调模型、不烧 token**
(§3.1.4 硬约束)。

### 7.2 数据流

已登录 actor(`resolveEmployeeWorkbenchActor`)→ 聚合三读模型结果:

- M1 `buildWorkbenchPendingTasks` → `{ ackRequiredCount, taskCount, governanceCount, inviteCount, totalCount }`
- M2 `buildWorkbenchNotices` → `{ conflictCount, attentionCount, totalCount }`
- M3 `buildWorkbenchUpcomingCollaboration` → `{ decisionCount, reviewCount, needsResponseCount, activeCount }`

→ 计算**信号指纹 `signature`** → 与缓存的上次 signature 比对:

1. **指纹未变** → 直接返回缓存建议(**0 LLM 调用**)。
2. **指纹变化 且 距上次生成 ≥ 节流窗口** →(企业作用域且过闸口才)调 LLM 生成简短建议 → 写缓存。
3. **闸口拒绝 / 非企业 / 无 LLM 注入 / 节流未到** → 退化为**确定性模板建议**(纯规则,见 7.4)。

### 7.3 关键设计点

1. **确定性优先,LLM 可选(DI seam)**:核心(signature / dedup / cache / 模板)全部确定性、可单测、
   无 LLM 也能用。LLM 经依赖注入 `generateSuggestionText?: (ctx) => Promise<string | null>` 提供;
   缺省 `undefined` → 纯模板。LLM 是**纯增强**,非必需件。
   (理由:代码里无轻量 one-shot LLM helper,`runWithModelFallback` 只是回退编排,真正文本生成在重型
   `runCliAgent`——不把这套机器塞进读模型路径。)
2. **signature / dedup**:`signature = hash(ackRequiredCount, taskCount, governanceCount, inviteCount,
conflictCount, attentionCount, decisionCount, reviewCount, needsResponseCount, activeCount, topItemIds)`。
   只要这些不变,就不调模型、不刷新建议。
3. **节流(throttle)**:每 actor 最小生成间隔(默认 **≥ 10 分钟**)+ in-flight guard(借鉴 maintenance,
   防并发重复生成)。
4. **闸口复用(硬约束 §5.1)**:LLM 分支严格走
   `tryAcquireEnterpriseAgentRun({ runId, agentId: "main", modelGateInput })`:
   - `acquired` → 调 LLM,`finally` `releaseEnterpriseAgentRun(runId)`;
   - `skipped`(非企业,解析不出 `enterpriseId`)→ 见 7.5 待确认;
   - `!skipped && !acquired`(预算 / 额度 / 并发 / model-gate 拒)→ 退化模板,**不调 LLM**。
5. **作用域**:仅员工首页、actor 作用域;无 actor → 空建议。企业管理员面不做 steward 建议
   (与 M2 的员工 / 管理员拆分一致)。
6. **呈现**:首页顶部**单条**大白建议条。不增殖 4 个具名值班机器人(§3.1 单一 steward 身份;
   “具名分身”仅 UI 包装,M4 暂不做)。

### 7.4 确定性模板建议(无 LLM 时兜底,也是 LLM 的 grounding)

按优先级取**最该先看的一条**拼一句中文(加法式,全 0 → 不显示建议条):

`ackRequiredCount>0`(待确认任务)> `decisionCount>0`(等你拍板)> `reviewCount>0`(等你复核)>
`taskCount>0`(待处理任务)> `conflictCount>0`(知识库冲突)> `needsResponseCount>0`(需要你回应)>
`attentionCount>0`(知识待关注)。

### 7.5 已确认决策(2026-06-30)

1. **非企业成本姿态 → (B)**:`skipped`(解析不出 `enterpriseId`,如个人 / 自托管)时**不调 LLM**,
   只给确定性模板;**仅企业作用域**才走闸口调 LLM。
2. **节流 → 接受**:每 actor 最小 LLM 生成间隔默认 **≥ 10 分钟**,且仅在信号指纹变化时才生成。
3. **作用域 → 仅员工端首页**(actor 作用域);企业管理员面不做 steward 建议。
4. **UI → 单条**大白建议条;不做 4 个具名分身。
5. **分期 → M4a 先,M4b 后**:M4a = 确定性建议层(signature / dedup / cache + 模板)+ RPC + UI 建议条
   (**零 LLM、零 token**,可独立验收);M4b = 接 gated LLM(DI seam `generateSuggestionText`,经
   `tryAcquireEnterpriseAgentRun`,仅 refine 措辞 / 排序)。

### 7.6 M4a 落地记录(2026-06-30)

- **网关读模型**:`src/gateway/workbench/steward-suggestion-read-model.ts`
  (`buildWorkbenchStewardSuggestion` + `computeStewardSignalSignature` + `buildStewardTemplateSuggestion`
  - `DEFAULT_STEWARD_SUGGESTION_THROTTLE_MS=10min`)。确定性指纹去重 / 缓存 / 模板 + 节流;
    `generateSuggestionText?` seam **缺省未接**(M4a 纯模板,零 token)。
- **RPC**:`workbench.steward-suggestion.get`(`src/gateway/server-methods/workbench.ts`),actor 作用域
  (`resolveEmployeeWorkbenchActor`,无 actor 返回空),聚合 M1/M2/M3 三读模型(各自独立降级),**未传 seam**。
  注册:`method-scopes.ts`(READ)+ `server-methods-list.ts`。
- **UI**:首页顶部单条「大白建议」条(`workbench-signals-surface.ts` 的 `renderWorkbenchStewardBar`;🐳 + 文本,
  `source==='llm'` 才显示 AI 标);`refreshWorkbenchSignals` 共载入 + 断连清空;经
  `workbench-signals → workbench-home-model → workbench-shell-model → workbench` 透传。i18n
  `frontstage.workbench.steward.{label,aiTag}`。
- **门禁**:读模型 13 + RPC 15(含 4 steward)+ 控制器 13 + surface 4 单测全绿;`ui:build` 通过;
  网关 tsdown 重建 + 重启。

### 7.7 M4b 暂缓(2026-06-30,产品决策)

**暂缓接入 gated LLM。** 原因:steward 代员工调模型时,token 成本必须在
**企业端 → 员工端的计费 / 用量统计链路**里被正确归属与计量(谁付费 = 企业租户、如何计量 = 按员工 / 按
steward 调用、在员工与企业两侧用量报表如何呈现)。这套归属 / 统计口径本身较复杂,应与计费体系
(参见 `cost-budget-billing` / `model-entitlement-chain`)对齐后单独设计,而非作为建议条的附带项草率接入。

- **现状**:`generateSuggestionText` seam 已就位但**休眠**;M4a 全程零 token,功能已交付。
- **复活路径(待计费口径确定后)**:在 RPC handler 注入 `generateSuggestionText`,内部
  `resolveEnterpriseIdForAgentRun` → 非企业返回 `null`(决策 B)→ 企业则
  `tryAcquireEnterpriseAgentRun({ agentId: "main", … })`,`acquired` 才调模型并在 `finally`
  `releaseEnterpriseAgentRun`,把用量按上面确定的口径记账。**注意**:代码库无轻量「一次性补全」原语,
  届时应新建一个最小的「过闸口补全」模块,**不要**复用 `runCronIsolatedAgentTurn`(为投递设计,有会话 /
  发送副作用,不适配)。

## 附：关键代码锚点

- 内置大白身份：`src/agents/builtin-steward/identity.ts:16`
- 主动唤醒：`src/infra/heartbeat-wake.ts`、`src/infra/heartbeat-runner.ts:1010`
- Cron 引擎与隔离执行：`src/cron/service/timer.ts`、`src/gateway/server-cron.ts`、`src/cron/isolated-agent/run.ts`
- 商业闸口：`src/gateway/billing/agent-run-governance.ts:38`、`src/gateway/billing/authorize-commercial-run.ts:149`
- 常驻 maintenance：`src/gateway/server.impl.ts:547`/`:605`/`:652`、`src/gateway/server-maintenance.ts`
- 卡片构建与数据：`ui/src/ui/ports/employee/views/workbench-signals.ts`、`ui/src/ui/ports/employee/views/workbench-home-model.ts`
- 业务读模型源：`src/organization/task-assignment.ts`、`src/organization/presence.ts`、`src/gateway/collaboration-learning/`
