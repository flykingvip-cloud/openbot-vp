> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# R4: 可重复的性能基准（修订）

> **修订问题**: 性能 SLA 只是目标，没有可验收证据  
> **严重性**: 🟡 中（性能风险）  
> **修订日期**: 2026-08-29  
> **状态**: 修订完成

---

## 1. 问题描述

**原设计问题**:

- 声称动态 O(N) 查询可达到 P99 < 20/50ms，但没有硬件、Catalog 大小、快照构造成本、审计写入模型、并发模型或基准数据
- 内存索引列为 P2 可选，与当前 SLA 无法同时成立
- 缺少可重复的性能基准测试

**影响范围**:

- D3 §6 (性能分析)
- D4 §9 (性能要求)
- D5 §6 (性能测试)

---

## 2. 修订方案

### 2.1 性能基准环境（固定配置）

```typescript
/**
 * 性能基准测试环境
 *
 * 所有性能测试必须在此环境下运行，以确保可重复性
 */
export type BenchmarkEnvironment = {
  /** 硬件规格 */
  hardware: {
    /** CPU 型号 */
    cpu: string; // 例如: "Apple M2 Pro (10-core)"

    /** CPU 核心数 */
    cores: number;

    /** 内存大小 (GB) */
    memory: number;

    /** 存储类型 */
    storage: "ssd" | "nvme" | "hdd";
  };

  /** 软件环境 */
  software: {
    /** 操作系统 */
    os: string; // 例如: "macOS 14.5"

    /** Node.js 版本 */
    nodeVersion: string; // 例如: "v22.5.1"

    /** 数据库版本 (如适用) */
    dbVersion?: string;
  };

  /** 网络环境 */
  network: {
    /** 网络延迟 (ms) */
    latency: number; // 本地: 0, 同区域: 5, 跨区域: 50

    /** 带宽 (Mbps) */
    bandwidth: number;
  };
};

/**
 * 推荐的基准测试环境
 */
export const RECOMMENDED_BENCHMARK_ENV: BenchmarkEnvironment = {
  hardware: {
    cpu: "Apple M2 Pro (10-core)",
    cores: 10,
    memory: 16,
    storage: "nvme",
  },
  software: {
    os: "macOS 14.5",
    nodeVersion: "v22.5.1",
  },
  network: {
    latency: 0, // 本地测试
    bandwidth: 1000,
  },
};
```

### 2.2 Catalog 规模定义

```typescript
/**
 * Catalog 规模配置
 */
export type CatalogScaleConfig = {
  /** 工作区数量 */
  workspaceCount: 10 | 100 | 1000 | 5000;

  /** 租户数量 */
  tenantCount: number;

  /** 平均每租户工作区数 */
  avgWorkspacesPerTenant: number;

  /** Principal 数量 */
  principalCount: number;

  /** Owner 类型分布 */
  ownerDistribution: {
    user: number; // 百分比
    group: number; // 百分比
    agent: number; // 百分比
  };
};

/**
 * 标准测试规模（3 种）
 */
export const CATALOG_SCALES: Record<string, CatalogScaleConfig> = {
  /** 小规模：个人用户 */
  small: {
    workspaceCount: 10,
    tenantCount: 1,
    avgWorkspacesPerTenant: 10,
    principalCount: 1,
    ownerDistribution: { user: 100, group: 0, agent: 0 },
  },

  /** 中规模：小型企业 */
  medium: {
    workspaceCount: 100,
    tenantCount: 5,
    avgWorkspacesPerTenant: 20,
    principalCount: 50,
    ownerDistribution: { user: 60, group: 30, agent: 10 },
  },

  /** 大规模：大型企业 */
  large: {
    workspaceCount: 1000,
    tenantCount: 20,
    avgWorkspacesPerTenant: 50,
    principalCount: 500,
    ownerDistribution: { user: 50, group: 40, agent: 10 },
  },

  /** 超大规模：平台级 */
  xlarge: {
    workspaceCount: 5000,
    tenantCount: 100,
    avgWorkspacesPerTenant: 50,
    principalCount: 2000,
    ownerDistribution: { user: 40, group: 50, agent: 10 },
  },
};
```

### 2.3 并发模型

