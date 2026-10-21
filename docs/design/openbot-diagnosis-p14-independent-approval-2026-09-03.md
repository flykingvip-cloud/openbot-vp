# OpenBot Diagnosis Platform — P14 独立批准材料冻结

Date: 2026-09-03

Status: **No-Go。运行容器 LIVE 已核对，ledger 已对齐故不改写；RELEASE_RECORD 落后、provenance 在 cutover 时未发布故不补 tag；candidate ≠ origin/main。全部 gate 保持 false。批准不等于开 gate。P14 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Security、Enterprise Admin、Employee、delivery ledger owner、SRE、QA

Task: `openbot-diagnosis-platform`

Related:

- [P13 只读准入排练](/design/openbot-diagnosis-p13-go-no-go-2026-09-03)
- [P12 Go/No-Go 预检包](/design/openbot-diagnosis-p12-go-no-go-2026-09-03)
- [开发交付链路标准](/design/openbot-dev-delivery-pipeline-standard-2026-07-20)

硬门禁：即使 `readyForIndependentApproval=true`，也不得打开生产 gate、不得注册 live pack、不得调用真实聊天 / RPC / Doctor / Channel、不得自动修复。Trusted tenant 只来自服务端 membership。生产依赖只能由显式服务端配置注入。禁止新增 Report DB / Skill Health DB / 平行诊断事实源。

机器可读快照：

- [P14 approval JSON](/design/openbot-diagnosis-p14-approval-2026-09-03.json) · [P14 approval Markdown](/design/openbot-diagnosis-p14-approval-2026-09-03.md)
- [P14 preflight JSON](/design/openbot-diagnosis-p14-preflight-2026-09-03.json) · [P14 preflight Markdown](/design/openbot-diagnosis-p14-preflight-2026-09-03.md)

复跑命令：

```text
bun src/diagnosis/production-approval-freeze.cli.ts \
  --json-out docs/design/openbot-diagnosis-p14-approval-2026-09-03.json \
  --md-out docs/design/openbot-diagnosis-p14-approval-2026-09-03.md

bun src/diagnosis/production-preflight.cli.ts --live-sha <40-hex> \
  --json-out docs/design/openbot-diagnosis-p14-preflight-2026-09-03.json \
  --md-out docs/design/openbot-diagnosis-p14-preflight-2026-09-03.md
```

---

## 1. 发布身份核对

2026-09-03 从 `root@8.217.93.71` / `openbot-gateway-rc` 读取 `/app/dist/build-info.json`：

```json
{ "commit": "6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96", "builtAt": "2026-09-03T01:37:57.887Z" }
```

| 身份                          | SHA                                        | 结论                                                                   |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| candidate                     | `3a413e616c44aa20a4114408b855b409cfd80ea5` | 特征分支，ahead of origin/main                                         |
| origin/main                   | `769da88d21a4ade2ed598ece481b1a31d75e3138` | ancestor check 通过                                                    |
| LIVE                          | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | 运行容器 source=container                                              |
| ledger open                   | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | seq 58 与 LIVE 一致                                                    |
| RELEASE_RECORD Latest cutover | `37cc40e51f468404baf3077307e347f32f636cb1` | 仍写 seq 54                                                            |
| provenance                    | missing                                    | 无 `provenance/sha-6d9ea1f2d5`；存在的是 `provenance/sha-37cc40e51f46` |

CLI 优先采用容器 LIVE。注入 SHA 与容器不一致时丢弃注入值，避免掩盖真实运行版本。

---

## 2. Provenance 与账本修复决定

