# P1 规范性 JSON 输入／输出样例（规格已同步；信封仅用于测试夹具）

- 状态：与 `contracts-and-merge-semantics.md`、`p1-validation-test-matrix.md` 具有同等规范效力。七组样例内容在安全整数修订后保持不变（均使用安全整数字面量 `24000` 等；不含 `NaN` / `Infinity`）。
- 本文件是可审阅的源，其中的 JSON 围栏必须与同目录 `samples/` 下对应文件**逐字节一致**（含缩进与结尾换行）。
- 每组样例把**模型提案**（`proposal`）和**可信宿主事实**（`host`）分开，以便测试把信封映射为 `validateRuntimeRuleProposal(proposal, hostFacts)` 的两个参数。该信封不是外部授权接口。宿主一律带 `fixture=true`；`fixture` 只是测试标记，不得作为身份或授权凭证。其中的值是测试夹具，不是生产配置读数。P1 不读生产配置。
- 每组输出都是完整校验结果：`resultKind`、`activationAllowed`（P1 恒为 `false`）、`authorizationAssessment`、`reasons`，批量时还有逐项 `items`。
- 结果中不得出现 `registrationReceipt`、`storageId` 或已退役种类 `candidate_recorded`，也不得把 `activationAllowed` 写成 `true`。
- 盘点 / 行号基线 SHA：`9b65109f41dee30b892a6faff493e46e735cab8d`。提案里的 `implementationVersion` 只是夹具绑定，不是兼容性证明。
- 时间：2026-11-12（Asia/Shanghai）

## 稳定 ID 与顶层结果

| ID        | 文件前缀                             | 场景                              | 顶层 `resultKind`     | `activationAllowed` | `authorizationAssessment` |
| --------- | ------------------------------------ | --------------------------------- | --------------------- | ------------------- | ------------------------- |
| S-JSON-01 | `01-legal-tighten`                   | 合法收紧，宿主评估已授权          | `shadow_accepted`     | `false`             | `host_authorized`         |
| S-JSON-02 | `02-unauthorized-shadow-legal`       | 未授权但影子合法                  | `shadow_accepted`     | `false`             | `host_unauthorized`       |
| S-JSON-03 | `03-unknown-rule-missing-host-facts` | 未知规则 + 缺宿主事实             | `blocked`             | `false`             | `assessment_unavailable`  |
| S-JSON-04 | `04-cancelled-missing-compatibility` | 已取消 + 缺兼容记录               | `blocked`             | `false`             | `host_unauthorized`       |
| S-JSON-05 | `05-forged-authorization-field`      | 提案携带伪造授权字段              | `blocked`             | `false`             | `host_unauthorized`       |
| S-JSON-06 | `06-batch-conflict`                  | 批量冲突（重复字段 + 缺兼容记录） | `blocked`             | `false`             | `host_unauthorized`       |
| S-JSON-07 | `07-rule-candidate-validated`        | 新规则候选校验，不声称已登记      | `candidate_validated` | `false`             | `assessment_unavailable`  |

机器可读文件：

```text
.kiro/specs/runtime-rule-adaptation/samples/
├─ 01-legal-tighten.input.json
├─ 01-legal-tighten.output.json
├─ 02-unauthorized-shadow-legal.input.json
├─ 02-unauthorized-shadow-legal.output.json
├─ 03-unknown-rule-missing-host-facts.input.json
├─ 03-unknown-rule-missing-host-facts.output.json
├─ 04-cancelled-missing-compatibility.input.json
├─ 04-cancelled-missing-compatibility.output.json
├─ 05-forged-authorization-field.input.json
├─ 05-forged-authorization-field.output.json
├─ 06-batch-conflict.input.json
├─ 06-batch-conflict.output.json
├─ 07-rule-candidate-validated.input.json
└─ 07-rule-candidate-validated.output.json
```

类型化实现必须以这些文件为测试输入／期望输出；测试断言以稳定 `code` / `path`、结果种类、`activationAllowed` 与 `authorizationAssessment` 为核心，不得把 `message` 文案当作业务判定依据。`NaN` 与 `Infinity` 不写入本目录 JSON 文件，只在程序调用测试中覆盖。

## S-JSON-01 合法收紧（宿主评估为已授权，但 activationAllowed 仍为 false）

个人字段从夹具当前有效值 32000 收紧到 24000。提案不含禁止字段。宿主明确 authorized。顶层 shadow_accepted；activationAllowed 必须是 false；authorizationAssessment=host_authorized。这不是 P1 激活许可。