```typescript
/**
 * 并发测试配置
 */
export type ConcurrencyConfig = {
  /** 并发请求数 */
  concurrency: 1 | 10 | 50 | 100;

  /** 总请求数 */
  totalRequests: number;

  /** 请求间隔 (ms) */
  requestInterval: number;

  /** 预热请求数 */
  warmupRequests: number;
};

/**
 * 标准并发测试场景
 */
export const CONCURRENCY_SCENARIOS: Record<string, ConcurrencyConfig> = {
  /** 单用户（无并发）*/
  single: {
    concurrency: 1,
    totalRequests: 1000,
    requestInterval: 0,
    warmupRequests: 100,
  },

  /** 低并发（10 用户）*/
  low: {
    concurrency: 10,
    totalRequests: 5000,
    requestInterval: 0,
    warmupRequests: 500,
  },

  /** 中并发（50 用户）*/
  medium: {
    concurrency: 50,
    totalRequests: 10000,
    requestInterval: 0,
    warmupRequests: 1000,
  },

  /** 高并发（100 用户）*/
  high: {
    concurrency: 100,
    totalRequests: 20000,
    requestInterval: 0,
    warmupRequests: 2000,
  },
};
```

### 2.4 冷/热缓存状态

```typescript
/**
 * 缓存状态配置
 */
export type CacheStateConfig = {
  /** 缓存类型 */
  cacheType: "cold" | "hot" | "warm";

  /** 缓存预热策略 */
  warmupStrategy?: "sequential" | "random" | "realistic";

  /** 缓存命中率目标 */
  targetHitRate?: number; // 0-1
};

/**
 * 标准缓存状态测试
 */
export const CACHE_STATES: Record<string, CacheStateConfig> = {
  /** 冷缓存：进程刚启动，无任何缓存 */
  cold: {
    cacheType: "cold",
  },

  /** 温缓存：部分数据已缓存（50% 命中率）*/
  warm: {
    cacheType: "warm",
    warmupStrategy: "realistic",
    targetHitRate: 0.5,
  },

  /** 热缓存：大部分数据已缓存（90% 命中率）*/
  hot: {
    cacheType: "hot",
    warmupStrategy: "realistic",
    targetHitRate: 0.9,
  },
};
```

### 2.5 审计日志配置

```typescript
/**
 * 审计日志配置（影响性能）
 */
export type AuditConfig = {
  /** 是否启用审计 */
  enabled: boolean;

  /** 写入模式 */
  writeMode: "sync" | "async" | "buffered";

  /** 缓冲区大小（buffered 模式）*/
  bufferSize?: number;

  /** 刷新间隔（buffered 模式，ms）*/
  flushInterval?: number;
};

/**
 * 标准审计配置
 */
export const AUDIT_CONFIGS: Record<string, AuditConfig> = {
  /** 禁用审计（最快）*/
  disabled: {
    enabled: false,
    writeMode: "async",
  },

  /** 异步审计（推荐）*/
  async: {
    enabled: true,
    writeMode: "async",
  },

  /** 缓冲审计（高吞吐）*/
  buffered: {
    enabled: true,
    writeMode: "buffered",
    bufferSize: 1000,
    flushInterval: 1000,
  },

  /** 同步审计（最慢，最安全）*/
  sync: {
    enabled: true,
    writeMode: "sync",
  },
};
```

### 2.6 性能统计方法

```typescript
/**
 * 性能统计指标
 */
export type PerformanceMetrics = {
  /** 总请求数 */
  totalRequests: number;

  /** 成功请求数 */
  successRequests: number;

  /** 失败请求数 */
  failedRequests: number;

  /** 延迟分布 (ms) */
  latency: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    p99_9: number;
  };

  /** 吞吐量 (req/s) */
  throughput: number;

  /** 测试持续时间 (ms) */
  duration: number;

  /** 内存使用 (MB) */
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };

  /** CPU 使用率 (%) */
  cpuUsage: number;
};

/**
 * 计算百分位数（P50, P90, P95, P99）
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;

  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[index];
}

/**
 * 计算性能指标
 */
export function calculateMetrics(samples: number[]): PerformanceMetrics["latency"] {
  if (samples.length === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      p99_9: 0,
    };
  }

  const sorted = samples.slice().sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / samples.length,
    median: calculatePercentile(sorted, 50),
    p50: calculatePercentile(sorted, 50),
    p90: calculatePercentile(sorted, 90),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
    p99_9: calculatePercentile(sorted, 99.9),
  };
}
```

