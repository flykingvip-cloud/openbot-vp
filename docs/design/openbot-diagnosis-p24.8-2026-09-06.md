# OpenBot Diagnosis Platform — P24.8 remediation 开启

Date: 2026-09-06

Status: **开启批准已冻结。按官方门槛顺序打开 remediation。adapters / report API / 大白保持已开。不部署 live executor，不绑 Doctor `--fix` / Channel restart，不进 P25/P26。合入 main 后仍须 delivery 统一窗口 cutover 才对用户生效。**

## Identity (exact match)

- candidate / origin/main: `0d8a31a2c4e91e13a9acff64ce57511efd694135`（#983 合入后的主干 tip）
- LIVE: `7d3fdf5bfef57077f7956ccab07c3c960984331b`（本机本次无法再 exec 容器；ledger / RELEASE_RECORD Latest 仍为 seq 64 同一 SHA。不是祖先沿用旧 candidate。）
- 祖先沿用无效。不改写旧 P22 / P24.5 / P24.6 / P24.7 JSON。

## Enablement order

官方批准门槛顺序：adapters → report API → Da Bai → remediation。

P24.5 先开大白并已合入 main。P24.6 adapters 只合进了 P24.5 侧枝，P24.7 report API PR #987 与新主干冲突。本增量重放到当前 `origin/main`，带上所需的 adapters + report API 依赖，然后打开最后一扇门槛 `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED`（approver=`platform_security+enterprise_admin+employee`）。`nextEnablementStep()` 为 `null`。不启动 P25。

## Enablement

- `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED = true`
- adapters / report API / Da Bai 保持 true
- live executor 仍 fail-closed：无 allowlist 或有 allowlist 都不得执行
- 金丝雀：`internal_single_tenant` / `tenant-fixture-a`
- 签署人：Daniel / CEO
- 四门 `valueAfterApproval=true`
- 不进入 P25 / P26

## After merge

诊断任务不单独切流、不改账本、不补 provenance。LIVE 仍是旧镜像，直到 delivery 用新 SHA 做统一窗口 cutover + `--verify-live`。
