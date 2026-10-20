# OpenBot 岗位资产管理研发任务拆解表（2026-06-04）

关联主方案：

- `docs/design/openbot-position-asset-management-plan-2026-06-04.md`

## 文档定位

本文用于把已经冻结的岗位资产管理方案拆成可排期、可指派、可验收的研发任务。

本文默认以下前提已经成立：

1. `Seat` 是资产宿主。
2. 继任是 `Seat Rebinding`。
3. `seatId` 是唯一交接标识。
4. 本轮执行顺序固定为：
   - `P0` `seatId` 精确继任
   - `P0.5` 审计体系
   - `P1` `seatOffer` 深链接岗位确认
   - `P2` 资产继承策略

## 执行状态（2026-06-05）

基于当前代码、聚焦测试与控制台 UI 验证，本轮状态更新如下：

| 里程碑 | 当前状态                | 说明                                                                                        |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------- |
| `M0`   | `done`                  | 冻结版方案、状态机与字段语义已写入设计文档。                                                |
| `M1`   | `done`                  | `seatId` 精确继任、`assigned` 状态、同名岗位不串位测试已落地。                              |
| `M1.5` | `done`                  | `assignmentId`、`assignmentType`、任命/提醒/接受审计事件与管理端摘要已落地。                |
| `M2`   | `code_done_ops_pending` | 前后端深链接、登录回跳、岗位确认摘要与接受闭环已落地；公网/ECS 联调证据仍需补齐。           |
| `M3`   | `done`                  | `full/selective` 继承、memory 分类快照、connector profile/credential 分层与继承 UI 已落地。 |

### 本轮研发完成边界

以下内容已完成并通过聚焦验证：

1. 新员工任命与已注册员工接岗主链按 `seatId` 运作。
2. Seat 任命发出后进入 `assigned`，接受后进入 `occupied`。
3. `assignmentId`、`assignmentType`、`inheritMode` 已贯穿主要任命链路。
4. 管理端可见最近岗位任命摘要与 `assignmentId`。
5. `seatOffer` 深链接、登录回跳、待确认岗位摘要与接受/拒绝已接通。
6. 管理端可在“完整继承 / 自定义继承”之间切换，并配置机器人、协作空间与 memory 继承。

### 待联调验收边界

以下事项不再属于研发实现缺口，但仍是宣布“一期完成”前必须补齐的交付证据：

1. `P1-OPS-1` 公网 `www.openbot.love` 链接打开验证记录。
2. `P1-OPS-2` 登录后自动回跳岗位确认页的浏览器录屏或截图。
3. `P1-OPS-3` 接受后 `pendingOffer` 清空且 `currentSeat` 生效的线上证据。
4. 联调用例、验收矩阵与线上验证记录归档到交付包。

### 当前推荐结论

当前建议把本轮口径更新为：

- `研发实现已收尾`
- `联调验收待完成`

只有待联调验收边界全部补齐后，才建议对外宣布岗位资产管理一期完成。

## 交付方式

建议把本轮工作拆成 4 个里程碑和 1 个保留阶段：

| 里程碑 | 范围     | 目标                                            |
| ------ | -------- | ----------------------------------------------- |
| `M0`   | 方案冻结 | 冻结状态机、实体、字段、交付语义                |
| `M1`   | `P0`     | 消除 `seatTitle` 误复用，建立 `seatId` 精确继任 |
| `M1.5` | `P0.5`   | 任命、继任、资产继承全链可审计                  |
| `M2`   | `P1`     | 岗位确认深链接从公网可稳定完成登录与接受        |
| `M3`   | `P2`     | 实现完整继承/自定义继承的最小可用版本           |
| `M4`   | Next     | 权限模型与宿主模型深化，不进入本轮排期          |

## 角色分工建议

建议按职能而不是个人分工：

| 角色            | 负责范围                                           |
| --------------- | -------------------------------------------------- |
| 后端负责人      | `SeatAssignment`、状态机、任命/交接/审计、继承策略 |
| 前端负责人      | 岗位任命入口、深链接、登录回跳、确认页、继承 UI    |
| 联调负责人      | 公网路由、邮件链接、ECS 验证、全链路验收           |
| 测试负责人      | 集成测试、回归矩阵、错误态覆盖                     |
| 产品/架构负责人 | 字段冻结、状态冻结、文案统一、越界需求控制         |

## 当前高风险代码点

这些位置是本轮最优先处理的代码入口：

### `P0` 相关

- `src/gateway/platform-auth/routes-employee.ts`
- `src/gateway/platform-auth/routes-employee-register.ts`
- `src/gateway/enterprise-seat-assets-store.ts`
- `src/gateway/enterprise-seat-assets.ts`

### `P1` 相关

- `ui/src/ui/views/auth-home.ts`
- `ui/src/ui/app.ts`
- `ui/src/ui/app-render.ts`
- `ui/src/ui/ports/employee/render-model.ts`

