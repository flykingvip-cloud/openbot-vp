# CQ-O0 Cursor 接手执行指令

> **已废止（2026-08-19）。** 本文是 CQ-O0 生产采集的一次性执行指令，不是现行授权。
>
> - CQ-O0 overall：**complete**（2026-08-19 窗口；归档 `docs/design/evidence/conversation-memory-cq-o0/2026-08-18/`）
> - CQ-O1a implementation：**complete**（#506）
> - 下文 §2 窗口 `2026-08-18T20:00:00+08:00/20:30:00+08:00` **已关闭**，不得按本文重跑生产 probe / overlay / cutover
> - 现行状态以 `docs/design/conversation-memory-collaboration-optimization-plan-2026-08-18.md` rev.4.1.10 为准；`deployAuthorized=false`
>
> 下文仅作历史记录，不构成新的执行授权。

日期：2026-08-18  
执行者：Cursor  
依据：`docs/design/conversation-memory-collaboration-optimization-plan-2026-08-18.md` rev.4 及本轮 Phase 0/Phase 1 验收结论

## 1. 当前签收状态

- Phase 0 实现：通过。
- Phase 1 实现：通过，probe、RPC、scope、真实 SQLite/WAL/SHM、dist smoke 测试均已通过。
- CQ-O0 implementation 轨道：通过。
- CQ-O0 overall：尚未 complete，原因是首份生产 evidence 尚未采集、脱敏、归档。
- CQ-O1a：继续阻断，直到 CQ-O0 production evidence 完成。
- CQ-O1b：设计已接受，实现仍阻断。
- CQ-A2：独立阻断，不得因本任务推进。

## 2. 已确认的生产采集授权参数

```text
operator=ceo
operatorRole=CEO
window=2026-08-18T20:00:00+08:00/2026-08-18T20:30:00+08:00
timezone=Asia/Shanghai
sourceCommit=92c3f93029d4edfc0b722d4f21e50975332c15a3
imageDigest=sha256:952a6c7aa93e17ff3b3eef39116bdf0cc70cac20030cc0e2c4d5d0e51afba037
archivePath=docs/design/evidence/conversation-memory-cq-o0/2026-08-18/
```

不得修改上述 source commit、image digest、operator 或时间窗口。若生产主机实际值不一致，必须 fail-closed 并回执 mismatch，不得继续采集。

## 3. 执行范围

Cursor 只负责以下工作：

1. 在已确认窗口内，从运行中的 `openbot-gateway-rc` 容器读取 build-info 并核对 image digest。
2. 使用镜像内置的 memory health CLI 或已批准的生产 RPC 执行只读 health probe。
3. 对输出执行脱敏、schema 校验、module SHA 校验和 mutation/integrity 校验。
4. 将脱敏 evidence 归档到 `archivePath`。
5. 生成机器可读 manifest、校验 hash 和签收回执。

## 4. 严格禁止

- 禁止 `podman cp` 工作树脚本进入生产容器。
- 禁止导入或调用 `MemoryManager` 的写路径、sync、reindex、rebuild、reset、watcher。
- 禁止修改 UI、`manager.ts`、resolver write switch、schema v2 write path。
- 禁止批量 reindex、迁移、Catalog 写入或改变 v1-root-guard 状态。
- 禁止把原始 ops report、绝对 workspace/index 路径、tenant 标识、数据库内容或未脱敏日志写入 `docs/`。
- 禁止因采集失败而重试写操作；任何 SHA、scope、脱敏或 mutation 失败都必须停止。
- 禁止将“evidence 已采集”误写成“CQ-O0 已完成”，除非归档和完整性验证全部通过。

## 5. 生产主机核对命令

在生产主机执行，保存 stdout 到临时受控位置，不直接提交原始输出：

```bash
podman inspect --format '{{.Id}}' openbot-gateway-rc
podman exec openbot-gateway-rc cat /app/dist/build-info.json
```

必须得到：

```text
imageDigest=sha256:952a6c7aa93e17ff3b3eef39116bdf0cc70cac20030cc0e2c4d5d0e51afba037
build-info.commit=92c3f93029d4edfc0b722d4f21e50975332c15a3
```

任何不一致都输出 `blocked: identity_mismatch`，不得执行 probe。

## 6. Evidence 处理要求

归档目录：

```text
docs/design/evidence/conversation-memory-cq-o0/2026-08-18/
```

建议归档文件：

- `memory-health-report.v2.redacted.json`
- `memory-health-report.v2.manifest.json`
- `memory-health-report.v2.sha256`
- `cq-o0-production-capture-receipt.json`

脱敏最低要求：

- 删除 `workspaceRoot`、`indexPath`、`runtime.stateDir`、`tenantsRoot`、绝对路径和原始 SQLite 内容；
- 保留 `schema`、三维 search 状态、`reasonCode`、documentState、计数、probe integrity、build/module SHA；
- summary report 不得恢复 ops 字段；
- `scope.denied` 必须保持最小 envelope；
- 脱敏后重新计算 SHA-256，并在 manifest 中记录输入/输出 hash、schema、采集时间和 operator。

## 7. 验收命令

生产采集前先在候选代码上运行：

```bash
pnpm exec vitest run --config vitest.unit.config.ts \
  src/memory/health-probe.test.ts \
  src/memory/health-probe-snapshot.test.ts \
  src/memory/health-probe-run.test.ts \
  src/memory/health-probe.factory.test.ts \
  src/memory/health-probe.di-guard.test.ts \
  src/memory/health-probe.oxlint.test.ts

pnpm exec vitest run --config vitest.gateway.config.ts \
  --pool=forks --maxWorkers=1 \
  src/gateway/method-scopes.test.ts \
  src/gateway/gateway-method-auth.test.ts \
  src/gateway/server-methods/doctor-memory-health.test.ts \
  src/gateway/server-methods/doctor-memory-health.integration.test.ts \
  src/gateway/server-methods/doctor-memory-health.dist-smoke.test.ts
```

任何失败都不得继续生产采集。

## 8. 最终回执格式

Cursor 完成后必须回执以下字段：

```text
status=passed|blocked
operator=ceo
window=2026-08-18T20:00:00+08:00/2026-08-18T20:30:00+08:00
imageDigest=...
sourceCommit=...
archivePath=docs/design/evidence/conversation-memory-cq-o0/2026-08-18/
redactedReportSha256=...
manifestSha256=...
schemaValidation=passed|failed
identityCheck=passed|failed
mutationCheck=passed|failed
redactionCheck=passed|failed
tests=passed|failed
nextState=CQ-O0-complete|CQ-O0-blocked
```

只有 `status=passed` 且 identity、schema、mutation、redaction、tests 全部为 `passed`，才允许把 CQ-O0 production evidence 标为完成，并提交方案中的 Phase 0/Phase 1 双轨签收更新。否则保持 blocked，并说明第一个失败原因。