| 对象                        | 决定                        | 原因                                                                                       |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`            | **keep / 不改写**           | 开放行已等于 LIVE。改写会掩盖运行版本。                                                    |
| `RELEASE_RECORD.md`         | **defer_to_delivery_owner** | Latest cutover 落后。Diagnosis 特征分支改写会使审批包看起来已对齐，而 trunk / 生产仍落后。 |
| `provenance/sha-6d9ea1f2d5` | **do_not_mint**             | seq 58 注明 cutover 拉取 GHCR `main` 且 `no provenance-sha-*`。事后补 tag 等于伪造发布史。 |

`ledgerMutated=false` `releaseRecordMutated=false` `provenanceMinted=false`。

delivery_ledger_owner 若要修复人类视图：在 trunk 上把 Latest cutover 写成已证明的 LIVE `6d9ea1f2d5`，并关闭 seq 54 的叙述；不要回写 ledger 历史。若未来 cutover 需要 provenance，走正常发布路径，不要让 Diagnosis 补旧 tag。

---

## 3. 生产依赖最终清单

全部 `tenantBoundary=server_membership_only`。注入合同：`serverConfigOnly`、`clientEnableForbidden`、`implicitEnableForbidden`。

| 依赖                      | Authority of record                                                      | Schema                         | Timeout | 失败关闭                                |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------ | ------- | --------------------------------------- |
| Composite Report reader   | CompositeDiagnosis 投影 + Session + Skill Invocation + tool observations | `diagnosis.reports@1`          | 3000ms  | unavailable，不得渲染健康               |
| Audit persist             | `$CONFIG_DIR/diagnosis-audit/`                                           | `append_only_audit_v1`         | 2000ms  | 缺审计阻断写入、保留历史                |
| Quota store               | 注入 windowed counter                                                    | `windowed_counter/60000ms`     | 1000ms  | 503 拒绝新查询                          |
| Gateway auth / membership | 服务端 membership resolver                                               | trusted tenant from membership | 2000ms  | 拒绝客户端 tenant 声明                  |
| Da Bai transport          | 仅 allowlist 注入                                                        | `diagnosis.daibai.delivery@1`  | 5000ms  | reject 不入 pending，保留回执           |
| Conversation store        | 进程内可注入 store                                                       | `conversation_diagnosis_run@1` | 2000ms  | 停在 WAITING_AUTHORIZATION              |
| Remediation executor      | 仅 allowlist 注入                                                        | `remediation_execution@1`      | 5000ms  | unavailable 且 `appliedToRuntime=false` |

---

## 4. SLO 证据冻结

P13 排练观测已冻结：`success`、`error`、`latency`、`stale`、`authorization_denied`、`quota_exhausted`。

- `completeness=complete`
- 总评 health=`not_ready`，因为身份未对齐
- 缺失观测不得渲染为健康

---

## 5. 独立审批包

批准 **不等于** 自动开启 gate。`approvalDoesNotOpenGate=true`。

### 分角色

- **platform_security**：adapters、report API、Da Bai allowlist、remediation executor allowlist
- **enterprise_admin**：Da Bai delivery、租户范围 remediation、membership 租户边界
- **employee**：高风险修复、个人范围证据不得被扩大
- **delivery_ledger_owner**：trunk 上更新 Latest cutover；provenance 只走正式发布路径

### 分 gate

| Gate                                      | 批准人                                          | 前置                                                     | 审计                   | 回滚                        |
| ----------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- | ---------------------- | --------------------------- |
| `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`   | platform_security                               | reader/audit/quota 已注入且 SLO 完整                     | pending_human_approval | 保持 false                  |
| `DIAGNOSIS_REPORT_API_DEPLOYED`           | platform_security                               | adapters 已批、live pack 不得自注册、SLO 完整            | pending_human_approval | 保持 false 并撤销 live pack |
| `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`       | platform_security + enterprise_admin            | P5 已签、transport allowlist、delegation guard、SLO 完整 | pending_human_approval | 关 gate、停投送、保留回执   |
| `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` | platform_security + enterprise_admin + employee | executor allowlist、高风险人工批准、SLO 完整             | pending_human_approval | 关 gate、停新任务、保留审计 |

禁止隐式开启，禁止客户端参数开启。

---

## 6. 可重复预检

一致性失败、权限失败、配额失败、SLO 缺失、依赖不可用均 fail-closed。当前树阻断：

- candidate `3a413e616c` ≠ origin/main `769da88d21`
- RELEASE_RECORD `37cc40e51f` lags LIVE `6d9ea1f2d5`
- 缺少 provenance；不得补发

合成对齐输入可以把 `readyForIndependentApproval` 打成 true，仍不会开 gate。

---

## 7. 未做

- 未改写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`
- 未改 `RELEASE_RECORD.md`
- 未补 `provenance/sha-6d9ea1f2d5`
- 未打开任何生产 gate，未注册 live pack
- 未执行生产构建、发布、重启、灰度或流量切换
- 未接真实聊天、Doctor `--fix`、Channel restart
- 4.1 / 4.2 仍未勾；`diagnose()` 仍未实现
