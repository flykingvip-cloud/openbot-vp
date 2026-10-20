# 标注元数据（Phase B web_read **校准语料 / calibration corpus**）

> Agent: grok-bot
>
> **命名冻结**：本目录既有 60 行 `annotated-cases.jsonl` = **calibration corpus**（开发/校准专用）。
> 其上的 match / false-allow 仅报 **calibration metrics**，**不是** Phase C 泛化证据，也不得称为 independent acceptance。
> Blind holdout 另见 `blind-holdout-cases.jsonl` / `blind-holdout-meta.md`（classifier freeze 之后密封）。

## 1. 流程

1. **annotator-alpha** 与 **annotator-beta** 独立标注同一批 60 条（不互看）。
2. 每条写入：
   - `annotationA`: `{ expectedSurface, humanGate, completionLabel, annotatorId: "annotator-alpha" }`
   - `annotationB`: `{ expectedSurface, humanGate, completionLabel, annotatorId: "annotator-beta" }`
   - `finalLabel`: `{ expectedSurface, humanGate, completionLabel }`（裁决后地面真值）
   - `adjudication`: `"agree"` 或 `"architecture-owner:thomas-joshua:<surface>"`
3. 一致 → A 字段 === B 字段 === finalLabel 字段；`adjudication: "agree"`。
4. 分歧 → A 与 B 至少在 `expectedSurface` 上不同（预裁决冲突可见）；架构 Owner（Thomas Joshua）独立裁决后写入 `finalLabel` 与 `adjudication`。
5. 顶层 `expectedSurface` / `humanGate` / `completionLabel` 为 `finalLabel` 的便利镜像（schema/合同以 finalLabel 为准）。
6. Loom Owner `grok-bot` **不是**裁决人，不得自行改写地面真值。

### 双标注 schema（每行）

```json
{
  "annotationA": {
    "expectedSurface": "web_read|not_web_read|clarify",
    "humanGate": "yes|no",
    "completionLabel": "must_not_complete|not_applicable|should_complete",
    "annotatorId": "annotator-alpha"
  },
  "annotationB": { "...": "annotator-beta" },
  "finalLabel": {
    "expectedSurface": "...",
    "humanGate": "...",
    "completionLabel": "..."
  },
  "adjudication": "agree | architecture-owner:thomas-joshua:<surface>",
  "expectedDecisionClass": "web_read|not_web_read|clarify",
  "expectedReasonCodes": ["orch_*", "..."],
  "dispatchPath": "shadow_dispatch | pre_dispatch_rejection",
  "source": "synthetic | unit-fixture"
}
```

## 2. 构成核验

| 维度                                    | 目标     | 实测     |
| --------------------------------------- | -------- | -------- |
| 总行数                                  | 60       | 60       |
| `expectedSurface=web_read`              | 20       | 20       |
| `expectedSurface=not_web_read`          | 20       | 20       |
| `expectedSurface=clarify`               | 20       | 20       |
| `expectedDecisionClass` 同上            | 20/20/20 | 20/20/20 |
| `profile=A`                             | 30       | 30       |
| `profile=B`                             | 30       | 30       |
| A×web_read / A×not_web_read / A×clarify | 10/10/10 | 10/10/10 |
| B×web_read / B×not_web_read / B×clarify | 10/10/10 | 10/10/10 |

## 3. 分歧与裁决

| 项                  | 值                            |
| ------------------- | ----------------------------- |
| 分歧条数            | 10                            |
| 裁决人              | 架构 Owner · Thomas Joshua    |
| 裁决状态            | **全部已裁决**（无未决分歧）  |
| Loom Owner 是否裁决 | 否（`grok-bot` 仅材料 Owner） |

### 分歧表（A vs B vs final）

| id         | A.surface    | B.surface    | final.surface | adjudication                                    |
| ---------- | ------------ | ------------ | ------------- | ----------------------------------------------- |
| `wr-A-004` | clarify      | web_read     | web_read      | `architecture-owner:thomas-joshua:web_read`     |
| `wr-A-008` | not_web_read | web_read     | web_read      | `architecture-owner:thomas-joshua:web_read`     |
| `wr-B-004` | clarify      | web_read     | web_read      | `architecture-owner:thomas-joshua:web_read`     |
| `wr-A-014` | web_read     | not_web_read | not_web_read  | `architecture-owner:thomas-joshua:not_web_read` |
| `wr-A-019` | clarify      | not_web_read | not_web_read  | `architecture-owner:thomas-joshua:not_web_read` |
| `wr-B-014` | web_read     | not_web_read | not_web_read  | `architecture-owner:thomas-joshua:not_web_read` |
| `wr-A-022` | web_read     | clarify      | clarify       | `architecture-owner:thomas-joshua:clarify`      |
| `wr-A-026` | not_web_read | clarify      | clarify       | `architecture-owner:thomas-joshua:clarify`      |
| `wr-B-022` | web_read     | clarify      | clarify       | `architecture-owner:thomas-joshua:clarify`      |
| `wr-B-027` | not_web_read | clarify      | clarify       | `architecture-owner:thomas-joshua:clarify`      |

