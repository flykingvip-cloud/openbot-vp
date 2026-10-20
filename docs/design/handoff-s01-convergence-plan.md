> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# Handoff S01 规范收敛计划

> **收敛目标**: 将 R1-R8 修订内容合并回主设计文档，消除双重规范  
> **收敛日期**: 2026-08-29  
> **负责人**: kiro-daibai  
> **状态**: 进行中

---

## 评审结论摘要

**决策**: R1-R8 修订方向有条件接受，但需要规范收敛

**关键问题**:

1. 🔴 P0: 主规范仍保留旧的匿名访问语义（D1/D4/D5）
2. 🔴 P0: ACL/Ownership 修订没有成为主授权模型（D2/D4/评审指南）
3. 🟡 P1: Trusted Proxy 主契约仍只有 IP 白名单（D1）
4. 🟢 P2: R6 不是实际的机器验收脚本（需实现）
5. 🟢 P2: R7 文档清单包含错误文件名（需修正）
6. 🟢 P2: 修订文件未进入 Git 基线（需落地）
7. 🟢 P2: 修订附件没有被主文档规范性引用（需合并）

---

## 收敛任务清单

### Phase 1: 主文档规范收敛（P0）

#### 任务 1.1: D1 收敛 - Anonymous Local + Trusted Proxy

**目标**: 将 R1 和 R3 的最终规则合并进 D1

**涉及文件**:

- 输入: `handoff-s01-revision-r1-anonymous-local-security.md`
- 输入: `handoff-s01-revision-r3-trusted-proxy-threat-model.md`
- 目标: `handoff-s01-d1-trusted-principal-contract.md`

**收敛内容**:

1. 替换 §3.2.2 Trusted Proxy Header 为 R3 的完整威胁模型
2. 替换 §9 向后兼容 allowAnonymousLocal 为 R1 的 Fail-Closed 策略
3. 删除或标记旧的宽松降级语义
4. 添加规范性引用：`本节采用 R1/R3 修订，取代原始设计`

**验收标准**:

- ✅ D1 不再包含 IP 白名单单独解析路径
- ✅ D1 明确 allowAnonymousLocal 仅 personal_local + loopback
- ✅ D1 明确 Trusted Proxy 需要签名 + nonce + 时间戳

**状态**: ⏳ 待执行

---

#### 任务 1.2: D2 收敛 - 授权矩阵

**目标**: 将 R2 的授权矩阵替换 D2 的租户绑定规则

**涉及文件**:

- 输入: `handoff-s01-revision-r2-authorization-matrix.md`
- 目标: `handoff-s01-d2-workspace-handle-model.md`

**收敛内容**:

1. 替换 §3 租户绑定规则为 R2 的 (Principal × Resource × Operation) 矩阵
2. 添加 Ownership Proof 验证规则
3. 添加 Platform 域 break-glass 权限
4. 删除旧的"Platform 访问所有""Employee 访问本租户"简化规则
5. 添加规范性引用：`本节采用 R2 修订，取代原始设计`

**验收标准**:

- ✅ D2 使用 R2 的授权矩阵类型和错误码
- ✅ D2 不再包含"同租户"="可访问"的误导语义
- ✅ D2 明确 Platform 域只读（写入需 break-glass）

**状态**: ⏳ 待执行

---

#### 任务 1.3: D4 收敛 - resolveAuthorizedToolCwd 接口

**目标**: 将 R1/R2/R5 的最终规则合并进 D4 接口定义

**涉及文件**:

- 输入: R1, R2, R5
- 目标: `handoff-s01-d4-resolve-authorized-tool-cwd-interface.md`

**收敛内容**:

1. 替换 §5 resolveAuthorizedToolCwd 实现逻辑为 R1/R2 的集成版本
2. 移除 :448 处直接依据 allowAnonymousLocal 放行的旧代码
3. 添加 R2 授权矩阵检查步骤
4. 添加 R5 审计失败 Fail-Closed 步骤
5. 更新错误码清单（增加 R1/R2/R5 的 13 个新错误码）
6. 添加规范性引用：`本节采用 R1/R2/R5 修订，取代原始设计`

**验收标准**:

- ✅ D4 不再包含旧的匿名访问直接放行逻辑
- ✅ D4 使用 R2 的授权矩阵进行授权检查
- ✅ D4 明确审计失败阻断授权（Fail-Closed）
- ✅ D4 错误码清单包含全部 24 个错误码

**状态**: ⏳ 待执行

---

#### 任务 1.4: D5 收敛 - 测试计划

**目标**: 将 R1-R6 的测试场景合并进 D5

**涉及文件**:

- 输入: R1, R2, R3, R4, R5, R6
- 目标: `handoff-s01-d5-regression-prevention-test-plan.md`

**收敛内容**:

1. 添加 R1 的 Anonymous Local 负例测试（6 个场景）
2. 添加 R2 的授权矩阵测试（11 种场景）
3. 添加 R3 的 Trusted Proxy 安全测试（签名/重放/直连拒绝）
4. 添加 R4 的性能基准测试（7 个 SLA 场景）
5. 添加 R5 的审计失败测试（Fail-Closed）
6. 添加 R6 的唯一 SoT 验收测试
7. 删除与修订冲突的旧测试场景
8. 添加规范性引用：`本节集成 R1-R6 测试要求`

**验收标准**:

- ✅ D5 测试计划覆盖 R1-R6 的所有测试场景
- ✅ D5 不再包含与修订冲突的旧场景

**状态**: ⏳ 待执行

---

#### 任务 1.5: 评审指南收敛

**目标**: 更新评审指南 Gate 2 授权规则

**涉及文件**:

- 输入: R2
- 目标: `handoff-s01-design-review-guide.md`

**收敛内容**:

1. 替换 :127 处 Gate 2 规则为 R2 的授权矩阵
2. 删除"Platform 可访问所有工作区"的旧规则
3. 删除"Employee 可访问本租户工作区"的旧规则
4. 添加 R2 的授权矩阵表（11 种场景）
5. 添加规范性引用：`Gate 2 采用 R2 授权矩阵`

**验收标准**:

- ✅ 评审指南使用 R2 授权矩阵作为 Gate 2 规则
- ✅ 评审指南不再包含旧的简化授权规则

**状态**: ⏳ 待执行

---

#### 任务 1.6: 主 Handoff 收敛

**目标**: 更新主 Handoff 文档引用修订内容

**涉及文件**:

- 输入: R1-R8
- 目标: `handoff-s01-trusted-principal-handle-gate.md`

**收敛内容**:

1. 添加修订声明章节：明确 R1-R8 已合并
2. 更新交付物清单：D1-D5 已集成修订
3. 添加规范性引用：指向具体修订章节
4. 删除或标记被取代的旧语义

**验收标准**:

- ✅ 主 Handoff 明确 R1-R8 已合并
- ✅ 主 Handoff 指向 D1-D5 的具体修订章节

**状态**: ⏳ 待执行

---

### Phase 2: R6 可运行脚本实现（P2）

#### 任务 2.1: 创建 verify-single-sot.ts 脚本

**目标**: 将 R6 的 Markdown 示例实现为可运行脚本

**涉及文件**:

- 输入: `handoff-s01-revision-r6-single-sot-verification.md`
- 目标: `scripts/verify-single-sot.ts`（新建）

**实现内容**:

1. 静态扫描规则（5 条）
2. Catalog API 封装检查（3 条规则）
3. Migration 证据验证
4. 命令行接口
5. 退出码（0 = 通过，1 = 失败）

**验收标准**:

- ✅ 脚本可运行：`pnpm verify:single-sot`
- ✅ 脚本有测试：`pnpm test scripts/verify-single-sot.test.ts`
- ✅ CI 集成：`.github/workflows/ci.yml` 包含此步骤
- ✅ 提供运行结果截图或日志

**状态**: ⏳ 待执行

---

#### 任务 2.2: 添加 package.json 脚本

**目标**: 添加 verify:single-sot 脚本

**涉及文件**:

- 目标: `package.json`

**修改内容**:

```json
{
  "scripts": {
    "verify:single-sot": "tsx scripts/verify-single-sot.ts"
  }
}
```

**状态**: ⏳ 待执行

---

### Phase 3: 文档清单修正（P2）

#### 任务 3.1: 修正 R7 文档清单

**目标**: 修正 R7 中的错误文件名

**涉及文件**:

- 目标: `handoff-s01-revision-r7-r8-documentation-consistency.md`

**修正内容**:

- ❌ 错误: `handoff-s01-d2-tenant-binding-isolation.md`
- ✅ 正确: `handoff-s01-d2-workspace-handle-model.md`

- ❌ 错误: `handoff-s01-d3-workspace-catalog-architecture.md`
- ✅ 正确: `handoff-s01-d3-catalog-extension.md`

- ❌ 错误: `handoff-s01-d4-handle-gate-interface.md`
- ✅ 正确: `handoff-s01-d4-resolve-authorized-tool-cwd-interface.md`

- ❌ 错误: `handoff-s01-d5-test-plan.md`
- ✅ 正确: `handoff-s01-d5-regression-prevention-test-plan.md`

**状态**: ⏳ 待执行

