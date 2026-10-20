# enterprise-pricing-ui-optimization

| Owner               | Task                                 | Role        |
| ------------------- | ------------------------------------ | ----------- |
| **kiro-pricing-ui** | `enterprise-pricing-ui-optimization` | implementer |
| **grok-pricing**    | `enterprise-pricing-ui-optimization` | implementer |

## Agents

- **grok-pricing** (2026-07-19): unify platform/enterprise/web pricing copy (基础/专业/高级 AI), structured AI quotas + compare group, cost-budget store status machine & retry isolation.

## Checklist

- [x] 公共定价页 CTA（拆分 readOnly vs showCta） — kiro-pricing-ui
- [x] 响应式网格断点与最小宽度 — kiro-pricing-ui
- [x] 卡片信息层级（5–6 行核心规格 + Credits/授权） — kiro-pricing-ui
- [x] CTA 底部对齐、去掉 card-foot — kiro-pricing-ui
- [x] 视觉语言统一（推荐/企业卡） — kiro-pricing-ui
- [x] 周期切换器 aria-pressed — kiro-pricing-ui
- [x] 价格语义（折合每月 / 周期节省） — kiro-pricing-ui
- [x] 对比表 displayName 与可访问性 — kiro-pricing-ui
- [x] 定向测试全绿 — kiro-pricing-ui
- [x] Container query 网格（替代 viewport 五列）+ 窄宿主覆盖 — kiro-pricing-ui
- [x] 周期总价与折合月价同源一致 + 自定义周期价回归 — kiro-pricing-ui
- [x] 公共 CTA pathForTab / basePath 兼容 — kiro-pricing-ui
- [x] Chromium 布局测试（五视口 + 宽视口窄容器 overflow/CTA/图标）— kiro-pricing-ui
- [x] 截图脚本对齐 view-model（enterprise 无 Credits、图标 stroke、窄宿主）— kiro-pricing-ui
- [x] 删除 public-legal viewport 3/5 列覆盖，公共页完全走 container query — kiro-pricing-ui
- [x] 布局测试挂载 public-legal\_\_pricing-frame / cost-budget / auth-home — kiro-pricing-ui
- [x] 修正 .pricing-v3\_\_spec-item 溢出断言；my-plan 文案「治理 / SLA」— kiro-pricing-ui
