# S01 Implementation Readiness A Handoff

> **本文件不是第二套 S01 规范。** 唯一设计 SoT 仍是  
> `.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。  
> V1.7 计划：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-implementation-readiness.md`。  
> **申请**: S01 Implementation Readiness A Review  
> **不申请**: Implementation Gate Accepted、Implementation Unlock、Item 7 met、Phase 1B unlock、production wiring、LIVE

## 基线

| 项           | 值                                                         |
| ------------ | ---------------------------------------------------------- |
| Worktree     | `../openbot-s01-implementation-readiness-a`                |
| Branch       | `cursor/s01-implementation-readiness-a`                    |
| Base SHA     | `0e5b3e3b5cac628e79c36606cacf28f061466473` (`origin/main`) |
| Head SHA     | 见本 PR tip                                                |
| ancestry     | `origin/main` is ancestor of `HEAD`                        |
| Loom task    | `s01-implementation-readiness-a:cursor`                    |
| Loom session | `bb47c748-39c9-4656-9837-5d36b74e7d70`                     |
| Agent        | `cursor`                                                   |

## 错误码裁决（任务清单 vs 唯一 handoff）

任务正文列出了 `ERR_WORKSPACE_SUSPENDED` / `ERR_WORKSPACE_RETIRED` / `ERR_BINDING_AMBIGUOUS` / `ERR_OWNERSHIP_MISMATCH` / `ERR_STALE_FENCING`。

**唯一 handoff D4 只有 11 个错误码。** 本切片不创建平行规范，沿用：

| 任务码                    | 本切片                                             |
| ------------------------- | -------------------------------------------------- |
| `ERR_WORKSPACE_SUSPENDED` | 无此枚举；`read_only` 写 → `ERR_CAPABILITY_DENIED` |
| `ERR_WORKSPACE_RETIRED`   | `ERR_WORKSPACE_ARCHIVED`                           |
| `ERR_BINDING_AMBIGUOUS`   | duplicate canonical → `ERR_WORKSPACE_NOT_FOUND`    |
| `ERR_OWNERSHIP_MISMATCH`  | `ERR_WORKSPACE_OWNER_DENIED`                       |
| `ERR_STALE_FENCING`       | `ERR_WORKSPACE_ARCHIVED`                           |

## Trusted Principal 威胁模型实现

- 仅 `issueTrustedPrincipal` 可构造；wire `tenantId` / `ownerId` / `principal` / `executedBy` / `userId` / `resourceId` 非空即拒绝
- presented proof 与 server secrets 分离；HMAC / device-token 常量时间比较
- 伪造 attestation、无密钥 SHA-256、过期、错误 source 均 fail-closed → `ERR_PRINCIPAL_REQUIRED`
- 签发对象 `Object.freeze`；brand 常量 `S01_TRUSTED_PRINCIPAL_BRAND` 不是 attested 字段
- `allowAnonymousLocal` / `personalFallback` / host cwd 不放行
- **未**接生产 trusted-proxy header，也未读客户端自报身份

## Workspace Handle fail-closed 矩阵

| 条件                                     | 结果                         |
| ---------------------------------------- | ---------------------------- |
| Catalog unavailable                      | `ERR_CATALOG_UNAVAILABLE`    |
| resource missing                         | `ERR_WORKSPACE_NOT_FOUND`    |
| duplicate canonical                      | `ERR_WORKSPACE_NOT_FOUND`    |
| compatibility-only                       | `ERR_BINDING_NOT_CANONICAL`  |
| tenant mismatch                          | `ERR_TENANT_MISMATCH`        |
| ownership / registry 目标不符            | `ERR_WORKSPACE_OWNER_DENIED` |
| retired / revoked / stale fencing        | `ERR_WORKSPACE_ARCHIVED`     |
| 无新表 / 无 JSON SoT / 无 mkdir / 无 RDS | 已遵守                       |

Handle 是 Catalog typed view：`resourceId`、`tenantId`、`ownerScope` / `ownerId`、canonical locator、lifecycle、capabilities、fencing、provenance。

## Authorized CWD 错误码与测试映射

`evaluateS01AuthorizedToolCwd` **必须**带 `targetResourceId`（V1.7 F1）。禁止路径恰好唯一选择。

| 码                            | 测试                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `ERR_PRINCIPAL_REQUIRED`      | 缺失 / 伪造 / 过期 / fallback                        |
| `ERR_TENANT_BINDING_REQUIRED` | membership 数组 / 缺失                               |
| `ERR_WORKSPACE_NOT_FOUND`     | 缺 target / Registry miss / Catalog miss / duplicate |
| `ERR_TENANT_MISMATCH`         | 跨租户                                               |
| `ERR_CAPABILITY_DENIED`       | read_only 写                                         |
| `ERR_WORKSPACE_ARCHIVED`      | retired / revoked / stale fencing                    |
| `ERR_BINDING_NOT_CANONICAL`   | compatibility-only                                   |
| `ERR_PATH_OUTSIDE_WORKSPACE`  | sibling locator / sibling-prefix                     |
| `ERR_CATALOG_UNAVAILABLE`     | snapshot unavailable                                 |
| `ERR_INVALID_PATH`            | `..` / encoded traversal / symlinkFollowed           |
| `ERR_WORKSPACE_OWNER_DENIED`  | 同租户其他 owner / 错误 Registry 目标                |

路径使用 `path.posix` 结构化解析，不用 `startsWith` 判断包含。符号链接：纯函数无法 lstat，`symlinkFollowed` 拒绝；成功仅 `lexical-only-caller-must-lstat`，不得当作已验证放行。

Audit 不含原始路径、attestation 或密钥。

## 文件清单

- `docs/design/contracts/s01-trusted-principal-handle-contract.ts`
- `docs/design/contracts/s01-trusted-principal-handle-contract.test.ts`
- `docs/design/contracts/s01-implementation-readiness-a.test.ts`
- `docs/design/evidence/s01-implementation-readiness-a-handoff.md`
- `docs/design/evidence/memory-workspace-s01-implementation-readiness-a.json`
- `.loom/registry.yaml`（独立 commit）

未修改：`src/auto-reply/reply/get-reply.ts`、`src/memory/**`、生产 resolver、Catalog adapter、scan、deploy。

## 明确声明

- `implementationVerified=false`
- `S01_PRODUCTION_WIRED=false`
- 未接生产、未部署、未签发 Implementation Unlock / Production Authorization
- Item 7 remaining = liveWriteWatchIndex = 10
- Phase 1B 未开启
