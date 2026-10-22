import { listConnectorActions } from "./connector-action-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { listRuntimeRegistryEntries } from "./runtime-registry.js";
import type {
  DataConnectorAccessMethod,
  DataSourceCategory,
  EnterpriseDataStore,
} from "./types.js";

export type DataConnectorCredentialKind = "none" | "api_key" | "oauth2";

export type DataConnectorIntegrationTier = "demo" | "production";

export type DataConnectorCatalogDefinition = {
  connectorId: string;
  label: string;
  category: DataSourceCategory;
  integrationTier: DataConnectorIntegrationTier;
  credentialKind: DataConnectorCredentialKind;
  /**
   * Credential connectors use api_key or oauth2. Website session connectors
   * reference AccountBinding.bindingId and do not pretend to be an api_key.
   */
  accessMethod: DataConnectorAccessMethod;
  description: string;
  /** Suggested sourceKey when registering a DataSource. */
  defaultSourceKey: string;
};

export const DATA_CONNECTOR_CATALOG: DataConnectorCatalogDefinition[] = [
  {
    connectorId: "crm-salesforce",
    label: "Salesforce CRM",
    category: "crm",
    integrationTier: "demo",
    credentialKind: "oauth2",
    accessMethod: "credential",
    description:
      "客户摘要、细分与导出能力（演示包默认 Mock；通过 Salesforce OAuth 授权后可真实探测并调用 API）。",
    defaultSourceKey: "crm-salesforce",
  },
  {
    connectorId: "erp-sap",
    label: "SAP ERP",
    category: "erp",
    integrationTier: "demo",
    credentialKind: "api_key",
    accessMethod: "credential",
    description:
      "订单状态查询能力（演示包默认 Mock；绑定 API Key/Basic 凭证后可对 SAP OData 服务真实探测并调用）。",
    defaultSourceKey: "erp-sap",
  },
  {
    connectorId: "notion",
    label: "Notion",
    category: "oa",
    integrationTier: "production",
    credentialKind: "oauth2",
    accessMethod: "credential",
    description: "企业知识库页面与数据库同步（需 OAuth 凭证，Action 目录待安装）。",
    defaultSourceKey: "notion-kb",
  },
  {
    connectorId: "http-rest",
    label: "HTTP REST API",
    category: "external",
    integrationTier: "production",
    credentialKind: "api_key",
    accessMethod: "credential",
    description:
      "通用 REST/HTTP API 连接器：绑定基础 URL 与访问令牌（支持 Bearer / 自定义头 / 查询参数 / Basic / 无鉴权，可配置健康检查路径）后，可探测连通性并按只读端点取数，用于接入内部/外部自有 API。",
    defaultSourceKey: "http-rest",
  },
  {
    connectorId: "db-postgres",
    label: "PostgreSQL",
    category: "external",
    integrationTier: "production",
    credentialKind: "api_key",
    accessMethod: "credential",
    description:
      "关系型数据库连接器：绑定连接串（postgres://host:5432/dbname）+ 数据库用户与密码后，执行 SELECT 1 探测连通性并运行只读 SQL 取数。建议使用只读数据库角色。",
    defaultSourceKey: "db-postgres",
  },
  {
    connectorId: "db-mysql",
    label: "MySQL",
    category: "external",
    integrationTier: "production",
    credentialKind: "api_key",
    accessMethod: "credential",
    description:
      "关系型数据库连接器：绑定连接串（mysql://host:3306/dbname）+ 数据库用户与密码后，执行 SELECT 1 探测连通性并运行只读 SQL 取数。建议使用只读数据库角色。",
    defaultSourceKey: "db-mysql",
  },
  {
    connectorId: "erp-yonyou-tplus",
    label: "用友 T+",
    category: "erp",
    integrationTier: "production",
    credentialKind: "oauth2",
    accessMethod: "credential",
    description:
      "畅捷通 T+ / T+Cloud（应用入驻 OAuth）。安装连接器包后，用 appKey、appSecret 与 openToken 探测 accountAPI/GetVersionInfo；已保存的 refresh token 或永久授权码会在探测时续期并写回保险库。读取仓库、存货、往来单位、销售订单、销货单与凭证。",
    defaultSourceKey: "yonyou-tplus",
  },
  {
    connectorId: "site-session",
    label: "网站会话",
    category: "external",
    integrationTier: "production",
    credentialKind: "none",
    accessMethod: "website_session",
    description:
      "网站会话接入。账户以 AccountBinding.bindingId 引用，不使用 api_key。不默认安装动作包，不把 mock 探测记成生产成功。业务分类仍用数据源上的 crm、erp 或 external。",
    defaultSourceKey: "site-session",
  },
];

export type DataConnectorCatalogEntry = DataConnectorCatalogDefinition & {
  registeredActionCount: number;
  runtimeHandlerCount: number;
  ready: boolean;
};

export function findDataConnectorDefinition(
  connectorId: string,
): DataConnectorCatalogDefinition | null {
  const normalized = connectorId.trim().toLowerCase();
  return (
    DATA_CONNECTOR_CATALOG.find((entry) => entry.connectorId.toLowerCase() === normalized) ?? null
  );
}

export function resolveDataConnectorCatalog(params: {
  store: EnterpriseDataStore;
  tenantId: string;
}): DataConnectorCatalogEntry[] {
  return DATA_CONNECTOR_CATALOG.map((definition) => {
    const registeredActionCount = listConnectorActions({
      store: params.store,
      tenantId: params.tenantId,
      connectorId: definition.connectorId,
    }).length;
    const runtimeHandlerCount = listRuntimeRegistryEntries({
      store: params.store,
      tenantId: params.tenantId,
      connectorId: definition.connectorId,
    }).length;
    return {
      ...definition,
      registeredActionCount,
      runtimeHandlerCount,
      ready: registeredActionCount > 0 && runtimeHandlerCount > 0,
    };
  });
}

export function assertKnownDataConnector(connectorId: string): DataConnectorCatalogDefinition {
  const definition = findDataConnectorDefinition(connectorId);
  if (!definition) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_NOT_IN_CATALOG",
      `Connector ${connectorId} is not in the enterprise data connector catalog.`,
    );
  }
  return definition;
}
