# OpenBot Diagnosis Platform — P21 生产依赖与 SLO 证据闭环

Date: 2026-09-05

Status: **Ready for independent approval。** 身份链一致。七项隔离预生产依赖可验证且 `productionWrite=false`。故障注入通过。隔离 SLO completeness=`complete`。standalone production-preflight / trunk-convergence 仍为 No-Go（空生产 SLO + 生产 reader/audit/quota fail-closed），不得渲染为 live 健康。未开 gate。不得自行进入 P22 部署或打开任何生产门禁。

Task: `openbot-diagnosis-platform`

Related:

- [依赖 JSON](/design/openbot-diagnosis-p21-dependencies-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p21-dependencies-2026-09-05)
- [SLO JSON](/design/openbot-diagnosis-p21-slo-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p21-slo-2026-09-05)
- [P21 report JSON](/design/openbot-diagnosis-p21-report-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p21-report-2026-09-05)
- [convergence JSON](/design/openbot-diagnosis-p21-convergence-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p21-convergence-2026-09-05)
- [preflight JSON](/design/openbot-diagnosis-p21-preflight-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p21-preflight-2026-09-05)

硬门禁：P21 Ready ≠ 生产部署。不得开 gate、不得补 provenance、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。不得注册 live gateway pack。不得真实 Da Bai 投送、聊天接入、Doctor `--fix`、Channel restart。

---

## 1. 基线

评估前 `git fetch origin`。LIVE 来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。

| 项                       | 值                                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| candidate / origin/main  | `dc3b3f849b54ad7ad3a640f43653f89e00b2c03b`（#967 squash）               |
| LIVE                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| ledger 开放行            | seq 63，同一 SHA，`liveFrom=2026-09-04T13:39:37Z`，`tag=main`           |
| 第一个 Latest            | seq 63 / `04690f8d2e`（#960）                                           |
| provenance peeled target | `04690f8d2ed51f24a06825c153b7c1885d17182a`                              |

未改 `RELEASE_RECORD.md` / `releases.jsonl`。未提交 `.loom/registry.yaml`。未发布 `provenance/sha-*`。provenance remint：`do_not_mint` / `published=false`。

## 2. Go / No-Go

| Ready 条件                              | 结果      |
| --------------------------------------- | --------- |
| candidate == 最新 origin/main           | true      |
| LIVE == ledger == Latest == peeled      | true      |
| 七项隔离预生产依赖可验证且无生产写入    | true      |
| 故障注入全通过                          | true      |
| 隔离 SLO completeness=complete          | true      |
| P4–P10 preview/dry-run + P20.2 identity | true      |
| 所有生产 gate 仍为 false                | true      |
| standalone 生产 SLO / 生产依赖可用      | **false** |

P21 评估器在隔离预生产后端上给出 **Ready for independent approval**。

独立生产预检仍是准入观察：`slo.completeness=empty`，reader/audit/quota fail-closed，故 standalone `readyForIndependentApproval=false`。那份空 SLO **不得**渲染为健康，也 **不得**被 P21 隔离数字覆盖。

**结论：Ready for independent approval。不得自行打开 gate 或部署。**

## 3. 隔离依赖

七项均注入进程内预生产实现，`productionWrite=false`：

| 依赖                      | timeout | fail-closed                                            |
| ------------------------- | ------- | ------------------------------------------------------ |
| Composite Report reader   | 3000ms  | unavailable/timeout/stale/schema/tenant 全部拒绝或丢弃 |
| append-only audit persist | 2000ms  | persist unavailable 阻断查询路径                       |
| quota store               | 1000ms  | 耗尽 429；后端失败 503                                 |
| gateway auth/membership   | 2000ms  | 缺失 401；越权/claimed tenant 403                      |
| Da Bai transport          | 5000ms  | unavailable 只排队，不 accepted 投送                   |
| conversation state store  | 2000ms  | store down fail-closed；无 live chat bind              |
| remediation executor      | 5000ms  | preview/execute unavailable；`appliedToRuntime=false`  |

完整字段见 [依赖清单](/design/openbot-diagnosis-p21-dependencies-2026-09-05)。

## 4. 故障注入

覆盖 reader unavailable / stale / schema mismatch / tenant mismatch / timeout、audit persist failure、quota exhaustion / backend failure、auth 缺失或越权、Da Bai unavailable、conversation store failure、remediation executor unavailable。

验证：不泄露 Evidence payload；不跨租户返回报告；不产生未授权投送；不执行真实修复；不写消息主链、Session、Skill Invocation、Doctor、Channel。

## 5. SLO

隔离预生产窗口 `2026-09-05T04:20:00.000Z` → `2026-09-05T04:30:19.085Z`。采样范围 `isolated_preprod_rehearsal_only`。租户 `tenant-fixture-a`，trusted tenant 只来自 membership。

必采六项均有 source / window / sample / tenant / observed：success、error、latency、stale、authorization_denied、quota_exhausted。completeness=`complete`。

standalone 生产观测仍全部 `observed=null`、completeness=`empty`。

## 6. 链路回归

仅 preview/dry-run：P4 Signal、P5 delivery contract、P6 `WAITING_AUTHORIZATION`、P7 delegation、P8 evolution proposal、P9 remediation preview、P10 visualization、P20.2 identity preflight。未开启真实 Da Bai、聊天或 remediation。
