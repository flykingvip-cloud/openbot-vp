# 云端智能诊断受控线上验收 O1

Date: 2026-09-12  
Task: O1（只读验收；非部署、非切流、非 Production Ready 宣布）  
Machine-readable: `openbot-diagnosis-cloud-o1-accept-2026-09-12.json`

## Go / No-Go

**结论：部分通过**

**不得**输出完整通过句：「云端诊断代码、只读报告 API、诊断 RPC、权限隔离和 UI 投影线上验收通过。」

---

## 一、发布身份与健康检查

| 项                        | 值                                                   |
| ------------------------- | ---------------------------------------------------- |
| `origin/main` / candidate | `6bd4569606fd286b7d8b46fb7d9198fb7a134493`           |
| LIVE（容器 build-info）   | `6bd4569606fd286b7d8b46fb7d9198fb7a134493`           |
| OCI revision              | `6bd4569606fd286b7d8b46fb7d9198fb7a134493`           |
| 镜像                      | `localhost/openbot:rc-amd64-provenance-6bd4569606`   |
| ledger open               | `6bd4569606fd286b7d8b46fb7d9198fb7a134493`           |
| RELEASE_RECORD latest     | `6bd4569606fd286b7d8b46fb7d9198fb7a134493`           |
| provenance peeled target  | **缺失**（无 `provenance/sha-6bd4569606*` 本地 tag） |

验收期间重新 `git fetch origin` 后 LIVE 未漂移。

### 脚本结果

| 脚本                                                 | 结果                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| `bun scripts/ops/l3-live-snapshot.ts --json --check` | exit 0                                                     |
| `verify-live-image-identity.sh` (R9)                 | **PASS** — build-info = OCI revision                       |
| `verify-forward-only.sh --candidate 6bd4569606…`     | **allow** — LIVE 为 candidate 祖先                         |
| `verify-delivery-alignment.sh`                       | PASS=4 WARN=2 FAIL=0（CANDIDATE_TAG 未设，L1/L2 tag 跳过） |

### 健康与 bundle

- `healthz=200`，`readyz.ready=true`
- 18789 由 `openbot-gateway-rc` 持有
- 公网四主机 + gateway 均服务 **`index-iwByD4J0.js`**（Gateway/UI 同一 bundle）
- 回滚容器/镜像存在：`openbot-gateway-rc-prev-f0dec72227-safety` / `localhost/openbot:rc-amd64-provenance-f0dec72227`

### 身份 blocker

- **provenance peeled target 与 LIVE 不可证明一致**（preflight / convergence 均标记 `live_equals_provenance: fail`）

---

## 二、生产 Gate 实际状态

### 容器运行时

- 环境变量：**无** `DIAGNOSIS_*` / `OPENBOT_DIAGNOSIS_*` 覆盖
- LIVE dist 已注册 pack 方法：`diagnosis.reports.query`、`diagnosis.reports.get`（`diagnosis.diagnose` 存在于 gateway dist）

### 编译期四门（对 LIVE SHA 的 artifact 评估 / preflight）

| Gate                                      | 编译期 value | auditReceipt           | approver                                    |
| ----------------------------------------- | ------------ | ---------------------- | ------------------------------------------- |
| `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`   | **true**     | pending_human_approval | platform_security                           |
| `DIAGNOSIS_REPORT_API_DEPLOYED`           | **true**     | pending_human_approval | platform_security                           |
| `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`       | **true**     | pending_human_approval | platform_security+enterprise_admin          |
| `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` | **true**     | pending_human_approval | platform_security+enterprise_admin+employee |

### 人工批准记录对账

- `docs/design/openbot-diagnosis-p24.8-enablement-2026-09-06.json`：四门 `valueAfterApproval=true`，但冻结身份为  
  candidate `0d8a31a2…` / LIVE `7d3fdf5b…` — **与当前 LIVE `6bd4569606…` 不匹配**
- `production-p24.8.cli`：**No-Go**，`exactIdentityMatch: false`
- `approvedForProductionCutover: false`，`p26ProductionReady: false`

### 安全阻塞（按任务规则 §2）

**gate 编译为 true，但批准链身份与 LIVE 不一致 + auditReceipt 仍为 pending** → 视为安全/合规阻塞，**未**在本任务中翻转 gate 或重启。

### 链路连接态（运行时）

| 项                | 状态                                                |
| ----------------- | --------------------------------------------------- |
| liveConnected     | false                                               |
| productionWrite   | false                                               |
| live executor     | **未部署**（P24.8：`liveExecutorUndeployed: true`） |
| Da Bai transport  | **未连接**（P5：`liveDeliveryEnabled: false`）      |
| live conversation | **未绑定**                                          |
| live SLO observed | **null / empty**                                    |

---

## 三、授权测试身份

- 本次**未获得**隔离测试租户 + `diagnosis.report_admin` 服务端 membership 注入会话（P24.8 canary `tenant-fixture-a` 不在 LIVE 租户列表）。
- 容器内 CLI 使用 operator gateway token：**非** TrustedTenantContext membership 路径。
- 未向报告写入任何 token / Cookie / session 标识。

---

## 四、线上只读 RPC 验收

### 已验证（负向 / operator 路径）

| 调用                                          | 结果                                   |
| --------------------------------------------- | -------------------------------------- |
| 无效 gateway token                            | unauthorized / 1008 token mismatch     |
| `diagnosis.nope`                              | unknown method                         |
| `diagnosis.reports.query`（operator）         | **forbidden**                          |
| `diagnosis.reports.get`（缺失 reportId）      | **forbidden**                          |
| `diagnosis.diagnose`（空 params）             | **unauthorized**                       |
| schemaVersion=9 / forged tenantId（operator） | **forbidden**（auth 先于 schema 分类） |