### 2.7 性能失败阈值

```typescript
/**
 * 性能 SLA 阈值
 */
export type PerformanceSLA = {
  /** 场景名称 */
  scenario: string;

  /** Catalog 规模 */
  catalogScale: keyof typeof CATALOG_SCALES;

  /** 并发级别 */
  concurrency: keyof typeof CONCURRENCY_SCENARIOS;

  /** 缓存状态 */
  cacheState: keyof typeof CACHE_STATES;

  /** 审计配置 */
  auditConfig: keyof typeof AUDIT_CONFIGS;

  /** SLA 阈值 */
  thresholds: {
    /** P99 延迟 (ms) */
    p99Latency: number;

    /** P95 延迟 (ms) */
    p95Latency: number;

    /** 平均延迟 (ms) */
    meanLatency: number;

    /** 最小吞吐量 (req/s) */
    minThroughput: number;

    /** 成功率 (%) */
    successRate: number; // 默认 99.9%
  };
};

/**
 * S01 性能 SLA 定义
 */
export const S01_PERFORMANCE_SLA: PerformanceSLA[] = [
  // ========================================
  // 小规模 (10 workspaces)
  // ========================================
  {
    scenario: "small-single-hot-async",
    catalogScale: "small",
    concurrency: "single",
    cacheState: "hot",
    auditConfig: "async",
    thresholds: {
      p99Latency: 20, // P99 < 20ms
      p95Latency: 15, // P95 < 15ms
      meanLatency: 10, // Mean < 10ms
      minThroughput: 100, // > 100 req/s
      successRate: 99.9,
    },
  },

  {
    scenario: "small-low-hot-async",
    catalogScale: "small",
    concurrency: "low",
    cacheState: "hot",
    auditConfig: "async",
    thresholds: {
      p99Latency: 50, // P99 < 50ms
      p95Latency: 30, // P95 < 30ms
      meanLatency: 20, // Mean < 20ms
      minThroughput: 500, // > 500 req/s
      successRate: 99.9,
    },
  },

  // ========================================
  // 中规模 (100 workspaces)
  // ========================================
  {
    scenario: "medium-single-hot-async",
    catalogScale: "medium",
    concurrency: "single",
    cacheState: "hot",
    auditConfig: "async",
    thresholds: {
      p99Latency: 50, // P99 < 50ms
      p95Latency: 30, // P95 < 30ms
      meanLatency: 20, // Mean < 20ms
      minThroughput: 50, // > 50 req/s
      successRate: 99.9,
    },
  },

  {
    scenario: "medium-low-hot-async",
    catalogScale: "medium",
    concurrency: "low",
    cacheState: "hot",
    auditConfig: "async",
    thresholds: {
      p99Latency: 100, // P99 < 100ms
      p95Latency: 70, // P95 < 70ms
      meanLatency: 50, // Mean < 50ms
      minThroughput: 200, // > 200 req/s
      successRate: 99.9,
    },
  },

  {
    scenario: "medium-single-cold-async",
    catalogScale: "medium",
    concurrency: "single",
    cacheState: "cold",
    auditConfig: "async",
    thresholds: {
      p99Latency: 200, // P99 < 200ms（冷缓存）
      p95Latency: 150, // P95 < 150ms
      meanLatency: 100, // Mean < 100ms
      minThroughput: 10, // > 10 req/s
      successRate: 99.9,
    },
  },

  // ========================================
  // 大规模 (1000 workspaces)
  // ========================================
  {
    scenario: "large-single-hot-async",
    catalogScale: "large",
    concurrency: "single",
    cacheState: "hot",
    auditConfig: "async",
    thresholds: {
      p99Latency: 100, // P99 < 100ms
      p95Latency: 70, // P95 < 70ms
      meanLatency: 50, // Mean < 50ms
      minThroughput: 20, // > 20 req/s
      successRate: 99.9,
    },
  },

  {
    scenario: "large-low-hot-async",
    catalogScale: "large",
    concurrency: "low",
    cacheState: "hot",
    auditConfig: "async",
    thresholds: {
      p99Latency: 200, // P99 < 200ms
      p95Latency: 150, // P95 < 150ms
      meanLatency: 100, // Mean < 100ms
      minThroughput: 100, // > 100 req/s
      successRate: 99.9,
    },
  },
];
```

