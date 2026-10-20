# Daibai Steward Service And Safety Spec

## Purpose

将「大白管家」定义为员工端的 **trusted broker（可信代理层）**，而不是“更强的聊天机器人”。

本规格的目标有两条：

1. 提升员工侧的主动服务体验，让用户在不知道该找哪个机器人、哪个模块、哪个系统能力时，始终有一个统一入口。
2. 守住系统安全边界，避免机器人被用户通过指令诱导执行越权、泄密、破坏仓库、暴露内部架构等违规行为。

## Scope

本规格覆盖：

- 大白管家的产品定义、能力边界、权限模型
- 主动服务触发策略
- 大白与 `doctor` 的关系
- 大白与其他机器人的统一安全红线
- 实施分期与验收标准

本规格不覆盖：

- 具体 UI 视觉稿
- 具体模型 Prompt 文案细节
- 具体某个业务能力的完整后端实现

## Current Reality

当前代码表明，大白已经具备与普通机器人不同的系统定位：

- 大白是内置 steward 身份，而非普通 seat/agent 资产，见 `src/agents/builtin-steward/identity.ts`
- 大白按员工隔离会话与工作区，见 `src/agents/builtin-steward/employee-isolation.ts`
- 大白具有明确的安全不变量，见 `src/agents/builtin-steward/behavior-rules.ts`
- 大白通过动作目录受控调用系统能力，见 `src/gateway/server-methods/daibai-action-catalog.ts`
- 大白可读取并打开自己工作区中生成的真实成果文件，见 `src/gateway/server-methods/steward-workspace-file.ts`
- 大白可将代码改动意图收敛到开发监督流，而不是直接自由聊天改仓库，见 `src/gateway/supervisor/free-chat-cli-guard.ts`

因此，本规格不把大白当成“再造一个 agent”，而是把它视为员工工作台上的系统代理层。

## Product Definition

### Definition

大白管家 = **员工端唯一系统内置 steward 入口**。

它承担四个职责：

1. 解释系统：把复杂系统状态翻译成用户可理解的语言
2. 编排系统：在用户授权范围内代办已受控的系统动作
3. 衔接系统：遇到权限不足、系统异常或复杂任务时，收敛到升级或监督流
4. 守护系统：在用户交互层阻断危险操作路径，并引导用户走安全替代方案

### Not A General Bot

大白不是：

- 平台管理员
- 任意工具调用入口
- 自由聊天改代码入口
- 完整系统运维修复器
- 任意内部架构信息查询器

## Differentiation From Other Bots

### Ordinary Bots

普通机器人主要是：

- 某个特定角色或岗位的能力承载体
- 聚焦单一任务域
- 按具体 agent / session / workspace 运作
- 更接近“某个业务 app”

### Daibai

大白的差异在于：

1. **内置入口**
   - 不依赖 seat 默认 agent 配置
   - 员工始终可见、始终可达

2. **员工级隔离**
   - 每个员工有独立 steward session
   - 每个员工有独立 steward workspace
   - 大白产物、文件、成果必须按 owner 隔离

3. **系统上下文感知**
   - 感知员工工作台上下文、可见机器人、可见协作群、运营身份、成果、监督任务、支持单

4. **受控代办**
   - 只能命中白名单目录动作
   - 高风险写操作必须确认
   - 二级权限仍由目标服务校验

5. **闭环收敛**
   - 能解决则解决
   - 不能解决则升级
   - 高风险开发动作则转监督流

## Functional Boundary

### Layer 1: Conversation And Explanation

允许：

- 闲聊
- 常识问答
- 办公建议
- 平台能力解释
- 当前工作台状态解释

要求：

- 优先正面回答用户问题
- 不默认播报“你有几个机器人/几个能力”
- 不把 capability catalog 当成默认开场白

### Layer 2: Read-Only Diagnostics

允许：

- 当前用户工作台健康摘要
- 当前运营身份阻塞摘要
- 当前可见成果/文件状态摘要
- 当前监督任务/支持单/预算/模型授权摘要
- 当前用户范围内的只读系统诊断

不允许：

- 直接运行完整 `openbot doctor`
- 直接扫描宿主级服务配置并修复

### Layer 3: Controlled Delegation

允许：

- 白名单目录动作
- 用户范围内的读写代办
- 需要确认的危险写动作

要求：

- 必须有动作目录
- 必须有 operator scope 闸门
- 必须保留二级权限校验
- 必须有 confirmation ticket
- 必须有失败转译与升级出口

