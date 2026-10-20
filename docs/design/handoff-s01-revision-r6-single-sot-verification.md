> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# R6: 唯一 SoT 机器验收脚本（修订）

> **修订问题**: 唯一 SoT 声明缺少实际验收方法  
> **严重性**: 🟢 低（验收方法不足）  
> **修订日期**: 2026-08-29  
> **状态**: 修订完成

---

## 1. 问题描述

**原设计问题**:

- 只列出"不新建表"，不足以证明没有旁路 JSON、缓存持久化、测试 fixture 冒充 SoT 或直接访问 RDS
- 应增加静态扫描、Catalog API 访问封装检查、运行时禁止真实 RDS 的测试和 migration/rollback 证据

**影响范围**:

- D3 §5 (测试环境约束)
- D5 §3.3 (授权 CWD 查询测试)

---

## 2. 修订方案

### 2.1 静态扫描规则

```typescript
/**
 * 静态扫描规则：禁止直接持久化操作
 *
 * 扫描目标文件:
 * - src/gateway/workspace-resolver/**
 * - src/gateway/workspace-catalog/**
 *
 * 禁止模式:
 * - CREATE TABLE
 * - fs.writeFile / fs.writeFileSync (到非临时路径)
 * - JSON.stringify 写入文件
 * - localStorage / sessionStorage
 */
export const SINGLE_SOT_STATIC_RULES = [
  {
    rule: "no-create-table",
    pattern: /CREATE\s+TABLE/i,
    message: "Forbidden: Direct table creation. Use Catalog API instead.",
  },
  {
    rule: "no-fs-write-persistent",
    pattern:
      /fs\.(writeFile|writeFileSync|appendFile|appendFileSync)\s*\([^)]*(?!\/tmp|\/var\/tmp)/,
    message: "Forbidden: Persistent file write. Use Catalog API or temp directory.",
  },
  {
    rule: "no-json-stringify-persist",
    pattern: /JSON\.stringify.*fs\.(writeFile|writeFileSync)/,
    message: "Forbidden: JSON persistence to file. Use Catalog API.",
  },
  {
    rule: "no-localstorage",
    pattern: /localStorage\.|sessionStorage\./,
    message: "Forbidden: Browser storage APIs not available in Node.js.",
  },
  {
    rule: "no-direct-rds-access",
    pattern: /(pg\.Client|mysql\.createConnection|mongodb\.connect)\s*\(/,
    message: "Forbidden: Direct RDS access. Use Catalog API.",
  },
];

/**
 * 执行静态扫描
 */
export async function runStaticScanForSingleSoT(): Promise<{
  passed: boolean;
  violations: Array<{
    file: string;
    line: number;
    rule: string;
    message: string;
    code: string;
  }>;
}> {
  const violations: any[] = [];

  // 扫描目标目录
  const targetDirs = ["src/gateway/workspace-resolver", "src/gateway/workspace-catalog"];

  for (const dir of targetDirs) {
    const files = await glob(`${dir}/**/*.ts`);

    for (const file of files) {
      const content = await fs.promises.readFile(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const { rule, pattern, message } of SINGLE_SOT_STATIC_RULES) {
          if (pattern.test(line)) {
            violations.push({
              file,
              line: i + 1,
              rule,
              message,
              code: line.trim(),
            });
          }
        }
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
```

### 2.2 Catalog API 封装检查

```typescript
/**
 * Catalog API 封装检查
 *
 * 确保所有工作区查询都通过 Catalog API，而非直接访问数据库
 */
export async function verifyCatalogApiEncapsulation(): Promise<{
  passed: boolean;
  violations: string[];
}> {
  const violations: string[] = [];

  // Rule 1: resolveAuthorizedToolCwd 必须使用 catalog.query
  const resolverSource = await fs.promises.readFile(
    "src/gateway/workspace-resolver/index.ts",
    "utf-8",
  );

  if (!resolverSource.includes("catalog.query")) {
    violations.push("resolveAuthorizedToolCwd does not use catalog.query()");
  }

  // Rule 2: 禁止直接导入 pg/mysql/mongodb
  const forbiddenImports = ["pg", "mysql", "mysql2", "mongodb"];
  for (const pkg of forbiddenImports) {
    if (resolverSource.includes(`from "${pkg}"`) || resolverSource.includes(`require("${pkg}")`)) {
      violations.push(`resolveAuthorizedToolCwd imports forbidden package: ${pkg}`);
    }
  }

  // Rule 3: WorkspaceCatalog 必须封装数据访问
  const catalogSource = await fs.promises.readFile(
    "src/gateway/workspace-catalog/index.ts",
    "utf-8",
  );

  // 检查是否有 public 方法直接暴露 RDS 连接
  if (
    catalogSource.includes("public.*getConnection") ||
    catalogSource.includes("public.*getRdsClient")
  ) {
    violations.push("WorkspaceCatalog exposes RDS connection via public method");
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
```