对应文件：`samples/01-legal-tighten.input.json` 与 `samples/01-legal-tighten.output.json`。

### 输入

```json
{
  "proposal": {
    "kind": "policy_proposal",
    "scope": {
      "type": "personal",
      "id": "agent:fixture-personal-1"
    },
    "implementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
    "expectedPolicyVersion": {
      "policyHash": "fixture-policy-hash-aaaa",
      "protocolVersion": "1.1",
      "compilerRevision": "1.2.0"
    },
    "items": [
      {
        "ruleId": "model.context_window.guard",
        "field": "agents.defaults.contextTokens",
        "action": "tune",
        "proposedValue": 24000
      }
    ]
  },
  "host": {
    "fixture": true,
    "identity": {
      "principalType": "personal",
      "principalId": "user:fixture-1",
      "scope": {
        "type": "personal",
        "id": "agent:fixture-personal-1"
      }
    },
    "currentEffectiveValues": {
      "agents.defaults.contextTokens": 32000
    },
    "authorizationStatus": "authorized",
    "compatibilityRecord": {
      "status": "approved_compatible",
      "boundImplementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
      "boundExpectedPolicyVersion": {
        "policyHash": "fixture-policy-hash-aaaa",
        "protocolVersion": "1.1",
        "compilerRevision": "1.2.0"
      }
    },
    "expectedPolicyState": "active"
  }
}
```

### 输出

```json
{
  "resultKind": "shadow_accepted",
  "activationAllowed": false,
  "authorizationAssessment": "host_authorized",
  "reasons": [
    {
      "code": "shadow_legal",
      "message": "Proposed value 24000 is a legal tightening of currentEffectiveValue 32000 under hardMin 16000. P1 does not activate; activationAllowed remains false.",
      "path": "proposal.items[0]"
    }
  ],
  "items": [
    {
      "ruleId": "model.context_window.guard",
      "field": "agents.defaults.contextTokens",
      "resultKind": "shadow_accepted",
      "reasons": [
        {
          "code": "shadow_legal",
          "message": "Proposed value 24000 is a legal tightening of currentEffectiveValue 32000 under hardMin 16000. P1 does not activate; activationAllowed remains false.",
          "path": "proposal.items[0]"
        }
      ]
    }
  ]
}
```

## S-JSON-02 未授权但影子合法

与 S-JSON-01 相同的干净提案。宿主明确 unauthorized。顶层 shadow_accepted；activationAllowed=false；authorizationAssessment=host_unauthorized。

对应文件：`samples/02-unauthorized-shadow-legal.input.json` 与 `samples/02-unauthorized-shadow-legal.output.json`。

### 输入

```json
{
  "proposal": {
    "kind": "policy_proposal",
    "scope": {
      "type": "personal",
      "id": "agent:fixture-personal-1"
    },
    "implementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
    "expectedPolicyVersion": {
      "policyHash": "fixture-policy-hash-aaaa",
      "protocolVersion": "1.1",
      "compilerRevision": "1.2.0"
    },
    "items": [
      {
        "ruleId": "model.context_window.guard",
        "field": "agents.defaults.contextTokens",
        "action": "tune",
        "proposedValue": 24000
      }
    ]
  },
  "host": {
    "fixture": true,
    "identity": {
      "principalType": "personal",
      "principalId": "user:fixture-1",
      "scope": {
        "type": "personal",
        "id": "agent:fixture-personal-1"
      }
    },
    "currentEffectiveValues": {
      "agents.defaults.contextTokens": 32000
    },
    "authorizationStatus": "unauthorized",
    "compatibilityRecord": {
      "status": "approved_compatible",
      "boundImplementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
      "boundExpectedPolicyVersion": {
        "policyHash": "fixture-policy-hash-aaaa",
        "protocolVersion": "1.1",
        "compilerRevision": "1.2.0"
      }
    },
    "expectedPolicyState": "active"
  }
}
```

### 输出

```json
{
  "resultKind": "shadow_accepted",
  "activationAllowed": false,
  "authorizationAssessment": "host_unauthorized",
  "reasons": [
    {
      "code": "shadow_legal",
      "message": "Proposed value 24000 is a legal tightening of currentEffectiveValue 32000 under hardMin 16000, but the host marks adjustment unauthorized. Shadow-legal only; P1 does not activate.",
      "path": "proposal.items[0]"
    }
  ],
  "items": [
    {
      "ruleId": "model.context_window.guard",
      "field": "agents.defaults.contextTokens",
      "resultKind": "shadow_accepted",
      "reasons": [
        {
          "code": "shadow_legal",
          "message": "Proposed value 24000 is a legal tightening of currentEffectiveValue 32000 under hardMin 16000, but the host marks adjustment unauthorized. Shadow-legal only; P1 does not activate.",
          "path": "proposal.items[0]"
        }
      ]
    }
  ]
}
```