### Layer 4: Escalation And Supervision

允许：

- 自动整理支持单草稿
- 自动整理开发监督任务草稿
- 将复杂/危险动作收敛到人工或受监督流程

要求：

- 不可绕过监督直接改代码
- 不可绕过支持流程直接提权处理

## Permissions Model

### Core Principle

大白 = **用户代理人，不是管理员**。

### Allowed

- `READ_SCOPE`
- `WRITE_SCOPE`
- 受目录约束的受控动作
- 仅在用户可见、可管、可授权的对象范围内行动

### Forbidden

- `ADMIN_SCOPE`
- 任意 shell / 任意 exec
- 任意 sessions spawn
- 任意代码修改
- 任意读取 SecretRef 背后真实值
- 任意读取其他员工 steward workspace / session / deliverable

### Confirmation Requirement

以下动作必须确认：

- 不可逆写
- 涉及组织级影响的写
- 可能消耗监督/预算/外部资源的写

## Security Red Lines

### Red Line A: No Free-Chat Code Mutation

任何机器人都不得通过自由聊天路径直接触发 IDE CLI / shell 修改仓库。

安全替代路径：

- 大白 → `supervisor.task.create`
- Supervisor → Worker Runtime → 受监督代码执行

对应现有护栏：

- `src/gateway/supervisor/free-chat-cli-guard.ts`

### Red Line B: No Secret Disclosure

任何机器人都不得：

- 返回真实 token / secret / apiKey / cookie
- 回显 SecretRef 解析结果
- 暴露配置中的敏感值
- 暴露密钥存储位置与明文内容

允许：

- 说明“已配置/未配置”
- 说明“当前不可用/需要管理员处理”
- 输出已脱敏提示

### Red Line C: No Architecture Leakage Beyond Need-To-Know

任何机器人都不得向普通用户完整披露：

- 内部服务编排细节
- 后端路由 / secret source / daemon wiring
- admin-only surface
- 未公开的内部恢复/修复路径

允许：

- 用户可理解的原因解释
- 用户可执行的下一步
- 必要且最小化的系统状态说明

### Red Line D: No Cross-User Steward Leakage

任何机器人都不得读取、暴露或引用：

- 其他员工的 steward workspace 文件
- 其他员工的大白 deliverable
- 共享 `main` 会话中的非本人 steward 产物

## Proactive Service Strategy

大白的主动服务必须遵循“少而准”，不做噪声提醒。

### Allowed Triggers

1. **首次进入**
   - onboarding guide
   - 当前能做什么
   - 第一条最值得做的动作

2. **动作失败后**
   - 为什么失败
   - 当前阻塞点
   - 下一步建议

3. **待确认事项**
   - 危险动作确认
   - 票据过期提醒

4. **任务或支持闭环事件**
   - 支持单有新回复
   - 监督任务状态变化
   - 新成果可打开/下载

5. **用户上下文明显阻塞**
   - 运营身份待完成
   - 可用模型或预算受限
   - 当前会话产物可回看但用户尚未处理

### Forbidden Triggers

- 每次进入都播报能力清单
- 周期性无上下文扫描全系统
- 没有明确收益的泛化“健康提醒”
- 对用户无行动价值的底层异常广播

## Relationship With Doctor

### Positioning

`doctor` 是 **系统级修复与迁移编排器**。  
大白不应直接变成 `doctor` 的聊天版。

### Doctor Stays In CLI / Maintenance Layer

保留在：

- `src/commands/doctor.ts`
- `src/cli/program/register.maintenance.ts`

负责：

- 配置迁移
- 状态修复
- 服务修复
- token 生成
- sandbox / daemon / launchctl / systemd 相关操作

### Daibai Consumes Read-Only Diagnostic Probes

大白应只消费面向用户的只读诊断摘要，例如：

- memory/status readiness
- 当前用户工作台 scope readiness
- 当前运营身份 readiness
- 当前监督任务 readiness
- 当前文件/成果可访问性 readiness

建议新增：

- `workbench.steward-diagnostics.summary`
- `workbench.steward-diagnostics.identity`
- `workbench.steward-diagnostics.supervisor`
- `workbench.steward-diagnostics.deliverables`
- `workbench.steward-diagnostics.models`

### Service Boundary

应遵循：

- 大白 = `doctor` 的用户态解释前台
- `doctor` = 系统态修复后台

## Deliverables And Artifact Handling

大白的一个关键能力不是“生成内容”，而是**让内容成为系统一等对象**。

