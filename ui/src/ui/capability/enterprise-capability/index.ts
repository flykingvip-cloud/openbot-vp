/**
 * 企业能力中心（Enterprise Capability Center）模块导出索引。
 *
 * 此模块为企业资产层（Enterprise Asset Layer）的对外公共面，统一以命名导出的
 * 形式重新导出本目录下的所有公共符号：
 * - `./types.ts`：纯类型定义（业务能力视图，不含运行时字段）
 * - `./endpoints.ts`：14 个 RPC 端点常量与 Request/Response 类型
 * - `./projection.ts`：EnterpriseCapabilityProjection 投影层
 * - `./gateway-client.ts`：基于 GatewayBrowserClient 的类型化客户端工厂
 *
 * 调用方应仅从此 index 引入企业能力中心相关符号，避免直接深入子模块路径，
 * 以便后续在不破坏外部 API 的前提下重组内部文件结构。
 */

export * from "./types.ts";
export * from "./endpoints.ts";
export * from "./projection.ts";
export * from "./gateway-client.ts";