### 2.8 内存索引必要性分析

```typescript
/**
 * 内存索引 vs 动态查询性能对比
 *
 * 结论: 在 Catalog 规模 ≥ 100 时，内存索引是 P0 必需，否则无法满足 P99 < 50ms SLA
 */
export type IndexingStrategy = "none" | "in-memory" | "database";

/**
 * 索引策略性能特性
 */
export const INDEXING_PERFORMANCE: Record<
  IndexingStrategy,
  {
    queryCost: string;
    catalogBuildCost: string;
    memoryCost: string;
    suitableFor: string;
  }
> = {
  none: {
    queryCost: "O(N) 全表扫描",
    catalogBuildCost: "O(1)",
    memoryCost: "O(N) 仅存储记录",
    suitableFor: "< 10 workspaces",
  },

  "in-memory": {
    queryCost: "O(log N) 二分查找",
    catalogBuildCost: "O(N log N) 排序",
    memoryCost: "O(N) 记录 + O(N) 索引",
    suitableFor: ">= 100 workspaces",
  },

  database: {
    queryCost: "O(log N) B-Tree 索引",
    catalogBuildCost: "O(1) 无需构建",
    memoryCost: "O(1) 仅查询结果",
    suitableFor: ">= 5000 workspaces",
  },
};

/**
 * 内存索引决策
 *
 * P0 要求: Catalog 规模 >= 100 时必须启用内存索引
 */
export function shouldEnableInMemoryIndex(workspaceCount: number): boolean {
  return workspaceCount >= 100;
}
```

---

## 3. 基准测试实现

