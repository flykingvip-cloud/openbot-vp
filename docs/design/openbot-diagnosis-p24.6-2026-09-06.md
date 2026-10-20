# OpenBot Diagnosis Platform — P24.6 adapters 开启

Date: 2026-09-06

Status: **开启批准已冻结。按官方门槛顺序打开 adapters。大白门保持已开。Report API 与 remediation 仍关。合入 main 后仍须 delivery 统一窗口 cutover 才对用户生效。**

## Identity (exact match)

- candidate / origin/main: `0676d469a7d45449837f33965bd7a71d5f7c9251`
- LIVE: `7d3fdf5bfef57077f7956ccab07c3c960984331b`（P24.5 已从容器读出；本机本次无法再 exec 容器，ledger / RELEASE_RECORD Latest 仍为 seq 64 同一 SHA，origin/main 未变。不是祖先沿用旧 candidate。）
- 祖先沿用无效。不改写旧 P22 / P24.5 JSON。

## Enablement order

官方批准门槛顺序：adapters → report API → Da Bai → remediation。

P24.5 作为产品第一刀先开了大白。P24.6 把顺序重新对齐：打开门槛最低且无前置依赖的 `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`。下一扇门是 report API（P24.7）。

## Enablement

- `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED = true`
- `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED` 保持 true
- 金丝雀：`internal_single_tenant` / `tenant-fixture-a`
- 签署人：Daniel / CEO（`platform_security`）
- report API / remediation 的 `valueAfterApproval=false`
- 不注册 `diagnosis-reports` pack
- 不进入 P25 / P26

## After merge

诊断任务不单独切流、不改账本、不补 provenance。LIVE 仍是旧镜像，直到 delivery 用新 SHA 做统一窗口 cutover + `--verify-live`。
