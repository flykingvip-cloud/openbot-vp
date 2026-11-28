# Track 2 零退化证据（既有 M2-B / B3 / vault-sync 基线）

- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 工作树：`/Users/daniel/.codex/worktrees/knowledge-sdk-alignment/openbot`
- 分支：`codex/openbot/v21-wave0-audit-and-adapters`（产品代码仍与 `f0fccbd37bb9a45545562ee668295f9153b6f6aa` 一致，本轮仅增加默认关闭适配器、契约 pin、官方字段文档与本地 CI 工作流）
- `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED` 未设置为 `true`
- **不是** Gate 7 沙箱重跑，不是 T-01–T-27，不是正式 Wave-V21-0 验收。未把历史 67 passed / EPERM 拼入本基线。
- `src/vault-sync/store/postgres-s3.live.test.ts` 仍被默认 `*.live.test.ts` 排除，分类 NOT_RUN，不是产品 FAIL。

## 命令与结果

| 套件 | 命令 | 窗口（CST） | 结果 | 退出码 |
|---|---|---|---|---:|
| B3 安全回归 | `pnpm exec vitest run --reporter=verbose src/gateway/knowledge/knowledge-base-permissions.test.ts src/gateway/knowledge/knowledge-base-members.test.ts src/retrieval/sources/knowledge-source.test.ts` | 08:47:45–08:47:50 | Test Files 3 passed；Tests **22 passed**；0 failed；0 skipped | 0 |
| vault-sync handlers | `pnpm exec vitest run --reporter=verbose src/gateway/server-methods/vault-sync.test.ts` | 08:47:50–08:47:55 | Test Files 1 passed；Tests **12 passed**；0 failed；0 skipped | 0 |
| vault-sync 默认套件（18-file / 60-passed 基线） | `pnpm exec vitest run --reporter=verbose src/vault-sync` | 08:47:55–08:48:00 | Test Files **18 passed**；Tests **60 passed**；0 failed；0 skipped | 0 |
| 本轮新增 VB-3/VB-4 | `pnpm exec vitest run --reporter=verbose src/knowledge/v21-wave0` | 08:47:36–08:47:37 | Test Files 4 passed；Tests **10 passed**（含 51 向量兼容与清单哈希钉扎） | 0 |

日志（工作树，同时归档）：

- `docs/architecture/v21-audit/evidence/b3.log`
- `docs/architecture/v21-audit/evidence/vault-sync-handlers.log`
- `docs/architecture/v21-audit/evidence/vault-sync-suite.log`
- `docs/architecture/v21-audit/evidence/vb3-vb4-vitest.log`

本零退化证明覆盖既有 M2-B 相关的 B3 权限/检索回归与 vault-sync 18 文件 / 60 通过基线，以及本轮新增默认关闭适配器与契约向量测试。不宣称 GitHub CI 已上线（工作流仅存在于本地 Track 2，本裁定未授权 push/PR）。