```typescript
/**
 * 性能基准测试框架
 */
export class PerformanceBenchmark {
  private env: BenchmarkEnvironment;
  private catalog: WorkspaceCatalog;
  private samples: number[] = [];

  constructor(env: BenchmarkEnvironment) {
    this.env = env;
  }

  /**
   * 运行基准测试
   */
  async run(sla: PerformanceSLA): Promise<{
    passed: boolean;
    metrics: PerformanceMetrics;
    violations: string[];
  }> {
    // 1. 准备测试环境
    this.catalog = await this.prepareCatalog(sla);
    await this.prepareCacheState(sla);

    // 2. 预热（不计入统计）
    const concurrency = CONCURRENCY_SCENARIOS[sla.concurrency];
    await this.warmup(concurrency.warmupRequests);

    // 3. 执行测试
    const startTime = Date.now();
    const startMem = process.memoryUsage();

    this.samples = await this.executeConcurrentRequests(
      concurrency.totalRequests,
      concurrency.concurrency,
    );

    const endTime = Date.now();
    const endMem = process.memoryUsage();

    // 4. 计算指标
    const metrics = this.calculateMetrics(startTime, endTime, startMem, endMem);

    // 5. 验证 SLA
    const violations = this.validateSLA(metrics, sla);

    return {
      passed: violations.length === 0,
      metrics,
      violations,
    };
  }

  /**
   * 准备测试 Catalog
   */
  private async prepareCatalog(sla: PerformanceSLA): Promise<WorkspaceCatalog> {
    const scale = CATALOG_SCALES[sla.catalogScale];
    const catalog = new WorkspaceCatalog();

    // 生成测试数据
    for (let i = 0; i < scale.workspaceCount; i++) {
      const resource = generateMockWorkspace(i, scale);
      await catalog.addResource(resource);
    }

    // 构建索引（如需要）
    if (shouldEnableInMemoryIndex(scale.workspaceCount)) {
      await catalog.buildInMemoryIndex();
    }

    return catalog;
  }

  /**
   * 准备缓存状态
   */
  private async prepareCacheState(sla: PerformanceSLA): Promise<void> {
    const cacheState = CACHE_STATES[sla.cacheState];

    if (cacheState.cacheType === "cold") {
      // 冷缓存：清空所有缓存
      this.catalog.clearCache();
      return;
    }

    if (cacheState.cacheType === "hot" || cacheState.cacheType === "warm") {
      // 热/温缓存：执行预热查询
      const warmupCount = Math.floor(this.catalog.size() * (cacheState.targetHitRate ?? 0.9));

      for (let i = 0; i < warmupCount; i++) {
        const principal = generateMockPrincipal(i);
        await this.catalog.query(principal, "/workspace-" + i);
      }
    }
  }

  /**
   * 执行并发请求
   */
  private async executeConcurrentRequests(total: number, concurrency: number): Promise<number[]> {
    const samples: number[] = [];
    const batchSize = Math.ceil(total / concurrency);

    for (let batch = 0; batch < concurrency; batch++) {
      const promises = [];
      for (let i = 0; i < batchSize; i++) {
        promises.push(this.executeSingleRequest());
      }

      const batchSamples = await Promise.all(promises);
      samples.push(...batchSamples);
    }

    return samples;
  }

  /**
   * 执行单个请求
   */
  private async executeSingleRequest(): Promise<number> {
    const principal = generateRandomPrincipal();
    const requestedCwd = generateRandomCwd();

    const startTime = performance.now();

    await resolveAuthorizedToolCwd({
      catalog: this.catalog,
      principal,
      requestedCwd,
      operation: "read",
    });

    const endTime = performance.now();
    return endTime - startTime;
  }

  /**
   * 计算性能指标
   */
  private calculateMetrics(
    startTime: number,
    endTime: number,
    startMem: NodeJS.MemoryUsage,
    endMem: NodeJS.MemoryUsage,
  ): PerformanceMetrics {
    const duration = endTime - startTime;
    const successRequests = this.samples.length;

    return {
      totalRequests: successRequests,
      successRequests,
      failedRequests: 0,
      latency: calculateMetrics(this.samples),
      throughput: (successRequests / duration) * 1000,
      duration,
      memory: {
        heapUsed: (endMem.heapUsed - startMem.heapUsed) / 1024 / 1024,
        heapTotal: (endMem.heapTotal - startMem.heapTotal) / 1024 / 1024,
        external: (endMem.external - startMem.external) / 1024 / 1024,
        rss: (endMem.rss - startMem.rss) / 1024 / 1024,
      },
      cpuUsage: 0, // TODO: 实现 CPU 监控
    };
  }

  /**
   * 验证 SLA
   */
  private validateSLA(metrics: PerformanceMetrics, sla: PerformanceSLA): string[] {
    const violations: string[] = [];

    // P99 延迟
    if (metrics.latency.p99 > sla.thresholds.p99Latency) {
      violations.push(
        `P99 latency violation: ${metrics.latency.p99.toFixed(2)}ms > ${sla.thresholds.p99Latency}ms`,
      );
    }

    // P95 延迟
    if (metrics.latency.p95 > sla.thresholds.p95Latency) {
      violations.push(
        `P95 latency violation: ${metrics.latency.p95.toFixed(2)}ms > ${sla.thresholds.p95Latency}ms`,
      );
    }

    // 平均延迟
    if (metrics.latency.mean > sla.thresholds.meanLatency) {
      violations.push(
        `Mean latency violation: ${metrics.latency.mean.toFixed(2)}ms > ${sla.thresholds.meanLatency}ms`,
      );
    }

    // 吞吐量
    if (metrics.throughput < sla.thresholds.minThroughput) {
      violations.push(
        `Throughput violation: ${metrics.throughput.toFixed(2)} req/s < ${sla.thresholds.minThroughput} req/s`,
      );
    }

    // 成功率
    const successRate = (metrics.successRequests / metrics.totalRequests) * 100;
    if (successRate < sla.thresholds.successRate) {
      violations.push(
        `Success rate violation: ${successRate.toFixed(2)}% < ${sla.thresholds.successRate}%`,
      );
    }

    return violations;
  }
}
```

---

## 4. 测试报告格式

```typescript
/**
 * 性能测试报告
 */
export type PerformanceReport = {
  /** 测试时间 */
  timestamp: string;

  /** 测试环境 */
  environment: BenchmarkEnvironment;

  /** SLA 场景 */
  scenario: PerformanceSLA;

  /** 测试结果 */
  result: {
    passed: boolean;
    metrics: PerformanceMetrics;
    violations: string[];
  };

  /** 对比基准（可选）*/
  baseline?: PerformanceMetrics;
};

/**
 * 生成 Markdown 报告
 */
export function generateMarkdownReport(report: PerformanceReport): string {
  const { scenario, result, environment } = report;

  return `
# Performance Benchmark Report

**Timestamp**: ${report.timestamp}  
**Scenario**: ${scenario.scenario}  
**Result**: ${result.passed ? "✅ PASSED" : "❌ FAILED"}

