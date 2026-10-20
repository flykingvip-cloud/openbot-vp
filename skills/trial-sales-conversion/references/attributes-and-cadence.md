# trial-sales-conversion — 属性面与生命周期节拍

## 1. `enterprise.customer-attributes.get` 响应摘要

```ts
{
  attributes: {
    schemaVersion: 1,
    generatedAt: string,
    enterprise: {
      id, name, slug, status, plan, createdSource, creationMode?,
      lifecycleStage?, billingStatus, seatQuota, seatUsed,
      trial: {
        startedAt?, endsAt?, expiredAt?, daysSnapshot?,
        daysRemaining: number | null,
        allowReadOnlyAfterExpiry?
      },
      upgradeUrl?, contactAdvisorUrl?
    },
    contact?: {
      email?, displayName?, membershipRole?, userStatus?,
      emailDomain?, emailKind?: "free" | "enterprise" | "unknown",
      activated?: boolean
    },
    application?: {
      id, mode, highIntentLead, reviewReasons[],
      expectedUsers, useCase, companySize?, industry?,
      needsDemo, status
    },
    segmentHints: string[]  // 软标签，可忽略或再推导
  }
}
```

### segmentHints 常用前缀

| 前缀                                          | 含义                               |
| --------------------------------------------- | ---------------------------------- |
| `status:`                                     | trial / paid / expired / suspended |
| `source:`                                     | self-service / platform-created    |
| `email:free` / `email:enterprise`             | 联系人邮箱类型                     |
| `team:small` / `mid` / `large`                | 人数或席位粗分档                   |
| `apply_mode:`                                 | auto / auto_with_sales / manual    |
| `intent:high`                                 | highIntentLead                     |
| `needs_demo`                                  | 需要演示                           |
| `trial_window:early\|mid\|late\|due\|expired` | 试用窗口                           |
| `review:*`                                    | 人工审核原因码                     |
| `industry:*`                                  | 行业（小写）                       |

---

## 2. 默认 segment 映射（可配置覆盖）

```text
IF apply_mode=manual OR team:large OR expectedUsers>50 OR review:large_account_name
  → segment=enterprise, priority=P1
ELSE IF apply_mode=auto_with_sales OR needs_demo OR team:mid
  → segment=mid_market, priority=P2
ELSE IF team:small AND email:enterprise AND apply_mode=auto
  → segment=smb, priority=P3
ELSE
  → segment=mid_market, priority=P2   # 保守默认
```

运营租户配置示例（本租户知识/配置文件，非平台强制）：

```json
{
  "segmentOwners": {
    "smb": { "agentId": "sales-smb", "seatId": "seat-sales-smb" },
    "mid_market": { "agentId": "sales-mid", "seatId": "seat-sales-mid" },
    "enterprise": {
      "agentId": "sales-enterprise",
      "seatId": "seat-sales-ent",
      "escalateHuman": true
    }
  }
}
```

---

## 3. 生命周期节点判定

设 `D = attributes.enterprise.trial.daysRemaining`，`A = attributes.contact.activated`。

| 节点 ID               | 判定                                       | 建议主题                          |
| --------------------- | ------------------------------------------ | --------------------------------- |
| `t0_welcome`          | 线索首次进入跟进队列                       | 欢迎 + 如何激活/登录              |
| `nudge_activate`      | `A === false`                              | 催激活（引导邮件/支持，不伪造码） |
| `t1_onboard`          | `A === true` 且 申请后 1–2 天内            | 组织/第一个能力                   |
| `t_minus_3`           | `status=trial` 且 `D ∈ {2,3}`              | 将到期 + 价值/升级                |
| `t_minus_1`           | `status=trial` 且 `D === 1`                | 二次提醒                          |
| `t_zero`              | `D !== null && D <= 0` 或 `status=expired` | 到期说明 + 升级/顾问              |
| `activation_expiring` | 未激活且激活码临期（若属性可得）           | 催激活                            |

同一 `enterpriseId + 节点 ID` 默认只执行一次（幂等），除非运营策略允许重试。

---

## 4. 邮件内容清单（模板要素）

每封外发至少包含：

- 企业名 `enterprise.name`
- 联系人称呼 `contact.displayName` 或邮箱本地部分
- 若试用中：剩余天数 `trial.daysRemaining`、结束日 `trial.endsAt`
- 行动链接：biz 登录/激活（深链由平台邮件体系提供时引用，勿编造激活码）
- 升级/顾问：`upgradeUrl` / `contactAdvisorUrl`（缺失则写「联系顾问」通用文案，不编造 URL）

**禁止：** 假装已开通付费、承诺未授权折扣、索要密码。

---

## 5. 审计字段（运营租户）

建议每条动作记录：

```text
at, enterpriseId, enterpriseName, segment, priority,
nodeId, ownerAgentId, channel=email|task|human,
subject, result=sent|skipped|failed, error?
```

不写客户租户 `control-plane`。

---

## 6. 与平台事件的关系（可选）

若平台后续提供通用事件，可订阅：

- `trial.lead_created`
- `trial.activated`
- `trial.expiring` / `trial.expired`

本 skill **不依赖**事件即可工作（轮询 attributes 亦可）。事件仅用于降低延迟。