### 2.3 运行时禁止真实 RDS 测试

```typescript
/**
 * 运行时测试：禁止测试环境访问真实 RDS
 *
 * 测试环境必须使用 Mock Catalog 或 In-Memory Catalog
 */
describe("Single SoT: Runtime RDS Access Prevention", () => {
  beforeAll(() => {
    // 设置测试环境标志
    process.env.NODE_ENV = "test";
  });

  it("should use mock catalog in test environment", () => {
    // 检查测试环境下的 Catalog 实例类型
    const catalog = createTestCatalog();

    expect(catalog.constructor.name).toBe("MockWorkspaceCatalog");
    expect(catalog.constructor.name).not.toBe("RdsWorkspaceCatalog");
  });

  it("should reject real RDS connection in test environment", async () => {
    // 尝试创建真实 RDS 连接（应该失败）
    await expect(async () => {
      const catalog = new RdsWorkspaceCatalog({
        host: "prod-rds.example.com",
        port: 5432,
        database: "workspace_catalog",
      });
      await catalog.connect();
    }).rejects.toThrow(/RDS connection forbidden in test environment/);
  });

  it("should prevent accidental real data access", async () => {
    // Mock 环境变量（模拟生产配置泄露到测试环境）
    process.env.WORKSPACE_CATALOG_RDS_HOST = "prod-rds.example.com";

    // 创建 Catalog 时应该检测到测试环境，拒绝真实连接
    await expect(async () => {
      const catalog = await createWorkspaceCatalogFromEnv();
      await catalog.query(makePrincipal("test"), "/workspace");
    }).rejects.toThrow(/RDS access forbidden in test environment/);
  });
});
```

### 2.4 Migration/Rollback 证据