## S-JSON-03 未知规则 + 缺宿主事实

提案绑定完整，规则 ID 为未知的 collab.policy.unknown。宿主省略当前有效值、授权状态、兼容性记录与 expectedPolicyState，只保留身份夹具。顶层必须是 blocked（首要原因 unknown_rule_id），不得为 needs_information。authorizationAssessment=assessment_unavailable，因为宿主省略了授权状态。

对应文件：`samples/03-unknown-rule-missing-host-facts.input.json` 与 `samples/03-unknown-rule-missing-host-facts.output.json`。

### 输入

```json
{
  "proposal": {
    "kind": "policy_proposal",
    "scope": {
      "type": "personal",
      "id": "agent:fixture-personal-1"
    },
    "implementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
    "expectedPolicyVersion": {
      "policyHash": "fixture-policy-hash-aaaa",
      "protocolVersion": "1.1",
      "compilerRevision": "1.2.0"
    },
    "items": [
      {
        "ruleId": "collab.policy.unknown",
        "field": "agents.defaults.contextTokens",
        "action": "tune",
        "proposedValue": 24000
      }
    ]
  },
  "host": {
    "fixture": true,
    "identity": {
      "principalType": "personal",
      "principalId": "user:fixture-1",
      "scope": {
        "type": "personal",
        "id": "agent:fixture-personal-1"
      }
    }
  }
}
```

### 输出

```json
{
  "resultKind": "blocked",
  "activationAllowed": false,
  "authorizationAssessment": "assessment_unavailable",
  "reasons": [
    {
      "code": "unknown_rule_id",
      "message": "Rule id 'collab.policy.unknown' is not in the known catalog. This is an independently decidable reject (unknown_rule_id). Missing host facts are not evaluated and must not produce needs_information.",
      "path": "proposal.items[0].ruleId"
    }
  ],
  "items": [
    {
      "ruleId": "collab.policy.unknown",
      "field": "agents.defaults.contextTokens",
      "resultKind": "blocked",
      "reasons": [
        {
          "code": "unknown_rule_id",
          "message": "Rule id 'collab.policy.unknown' is not in the known catalog. This is an independently decidable reject (unknown_rule_id). Missing host facts are not evaluated and must not produce needs_information.",
          "path": "proposal.items[0].ruleId"
        }
      ]
    }
  ]
}
```

## S-JSON-04 已取消 + 缺兼容记录

提案形态像 32000→24000 的合法收紧，绑定完整，无禁止字段。宿主给出 expectedPolicyState=cancelled，但省略 compatibilityRecord。顶层 blocked（cancelled_or_tombstone），不得为 needs_information。本夹具仍给出 unauthorized，故 authorizationAssessment=host_unauthorized。

对应文件：`samples/04-cancelled-missing-compatibility.input.json` 与 `samples/04-cancelled-missing-compatibility.output.json`。

### 输入

```json
{
  "proposal": {
    "kind": "policy_proposal",
    "scope": {
      "type": "personal",
      "id": "agent:fixture-personal-1"
    },
    "implementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
    "expectedPolicyVersion": {
      "policyHash": "fixture-policy-hash-aaaa",
      "protocolVersion": "1.1",
      "compilerRevision": "1.2.0"
    },
    "items": [
      {
        "ruleId": "model.context_window.guard",
        "field": "agents.defaults.contextTokens",
        "action": "tune",
        "proposedValue": 24000
      }
    ]
  },
  "host": {
    "fixture": true,
    "identity": {
      "principalType": "personal",
      "principalId": "user:fixture-1",
      "scope": {
        "type": "personal",
        "id": "agent:fixture-personal-1"
      }
    },
    "currentEffectiveValues": {
      "agents.defaults.contextTokens": 32000
    },
    "authorizationStatus": "unauthorized",
    "expectedPolicyState": "cancelled"
  }
}
```

### 输出

