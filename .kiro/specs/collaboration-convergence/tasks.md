# Collaboration Convergence — Phase 0

## Agents

- `codex-pricing-incident` · role: owner · scope: collaboration-learning snapshot types takeover · paths: `src/gateway/collaboration-learning/snapshot-types.ts`, `.kiro/specs/collaboration-convergence/tasks.md` · since: 2026-06-25

## 验收状态

| 字段             | 值                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **Verdict**      | 主干实施通过；试点群探针 **PASS**（2026-06-19）；群作答编排 Phase 7 **代码落地 + 单测绿**（2026-06-18 续） |
| **Architecture** | `legacy-free`（Phase 6 完成，2026-06-19）                                                                  |
| **Report**       | [acceptance-report-2026-06-19.md](./acceptance-report-2026-06-19.md)                                       |
| **Cleanup wave** | [legacy-cleanup-wave.md](./legacy-cleanup-wave.md)                                                         |

**固定句（镜像 vs runtime truth）：**  
`{stateDir}/spaces/{groupId}` 是 UI / 治理镜像，不是 runtime memory 决策真相；runtime 读写以 `resolveGroupCollaborationPaths()` 输出的 group root 为准。

## Phase 0

- [x] P0-2 `resolveGroupCollaborationPaths(groupId)` + `materializeGroupCollaborationWorkspace` — cursor-convergence
- [x] P0-9 legacy `readParticipations()` helper 删除；业务改走 `loadGroupParticipations` / fileStore — cursor-convergence
- [x] P0-10 删除 auto-reply duplicate resolver；backflow/promoted 走 gateway store — cursor-convergence
- [x] P0-5 `session-continuity` group memory 经 resolver（含 cfg 注入）— cursor-convergence
- [x] P0-11 `space-store` list/members 经 resolver + materialize — cursor-convergence
- [x] P0-1 本机配置 `collaboration.defaults.workspace` → `~/.openbot/collaboration-shared` — cursor-convergence（**环境类**；AC-0 探针间接验真）
- [x] P0-3 迁移脚本 `scripts/migrate-collaboration-group-storage.ts` — cursor-convergence
- [x] P0-4 数字人战队副本合并 + 删除 legacy dirs（backup 在 `~/.openbot/backups/`）— cursor-convergence（**环境类**；AC-3 探针间接验真）

## Phase 2

- [x] P2-1 `runtime-context-assembly.ts` 冻结协作群装配顺序 — cursor-convergence
- [x] P2-2 群 turn `workspaceDir` → group collaboration root — cursor-convergence
- [x] P2-3 群 turn 每轮注入 continuity（非仅 isNewSession）— cursor-convergence

## Phase 1

- [x] P1-1 `participation-sync.ts` 统一 `BotParticipationProfile` 映射与 merge — cursor-convergence
- [x] P1-2 session overlay ↔ `participations.json` 同步；legacy `readParticipations()` helper 已删 — cursor-convergence
- [x] P1-3 `share-to-group` 更新 group capabilities + participation overlay — cursor-convergence

## Phase 3

- [x] P3-1 Participation Charter（`group-charter.ts` participationPolicy）— cursor-convergence
- [x] P3-2 Operating Phase 强化（`review` + runtime phase prompt）— cursor-convergence
- [x] P3-3 Coordinator 治理写入 charter — cursor-convergence
- [x] P3-4 `governance/group-charter.json` + lifecycle ACTIVE/FROZEN/ARCHIVED — cursor-convergence
- [x] P3-5 Ledger governance events + `collaboration.ledger.list` 只读 API — cursor-convergence

## Phase 4

- [x] P4-1 CogniWeave/QMD 索引 `{collaborationRoot}/groups/*/memory` — cursor-convergence
- [x] P4-2 Behavior Buffer → Growth（ledger 聚合 + recompute-growth）— cursor-convergence
- [x] P4-3 跨群 promotion 审计（ledger `promotion` + `collaboration.promotion.audit.list`）— cursor-convergence
- [x] P4-4 AI 社会学治理（charter `promotionPolicy` + backflow gate）— cursor-convergence

## Phase 5+ — 验收与持续（design §9 / §16）

- [x] P5-1 `convergence-acceptance.test.ts` 自动化 AC-1–AC-5 — cursor-convergence
- [x] P5-2 workbench reason drawer + round plan 回归（AC-6）— cursor-convergence
- [x] P5-3 `scripts/verify-collaboration-convergence.ts` 试点群探针 — cursor-convergence
- [x] P5-4 backflow 测试 config 隔离修复 — cursor-convergence
- [x] P5-5 验收报告归档 + legacy compat 标记 — cursor-convergence
- [x] P5-6 试点群 charter sync + `--fail-on-warn` 探针全绿 — cursor-convergence

## Phase 6 — Legacy cleanup wave（清尾，不夹带新功能）

> 详见 [legacy-cleanup-wave.md](./legacy-cleanup-wave.md) · 源码 `legacy-compat.ts`

- [x] LC-1 移除 `createGroupFileStore` legacy read fallback — cursor-convergence
- [x] LC-2 移除 `legacyGroupRootDir` 工厂字段 — cursor-convergence
- [x] LC-3 删除 agent-workspace collaboration root export — cursor-convergence
- [x] LC-4 移除 space-store legacy workspace 枚举 — cursor-convergence
- [x] LC-5 移除 ledger reader 双源 merge — cursor-convergence
- [x] LC-6 删除 `resolveLegacyLedgerPath()` — cursor-convergence
- [x] LC-7 移除 managed-space read fallback（保留镜像写）— cursor-convergence

## Phase 7 — 群作答编排优化（design: `docs/design/openbot-collaboration-group-response-orchestration-optimization-2026-06-19.md`）

- [x] O7-1 `@` 粘连 + `mention_unmatched` 降级为协调者单人 — cursor-convergence
- [x] O7-2 编号决策回复路由（`directed-decision-reply`）— cursor-convergence
- [x] O7-3 `decision_to_executor` 模式（协调者 confirm → 执行者 executor）— cursor-convergence
- [x] O7-4 可选补充旁路：`collaboration.optional_suggestion` + UI chips — cursor-convergence
- [x] O7-5 Mission 升级：`collaboration.spaces.mission.advance` + UI 一键按钮 — cursor-convergence
- [x] O7-6 Chat 折叠：`NO_REPLY` + echo 确认复读（runtime suppress + UI filter）— cursor-convergence
- [x] O7-7 回归单测（dispatch + UI + mission-phase）— cursor-convergence
- [ ] O7-8 试点群人工复测（数字人战队三条路径）— **待 operator**

## Reference

- Design: `docs/design/openbot-multi-agent-collaboration-os-freeze-2026-06-19.md`
- Orchestration: `docs/design/openbot-collaboration-group-response-orchestration-optimization-2026-06-19.md`
- Acceptance: [acceptance-report-2026-06-19.md](./acceptance-report-2026-06-19.md)
- Legacy cleanup: [legacy-cleanup-wave.md](./legacy-cleanup-wave.md)
