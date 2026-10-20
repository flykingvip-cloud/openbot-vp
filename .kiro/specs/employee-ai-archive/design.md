# 设计文档：员工 AI 电子档案

## 1. 目标与边界

- **目标**：把组织侧「岗位详情」从治理操作堆叠面，演进为可生长的 Seat-bound AI Profile。
- **非目标（本规格）**：不重做激活邮件基础设施；不新建用户档案写库；不在 Phase 1 实现列表多选发信完整交互（见 §5 / tasks Phase 2）。

## 2. 领域模型

```text
EmployeeAccount ──SeatBinding──► PositionSeat(seatId) ──► SeatAssets
                                      │
                                      ▼
                              SeatAiArchiveReadModel
                              （只读投影，无独立写库）
```

| 层               | 内容                                         | 交接时                  |
| ---------------- | -------------------------------------------- | ----------------------- |
| 壳（Seat）       | 岗位名、部门、职责、roleCode、资产、能力授权 | 保留                    |
| 人格（Employee） | 正式姓名、账号、行为切片、个人贡献计数       | 归档/重置后由继任者重写 |

## 3. 六分区线框与三态差异

### 3.1 通用骨架

```text
+------------------------------------------------------------------+
| {岗位名}                                    完善度 {N}%    [关闭] |
| {部门} · {阶段标签}                                               |
+------------------------------------------------------------------+
| §1 身份与入职状态                                                 |
|   字段… / 主 CTA（随阶段变化）                                     |
| §2 岗位数字人与运行时                                             |
| §3 权限与能力清单                                                 |
| §4 技能与工具图谱                                                 |
| §5 资产与贡献                                                     |
| §6 工作与衔接时间线                                               |
+------------------------------------------------------------------+
| [次要操作…]                                      [危险：删除空岗]  |
+------------------------------------------------------------------+
```

### 3.2 空岗壳 `vacant_shell`

| 分区           | 展示                                       | 主操作                            |
| -------------- | ------------------------------------------ | --------------------------------- |
| 身份           | 岗位名/部门/职责；成员=未绑定；邮箱=待补充 | 绑定成员 / 补邮箱并激活；编辑岗位 |
| 数字人         | roleCode；Bot 0；用量 --                   | —                                 |
| 权限/技能/贡献 | 待完善                                     | —                                 |
| 时间线         | 「岗位已创建」事件（若有审计）或空态       | —                                 |

### 3.3 待激活 `pending_activation`

| 分区   | 展示                            | 主操作                            |
| ------ | ------------------------------- | --------------------------------- |
| 身份   | 预填姓名/邮箱、过期时间、待激活 | 发送/重发激活；编辑资料（含邮箱） |
| 数字人 | roleCode；通常仍无 Bot          | —                                 |
| 其余   | 待完善占位                      | —                                 |
| 时间线 | 任命创建、发信（若可知）        | —                                 |

### 3.4 在岗 `occupied` / 交接 `handover`

| 分区      | 展示                  | 主操作                         |
| --------- | --------------------- | ------------------------------ |
| 身份      | 正式成员、正常/交接中 | 更换成员；发起交接；交接案入口 |
| 数字人    | Agent/组/Token/成本   | 解绑/转移归属（次要）          |
| 权限      | 运营身份列表          | 跳转治理                       |
| 技能/贡献 | 有则显示，无则占位    | —                              |
| 时间线    | 激活后事件 + 交接事件 | —                              |

## 4. 完善度计算（实现契约）

```text
weights = {
  identity: 25,
  digital: 20,
  permissions: 15,
  skills: 15,
  contribution: 15,
  timeline: 10,
}
completeness = round(sum(weight_i for i where filled_i) )
```

`filled_*` 判定：

- **identity**：`name.trim()` ∧ `teamOk`（非空且 ≠「未分组」） ∧ `hasPerson`（正式成员或有效待激活/成员邮箱）
- **digital**：有 `roleCode` 或至少一个 agent
- **permissions**：≥1 条运营身份
- **skills**：≥1 skill（Phase 1 可恒 false）
- **contribution**：启发式资产计数 > 0
- **timeline**：≥1 条有可靠来源的事件；**禁止**无条件 `seat_present`

## 4.1 Active handover 状态

进行中（→ phase=`handover`）：`draft` | `asset_review` | `pending_approval` | `frozen`

非进行中：

- `rebound`：继任绑定已完成，档案阶段回落到 occupied/vacant_shell 等主线态，时间线可记一条历史事件但不占 handover phase
- `completed`：终态，同上

## 5. 事件 → 字段投影表（完善旅程）

