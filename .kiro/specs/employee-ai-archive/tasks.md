# Tasks: 员工 AI 电子档案

## Agents

> 签到以 `pnpm loom register` 为准（本块为派生视图）。未认领 `ui/src/styles/components.css`（与其他任务 CONFLICT）；档案页复用既有 `enterprise-org-ws` 样式。

- cursor-composer · role: owner · scope: employee AI archive Phase 1–3 · paths: .kiro/specs/employee-ai-archive/\*_, ui/src/ui/ports/enterprise/semantic/seat-ai-archive_.ts, ui/src/ui/ports/enterprise/semantic/organization-inactive-activation*.ts, ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts, ui/src/ui/ports/enterprise/views/enterprise-org-position-detail*.ts, ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts, ui/src/ui/ports/enterprise/views/enterprise-organization-activation.browser.test.ts · since: 2026-07-22

> 归属：`organization-surface` / `position-detail` 由本任务独占落地。`enterprise-read-model.ts` 仅认领 `handoverSummaries.seatId` 透传（verify-then-take，自 ops-decommission / model-gov paths 移除重叠）；列表匹配 seatId→title。

## Checklist

### Phase 0 — 设计冻结

- [x] requirements.md — 档案定义、六分区、三态、完善度、投影与激活对齐（含空岗六区占位 / active handover 澄清）
- [x] design.md — 线框、事件投影表、UX 差距与迁移、ReadModel 契约
- [x] tasks.md — 本文件

### Phase 1 — 读模型 + 详情六分区骨架

- [x] `seat-ai-archive.ts`：完善度/时间线/handover/邮箱建模修复 + `buildSeatAiArchiveInput`
- [x] `seat-ai-archive.node.test.ts`：含无部门、completed handover、无真实事件、userId 非邮箱反例
- [x] `enterprise-org-position-detail.ts`：真正接入六分区布局 + 顶栏完善度 + 阶段主 CTA（保留治理能力）
- [x] 样式：复用 org-ws（未改 components.css，避免 ownership overlap）
- [x] 组件级四态 CTA 测试（`enterprise-org-position-detail.browser.test.ts`）
- [x] loom register；本任务文件已归属 cursor-composer（`enterprise-org-position-detail.ts` 仍可能与其他宽路径任务 CONFLICT，落地由本任务 owner 负责）
- [x] scoped Vitest + oxfmt check 通过

### Phase 2 — 列表主路径

- [x] 组织列表「未激活」筛选一等化（`organizationStatus=inactive` = VACANT ∪ PENDING_ACTIVATION）
- [x] 多选 + 批量 `onSendActivationEmails`（对应 `/employee/activation/send`）
- [x] 无邮箱选中项 → 打开结构档案 + `seatOfferEditor` mode `activation`
- [x] 纯函数 `organization-inactive-activation.ts` + node/browser 测试
- [x] 切换状态 Tab 清空多选；发信后清空多选

### Phase 3 — 深度投影

- [x] skills：打开档案时按岗位 Bot 调 `robot-capability.list` 聚合 `knownSkills`（既有 RPC，无新写库）
- [x] 贡献：agent/space/memory + 身份绑定拆分；mesh 会话作参考字段
- [x] 工时：`lastActiveAt` 投影；`avgDailyHours` 暂无可靠源，UI 明示
- [x] 时间线事件化：offer/handover/bot 归属/身份绑定/活跃，带 source + 可排序时间戳
- [x] 完善度子条件：skills≥1；contribution=`breakdown.total>0`；timeline≥1 有来源事件
- [x] handoverSummaries 透传 `seatId`；列表按 seatId→title 匹配
- [x] scoped Vitest（archive 16 + skills 2 + detail browser 5）

## Acceptance（Phase 1）

1. 选中任意岗位打开详情，可见六个分区标题与完善度百分比 — done
2. vacant / pending_activation / occupied / handover 主 CTA 符合 design §3 — done（组件级测试）
3. `buildSeatAiArchiveReadModel` 单测覆盖 phase 推导、加权完善度及专家反例 — done（12 tests）
4. 不新增平行档案写 API — done
5. 详情组件实际引用读模型（`buildSeatAiArchiveInput` → `buildSeatAiArchiveReadModel`）— done

## Acceptance（Phase 2）

1. 状态 Tab 含一等「未激活」，href 带 `organizationStatus=inactive` — done
2. 未激活列表可多选；有 pending 邮箱的选中项批量走 `onSendActivationEmails` — done
3. 无邮箱空岗选中后点发送 → 跳转该岗档案并以 activation 打开补邮箱 — done
4. scoped Vitest（node helper + activation browser）通过 — done

## Acceptance（Phase 3）

1. 档案技能区可展示 `robot-capability.list` 聚合名（有 Bot 时异步加载）— done
2. 贡献区展示可继承资产拆分（Bot/空间/记忆域/身份绑定）— done
3. 时间线事件含 source，并优先展示带时间戳的 offer/handover/bot/身份/活跃事件 — done
4. `avgDailyHours` 无源时不造数 — done
5. scoped Vitest 通过 — done

## Acceptance fix（2026-07-22 复验）

- [x] `seat-ai-archive.ts` TS7053：`knownSkillsBySeatId` 收窄为 `ReadonlyMap` only
- [x] `enterprise-org-position-detail.browser.test.ts`：typed `vi.fn<...>` + 完整 `ownershipTransferEditor` stub
- [x] 身份时间线：仅 `event.seatId === row.seatId`；无 seatId 不投影
- [x] 交接风险：仅 `archive.phase === "handover"`
- [x] 归属：`organization-surface` / `position-detail` 独占落地；`enterprise-read-model.ts` 正式透传 `handoverSummaries.seatId`（与 Phase 3 勾选一致）

— cursor-composer