```typescript
/**
 * Migration 证据验证
 *
 * 确保 Workspace Catalog 数据模型变更有完整的 migration 和 rollback 脚本
 */
export type MigrationEvidence = {
  /** Migration ID */
  id: string;

  /** 版本号 */
  version: string;

  /** 迁移脚本路径 */
  upScript: string;

  /** 回滚脚本路径 */
  downScript: string;

  /** 是否已应用 */
  applied: boolean;

  /** 应用时间 */
  appliedAt?: string;
};

/**
 * 验证 Migration 证据
 */
export async function verifyMigrationEvidence(): Promise<{
  passed: boolean;
  violations: string[];
}> {
  const violations: string[] = [];

  // 1. 检查 migrations 目录是否存在
  const migrationsDir = "src/gateway/workspace-catalog/migrations";
  if (!fs.existsSync(migrationsDir)) {
    violations.push(`Migrations directory not found: ${migrationsDir}`);
    return { passed: false, violations };
  }

  // 2. 读取所有 migration 文件
  const files = await fs.promises.readdir(migrationsDir);
  const upFiles = files.filter((f) => f.endsWith(".up.sql"));
  const downFiles = files.filter((f) => f.endsWith(".down.sql"));

  // 3. 检查每个 up migration 都有对应的 down migration
  for (const upFile of upFiles) {
    const baseName = upFile.replace(".up.sql", "");
    const downFile = `${baseName}.down.sql`;

    if (!downFiles.includes(downFile)) {
      violations.push(`Missing rollback script: ${downFile} for ${upFile}`);
    }
  }

  // 4. 检查 migration 命名规范
  const migrationPattern = /^\d{14}_[a-z_]+\.(up|down)\.sql$/;
  for (const file of files) {
    if (!migrationPattern.test(file)) {
      violations.push(
        `Invalid migration naming: ${file}. Expected format: YYYYMMDDHHmmss_description.(up|down).sql`,
      );
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * 示例 Migration 文件
 *
 * migrations/20260829120000_add_workspace_resource_table.up.sql
 */
const EXAMPLE_UP_MIGRATION = `
-- Add workspace_resource table
CREATE TABLE workspace_resource (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  owner_scope JSONB NOT NULL,
  lifecycle_state TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspace_resource_tenant_id ON workspace_resource(tenant_id);
CREATE INDEX idx_workspace_resource_lifecycle_state ON workspace_resource(lifecycle_state);
`;

/**
 * migrations/20260829120000_add_workspace_resource_table.down.sql
 */
const EXAMPLE_DOWN_MIGRATION = `
-- Rollback workspace_resource table
DROP INDEX IF EXISTS idx_workspace_resource_lifecycle_state;
DROP INDEX IF EXISTS idx_workspace_resource_tenant_id;
DROP TABLE IF EXISTS workspace_resource;
`;
```

---

## 3. 验收脚本实现

```typescript
/**
 * 唯一 SoT 验收脚本（汇总）
 *
 * 用法: pnpm verify:single-sot
 */
export async function verifySingleSoT(): Promise<{
  passed: boolean;
  results: {
    staticScan: { passed: boolean; violations: any[] };
    apiEncapsulation: { passed: boolean; violations: string[] };
    migrationEvidence: { passed: boolean; violations: string[] };
  };
}> {
  console.log("🔍 Verifying Single Source of Truth...\n");

  // 1. 静态扫描
  console.log("1️⃣ Running static scan...");
  const staticScan = await runStaticScanForSingleSoT();
  console.log(staticScan.passed ? "✅ PASSED" : "❌ FAILED");
  if (!staticScan.passed) {
    console.log(`   Found ${staticScan.violations.length} violations:`);
    for (const v of staticScan.violations) {
      console.log(`   - ${v.file}:${v.line} [${v.rule}] ${v.message}`);
    }
  }
  console.log();

  // 2. Catalog API 封装检查
  console.log("2️⃣ Checking Catalog API encapsulation...");
  const apiEncapsulation = await verifyCatalogApiEncapsulation();
  console.log(apiEncapsulation.passed ? "✅ PASSED" : "❌ FAILED");
  if (!apiEncapsulation.passed) {
    console.log(`   Found ${apiEncapsulation.violations.length} violations:`);
    for (const v of apiEncapsulation.violations) {
      console.log(`   - ${v}`);
    }
  }
  console.log();

  // 3. Migration 证据验证
  console.log("3️⃣ Verifying migration evidence...");
  const migrationEvidence = await verifyMigrationEvidence();
  console.log(migrationEvidence.passed ? "✅ PASSED" : "❌ FAILED");
  if (!migrationEvidence.passed) {
    console.log(`   Found ${migrationEvidence.violations.length} violations:`);
    for (const v of migrationEvidence.violations) {
      console.log(`   - ${v}`);
    }
  }
  console.log();

  // 4. 总结
  const allPassed = staticScan.passed && apiEncapsulation.passed && migrationEvidence.passed;
  console.log("📊 Summary:");
  console.log(`   Static Scan: ${staticScan.passed ? "✅" : "❌"}`);
  console.log(`   API Encapsulation: ${apiEncapsulation.passed ? "✅" : "❌"}`);
  console.log(`   Migration Evidence: ${migrationEvidence.passed ? "✅" : "❌"}`);
  console.log();
  console.log(allPassed ? "✅ All checks passed!" : "❌ Some checks failed!");

  return {
    passed: allPassed,
    results: {
      staticScan,
      apiEncapsulation,
      migrationEvidence,
    },
  };
}

// CLI 入口
if (require.main === module) {
  verifySingleSoT().then((result) => {
    process.exit(result.passed ? 0 : 1);
  });
}
```

---

## 4. package.json 脚本

```json
{
  "scripts": {
    "verify:single-sot": "tsx scripts/verify-single-sot.ts",
    "test:single-sot": "vitest run --grep 'Single SoT'"
  }
}
```

---

## 5. CI 集成

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  verify-single-sot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 22
          cache: "pnpm"

      - run: pnpm install

      # 运行唯一 SoT 验收脚本
      - name: Verify Single Source of Truth
        run: pnpm verify:single-sot

      # 运行运行时测试
      - name: Test RDS Access Prevention
        run: pnpm test:single-sot
```

---

## 6. 修订总结

### 修订前（存在问题）

- ❌ 只有"不新建表"声明，无验收方法
- ❌ 无法检测旁路 JSON 持久化
- ❌ 无法检测测试环境访问真实 RDS
- ❌ 无 migration/rollback 证据

### 修订后（问题解决）

- ✅ 静态扫描规则（5 条）
- ✅ Catalog API 封装检查（3 条规则）
- ✅ 运行时 RDS 访问禁止测试
- ✅ Migration/Rollback 证据验证
- ✅ 完整的验收脚本（`pnpm verify:single-sot`）
- ✅ CI 集成

### 验收保证

- ✅ 静态扫描检测禁止模式
- ✅ API 封装检查防止旁路访问
- ✅ 测试环境禁止真实 RDS
- ✅ 每个 migration 都有 rollback

---

**修订状态**: ✅ 完成  
**修订日期**: 2026-08-29  
**修订人**: kiro-daibai
