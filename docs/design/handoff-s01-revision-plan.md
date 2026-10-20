> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# Handoff S01 设计修订计划（完成）

> **评审结论**: Revisions Required  
> **评审日期**: 2026-08-29  
> **修订开始**: 2026-08-29  
> **修订完成**: 2026-08-29  
> **修订负责人**: kiro-daibai

---

## 评审结论

**决策**: ❌ 需要修订（Revisions Required）

**Implementation unlock**: ❌ 不批准  
**Production authorization**: ❌ 不批准

**原因**: 该文件可以作为评审清单，但不能作为 S01 设计通过或进入实现阶段的依据。

---

## 修订完成状态

**所有 8 个问题已修订完成！**

✅ **P0 问题（2 个）**: 完成  
✅ **P1 问题（3 个）**: 完成  
✅ **P2 问题（3 个）**: 完成

---

## 修订交付物清单

### 修订文档（8 个）

1. ✅ **R1: Anonymous Local 安全封闭**
   - 文件: `docs/design/handoff-s01-revision-r1-anonymous-local-security.md`
   - 问题: P0 问题 1
   - 内容: 仅 personal_local profile + loopback + 只读工具 + 启动时 fail-closed 校验 + 运行时双重校验

2. ✅ **R2: 授权矩阵**
   - 文件: `docs/design/handoff-s01-revision-r2-authorization-matrix.md`
   - 问题: P0 问题 2
   - 内容: 基于 (Principal × Resource × Operation) 三元组授权矩阵 + Ownership Proof 验证 + Platform 域只读（写入需 break-glass）

3. ✅ **R3: Trusted Proxy 威胁模型**
   - 文件: `docs/design/handoff-s01-revision-r3-trusted-proxy-threat-model.md`
   - 问题: P1 问题 3
   - 内容: 受信代理拓扑、单跳/多跳规则、签名或 mTLS、时间戳/nonce、密钥轮换、直连拒绝测试

4. ✅ **R4: 性能基准**
   - 文件: `docs/design/handoff-s01-revision-r4-performance-benchmark.md`
   - 问题: P1 问题 4
   - 内容: 固定测试环境、Catalog 规模、并发模型、冷/热缓存、统计方法、失败阈值

5. ✅ **R5: 审计失败语义**
   - 文件: `docs/design/handoff-s01-revision-r5-audit-failure-semantics.md`
   - 问题: P1 问题 5
   - 内容: Fail-Closed 策略、字段白名单、敏感值禁止记录、retention 策略

6. ✅ **R6: 唯一 SoT 验收脚本**
   - 文件: `docs/design/handoff-s01-revision-r6-single-sot-verification.md`
   - 问题: P2 问题 6
   - 内容: 静态扫描规则、Catalog API 封装检查、运行时禁止 RDS 测试、migration/rollback 证据

7. ✅ **R7+R8: 文档一致性**
   - 文件: `docs/design/handoff-s01-revision-r7-r8-documentation-consistency.md`
   - 问题: P2 问题 7、8
   - 内容: 统一文档清单、错误码映射表、状态标记统一

8. ✅ **修订计划**
   - 文件: `docs/design/handoff-s01-revision-plan.md`
   - 内容: 评审结论、修订计划、问题清单

---

## 修订完成时间表

| 阶段   | 问题                             | 状态    |
| ------ | -------------------------------- | ------- |
| **P0** | 问题 1: Anonymous Local 安全封闭 | ✅ 完成 |
| **P0** | 问题 2: 授权矩阵                 | ✅ 完成 |
| **P1** | 问题 3: Trusted Proxy 威胁模型   | ✅ 完成 |
| **P1** | 问题 4: 性能基准                 | ✅ 完成 |
| **P1** | 问题 5: 审计失败语义             | ✅ 完成 |
| **P2** | 问题 6: 唯一 SoT 验收脚本        | ✅ 完成 |
| **P2** | 问题 7+8: 文档一致性             | ✅ 完成 |

---

## 修订完成标准（已达成）

修订完成后，至少应补充：

1. ✅ 匿名本地模式的生产禁用门禁
2. ✅ 基于 ownership/ACL 的授权矩阵
3. ✅ Trusted Proxy 完整威胁模型
4. ✅ 可重复的性能基准
5. ✅ 审计失败语义
6. ✅ 唯一 SoT 机器验收脚本
7. ✅ 统一后的文档清单

---

## 关键修订要点总结

### P0 修订（高优先级 - 安全风险）

#### R1: Anonymous Local 安全封闭

**问题**: allowAnonymousLocal=true 是未封闭的安全例外

**解决方案**:

- ✅ 仅允许 `personal_local` profile + `loopback` 监听 + 只读工具
- ✅ 启动时 fail-closed 校验（生产环境拒绝启动）
- ✅ 运行时双重校验（远程请求/写入操作被拒绝）
- ✅ 完整的负例测试（6 个场景）

**新增错误码**: 5 个

- `ERR_ANONYMOUS_LOCAL_FORBIDDEN`
- `ERR_ANONYMOUS_LOCAL_NON_LOCAL_PATH`
- `ERR_ANONYMOUS_LOCAL_WRITE_DENIED`
- `ERR_ANONYMOUS_LOCAL_EXECUTE_DENIED`
- `ERR_ANONYMOUS_LOCAL_TOOL_DENIED`

#### R2: 授权矩阵

