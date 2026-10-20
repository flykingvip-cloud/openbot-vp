# SAR P2 学习闭环

- 状态：实现说明。不是真实站点生产能力，也不自动发布能力。
- 日期：2026-10-17
- 路径：Path C。复用 P0 账户浏览器、有限操作和 P1 `site_list` / `site_describe` / `site_invoke`。不建 Bridge，不导出 Cookie，不分叉 OpenCLI，不执行未隔离的生成式 JS。

## 证据到私有草稿

探索只有在非空、完整、已通过的成功证据上才能生成草稿。合法空结果不是草稿证据。

草稿计划只含 `navigate` / `read_page` / `request_context` / `capture_result`。脚本字段在生成前被拒绝。草稿生命周期是技能契约里的 `private`，`enabled` 为假，`published` 保持假。候选不会出现在 `site_list`，`site_invoke` 返回未授权。即使误把该版本登记并授权，`private` 仍然不可调用。

## 薄验证记录

`ThinValidationRunner` 只保存结构化记录：能力版本、制品摘要、输入是否参与过草稿生成、测试站真值或人工核验依据、runId、证据引用、输出、完整性、通过或失败、审核者、时间、原因。

测试站依据用输出与给定真值的相等判断。人工依据原样记录结论，不另做评分。没有规则语言、权重或自动评分平台。

人工接受要求一条**未参与生成**且结论为通过的记录。只勾选接受、或只用生成时的参数 A 通过，都不会把能力标成已验证。

## 接受后启用

接受把该版本的生命周期写成 `approved`，并只授予探索时的那一个账户绑定。`site_invoke` 这之后才能调用。接受不把生命周期写成 `published`。

可控站的 notes 读取不是 P1 预装能力。任务 A 用 `alpha`，留出参数 B 用 `beta`。B 通过真值核对并被人工接受后，`site_invoke` 可以再次读出 B，也可以再读 A。

## 失败分类

分类：`auth` / `infrastructure` / `params` / `policy` / `risk-control` / `structure-change` / `validation-failed` / `unknown`。

结构变化和验证失败可以复制一个新的私有候选版本，计划字节不变，原版本和证据保留。其余类别只给建议。所有路径都是 `autoPublished: false`，不扩大授权，不换账户，不放宽夹具，不因为空结果改计划。`SiteRunResult.repair` 仍是 `none`。