---

### Phase 4: Git 基线落地（P2）

#### 任务 4.1: 创建收敛分支

**目标**: 将所有收敛后的文件落到干净分支

**操作步骤**:

1. 创建分支：`git checkout -b kiro-daibai/handoff-s01-convergence`
2. 添加文件：`git add docs/design/handoff-s01-*.md scripts/verify-single-sot.ts`
3. 提交：`git commit -m "design: Handoff S01 规范收敛（R1-R8 合并）"`
4. 推送：`git push -u origin kiro-daibai/handoff-s01-convergence`

**验收标准**:

- ✅ 提供提交 SHA
- ✅ 提供分支名
- ✅ 提供格式检查结果（`pnpm check`）

**状态**: ⏳ 待执行

---

#### 任务 4.2: 运行格式检查

**目标**: 确保所有文件通过 lint 和格式检查

**操作步骤**:

1. 运行：`pnpm check`
2. 修复任何格式问题
3. 重新提交

**状态**: ⏳ 待执行

---

### Phase 5: 提交 Consolidated Handoff（最终交付）

#### 任务 5.1: 创建 Consolidated Handoff 文档

**目标**: 创建单一的、经过收敛的 Handoff 文档

**涉及文件**:

- 目标: `docs/design/handoff-s01-consolidated.md`（新建）

**内容结构**:

```markdown
# Handoff S01 Consolidated（规范收敛版）

## 修订声明

- R1-R8 已合并进主设计文档
- 旧的双重规范已消除
- 本文档指向最终规范位置

## 8 个问题的最终规范位置

1. Anonymous Local 安全封闭
   - 主规范: D1 §9（已收敛 R1）
   - 测试: D5 §7.1（已收敛 R1）
   - 验证证据: [commit SHA]

2. 授权矩阵
   - 主规范: D2 §3（已收敛 R2）
   - 接口: D4 §5（已收敛 R2）
   - 测试: D5 §7.2（已收敛 R2）
   - 验证证据: [commit SHA]

...（依此类推）

## 验证证据

- 提交 SHA: [...]
- 分支: kiro-daibai/handoff-s01-convergence
- 格式检查: ✅ 通过
- R6 脚本运行: ✅ 通过
```

**状态**: ⏳ 待执行

---

## 收敛时间表

| Phase       | 任务                             | 预计时间           | 状态      |
| ----------- | -------------------------------- | ------------------ | --------- |
| **Phase 1** | 主文档规范收敛（6 个任务）       | 8-10 小时          | ⏳ 待执行 |
| **Phase 2** | R6 脚本实现（2 个任务）          | 3-4 小时           | ⏳ 待执行 |
| **Phase 3** | 文档清单修正（1 个任务）         | 0.5 小时           | ⏳ 待执行 |
| **Phase 4** | Git 基线落地（2 个任务）         | 1 小时             | ⏳ 待执行 |
| **Phase 5** | Consolidated Handoff（1 个任务） | 2 小时             | ⏳ 待执行 |
| **总计**    | **12 个任务**                    | **14.5-17.5 小时** | ⏳ 待执行 |

---

## 收敛完成标准

### 必须达成的收敛条件

1. ✅ R1-R8 的最终规则已合并进主 Handoff、D1-D5、总结和 review guide
2. ✅ 删除或明确标记被取代的旧语义，不允许两套规则并存
3. ✅ R6 已实现为真实脚本、测试和 CI 命令，并提供运行结果
4. ✅ 修正文档清单中的全部文件名和数量
5. ✅ 将所有文件落到干净分支，提供提交 SHA、PR 和格式检查结果
6. ✅ 重新提交一份 consolidated handoff，逐项绑定 8 个问题的最终规范位置和验证证据

### 验收证据

- 📋 提交 SHA: [待补充]
- 📋 分支名: `kiro-daibai/handoff-s01-convergence`
- 📋 PR 链接: [待补充]
- 📋 格式检查: [待补充]
- 📋 R6 脚本运行结果: [待补充]
- 📋 Consolidated Handoff: [待补充]

---

## 下一步行动

**立即开始**: Phase 1 - 主文档规范收敛

**优先级**:

1. 🔴 P0: 任务 1.1, 1.2, 1.3（D1/D2/D4 收敛）
2. 🟡 P1: 任务 1.4, 1.5, 1.6（D5/评审指南/主 Handoff 收敛）
3. 🟢 P2: Phase 2-5（R6 脚本、文档修正、Git 落地、Consolidated）

---

**收敛计划版本**: 1.0  
**创建日期**: 2026-08-29  
**负责人**: kiro-daibai  
**状态**: 进行中
