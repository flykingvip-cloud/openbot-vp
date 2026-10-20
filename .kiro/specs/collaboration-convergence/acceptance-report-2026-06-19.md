# Collaboration Convergence — 验收报告

| 项       | 值                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------- |
| 验收日期 | 2026-06-19                                                                                            |
| 试点群   | `grp-daniel-hhd-gmail-com-upbeyond`（数字人战队）                                                     |
| 架构状态 | **Legacy-free**（Phase 6 完成）                                                                       |
| 探针命令 | `bun scripts/verify-collaboration-convergence.ts --group-id grp-daniel-hhd-gmail-com-upbeyond --json` |

## 验收结论

**主干实施通过，进入清尾阶段（Phase 6 legacy cleanup wave）。**

不得宣称「架构冗余已全部清理完成」。兼容读链、双写镜像仍按设计保留至删除清单 LC-\* 逐项清零。

| 阶段      | 判定                                          |
| --------- | --------------------------------------------- |
| Phase 0–3 | 功能主线 **通过**                             |
| Phase 4   | 框架已接入；效果属 **持续治理**，非一次性收官 |
| Phase 5+  | 自动化 AC + 试点探针 **通过（有条件）**       |
| 整体      | **Converged with legacy compat**              |

## 试点群探针结果（2026-06-19）

```json
{
  "groupId": "grp-daniel-hhd-gmail-com-upbeyond",
  "results": [
    {
      "id": "AC-0-collaboration-root",
      "status": "pass",
      "detail": "collaboration.defaults.workspace=~/.openbot/collaboration-shared"
    },
    {
      "id": "AC-2-workspace-materialized",
      "status": "pass",
      "detail": "collaboration-shared/groups/grp-daniel-hhd-gmail-com-upbeyond"
    },
    {
      "id": "AC-3-single-task-ledger",
      "status": "pass",
      "detail": "single task_ledger.json at canonical collaboration root"
    },
    {
      "id": "AC-4-capsules-at-resolver-root",
      "status": "pass"
    },
    {
      "id": "AC-3-charter-present",
      "status": "pass",
      "detail": "governance/group-charter.json synced via scripts/sync-collaboration-group-charter.ts"
    },
    {
      "id": "AC-2-managed-profile-workspacePath",
      "status": "pass",
      "detail": "spaces/{groupId}/profile.json mirror present"
    }
  ],
  "failed": false,
  "warned": false
}
```

**WARN 跟进（2026-06-19 已关闭）：** 已执行 `bun scripts/sync-collaboration-group-charter.ts --group-id grp-daniel-hhd-gmail-com-upbeyond`，探针 `--fail-on-warn --run-tests` 全绿。

## 环境类动作（仓库外，探针可部分验真）

| 任务 | 说明                                                                             |
| ---- | -------------------------------------------------------------------------------- |
| P0-1 | `collaboration.defaults.workspace` 本机配置 — AC-0 pass 间接确认                 |
| P0-4 | 副本合并 + legacy dir 删除 — AC-3 single ledger pass；完整删除需 filesystem 审计 |

## 遗留 compat

Phase 6（2026-06-19）已移除 LC-1 … LC-7。profile/members **镜像写** `{stateDir}/spaces/{groupId}` 仍保留（UI/治理），runtime **读**仅 canonical group root。

## 自动化测试

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/collaboration-learning/convergence-acceptance.test.ts \
  src/gateway/collaboration-learning/legacy-compat.test.ts \
  ui/src/ui/controllers/collaboration-round-plan.test.ts \
  ui/src/ui/ports/employee/views/workbench-stage-collaboration.node.test.ts
```

## 下一步

见 [legacy-cleanup-wave.md](./legacy-cleanup-wave.md) — Phase 6，只做 compat 删除，不夹带新功能。