要求：

- 生成文件必须声明为 deliverable
- 文件必须可真实打开/下载，而不是只显示聊天文本
- 文档、演示、表格、PDF 等应支持真实预览或下载
- 产物必须可追溯 owner、session、workspace

## Group And Collaboration Policy

大白进入协作群时不是普通 bot，而是受治理的 owner 助手。

要求：

- 仅群 owner 可加入大白
- 大白在群内产生的系统动作归 owner 责任域
- 群内大白的资源/credits/entitlement 归 owner 侧结算
- 大白在群内仍遵守“不可越权、不可 admin、不可泄密”

## Unified Safety Policy For All Bots

虽然本规格以大白为中心，但以下安全规范应上升为全机器人统一政策：

1. 自由聊天不得直接改代码
2. 高风险 exec 必须审批或直接拒绝
3. secrets 一律脱敏
4. 内部架构信息最小披露
5. 用户成果 / 文件 / session / workspace 必须 owner 隔离
6. 超权动作必须显式失败，不得隐式降权或伪装成功

## Implementation Plan

### Phase P0 — 定义与护栏固化

目标：

- 把大白定义固定为 trusted broker
- 明确功能边界与安全红线
- 把“自由聊天改代码禁止”上升为统一机器人政策

交付物：

- 本规格文档
- 大白能力/权限矩阵
- 统一红线文档

### Phase P1 — Steward Diagnostics Summary

目标：

- 新增只读诊断聚合层，供大白主动提示和按需诊断

建议 RPC：

- `workbench.steward-diagnostics.summary`
- `workbench.steward-diagnostics.identity`
- `workbench.steward-diagnostics.supervisor`
- `workbench.steward-diagnostics.deliverables`

验收：

- 不产生副作用
- 结果按当前用户 scope 严格裁剪
- 大白能给出用户可理解解释

### Phase P2 — 主动服务体验优化

目标：

- 将大白的主动服务从“静态 guide”升级到“基于状态的轻提示”

范围：

- onboarding
- action-failure explanation
- pending confirmation reminder
- support / supervisor / deliverable 状态提醒

验收：

- 进入会话不再机械播报
- 提醒必须携带可执行下一步
- 无行动价值提醒不出现

### Phase P3 — 受控代办扩展

目标：

- 扩展动作目录，但保持高安全门槛

允许扩展方向：

- 更多 workbench 只读汇总
- 更多组织内受控写动作
- 成果/发布类明确代办

前提：

- 必须目录化
- 必须可确认
- 必须可审计
- 必须可升级收敛

### Phase P4 — 全机器人统一护栏

目标：

- 把目前散落的大白/监督/exec 安全机制统一成平台级策略

范围：

- free-chat CLI guard 统一化
- exec 审批策略统一化
- secret redaction 统一化
- architecture disclosure policy 统一化

### Phase P5 — 成果中枢增强

目标：

- 让大白成为“生成、打开、分享、升级、发布”一条链的成果入口

范围：

- deliverable open/download/render
- publish destination abstraction
- deliverable lineage / ownership audit

## Acceptance Criteria

### Product

- 用户可以把大白当成系统统一入口
- 用户不需要提前理解机器人/模块拓扑
- 主动服务不骚扰，但能在关键节点给出帮助

### Security

- 大白不可触达 admin
- 大白不可自由聊天改代码
- 大白不可暴露 secret
- 大白不可读取其他员工的 steward 产物
- 超权动作必须升级而非伪装成功

### Architecture

- 完整 `doctor` 保留在 CLI
- 大白仅消费只读 diagnostics probes
- 高风险系统修复不进入大白目录
- 代码修改路径只能走监督流

### UX

- 普通问题先正面回答
- 危险动作必须确认
- 失败后必须解释并给出下一步
- 成果文件必须真实可打开/下载

## Open Questions

1. `Steward Diagnostics Summary` 第一批 probe 由哪些现有 doctor 子模块抽取最合适？
2. 全机器人“架构信息披露分级”是否需要单独安全规范文档？
3. 大白是否需要“用户自定义主动提醒偏好”开关？
4. 大白是否需要区分“员工个人 steward”与“群 owner steward”两种提示策略？

## Recommended Immediate Next Steps

1. 先落一版 **Steward Diagnostics Summary** 只读聚合
2. 把 **free-chat CLI 禁止改仓库** 明确提升为平台级统一政策
3. 把 **成果/文件/发布物** 明确列为大白一等能力，而不是聊天附属品
