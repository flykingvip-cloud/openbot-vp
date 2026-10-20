# OpenBot Diagnosis Platform — P24.7 report API 开启

Date: 2026-09-06

Status: **开启批准已冻结。按官方门槛顺序打开 report API。adapters 与大白保持已开。remediation 仍关。合入 main 后仍须 delivery 统一窗口 cutover 才对用户生效。**

## Identity (exact match)

- candidate / origin/main: `1a429ce5ac017da7365221c795af6884570933d9`
- LIVE: `7d3fdf5bfef57077f7956ccab07c3c960984331b`（本机本次无法再 exec 容器；ledger / RELEASE_RECORD Latest 仍为 seq 64 同一 SHA。不是祖先沿用旧 candidate。）
- 祖先沿用无效。不改写旧 P22 / P24.5 / P24.6 JSON。

## Enablement order

官方批准门槛顺序：adapters → report API → Da Bai → remediation。

P24.5 先开大白，P24.6 打开 adapters。P24.7 打开下一扇门槛同为 `platform_security`、且依赖 adapters 的 `DIAGNOSIS_REPORT_API_DEPLOYED`。`diagnosis-reports` pack 随之注册。下一扇门是 remediation（P24.8）。

## Enablement

- `DIAGNOSIS_REPORT_API_DEPLOYED = true`
- adapters / Da Bai 保持 true
- 金丝雀：`internal_single_tenant` / `tenant-fixture-a`
- 签署人：Daniel / CEO（`platform_security`）
- remediation 的 `valueAfterApproval=false`
- 不进入 P25 / P26

## After merge

诊断任务不单独切流、不改账本、不补 provenance。LIVE 仍是旧镜像，直到 delivery 用新 SHA 做统一窗口 cutover + `--verify-live`。