### `P2` 相关

- `src/gateway/enterprise-seat-assets-store.ts`
- `src/gateway/enterprise-seat-assets-governance.ts`
- `ui/src/ui/ports/enterprise/render-model.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts`

## M0：冻结输出

本阶段不改业务行为，只产出冻结结果。

### 任务清单

| ID     | 任务                           | 产出                                                              | 负责人    |
| ------ | ------------------------------ | ----------------------------------------------------------------- | --------- |
| `M0-1` | 冻结 Seat 生命周期状态机       | `vacant / assigned / occupied / handover_pending / frozen` 状态表 | 产品/架构 |
| `M0-2` | 冻结 `SeatAssignment` 实体字段 | 字段清单、状态流转、兼容策略                                      | 后端/架构 |
| `M0-3` | 冻结岗位任命统一文案           | `New Hire Assignment` / `Internal Assignment` 文案表              | 产品      |
| `M0-4` | 冻结审计字段最低集合           | `assignmentId` 等最小审计字段表                                   | 架构/测试 |

### 完成定义

1. 所有冻结字段和状态写入设计文档。
2. 新需求不得再改动本轮状态机与字段语义。
3. 研发按冻结版字段命名，不再自创别名。

## M1：`P0` seatId 精确继任

目标：

- 新员工继任与已注册员工接岗都必须按 `seatId` 运作。
- 彻底消除按 `seatTitle` 误复用的风险。

### 后端任务

| ID        | 任务                                                              | 涉及文件                                                                                         | 产出                           | 依赖      |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------ | --------- |
| `P0-BE-1` | 为岗位任命增加显式 `seatId` 参数                                  | `src/gateway/platform-auth/routes-employee.ts`                                                   | 新员工任命接口支持显式岗位目标 | `M0-2`    |
| `P0-BE-2` | 为岗位确认/岗位 offer 统一补充 `assignmentType`                   | `src/gateway/enterprise-seat-assets.ts`, `src/gateway/platform-auth/routes-employee-register.ts` | 新老员工任命语义对齐           | `M0-2`    |
| `P0-BE-3` | 修改 `createEmployeeProvisionWithSeat(...)`，优先按 `seatId` 绑定 | `src/gateway/platform-auth/routes-employee.ts`                                                   | 新员工继任不再按标题复用       | `P0-BE-1` |
| `P0-BE-4` | 限制按 `seatTitle` 复用仅用于“创建全新岗位”路径                   | `src/gateway/enterprise-seat-assets-store.ts`                                                    | 模糊复用退出继任主链           | `P0-BE-3` |
| `P0-BE-5` | 引入 `assigned` 状态并修正 seat 状态流转                          | `src/gateway/enterprise-seat-assets-store.ts`                                                    | 状态机实现与文档一致           | `M0-1`    |
| `P0-BE-6` | `SeatAssignment` 读写兼容层                                       | `src/gateway/platform-auth/store-types.ts`, `src/gateway/enterprise-seat-assets-store.ts`        | offer/provision 对外统一抽象   | `M0-2`    |

### 前端任务

| ID        | 任务                                 | 涉及文件                                                              | 产出                                                  | 依赖      |
| --------- | ------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------- | --------- |
| `P0-FE-1` | 管理后台岗位任命入口改成从岗位行发起 | `ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts` | 继任必须显式选择具体岗位                              | `P0-BE-1` |
| `P0-FE-2` | 岗位选择器展示完整岗位标识           | 同上 + `ui/src/ui/ports/enterprise/render-model.ts`                   | 显示 `seatId / roleCode / 部门 / 当前状态 / 当前员工` | `M0-1`    |
| `P0-FE-3` | 禁止纯文本岗位名继任入口             | 同上                                                                  | 去掉只填岗位标题的旧交互                              | `P0-FE-1` |

### 测试任务

| ID        | 任务                                   | 产出                  |
| --------- | -------------------------------------- | --------------------- |
| `P0-QA-1` | 新增三个同名岗位测试数据               | 验证同名岗位不串位    |
| `P0-QA-2` | 新员工继任指定 `seatId` 的集成测试     | 注册后绑定到正确 seat |
| `P0-QA-3` | 已注册员工接岗指定 `seatId` 的集成测试 | 接受后绑定到正确 seat |

### M1 验收标准

1. 同名岗位场景下，所有继任都只能落到指定 `seatId`。
2. 任何 API 不再接受“只凭岗位标题定位继任对象”。
3. Seat 进入 `assigned` 的时机和接受后进入 `occupied` 的时机可被测试证明。

## M1.5：`P0.5` 审计体系

目标：

- 岗位任命、继任、资产继承可追踪、可回放、可问责。

### 后端任务