| 环节          | 触发                                     | 写入档案字段                                                                                     | 现状数据源                              |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 创建岗位      | ensureSeat / create seat                 | identity.title/team/responsibility；digital.roleCode；phase=vacant_shell；timeline: seat_created | `enterprise-seat-assets-store`          |
| 填邮箱/导入   | provision `sendActivationEmail` 可 false | identity.pendingName/Email；phase=pending_activation；timeline: assignment_created               | `employeeProvisions` + seat pending\*   |
| 发信/重发     | `/employee/activation/send`              | identity.activationExpiresAt；timeline: activation_email_sent                                    | activationCodes + email notifications   |
| 注册激活      | employee claim                           | identity.memberUserId/displayName；phase=occupied；timeline: activated                           | platform-auth claim → seat occupied     |
| 创建机器人    | 员工创建 Bot / 归属绑定                  | digital.agentIds/defaultAgentId/botCount；timeline: first_bot                                    | seat assets / mesh ownership            |
| 消费 Token    | 月度用量聚合                             | digital.totalTokens/totalCost/sessions；behavior.lastActiveAt                                    | organization monthly usage              |
| 安装技能      | skills 安装（后置）                      | skills[]；completeness.skills                                                                    | agent roster / skills（Phase 3）        |
| 权限清单      | 身份策略绑定                             | permissions.identities[]                                                                         | `seatOperationalIdentityAccess`         |
| 资产贡献      | 资产/知识贡献（后置）                    | contribution.\*                                                                                  | seat assets + employee asset（Phase 3） |
| 日均工时/活跃 | usage/presence                           | timeline.avgDailyHours / lastActiveAt                                                            | usage + presence（Phase 3 精细化）      |
| 岗位衔接      | handover case                            | phase=handover；timeline: handover\_\*；壳保留人格重置                                           | handover summaries                      |

**投影原则**：UI 只读 `SeatAiArchiveReadModel`；禁止详情页临时散落拼装业务规则（规则集中在 `buildSeatAiArchiveReadModel`）。

## 6. 与现有激活 UX 的差距与收敛

### 6.1 现状锚点

| 能力                 | 位置                                   | 状态                       |
| -------------------- | -------------------------------------- | -------------------------- |
| 空岗创建             | `createEnterpriseSeat`                 | 已有                       |
| 单岗补邮箱+发信      | `seatOfferEditor` mode=`activation`    | 已有                       |
| 批量重发             | `/employee/activation/send` + 邀请弹层 | API 已有，列表多选未做     |
| 编辑岗位名/部门/职责 | `createPositionEditor`                 | 已有，不在详情内联         |
| 岗位详情             | `enterprise-org-position-detail.ts`    | 治理操作堆叠，非六分区档案 |

### 6.2 差距清单

1. 详情心智：操作按钮墙 → 需改为六分区档案 + 阶段主 CTA
2. 待激活邮箱：不在详情主表单 → 身份区应暴露「发送激活 / 补邮箱」入口（Phase 1 复用 editor，文案收口）
3. 列表「未激活」一等筛选 + 多选发信 → Phase 2
4. 邀请弹层 → 降级为批量快捷入口，不再是唯一激活路径（文案与入口保留）

### 6.3 迁移说明（岗位详情 → 档案）

1. **同一入口**：选中 `organizationSeat` 仍渲染详情组件；组件内部改为档案布局
2. **类型**：`OrganizationPositionDetailRow` 扩展为档案所需字段（或接受 position row 超集）
3. **操作保留**：删除空岗、交接、offer 提醒/撤回、归属转移等进入页脚次要操作或对应分区，避免丢失能力
4. **测试**：更新 `enterprise-surfaces.browser.test.ts` 中对详情文案/结构的断言（出现六分区标题与完善度）

## 7. SeatAiArchiveReadModel（Phase 1）

```typescript
type SeatAiArchivePhase = "vacant_shell" | "pending_activation" | "occupied" | "handover";

type SeatAiArchiveSectionId =
  | "identity"
  | "digital"
  | "permissions"
  | "skills"
  | "contribution"
  | "timeline";

type SeatAiArchiveReadModel = {
  seatId: string;
  phase: SeatAiArchivePhase;
  phaseLabel: string;
  completeness: number;
  sections: Record<
    SeatAiArchiveSectionId,
    { filled: boolean; weight: number; score: number; placeholder: string | null }
  >;
  identity: {
    /* 展示字段 */
  };
  digital: {
    /* … */
  };
  permissions: { identities: Array<{ title: string; detail: string; badge: string }> };
  skills: { items: string[]; placeholder: string };
  contribution: { heuristicAssetCount: number; placeholder: string | null };
  timeline: { events: Array<{ id: string; label: string; at: string | null }> };
};
```

实现路径：`ui/src/ui/ports/enterprise/semantic/seat-ai-archive.ts`（纯函数 + node test）。

## 8. 风险与非目标

- Phase 3 起技能/贡献/时间线从既有 read model + `robot-capability.list` 投影；仍不新建档案写库
- `avgDailyHours` / 审计流 `activation_email_sent` / seat.createdAt 在 snapshot 未暴露前保持占位，禁止造数
- 不改变 Seat 状态机与「资产跟岗」铁律
- 不把完善度做成多个并列徽章
