# OpenBot Diagnosis Platform — P4 动态巡检与 DiagnosticSignal

Date: 2026-09-03

Status: **只读巡检与信号已落地。P4 完成 ≠ Phase 完成 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Gateway、Security、QA

Task: `openbot-diagnosis-platform`

硬门禁：只读生成信号。不修复，不接入大白投送，不写消息主链 / Skill Invocation / Doctor / Channel / 配置。不新增运行事实源、Report DB 或 Skill Health DB。调度只接受显式 `run` / `tick`，禁止 `setInterval` / 常驻线程。

---

## 1. 巡检触发

| kind                     | 行为                                           |
| ------------------------ | ---------------------------------------------- |
| `scheduled`              | 对当前 snapshot 中同租户 open Finding 生成信号 |
| `event`                  | 匹配 Evidence summary 中的 eventCode           |
| `threshold`              | 指标越过阈值                                   |
| `trend`                  | 窗口内指标增量超过 minDelta                    |
| `verification_triggered` | Case 的 verification 未改善或缺失              |

时钟可注入。`tick` 只在 `everyMs` 到期时运行 scheduled，不创建后台定时器。

---

## 2. DiagnosticSignal

必须引用既有 Target、Evidence、Finding、Case 与 trusted tenant。CONFIRMED 必须有 Evidence id；INCONCLUSIVE 必须有 `missingEvidence`。禁止携带 `causes` / `relations` / `payload`。

去重键：tenant + fingerprint。重复触发合并 `occurrenceCount`，保持同一 `signalId`。抑制窗口内不再发射。过期后标记 `expired`。

信号可创建或关联 DiagnosticCase；Case 只追加 findingIds 与 timeline，不写 Evidence，不推断 RCA。

---

## 3. 失败关闭

- 跨租户 snapshot / 引用 → `tenant_mismatch`，不发射
- snapshot `unavailable` → 累加 retry，不编造信号
- 缺失证据 → INCONCLUSIVE，不编造 Evidence

---

## 4. 未做

- 未接入大白投送
- 未执行修复或自动变更
- 未注册 live pack / 未生产部署
