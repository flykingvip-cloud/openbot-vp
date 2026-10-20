# OpenBot Diagnosis Platform — P24.5 大白 + 对话开启

Date: 2026-09-05

Status: **开启批准已冻结。只打开大白投送 + live conversation。合入 main 后仍须 delivery 统一窗口 cutover 才对用户生效。**

## Identity (exact match)

- candidate / origin/main: `0676d469a7d45449837f33965bd7a71d5f7c9251`
- LIVE (container `build-info.json`): `7d3fdf5bfef57077f7956ccab07c3c960984331b`
- 祖先沿用无效。不改写旧 P22 JSON。

## Enablement

- `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED = true`
- `liveConversationBound = true`
- 金丝雀：`internal_single_tenant` / `tenant-fixture-a`
- 签署人：Daniel / CEO
- 其余三门保持 `valueAfterApproval=false`
- 不注册 `diagnosis-reports` pack
- 不进入 P25 / P26

## Transport

唯一出站写点：`createLiveDaibaiTransport` → 现有 `chat.send`。禁止 `user.daibai.ask` / `user.daibai.execute`。投送正文只含脱敏 `DiagnosisDaibaiDeliveryProjection`。

## After merge

诊断任务不单独切流、不改账本、不补 provenance。LIVE 仍是旧镜像，直到 delivery 用新 SHA 做统一窗口 cutover + `--verify-live`。