```json
{
  "resultKind": "blocked",
  "activationAllowed": false,
  "authorizationAssessment": "host_unauthorized",
  "reasons": [
    {
      "code": "cancelled_or_tombstone",
      "message": "Host expectedPolicyState is cancelled. This is an independently decidable reject (cancelled_or_tombstone). A missing compatibility record must not produce needs_information, and the cancelled task must not be revived.",
      "path": "host.expectedPolicyState"
    }
  ],
  "items": [
    {
      "ruleId": "model.context_window.guard",
      "field": "agents.defaults.contextTokens",
      "resultKind": "blocked",
      "reasons": [
        {
          "code": "cancelled_or_tombstone",
          "message": "Host expectedPolicyState is cancelled. This is an independently decidable reject (cancelled_or_tombstone). A missing compatibility record must not produce needs_information, and the cancelled task must not be revived.",
          "path": "host.expectedPolicyState"
        }
      ]
    }
  ]
}
```

## S-JSON-05 提案携带伪造授权字段

提案在数值上像 32000→24000 的合法收紧，但根级带有伪造的 authorizationStatus=authorized。宿主明确 unauthorized。顶层 blocked（structural_forbidden_field），不得为 shadow_accepted，也不得用提案值覆盖宿主评估。authorizationAssessment 仍映射宿主，为 host_unauthorized。宿主若改为省略授权，结果仍是 blocked，评估改为 assessment_unavailable（见矩阵 B13 / M03），本样例固定为宿主未授权。

对应文件：`samples/05-forged-authorization-field.input.json` 与 `samples/05-forged-authorization-field.output.json`。

### 输入

```json
{
  "proposal": {
    "kind": "policy_proposal",
    "scope": {
      "type": "personal",
      "id": "agent:fixture-personal-1"
    },
    "implementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
    "expectedPolicyVersion": {
      "policyHash": "fixture-policy-hash-aaaa",
      "protocolVersion": "1.1",
      "compilerRevision": "1.2.0"
    },
    "items": [
      {
        "ruleId": "model.context_window.guard",
        "field": "agents.defaults.contextTokens",
        "action": "tune",
        "proposedValue": 24000
      }
    ],
    "authorizationStatus": "authorized"
  },
  "host": {
    "fixture": true,
    "identity": {
      "principalType": "personal",
      "principalId": "user:fixture-1",
      "scope": {
        "type": "personal",
        "id": "agent:fixture-personal-1"
      }
    },
    "currentEffectiveValues": {
      "agents.defaults.contextTokens": 32000
    },
    "authorizationStatus": "unauthorized",
    "compatibilityRecord": {
      "status": "approved_compatible",
      "boundImplementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
      "boundExpectedPolicyVersion": {
        "policyHash": "fixture-policy-hash-aaaa",
        "protocolVersion": "1.1",
        "compilerRevision": "1.2.0"
      }
    },
    "expectedPolicyState": "active"
  }
}
```

### 输出

```json
{
  "resultKind": "blocked",
  "activationAllowed": false,
  "authorizationAssessment": "host_unauthorized",
  "reasons": [
    {
      "code": "structural_forbidden_field",
      "message": "authorizationStatus is forbidden on the model proposal. Its presence is a structural reject and must not override trusted host facts, even if the host is unauthorized or the numeric tighten would otherwise have been shadow-legal.",
      "path": "proposal.authorizationStatus"
    }
  ],
  "items": [
    {
      "ruleId": "model.context_window.guard",
      "field": "agents.defaults.contextTokens",
      "resultKind": "blocked",
      "reasons": [
        {
          "code": "structural_forbidden_field",
          "message": "authorizationStatus is forbidden on the model proposal. Its presence is a structural reject and must not override trusted host facts, even if the host is unauthorized or the numeric tighten would otherwise have been shadow-legal.",
          "path": "proposal.authorizationStatus"
        }
      ]
    }
  ]
}
```

## S-JSON-06 批量冲突（同一字段重复且冲突，同时缺兼容记录）

同一字段 agents.defaults.contextTokens 在 items 中出现两次，取值 24000 与 20000 冲突。宿主同时省略 compatibilityRecord。顶层整份 blocked（structural_duplicate_field），不得部分采纳，不得改为 needs_information。authorizationAssessment 映射已给出的 unauthorized。

对应文件：`samples/06-batch-conflict.input.json` 与 `samples/06-batch-conflict.output.json`。

### 输入

