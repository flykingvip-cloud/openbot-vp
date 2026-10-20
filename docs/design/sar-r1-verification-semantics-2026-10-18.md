# SAR R1 业务验证状态与人工验证入口

- 状态：整改说明。不是真实站点验收，也不把双中心写成已验证的真实企业连接。
- 日期：2026-10-18
- 路径：Path C。不建 Bridge，不导出 Cookie，不分叉 OpenCLI，不新建第三中心。
- 范围：只做 R1。不做 R2 真浏览器、R3 skill-lifecycle 持久化、R4 写账本分区、R5 外站真岗位。

## 问题

P0–P4 的受控组件和夹具可以保留。专家闸门不接受把它们当成整体通过。

运行时把「输出完整」写成了「业务验证通过」：

`completeness === "complete"` 时，`SiteRunResult.verification` 被标成 `passed`。

人工验证入口又优先抄 `humanVerdict`。失败或 unknown 的运行，只要写了 `humanVerdict: passed`，就能变成可接受记录，再被学习环推进成已验证可调用。

`completeness` 和 `verification` 不是同一件事。

## 语义

| 字段           | 含义                                       | 谁来写                                                          |
| -------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `status`       | 这次运行是 succeeded、failed，还是 unknown | 执行结果                                                        |
| `completeness` | 输出是完整还是被条数预算截断               | 执行结果                                                        |
| `verification` | 业务结果有没有经过验证器                   | 默认 `not_performed`；只有验证器明确返回 `passed` 才是 `passed` |

没有验证器时，完整成功仍是 `not_performed`。unknown 不能被验证器改成 `passed`。失败运行也不能被验证器改成 `passed`。

空集合成功只看运行是否干净地完成，不再要求 `verification === "passed"`。验证器判定失败的空结果不是空成功。

## 人工入口

`ThinValidationRunner` 在记下结论之前，同时核对：

- 运行的能力 id、版本、状态
- 证据引用、runId、制品摘要与存储的证据一致
- 证据上的状态、验证、完整性与这次运行一致

人工 `passed` 只有在运行 `succeeded`、没有 error、且这次运行的 `verification` 不是 `failed` 时，才是可晋升记录。

失败、unknown，或验证器已经判定失败的运行：

- 只有 `humanVerdict: passed`：拒绝，不落记录
- 另交独立回查证据（`independentReviewEvidence`：单独的证据引用、说明、制品摘要）：可以落审计记录，`promotable` 仍为假

独立证据的引用不能等于这次运行自己的 `evidenceRef`，制品摘要必须等于候选制品。它不能代替可晋升。

## 学习环与已验证可调用

非空、完整、未被验证器拒绝的成功，可以生成私有草稿。草稿上的 `verification` 照抄运行结果，不再写死 `passed`。

接受路径只接收可晋升记录：结论为通过、`promotable` 为真、运行状态为 succeeded、运行验证不是 failed、没有独立回查例外、且参数没有参与草稿生成。

因此下面这些都不能变成已验证可调用：

- 失败
- unknown
- 只有 `completeness === "complete"`、没有验证器
- 真值对不上的业务结果
- 只写了 `humanVerdict: passed` 的失败或 unknown

真实验证器可以通过。留出参数上的真值相等，或一次已经成功的人工核对，仍然可以把该版本接受为可调用。接受之后，下一次没有验证器的调用仍是 `verification: not_performed`；目录上的 `passed` 来自那条验证记录，不来自完整性。

能力中心安装投影使用同一条阻断层。失败、unknown、不可晋升、或带独立回查例外的记录不能显示成已验证，也不能变成可执行。这不表示已经接上真实企业连接。正式执行接入仍暂缓。

## 明确不做

- R2：真浏览器会话
- R3：skill-lifecycle 持久化
- R4：写账本分区
- R5：外站真岗位
- 把 E0–E5 文档改成「已验证真实连接」
