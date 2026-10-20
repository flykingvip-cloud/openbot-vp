# OpenBot Diagnosis Platform — P25 受治理修复隔离灰度

Date: 2026-09-06

Status: **隔离金丝雀已冻结。只在 `tenant-fixture-a` 进程内跑 preview → execute → verification。生产 live executor 仍 undeployed。不绑 Doctor `--fix` / Channel restart / Skill disable / 配置写入。不进 P26，不切 LIVE。合入 main 后仍须 delivery 统一窗口 cutover。**

## Identity (exact match)

- candidate / origin/main: `0d8a31a2c4e91e13a9acff64ce57511efd694135`（#983 合入后的主干 tip；与 P24.8 冻结 SHA 相同，因为主干未再前进）
- LIVE: `7d3fdf5bfef57077f7956ccab07c3c960984331b`（本机本次无法再 exec 容器；ledger / RELEASE_RECORD Latest 仍为 seq 64 同一 SHA。不是祖先沿用旧 candidate。）
- 祖先沿用无效。不改写旧 P22 / P24.5–P24.8 JSON。

## Official P25 scope

前置：P24 稳定，并已取得 `platform_security + enterprise_admin + employee` 批准（P24.8 已记录）。

本增量完成：

1. 仅允许 **隔离 allowlisted dry-run executor**
2. 高风险动作必须人工批准
3. 先 preview，再 execute，再 verification
4. 验证 baseline、observation、rollback 和 verification receipt
5. 禁止未批准的 Doctor `--fix`、Channel restart、Skill disable、配置写入；即使批准也保持 `appliedToRuntime=false` / `BLOCKED`
6. 任何失败保持 `appliedToRuntime=false` 或进入明确回滚状态

不部署生产 live executor。`resolveProductionRemediationExecutor({ allowlisted: true })` 仍 fail-closed 为 `remediation_live_executor_undeployed`。

## After merge

诊断任务不单独切流、不改账本、不补 provenance。LIVE 仍是旧镜像，直到 delivery 用新 SHA 做统一窗口 cutover + `--verify-live`。P26 Production Ready 仍关闭。