### 未验证（blocker）

- 授权身份下 query/get **成功体**（schemaVersion、reportId、tenant scope、targets、findings、evidenceRefs；无 Evidence payload）
- query/get **一致性**
- 授权 `diagnosis.diagnose` 字段级（completion、missingEvidence、confidence、verification；INCONCLUSIVE → verification=null）
- 400 非法 cursor、403 跨租户双身份、429 quota、reader/audit/quota backend fail-closed、持久 audit 摘要

---

## 五、负向安全测试

已记录 operator/invalid-token/unknown-method 摘要（见 JSON `rpc.negativeResults`）。  
**未完成**完整负向矩阵（跨租户双 principal、quota 耗尽、backend 不可用 fail-closed）。

---

## 六、线上 UI 验收

| 路由                                                | HTTP | Bundle            | 观察                                       |
| --------------------------------------------------- | ---- | ----------------- | ------------------------------------------ |
| <https://www.openbot.love/>                         | 200  | index-iwByD4J0.js | 员工控制壳                                 |
| <https://admin.openbot.love/platform/diagnosis>     | 200  | index-iwByD4J0.js | **平台管理员登录门**；跨企业脱敏摘要未验   |
| <https://biz.openbot.love/enterprise/001/diagnosis> | 200  | index-iwByD4J0.js | 自动化会话**未登录**；授权企业 UI 行为未验 |

L3 确认公网 bundle 与 LIVE 一致。授权会话下的 fail-closed 文案、无 payload 泄漏、INCONCLUSIVE 不渲染健康 — **本轮未验**。

---

## 七、真实链路边界

| 边界                  | 状态                          |
| --------------------- | ----------------------------- |
| 只读报告 API          | **未验证**成功路径            |
| diagnosis.diagnose    | **未验证** RPC 字段           |
| Da Bai delivery       | **未连接**                    |
| live conversation     | **未绑定**                    |
| remediation executor  | **未部署**                    |
| WeCom `default`       | configured=false, **stopped** |
| WeCom `t_001_default` | configured=true, **running**  |
| live SLO              | **缺失**                      |

**Blocker：** `default` WeCom 未运行 → 「真实对话投送未完成线上验收」。

---

## 八、无副作用与回滚

验收期间：

- 未修改消息主链 / Skill Invocation / Doctor --fix / Channel restart
- 未发送 Da Bai / remediation
- 未改配置、环境变量、ledger、RELEASE_RECORD、provenance
- LIVE 主机路径无 `diagnosis-audit` / `diagnosis-projections` 目录
- 回滚镜像存在；**未触发** incident 回滚

---

## 九、测试门禁

| 门禁                                 | 结果                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `pnpm exec vitest run src/diagnosis` | **411 pass / 1 fail** — attribution 测试指向前轮 accept json 未 sign-in        |
| 诊断 UI tests + navigation           | **60 pass / 1 fail** — `subtitles.enterpriseDiagnosis` 翻译缺失                |
| `pnpm exec tsgo --noEmit`            | exit 0                                                                         |
| `pnpm format`                        | exit 0                                                                         |
| `git diff --check`                   | exit 0                                                                         |
| `production-preflight.cli`           | verdict **no-go**                                                              |
| `production-trunk-convergence.cli`   | verdict **no-go**（provenance fail；本地 HEAD≠origin/main 为 dirty-tree 预期） |
| verify-live-image-identity           | pass                                                                           |
| verify-forward-only                  | allow                                                                          |
| verify-delivery-alignment            | pass with warnings                                                             |

---

## 十、交付物索引

1. L3 snapshot JSON — `/tmp/o1-diagnosis-accept-20260912/l3-snapshot.json`
2. R9 镜像身份 — `/tmp/o1-diagnosis-accept-20260912/verify-live-image-identity.txt`
3. candidate/LIVE/ledger/RELEASE_RECORD 对账 — 本文 §一 + forward-only / alignment 输出
4. 四门 gate 快照 — 本文 §二 + `/tmp/o1-diagnosis-accept-20260912/preflight.json`
5. RPC 测试结果 — `/tmp/o1-diagnosis-accept-20260912/rpc-negative-v2.txt`
6. UI 路由/bundle — L3 `publicHosts` + 浏览器快照
7. SLO/审计/配额 — preflight blockingReasons
8. Da Bai/Channel/live — §七
9. 无副作用 — §八
10. 回滚检查 — §八
11. **O1 Go/No-Go** — 本文 + JSON

---

## 解除 blocker 所需（运维/产品，非本任务范围）

1. 提供隔离测试租户 + `diagnosis.report_admin` 授权浏览器/WS 会话（membership 注入）
2. 将 P24.8（或后继）批准记录 re-sign 到当前 LIVE SHA，或回退编译 gate 至批准身份一致
3. 补齐 `provenance/sha-6bd4569606…` peeled target（正常 release 路径，非验收任务 mint）
4. 注入/观测 live SLO、audit、quota backend；完成 Da Bai / live conversation / remediation 分阶段验收
5. 修复 UI i18n `subtitles.enterpriseDiagnosis`；合并后重跑 UI 测试

---

## 禁止事项遵守确认

本任务未：翻转 gate、生产 build/publish/restart、诊断单独切流、发送真实 Da Bai、Doctor --fix、Channel restart、remediation、修改 ledger/RELEASE_RECORD/provenance、提交 `.loom/registry.yaml`、宣布 Production Ready。
