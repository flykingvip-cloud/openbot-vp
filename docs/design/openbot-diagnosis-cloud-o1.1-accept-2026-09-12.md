# O1.1 阻塞解除 — Go / No-Go

Date: 2026-09-12  
Predecessor: `openbot-diagnosis-cloud-o1-accept-2026-09-12.md`（部分通过）

## 结论

**部分通过（O1.1 代码与门禁已解除；云端 LIVE 尚未切到 O1.1 产物）**

固定对外表述：

> 基础部署和运行身份通过；诊断入口部分可见；授权成功路径、SLO、真实对话和修复闭环未验收。

不得输出 O1 完整通过句。

---

## 已完成（O1.1 顺序 1–2、5、9 本地）

### 1. Gate 与批准身份重绑定（fail-closed）

| Gate                                      | 工作区编译值 | 说明                         |
| ----------------------------------------- | ------------ | ---------------------------- |
| `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`   | **true**     | O1.1 step 3 只读 query/get   |
| `DIAGNOSIS_REPORT_API_DEPLOYED`           | **true**     | live pack 可注册             |
| `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`       | **false**    | fail-closed，待分阶段验收    |
| `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` | **false**    | fail-closed，executor 未部署 |

- P24.5 / P24.6 / P24.7 / P24.8 **frozen SHA** 重绑至 `6bd4569606fd286b7d8b46fb7d9198fb7a134493`
- 新批准记录：`docs/design/openbot-diagnosis-p24.8-enablement-2026-09-12.json`（2026-09-06 记录已标记 superseded）
- `assertApprovedEnablementPrefix` 允许 **partial prefix**（只读门开、Da Bai/remediation 关）
- `nextEnablementStep` 在 report API 之后正确返回 `daibaiDelivery`

**云端 LIVE 现状（未切 O1.1 构建）：** 仍运行 `6bd4569606` 旧产物（四门编译均为 true）。需 **delivery 统一窗口 cutover** 后 LIVE 才体现 fail-closed。

### 2. Provenance peeled target

- 本地已创建 annotated tag：`provenance/sha-6bd4569606fd` → `6bd4569606fd286b7d8b46fb7d9198fb7a134493`
- **待推送** `git push origin provenance/sha-6bd4569606fd`（正常 release 路径）

### 5. 测试门禁

| 门禁                       | 结果                                           |
| -------------------------- | ---------------------------------------------- |
| `vitest run src/diagnosis` | **389/389 pass**                               |
| `vitest ui navigation`     | **pass**（含 `subtitles.enterpriseDiagnosis`） |
| 合计                       | **445/445 pass**                               |

### 9. 无副作用（工作区）

- 未改 ledger / RELEASE_RECORD / 云端配置
- 未发 Da Bai / remediation

---

## 未完成 / 待 delivery + 授权会话（O1.1 顺序 3–8）

| #   | 项                                                              | 状态                                                           |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| 3   | `diagnosis.report_admin` membership 注入会话 query/get 成功路径 | **blocked** — 需隔离租户 + 平台/企业管理员登录；LIVE 未切 O1.1 |
| 4   | `diagnosis.diagnose` 字段级线上验证                             | **未做**                                                       |
| 6   | live SLO / 审计 / 配额观测                                      | **未补齐** — preflight 仍 No-Go                                |
| 7   | Da Bai / live conversation / remediation 分阶段                 | **未做** — 两门 gate 保持 false                                |
| 8   | WeCom default stopped                                           | **blocker 仍在** — 不得宣称真实对话闭环                        |
| 8   | 重跑 O1 全套 + 新 Go/No-Go                                      | **待 LIVE cutover 后**                                         |

`production-p24.8.cli` 对当前 **origin/main tip**（`e6bd204…`）仍报 `report_identity_mismatch` — 预期行为，直到 cutover 候选与 LIVE 再次对齐。

---

## 下一步（delivery / 运维）

1. **Merge + cutover** 含 O1.1 gate 变更的 `origin/main` tip 到 `openbot-gateway-rc`（forward-only 校验 LIVE `6bd4569606` → 新 SHA）
2. **Push** `provenance/sha-6bd4569606fd`；更新 ledger / RELEASE_RECORD（delivery owner，非本任务）
3. 提供 **tenant-fixture-a**（或新隔离租户）+ **diagnosis.report_admin** 浏览器/WS 会话
4. 重跑 O1 验收清单 → 更新 `openbot-diagnosis-cloud-o1-accept-*.md/json`

---

## 禁止事项遵守

未翻转云端 gate、未 restart、未发真实 Da Bai、未 remediation、未改生产账本。
