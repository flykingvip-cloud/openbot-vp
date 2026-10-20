# OpenBot Diagnosis Platform — P9 治理修复预览与验证

Date: 2026-09-03

Status: **进程内 remediation 治理执行器已落地。只生成 preview、门禁记录和验证判决，不执行真实修复。P9 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Security、QA、Evolution Governance

Task: `openbot-diagnosis-platform`

Related:

- [P7 分级授权与会诊](/design/openbot-diagnosis-p7-graded-delegation-2026-09-03)
- [P8 受治理进化提案](/design/openbot-diagnosis-p8-evolution-proposal-2026-09-03)

硬门禁：P8 proposal 必须已经批准。P7 grant 必须仍有效。模型输出不能直接变成 action。`doctor_repair` / `channel_restart` / `skill_disable` / `configuration_change` / `batch_change` 不得真正执行。Verification 不得抄写旧 Finding 作为成功。

---

## 1. 对象

`RemediationProposal`、`RemediationExecution`、`RemediationVerification` 分开存放。执行结果不写回 Diagnosis Case / Finding。

状态：`PROPOSED` → `PREVIEWED` → `PENDING_APPROVAL` → `APPROVED` → `EXECUTING` → `EXECUTED` → `VERIFYING` → `VERIFIED` → `ROLLED_BACK`。拒绝分支：`REJECTED` / `EXPIRED` / `REVOKED` / `BLOCKED` / `FAILED`。

---

## 2. 动作门禁

| 动作                                                  | 风险   | 预览                 | 人工批准 | 本阶段执行 |
| ----------------------------------------------------- | ------ | -------------------- | -------- | ---------- |
| `read_only_check`                                     | low    | 可直接 preview       | 否       | dry-run    |
| `safe_reversible`                                     | medium | 必须 preview + grant | 否       | dry-run    |
| `configuration_change` / `batch_change`               | high   | 必须                 | 是       | BLOCKED    |
| `doctor_repair` / `channel_restart` / `skill_disable` | high   | 必须                 | 是       | BLOCKED    |

默认 executor 为 unavailable；测试可注入 dry-run。`appliedToRuntime` 恒为 false。

---

## 3. Verification

执行前写 baseline window，执行后写 observation window。判决：`improved` / `unchanged` / `regressed` / `inconclusive`。`inconclusive` 必须带 `missingEvidence`。`regressed` / `inconclusive` 只能进入 `FAILED` 或后续 `ROLLED_BACK`，不得标成功。

---

## 4. 未做

- 未接 Doctor `--fix`、Channel restart、配置写入、Skill install/disable
- 未接 HTTP / RPC / UI / live pack
- 未执行生产构建、发布、重启或切流量
