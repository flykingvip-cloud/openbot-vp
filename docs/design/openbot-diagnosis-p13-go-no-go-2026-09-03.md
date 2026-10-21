# OpenBot Diagnosis Platform — P13 只读单租户准入排练

Date: 2026-09-03

Status: **No-Go。预生产 reader/audit/quota 与完整 SLO 已在进程内排练通过，但 candidate ≠ origin/main、RELEASE_RECORD 落后 LIVE/ledger、缺少 provenance/sha-6d9ea1f2d5。全部 gate 保持 false。P13 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Security、Enterprise Admin、SRE、QA、delivery ledger owner

Task: `openbot-diagnosis-platform`

Related:

- [P12 Go/No-Go 预检包](/design/openbot-diagnosis-p12-go-no-go-2026-09-03)
- [P5 大白投送合同](/design/openbot-diagnosis-p5-daibai-delivery-2026-09-03)
- [P11 受控灰度与回滚演练](/design/openbot-diagnosis-p11-production-cutover-2026-09-03)
- [开发交付链路标准](/design/openbot-dev-delivery-pipeline-standard-2026-07-20)

硬门禁：即使 `readyForIndependentApproval=true`，也不得打开生产 gate、不得注册 live pack、不得调用真实聊天 / RPC / Doctor / Channel、不得自动修复。Trusted tenant 只来自服务端 membership。禁止新增 Report DB / Skill Health DB / 平行诊断事实源。P13 不得改写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`、不得补 provenance tag、不得把 `RELEASE_RECORD.md` 改成看起来已对齐。

机器可读快照：

- [P13 admission JSON](/design/openbot-diagnosis-p13-admission-2026-09-03.json) · [P13 admission Markdown](/design/openbot-diagnosis-p13-admission-2026-09-03.md)
- [P13 preflight JSON](/design/openbot-diagnosis-p13-preflight-2026-09-03.json) · [P13 preflight Markdown](/design/openbot-diagnosis-p13-preflight-2026-09-03.md)

复跑命令：

```text
bun src/diagnosis/production-admission.cli.ts --live-sha <40-hex> \
  --json-out docs/design/openbot-diagnosis-p13-admission-2026-09-03.json \
  --md-out docs/design/openbot-diagnosis-p13-admission-2026-09-03.md

bun src/diagnosis/production-preflight.cli.ts --live-sha <40-hex> \
  --json-out docs/design/openbot-diagnosis-p13-preflight-2026-09-03.json \
  --md-out docs/design/openbot-diagnosis-p13-preflight-2026-09-03.md
```

---

## 1. 账本一致性

观测身份（DIAGP0 `f09b7c76eb`）：

| 身份                          | SHA                                        | 结论                           |
| ----------------------------- | ------------------------------------------ | ------------------------------ |
| candidate                     | `f09b7c76ebb3c4cbaaba8901be3dae8414f77217` | 特征分支，ahead of origin/main |
| origin/main                   | `769da88d21a4ade2ed598ece481b1a31d75e3138` | ancestor check 通过            |
| LIVE                          | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | 运行容器 / seq 58 开放行       |
| ledger open                   | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | 与 LIVE 一致                   |
| RELEASE_RECORD Latest cutover | `37cc40e51f468404baf3077307e347f32f636cb1` | 仍写 seq 54，落后 LIVE         |
| provenance                    | missing                                    | 无 `provenance/sha-6d9ea1f2d5` |

P13 选择 **保持 No-Go 并列出阻断**，而不是改写账本或补 tag：

- `ledgerMutated=false`
- `provenanceMinted=false`
- blocker: `RELEASE_RECORD` 落后 LIVE，不得掩盖 LIVE
- blocker: 缺少 provenance，P13 不得补发

`readyForIndependentApproval` 还要求 `candidateSha === origin/main`。特征分支 HEAD 保持 false 是正确的。

---

## 2. 预生产依赖注入

P13 只向进程内排练注入测试/预生产后端：

- Composite Report reader：投影源 + schema / tenant / maxAge / timeout 全部 fail-closed
- append-only audit
- windowed quota

未接真实 Report DB / Skill Health DB / 第二事实源。生产常量保持：

- `DIAGNOSIS_REPORT_API_DEPLOYED=false`
- `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=false`
- `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED=false`
- `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED=false`

裸 P12 preflight（不注入）仍把 reader/audit/quota/SLO 记为 unavailable / empty。P13 admission 包装后，排练事实把这四项记为 pass，但账本身份阻断仍使总评为 No-Go。

---

## 3. SLO 观测排练

已记录六项必需指标：`success`、`error`、`latency`、`stale`、`authorization_denied`、`quota_exhausted`。

- `completeness=complete`
- 缺失指标不得渲染为健康；本轮观测齐全后 rehearsal health=`healthy`
- 总评仍为 `not_ready`，因为 candidate / RELEASE_RECORD / provenance 未对齐

---

## 4. 单租户只读 API

只排练 `diagnosis.reports.query` / `diagnosis.reports.get`：

| 检查                                   | 结果                           |
| -------------------------------------- | ------------------------------ |
| query                                  | 200                            |
| get                                    | 200                            |
| unauthorized                           | 401                            |
| 客户端伪造 tenant / 跨租户 get         | 403，隔离成立                  |
| 用户态脱敏                             | `sessionKeyHash` 不出现在 body |
| audit                                  | 已记录                         |
| quota                                  | 429                            |
| schema / stale / timeout / unavailable | fail-closed                    |

Trusted tenant 只来自 membership。`claimedTenantId` / query / header / `sessionTenantId` 不是权威来源。未注册 live pack，未接真实 HTTP/RPC。

---

## 5. P4–P10 预览链

Signal → 进程内投送合同 → `WAITING_AUTHORIZATION` → 分级授权 → Composite Report → EvolutionProposal → Remediation preview：

- conversation 停在 `WAITING_AUTHORIZATION`
- P8 使用 platform→enterprise grant（员工 grant 保密上限为 personal）
- remediation `read_only_check` 状态 `PREVIEWED`，`appliedToRuntime=false`
- 未接 live Da Bai，未写消息主链，未执行 Doctor / Channel

P5 仍按 P12 签收为进程内合同，不是 live 投送。

---

## 6. 未做

- 未打开任何生产 gate
- 未注册 `GATEWAY_METHOD_PACKS` / `coreGatewayHandlers` 的 diagnosis live 入口
- 未执行生产构建、发布、重启、灰度或流量切换
- 未把 candidate 快进成 origin/main
- 未改写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / `RELEASE_RECORD.md`，未补 provenance tag
- 未接真实聊天、Doctor `--fix`、Channel restart
- 4.1 / 4.2 仍未勾；`diagnose()` 仍未实现

---

## 7. 仍需人类批准

- `platform_security`：生产依赖与 live pack
- `enterprise_admin`：投送 / 修复执行
- `delivery_ledger_owner`：把 `RELEASE_RECORD.md` 与 provenance 对齐到 LIVE `6d9ea1f2d5`，不得要求 Diagnosis 任务改写账本
- 把 diagnosis candidate 收敛到最新 `origin/main`
- 独立审批通过后，仍需另一次明确指令才能开 gate
