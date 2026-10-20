/**
 * Agent Runtime Center 控制器索引。
 *
 * 与 enterprise-asset-library 控制器同构，提供 5 个独立 state slice：
 * - runtime-catalog        Agent 实例目录
 * - capability-bindings    运行时能力绑定操作
 * - deployment-lifecycle   生命周期转换 + Projection 钩子
 * - governance             治理问题与策略配置
 * - runtime-health         健康摘要 + 时间序列 + 健康事件
 *
 * 调用方应仅从此 index 引入相关符号，便于后续重组内部结构。
 */

export * from "./runtime-catalog.ts";
export * from "./capability-bindings.ts";
export * from "./deployment-lifecycle.ts";
export * from "./governance.ts";
export * from "./runtime-health.ts";
