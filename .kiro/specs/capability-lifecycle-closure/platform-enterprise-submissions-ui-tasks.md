# 平台「企业提交」审核 UI 补齐任务清单

## 背景

孵化中心「推荐上报平台」路径的服务端已落地（脱敏三步 → `submit-to-platform` → `platform-capability.*`），但平台端缺少审核操作 UI，导致规范主路径在 UI 层断裂。

## 目标

使 **孵化中心上报平台** 全链路可在 UI 内完成：

```
企业孵化中心「推荐上报平台」
  → sanitization-preview / confirm
  → enterprise-capability.submit-to-platform
  → 平台能力中心「企业提交」tab 审核
  → publish / reject / return / approve-enterprise-only
  → 分发配置（全租户可见）
  → 租户员工平台市场安装
```

## 任务

| ID  | 任务                                                   | 状态 |
| --- | ------------------------------------------------------ | ---- |
| T1  | 定义 `EnterpriseSubmission*` UI 类型                   | done |
| T2  | `render-actions` 接线 `platform-capability.*` 六个 RPC | done |
| T3  | 平台能力中心新增「企业提交」tab（列表 + 详情抽屉）     | done |
| T4  | 发布后引导打开分发配置                                 | done |
| T5  | 浏览器测试覆盖 tab 渲染与审核操作                      | done |

## 验收标准

1. 平台能力中心可见「企业提交」tab，展示 `pending-review` 计数。
2. 列表可加载 `platform-capability.enterprise-submissions` 返回的提交记录。
3. 点击提交可查看 `review-enterprise-submission` 详情（脱敏 findings、artifactHash）。
4. 待审提交可执行：发布到平台 / 仅企业内 / 退回修改 / 拒绝。
5. 发布成功后提示并引导配置分发范围（默认仅提交企业，需扩全租户）。
6. 企业端 `platform-submissions` 追踪状态与平台操作结果一致。

## 不在本次范围

- 脱敏 preview/confirm UI 改造（企业端已有）
- 批量审批
- 将路径 B（员工 submit-to-enterprise → 待审阅）与路径 A 合并为单一入口