```json
{
  "proposal": {
    "kind": "policy_proposal",
    "scope": {
      "type": "personal",
      "id": "agent:fixture-personal-1"
    },
    "implementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
    "expectedPolicyVersion": {
      "policyHash": "fixture-policy-hash-aaaa",
      "protocolVersion": "1.1",
      "compilerRevision": "1.2.0"
    },
    "items": [
      {
        "ruleId": "model.context_window.guard",
        "field": "agents.defaults.contextTokens",
        "action": "tune",
        "proposedValue": 24000
      },
      {
        "ruleId": "model.context_window.guard",
        "field": "agents.defaults.contextTokens",
        "action": "tune",
        "proposedValue": 20000
      }
    ]
  },
  "host": {
    "fixture": true,
    "identity": {
      "principalType": "personal",
      "principalId": "user:fixture-1",
      "scope": {
        "type": "personal",
        "id": "agent:fixture-personal-1"
      }
    },
    "currentEffectiveValues": {
      "agents.defaults.contextTokens": 32000
    },
    "authorizationStatus": "unauthorized",
    "expectedPolicyState": "active"
  }
}
```

### 输出

```json
{
  "resultKind": "blocked",
  "activationAllowed": false,
  "authorizationAssessment": "host_unauthorized",
  "reasons": [
    {
      "code": "structural_duplicate_field",
      "message": "Field agents.defaults.contextTokens is repeated in proposal.items with conflicting values 24000 and 20000. The whole proposal is blocked (structural_duplicate_field). A missing host compatibility record is not evaluated and must not produce needs_information. Partial adoption is forbidden.",
      "path": "proposal.items"
    }
  ],
  "items": [
    {
      "ruleId": "model.context_window.guard",
      "field": "agents.defaults.contextTokens",
      "resultKind": "blocked",
      "reasons": [
        {
          "code": "structural_duplicate_field",
          "message": "Whole-proposal reject because this field is repeated with a conflicting value; item 0 proposedValue=24000 is not adopted.",
          "path": "proposal.items[0]"
        }
      ]
    },
    {
      "ruleId": "model.context_window.guard",
      "field": "agents.defaults.contextTokens",
      "resultKind": "blocked",
      "reasons": [
        {
          "code": "structural_duplicate_field",
          "message": "Whole-proposal reject because this field is repeated with a conflicting value; item 1 proposedValue=20000 is not adopted.",
          "path": "proposal.items[1]"
        }
      ]
    }
  ]
}
```

## S-JSON-07 新规则候选校验，不声称已登记

干净的 rule_candidate，只含允许键，不含 registerNow / compileNow / activateNow 或其他禁止字段。宿主只提供匹配的身份与作用域夹具。顶层 candidate_validated；activationAllowed=false；authorizationAssessment=assessment_unavailable（本输入不要求授权状态）。结果不得包含 registrationReceipt、storageId 或“已登记”措辞。

对应文件：`samples/07-rule-candidate-validated.input.json` 与 `samples/07-rule-candidate-validated.output.json`。

### 输入

```json
{
  "proposal": {
    "kind": "rule_candidate",
    "scope": {
      "type": "personal",
      "id": "agent:fixture-personal-1"
    },
    "implementationVersion": "9b65109f41dee30b892a6faff493e46e735cab8d",
    "candidate": {
      "proposedRuleId": "diag.paused_job.watch.candidate",
      "summary": "Fixture candidate: propose declaring an isolated paused-job watch rule. Not a production rule and not in the catalog.",
      "body": "Validate-only fixture body. The P1 validator must not persist or register this candidate."
    }
  },
  "host": {
    "fixture": true,
    "identity": {
      "principalType": "personal",
      "principalId": "user:fixture-1",
      "scope": {
        "type": "personal",
        "id": "agent:fixture-personal-1"
      }
    }
  }
}
```

### 输出

```json
{
  "resultKind": "candidate_validated",
  "activationAllowed": false,
  "authorizationAssessment": "assessment_unavailable",
  "reasons": [
    {
      "code": "candidate_validated",
      "message": "The rule_candidate payload is structurally valid under the candidate schema. This result means candidate_validated only: the P1 validator does not register, persist, or assign a storage id, and this object is not a registration receipt.",
      "path": "proposal.candidate"
    }
  ],
  "items": [
    {
      "proposedRuleId": "diag.paused_job.watch.candidate",
      "resultKind": "candidate_validated",
      "reasons": [
        {
          "code": "candidate_validated",
          "message": "The rule_candidate payload is structurally valid under the candidate schema. This result means candidate_validated only: the P1 validator does not register, persist, or assign a storage id, and this object is not a registration receipt.",
          "path": "proposal.candidate"
        }
      ]
    }
  ]
}
```