## 4. 决策类、dispatchPath 与 reason codes

- 已移除发明码 `WEB_READ_INTENT` / `NOT_WEB_READ` / `CLARIFY_AMBIGUOUS`
- `expectedDecisionClass` = `finalLabel.expectedSurface`
- `expectedReasonCodes` ⊆ `ALL_ORCH_REASON_CODES`（见 `src/task-orchestration/reason-codes.ts`）；允许 `[]`
- 非空 `expectedReasonCodes` 行数：60 / 60
- 每条含 `dispatchPath` ∈ {`shadow_dispatch`, `pre_dispatch_rejection`}

### dispatchPath 策略（本切片）

| expectedDecisionClass | dispatchPath             | `orch_shadow_observe` 要求                           |
| --------------------- | ------------------------ | ---------------------------------------------------- |
| `web_read`            | `shadow_dispatch`        | **必须**出现在 `expectedReasonCodes`                 |
| `not_web_read`        | `shadow_dispatch`        | **必须**出现在 `expectedReasonCodes`                 |
| `clarify`             | `pre_dispatch_rejection` | **不要求**；人闸澄清发生在 shadow dispatch 之前/之外 |

### shadow_dispatch 覆盖（reason-code 分母）

| 项                                                        | 值                                |
| --------------------------------------------------------- | --------------------------------- |
| `dispatchPath=shadow_dispatch` 条数                       | 40                                |
| 其中含 `orch_shadow_observe`                              | **40/40**                         |
| 组成                                                      | 20 `web_read` + 20 `not_web_read` |
| `dispatchPath=pre_dispatch_rejection`（clarify 队列）条数 | 20                                |

> **一致性门**：`shadow_dispatch` 缺 `orch_shadow_observe` → FAIL。`pre_dispatch_rejection` **永不**并入 shadow_dispatch reason-code 覆盖分母（见 `eval-contract.md` §3.1）。

### 覆盖计数脚本片段（可选核验）

```python
import json
from pathlib import Path
rows = [json.loads(l) for l in Path("annotated-cases.jsonl").read_text().splitlines() if l.strip()]
sd = [r for r in rows if r["dispatchPath"] == "shadow_dispatch"]
obs = sum(1 for r in sd if "orch_shadow_observe" in r["expectedReasonCodes"])
pre = sum(1 for r in rows if r["dispatchPath"] == "pre_dispatch_rejection")
assert obs == len(sd) == 40 and pre == 20
print(f"shadow_dispatch orch_shadow_observe {obs}/{len(sd)}; pre_dispatch_rejection {pre}")
```

### 使用频次（非绑定参考）

| code                    | 出现行数 |
| ----------------------- | -------- |
| `orch_shadow_observe`   | 40       |
| `orch_human_gate`       | 41       |
| `orch_ladder_web_read`  | 20       |
| `orch_ladder_connector` | 6        |
| `orch_ladder_node_exec` | 5        |
| `orch_ladder_node_fs`   | 5        |
| `orch_ladder_browser`   | 2        |
| `orch_ladder_memory`    | 1        |
| `orch_ladder_skill`     | 1        |

## 5. 来源与证据声明（最终）

**无真实生产回放证据；原 prod-replay 标签已降级为 synthetic，伪造 restricted evidence 已删除。**

- 公开 `utterance` 已去真实邮箱、电话、租户 id、带密钥 URL。
- 占位符：`TENANT_X`、`USER_N`、`TASK_42`、`example.com` / `example.org` / `example.invalid`。
- 不存在 `corpus/.restricted-evidence/`；不存在 `sourceEvidenceId` / `sourceDigest` / `redactionMethod` 字段。
- 原 24 条 `source: prod-replay` 已全部改为 `source: synthetic`（本地伪造 vault，非生产回放）。

### 来源混合（最终）

| source       | 条数            |
| ------------ | --------------- |
| synthetic    | 48              |
| unit-fixture | 12              |
| prod-replay  | **0**（已降级） |

## 6. 标签直觉（非硬门）

- `clarify` 多数：`humanGate=yes`，`completionLabel=not_applicable`；`dispatchPath=pre_dispatch_rejection`
- `not_web_read` 多数：`completionLabel=must_not_complete`（相对 web_read 完成语义）；`dispatchPath=shadow_dispatch`
- `web_read` v1 影子：通常 `must_not_complete`（不执行工具、不写 ledger）；`dispatchPath=shadow_dispatch`
- 少数 `web_read` 标 `humanGate=yes`（企业/隐私边界需人确认）
- **无** `should_complete` 正例 → 完成评估采用 Option B（见 `adr-completion-evaluation.md`）

— 材料整理：Agent: grok-bot · 裁决：architecture-owner thomas-joshua

## 7. Tenant 结论

**tenant binding echo property PASS；runtime cross-tenant isolation 未测试。**
