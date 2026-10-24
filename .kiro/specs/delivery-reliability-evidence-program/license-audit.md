# 许可与权属审计执行方案

本工作包输出事实清单与待决问题，不替代法律意见。本轮不更换 LICENSE、不删除上游声明、不追溯修改历史版本，也不预设任何模块已经具备独占许可条件。

## 范围与复用

以 WP-00 的当前 SHA、锁文件和发布形态冻结范围。复用 `sbom/openbot.cdx.json` 与 `scripts/generate-cyclonedx-sbom.ts`，先核对其时间、工具身份、锁文件与组件覆盖；存在 SBOM 不等于完成许可或权属审计。

范围包括核心 TypeScript、packages、extensions、插件 SDK、skills、移动/桌面代码、Python、原生/系统依赖、vendored 源码、字体/图片/音频/模型数据、补丁、构建/安装器及分发镜像。已有 SBOM 若只覆盖 JS，不得据此标记其他生态已审计。

需分别定义 npm 包、源码仓库、容器镜像、桌面/移动应用和托管服务的实际发布内容。未跟踪的本机工具目录不自动作为发布内容，但应核验是否进入构建上下文或镜像。

## 审计步骤

1. 列出全部实际分发文件与组件；区分 runtime/dev/build-only，同时确认构建工具是否被打包。
2. 收集许可证原文、SPDX 标识、copyright/NOTICE、版本和校验和；清单字段不能只有扫描器推测。
3. 对自有/继承/外部贡献/来源不明源文件做来源映射：首次引入提交、上游路径和版本、修改历史、补丁来源及授权证据。
4. 核验员工/承包商/贡献者协议；git author、仓库 owner、提交 trailers 只用于定位，不作为版权转让证明。找不到授权材料标 unknown，不推定可重许可。
5. 检查嵌套许可、双许可、例外条款、素材限制和缺失声明；自动扫描结果人工抽核，高风险/不明项逐项复核。
6. 按发布形态整理应履行事项及证据，形成缺口修复建议；法律解释与兼容性结论交授权顾问确认。
7. 输出可供决策的边界选项：保持当前许可、仅未来权属完整的新增模块另行许可、符合条件的双许可/商业模块、独立服务商业化。每项列明前提、生态影响、技术边界和未知项，不做未经核实的可行性保证。

## 输出格式

执行时生成以下材料，不在计划阶段填造结果：

- `license-inventory.csv`：artifact/path、component、version、purl、ecosystem、origin、licenseExpression、licenseTextRef、copyright、distributionForms、runtimeBundled、evidenceRef、reviewStatus。
- `source-provenance.csv`：path/range、upstreamRef/commit、firstImportCommit、modificationRefs、rightsBasis、contributorAuthorizationRef、status、reviewer。
- `license-findings.csv`：findingId、severity/priority、scope、evidence、uncertainty、proposedRemediation、owner、dueGate、legalReviewRequired。
- `distribution-obligations.md`：各发布物的实际范围、待确认义务、当前声明证据、缺口和顾问结论位置。
- `licensing-options.md`：未来许可策略选项、模块边界、需要补齐的权利及治理事项、商业与生态取舍。
- `audit-method.md`：扫描工具及版本、命令/退出码、排除规则、覆盖率分母、SBOM 与锁文件对应、人工复核样本及未覆盖范围。

权利状态仅用 `VERIFIED / NEEDS_REVIEW / UNKNOWN / CONFLICT`，不要混用“MIT”与“自有产权完整”。法律材料包含隐私时仅保存受控引用，不将合同原件或个人信息放入公开仓库。

## 完成门槛 GL

- 每个实际发布范围都有清单或明确未覆盖说明，所有 unknown/conflict 有负责人和处置计划。
- 自有、继承、第三方和来源未知部分可区分，既有声明保留情况有证据。
- 技术扫描与法律结论分栏；无顾问确认的事项不得标为“可取消 MIT/可独占”。
- 许可变更另立决策与实施 PR；顾问、产品及发布负责人审核后才更新未来版本许可政策。
- 不以主线工程完成为由阻塞全部审计；对有明确风险的发布物设置精准门槛，不把所有历史未知无限扩大为整仓停工。