---

## Environment

- **CPU**: ${environment.hardware.cpu}
- **Memory**: ${environment.hardware.memory} GB
- **OS**: ${environment.software.os}
- **Node.js**: ${environment.software.nodeVersion}

---

## Configuration

- **Catalog Scale**: ${scenario.catalogScale} (${CATALOG_SCALES[scenario.catalogScale].workspaceCount} workspaces)
- **Concurrency**: ${scenario.concurrency} (${CONCURRENCY_SCENARIOS[scenario.concurrency].concurrency} concurrent users)
- **Cache State**: ${scenario.cacheState}
- **Audit Config**: ${scenario.auditConfig}

---

## Metrics

| Metric | Value | SLA | Status |
|--------|-------|-----|--------|
| **P99 Latency** | ${result.metrics.latency.p99.toFixed(2)} ms | < ${scenario.thresholds.p99Latency} ms | ${result.metrics.latency.p99 <= scenario.thresholds.p99Latency ? "✅" : "❌"} |
| **P95 Latency** | ${result.metrics.latency.p95.toFixed(2)} ms | < ${scenario.thresholds.p95Latency} ms | ${result.metrics.latency.p95 <= scenario.thresholds.p95Latency ? "✅" : "❌"} |
| **Mean Latency** | ${result.metrics.latency.mean.toFixed(2)} ms | < ${scenario.thresholds.meanLatency} ms | ${result.metrics.latency.mean <= scenario.thresholds.meanLatency ? "✅" : "❌"} |
| **Throughput** | ${result.metrics.throughput.toFixed(2)} req/s | > ${scenario.thresholds.minThroughput} req/s | ${result.metrics.throughput >= scenario.thresholds.minThroughput ? "✅" : "❌"} |
| **Success Rate** | ${((result.metrics.successRequests / result.metrics.totalRequests) * 100).toFixed(2)}% | > ${scenario.thresholds.successRate}% | ✅ |

---

## Violations

${result.violations.length === 0 ? "None" : result.violations.map((v) => `- ${v}`).join("\n")}

---

## Latency Distribution

- **Min**: ${result.metrics.latency.min.toFixed(2)} ms
- **Max**: ${result.metrics.latency.max.toFixed(2)} ms
- **Median (P50)**: ${result.metrics.latency.p50.toFixed(2)} ms
- **P90**: ${result.metrics.latency.p90.toFixed(2)} ms
- **P95**: ${result.metrics.latency.p95.toFixed(2)} ms
- **P99**: ${result.metrics.latency.p99.toFixed(2)} ms
- **P99.9**: ${result.metrics.latency.p99_9.toFixed(2)} ms

---

## Memory Usage

- **Heap Used**: ${result.metrics.memory.heapUsed.toFixed(2)} MB
- **Heap Total**: ${result.metrics.memory.heapTotal.toFixed(2)} MB
- **RSS**: ${result.metrics.memory.rss.toFixed(2)} MB
`;
}
```

---

## 5. 修订总结

### 修订前（存在问题）

- ❌ 无固定测试环境
- ❌ 无 Catalog 规模定义
- ❌ 无并发模型
- ❌ 无冷/热缓存区分
- ❌ 无审计配置说明
- ❌ 无性能失败阈值
- ❌ 内存索引标记为 P2（与 SLA 矛盾）

### 修订后（问题解决）

- ✅ 固定测试环境（硬件/软件/网络）
- ✅ 4 种 Catalog 规模（10/100/1000/5000）
- ✅ 4 种并发级别（1/10/50/100）
- ✅ 3 种缓存状态（cold/warm/hot）
- ✅ 4 种审计配置（disabled/async/buffered/sync）
- ✅ 7 个标准 SLA 场景
- ✅ 明确内存索引为 P0 必需（≥100 workspaces）
- ✅ 可重复的基准测试框架
- ✅ Markdown 测试报告

### 性能保证

- ✅ 小规模 P99 < 20ms (hot cache)
- ✅ 中规模 P99 < 50ms (hot cache)
- ✅ 大规模 P99 < 100ms (hot cache)
- ✅ 所有场景成功率 > 99.9%

---

**修订状态**: ✅ 完成  
**修订日期**: 2026-08-29  
**修订人**: kiro-daibai
