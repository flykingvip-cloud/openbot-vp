# Tasks: enterprise-data-capability-ia-redesign

## Agents

- cursor-enterprise-data-ia · role: owner · scope: 企业数据能力中心 IA 重构（四 Tab 工作台） · paths: `.kiro/specs/enterprise-data-capability-ia-redesign/**`, `ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts`, `ui/src/ui/ports/enterprise/views/enterprise-data-capability/**`, `ui/src/ui/controllers/enterprise-data-capability/**`, `ui/src/ui/views/enterprise-data-capability/**`, `ui/src/ui/capability/enterprise-data-capability/**` · since: 2026-07-20

## Checklist

- [x] Loom register (`enterprise-data-capability-ia-redesign:cursor-enterprise-data-ia`)
- [x] design.md 现状审计
- [x] CP1: section-routing + 四 Tab 外壳 + 旧 section/hash 兼容
- [x] CP2: 总览工作台（5 KPI + 需要处理队列 + 产品运行榜）
- [x] CP3: 数据产品四步事务闭环（upsertCapability + 投影 spec/binding + 开放授权）
- [x] CP4: 权限与治理（默认矩阵 + 真实审计血缘页 + 模块内审批跳转）
- [x] CP5: 删除旧重复一级入口；lazy load 按子区隔离
- [x] CP6: 专项测试（home.browser + ports helpers，49 通过 / 1 skip）
- [x] 交付移植到 `fix-scoped-package-templates`（见 handoff）

## Commits cadence

每个绿色检查点用 `scripts/committer`，trailer：

```
Task: enterprise-data-capability-ia-redesign
Agent: cursor-enterprise-data-ia
```