| ID         | 任务                         | 涉及文件                                                                                      | 产出                                                                             | 依赖       |
| ---------- | ---------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| `P05-BE-1` | 增加 `assignmentId` 审计主键 | `src/gateway/enterprise-seat-assets-store.ts`, `src/gateway/enterprise-seat-assets-audit.ts`  | 任命贯穿 ID                                                                      | `P0-BE-6`  |
| `P05-BE-2` | 增加最小审计字段             | 同上                                                                                          | `seatId / employeeId / oldEmployeeId / newEmployeeId / inheritMode / acceptedAt` | `M0-4`     |
| `P05-BE-3` | 增加审计事件类型             | 同上                                                                                          | `assignment.created/accepted/...`                                                | `P05-BE-1` |
| `P05-BE-4` | 在邮件发送和接受动作中落审计 | `src/gateway/platform-auth-email.ts`, `src/gateway/platform-auth/routes-employee-register.ts` | 任命发出与接受可串联                                                             | `P05-BE-2` |

### 前端任务

| ID         | 任务                             | 涉及文件                                                              | 产出             |
| ---------- | -------------------------------- | --------------------------------------------------------------------- | ---------------- |
| `P05-FE-1` | 管理后台显示最近岗位任命日志摘要 | `ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts` | 便于运营排查     |
| `P05-FE-2` | 任命详情显示 `assignmentId`      | 同上                                                                  | 对客服与审计可见 |

### 测试任务

| ID         | 任务                         | 产出                       |
| ---------- | ---------------------------- | -------------------------- |
| `P05-QA-1` | 任命创建与接受事件链测试     | 可按 `assignmentId` 找全链 |
| `P05-QA-2` | 继承策略与审计字段一致性测试 | 审计快照不丢字段           |

### M1.5 验收标准

1. 任意一次岗位任命都可按 `assignmentId` 回溯完整生命周期。
2. 任意一次资产继承都能查到来源岗位、目标员工、继承策略和接受时间。

## M2：`P1` 岗位确认深链接流程

目标：

- 已注册员工点击岗位任命邮件后，稳定进入登录并完成岗位接受。

### 前端任务

| ID        | 任务                                      | 涉及文件                                      | 产出                       | 依赖      |
| --------- | ----------------------------------------- | --------------------------------------------- | -------------------------- | --------- |
| `P1-FE-1` | 识别公网 `seatOffer` 深链接               | `ui/src/ui/views/auth-home.ts`                | 识别 `seatOffer=<offerId>` | `M1`      |
| `P1-FE-2` | 未登录时强制进入员工登录，而非注册        | 同上                                          | 修复当前错误落点           | `P1-FE-1` |
| `P1-FE-3` | 登录成功后回跳岗位确认页                  | `ui/src/ui/app.ts`, `ui/src/ui/app-render.ts` | 保留 `seatOffer` 上下文    | `P1-FE-2` |
| `P1-FE-4` | 岗位确认页显示待确认岗位资产摘要          | `ui/src/ui/ports/employee/render-model.ts`    | 展示 `pendingSeatOffer`    | `P1-FE-3` |
| `P1-FE-5` | 岗位确认页增加“接受 / 拒绝”操作与结果提示 | 相关 employee/workbench 视图                  | 完成闭环                   | `P1-FE-4` |

### 后端任务

| ID        | 任务                                                           | 涉及文件                                                | 产出                     |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------- | ------------------------ |
| `P1-BE-1` | 岗位确认邮件链接持续使用公网基址                               | `src/gateway/enterprise-seat-assets.ts`                 | 邮件链接稳定生成公网地址 |
| `P1-BE-2` | 受理岗位确认时返回完整 `pendingOffer` / `currentSeat` 更新结果 | `src/gateway/platform-auth/routes-employee-register.ts` | 前端能无歧义刷新状态     |

### 联调任务

| ID         | 任务                                                | 产出           |
| ---------- | --------------------------------------------------- | -------------- |
| `P1-OPS-1` | 验证公网链接在 `www.openbot.love` 下可打开          | 邮件落地验证   |
| `P1-OPS-2` | 验证登录后自动回跳                                  | 浏览器联调记录 |
| `P1-OPS-3` | 验证接受后 `pendingOffer` 清空且 `currentSeat` 生效 | 线上快照证据   |

### M2 验收标准

1. 岗位确认邮件点击后不再落到通用注册页。
2. 员工登录后直接进入岗位确认区。
3. 接受岗位后可见 `currentSeat` 与默认岗位资产。

## M3：`P2` 资产继承策略

目标：

- 管理员可控岗位默认资产如何交给继任者。

### 后端任务