**问题**: 权限模型过于宽泛，与所有权模型不一致

**解决方案**:

- ✅ 基于 (Principal × Resource × Operation) 三元组授权矩阵
- ✅ Ownership Proof 验证（user/group/agent）
- ✅ Platform 域只读（写入需 break-glass 权限）
- ✅ Group Membership 检查
- ✅ 授权矩阵表（11 种场景）

**新增错误码**: 5 个

- `ERR_OWNERSHIP_MISMATCH`
- `ERR_GROUP_MEMBERSHIP_REQUIRED`
- `ERR_SEAT_NOT_ASSIGNED`
- `ERR_BREAK_GLASS_REQUIRED`
- `ERR_OPERATION_DENIED`

---

### P1 修订（中优先级 - 配置/性能/合规风险）

#### R3: Trusted Proxy 威胁模型

**问题**: Trusted Proxy Header 信任边界未定义完整

**解决方案**:

- ✅ 威胁模型（8 种威胁场景）
- ✅ 单跳/多跳代理解析
- ✅ HMAC-SHA256 签名验证
- ✅ Nonce + 时间戳防重放
- ✅ IPv4/IPv6 + CIDR 支持
- ✅ 密钥轮换（90 天 + 7 天重叠期）
- ✅ 直连拒绝测试

#### R4: 性能基准

**问题**: 性能 SLA 只是目标，没有可验收证据

**解决方案**:

- ✅ 固定测试环境（硬件/软件/网络）
- ✅ 4 种 Catalog 规模（10/100/1000/5000）
- ✅ 4 种并发级别（1/10/50/100）
- ✅ 3 种缓存状态（cold/warm/hot）
- ✅ 4 种审计配置（disabled/async/buffered/sync）
- ✅ 7 个标准 SLA 场景
- ✅ 明确内存索引为 P0 必需（≥100 workspaces）
- ✅ 可重复的基准测试框架

**性能目标**:

- 小规模 (10 workspaces): P99 < 20ms (hot cache)
- 中规模 (100 workspaces): P99 < 50ms (hot cache)
- 大规模 (1000 workspaces): P99 < 100ms (hot cache)

#### R5: 审计失败语义

**问题**: 审计日志要求不完整

**解决方案**:

- ✅ Fail-Closed 策略（默认）
- ✅ 完整的审计日志字段规范（25 个字段）
- ✅ 字段白名单
- ✅ 敏感值黑名单（17 种）
- ✅ 路径脱敏规则
- ✅ 保留期限策略（90 天 + 归档）
- ✅ HMAC-SHA256 签名（不可抵赖）

**新增错误码**: 3 个

- `ERR_AUDIT_FAILURE`
- `ERR_AUDIT_STORE_UNAVAILABLE`
- `ERR_AUDIT_SIGNATURE_INVALID`

---

### P2 修订（低优先级 - 验收方法/文档一致性）

#### R6: 唯一 SoT 验收脚本

**问题**: 唯一 SoT 声明缺少实际验收方法

**解决方案**:

- ✅ 静态扫描规则（5 条）
- ✅ Catalog API 封装检查（3 条规则）
- ✅ 运行时 RDS 访问禁止测试
- ✅ Migration/Rollback 证据验证
- ✅ 完整的验收脚本（`pnpm verify:single-sot`）
- ✅ CI 集成

#### R7+R8: 文档一致性

**问题 7**: 文档数字不一致  
**问题 8**: "设计完成"与"评审未完成"混淆

**解决方案**:

- ✅ 统一文档清单：16 个文档（7 核心 + 8 修订 + 1 评审）
- ✅ 错误码映射表：24 个错误码完整映射
- ✅ 4 种明确的状态标记（📋 设计意图、⏳ 待验证条件、✅ 已有代码证据、🎯 实现后退出标准）
- ✅ 状态标记使用指南
- ✅ 修订后的评审说明模板

---

## 总计修订成果

### 新增错误码

**总计**: 24 个错误码

- 核心错误码: 11 个
- R1 (Anonymous Local): 5 个
- R2 (Authorization Matrix): 5 个
- R5 (Audit Failure): 3 个

### 文档交付物

**总计**: 16 个文档

- 核心设计文档: 7 个
- 修订文档: 8 个
- 评审文档: 1 个

### 关键决策

1. ✅ Anonymous Local 采用 Fail-Closed 策略（生产禁用）
2. ✅ 授权采用 (Principal × Resource × Operation) 三元组模型
3. ✅ Trusted Proxy 采用 HMAC-SHA256 签名 + Nonce + 时间戳
4. ✅ 性能基准采用固定环境 + 4×4×3×4 测试矩阵
5. ✅ 审计失败采用 Fail-Closed 策略（默认）
6. ✅ 唯一 SoT 采用静态扫描 + 运行时禁止 + Migration 证据
7. ✅ 文档状态标记统一为 4 种明确标记

---

## 下一步行动

**修订已完成！**

**建议后续工作**:

1. **重新评审**: 基于修订文档重新评审设计
2. **实现排期**: 制定 S01 实现计划和排期
3. **原型验证**: 针对关键修订点进行原型验证（性能基准、授权矩阵）
4. **测试准备**: 准备测试环境和基准数据

---

**修订完成日期**: 2026-08-29  
**修订负责人**: kiro-daibai  
**修订状态**: ✅ 全部完成（8/8）