| ID        | 任务                                                                      | 涉及文件                                           | 产出                                          | 依赖             |
| --------- | ------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- | ---------------- | ---- |
| `P2-BE-1` | 增加 `inheritMode = full                                                  | selective`                                         | `src/gateway/enterprise-seat-assets-store.ts` | 最小可用继承策略 | `M1` |
| `P2-BE-2` | 支持 selective 传入 `agentIds` / `defaultSpaceIds` / `inheritMemoryScope` | 同上                                               | 可配置部分继承                                | `P2-BE-1`        |
| `P2-BE-3` | 增加 memory 分类快照                                                      | 同上                                               | `inheritable / review_required / private`     | `M0-2`           |
| `P2-BE-4` | 增加 connector profile / credential 分层快照                              | `src/gateway/enterprise-seat-assets-governance.ts` | “配置继承、凭证重绑”可表达                    | `P2-BE-1`        |

### 前端任务

| ID        | 任务                              | 涉及文件                                                              | 产出                            |
| --------- | --------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| `P2-FE-1` | 默认显示“完整继承”                | `ui/src/ui/ports/enterprise/render-model.ts`                          | 降低管理员误配                  |
| `P2-FE-2` | 展开“自定义继承”面板              | `ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts` | 勾选机器人、协作空间、memory    |
| `P2-FE-3` | 展示 memory 分类与 connector 提示 | 同上                                                                  | 标出“需管理员确认 / 需重新授权” |

### 测试任务

| ID        | 任务                   | 产出                                       |
| --------- | ---------------------- | ------------------------------------------ |
| `P2-QA-1` | 完整继承场景集成测试   | 新/老员工都可通过                          |
| `P2-QA-2` | 自定义继承场景集成测试 | 只继承勾选资产                             |
| `P2-QA-3` | connector 重授权测试   | profile 保留、credential 重绑              |
| `P2-QA-4` | memory 分类测试        | `private` 不继承，`review_required` 需提示 |

### M3 验收标准

1. 管理员可在“完整继承 / 自定义继承”之间切换。
2. 自定义继承的机器人、协作空间、memory 配置能正确投影到继任结果。
3. connector 配置与凭证在交接后的行为与方案一致。

## 下一阶段（不进入本轮排期）

以下内容已确定重要，但不进入当前迭代：

1. `Tenant Scope / Space Scope / Seat Scope` 的完整权限协作模型
2. 多岗位并存的 `primary / secondary` 消费规则
3. Ownership 与 Permission 的完整分层实现
4. 项目级资产、部门级资产与岗位级资产的可视化治理

## 排期建议

### Sprint 1

- `M0`
- `M1`

目标：

- 先消除资产错交风险
- 先冻结实体与状态机

### Sprint 2

- `M1.5`
- `M2`

目标：

- 让岗位任命可审计
- 让公网岗位确认流程真正可用

### Sprint 3

- `M3`

目标：

- 上线最小可用的继承策略

## 最终交付物清单

本轮实施完成后，应形成以下交付物：

1. 冻结版设计文档
   - `docs/design/openbot-position-asset-management-plan-2026-06-04.md`
2. 研发任务拆解文档
   - `docs/design/openbot-position-asset-management-work-breakdown-2026-06-04.md`
3. 最终验收 SOP
   - `docs/design/openbot-position-asset-management-final-acceptance-sop-2026-06-05.md`
4. 后端接口与实体变更清单
5. 前端页面与状态流转清单
6. 联调用例与验收矩阵
7. 线上验证记录

## 建议的执行门槛

以下门槛都满足后，才允许宣布岗位资产管理一期完成：

1. 同名岗位继任不再串位。
2. 任命可按 `assignmentId` 全链回溯。
3. 岗位确认邮件公网可点通并完成接受。
4. 新员工继任与已注册员工接岗都能走通。
5. 完整继承与自定义继承都可验证通过。

## 最终验收清单（建议直接执行）

### A. 研发验证

1. 同名岗位场景下，新员工任命指定 `seatId` 后，激活完成落到正确岗位。
2. 已注册员工收到岗位确认后，接受完成落到正确岗位。
3. 任命发出后 Seat 状态显示为 `assigned`。
4. 接受完成后 Seat 状态显示为 `occupied`。
5. 管理端“最近岗位任命”中可见 `assignmentId`、任命类型、目标员工与当前状态。
6. 自定义继承场景下，仅勾选资产进入最终岗位结果。
7. connector profile 继承，credential 仍需重授权。

### B. 联调验证

1. 从公网邮件点击岗位确认链接，进入员工登录页而非通用注册页。
2. 登录成功后自动回跳到个人设置中的岗位确认区。
3. 接受岗位后 `pendingOffer` 消失，`currentSeat` 与岗位默认资产生效。
4. 激活邮件与岗位确认提醒邮件都能在公网环境成功送达并打开目标页面。

### C. 归档材料

1. 聚焦测试通过记录。
2. 浏览器联调截图或录屏。
3. 公网验证记录。
4. 最终上线说明与回滚要点。
