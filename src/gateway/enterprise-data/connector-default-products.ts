import { YONYOU_TPLUS_CONNECTOR_ID } from "./adapters/yonyou-tplus-oauth.js";
import type {
  EnterpriseKnowledgeObjectKind,
  EnterpriseKnowledgeProjectionCategory,
  ProjectionTemplateKey,
} from "./types.js";

/**
 * One high-value read model a connector pack wants supplied as a data product.
 * Declaring a template does not by itself write a FeedItem. Supply runs on
 * successful connect or sync.
 */
export type ConnectorDefaultProductTemplate = {
  productKey: string;
  displayName: string;
  description: string;
  actionKey: string;
  version: string;
  templateKey: ProjectionTemplateKey;
  category: EnterpriseKnowledgeProjectionCategory;
  objectKind: EnterpriseKnowledgeObjectKind;
};

/**
 * 用友 T+ frontline read models. Action keys match connector-yonyou-tplus-package.
 * 凭证 is omitted: it is not a frontline list product.
 * AggregateTemplate stores a list snapshot the knowledge feed can quote.
 */
const YONYOU_TPLUS_DEFAULT_PRODUCTS: readonly ConnectorDefaultProductTemplate[] = [
  {
    productKey: "warehouse",
    displayName: "仓库",
    description: "用友 T+ 仓库目录。",
    actionKey: "erp.warehouse.query",
    version: "v1",
    templateKey: "AggregateTemplate",
    category: "inventory",
    objectKind: "data",
  },
  {
    productKey: "inventory",
    displayName: "存货",
    description: "用友 T+ 存货档案。",
    actionKey: "erp.inventory.query_page",
    version: "v1",
    templateKey: "AggregateTemplate",
    category: "inventory",
    objectKind: "data",
  },
  {
    productKey: "partner",
    displayName: "往来单位",
    description: "用友 T+ 往来单位。",
    actionKey: "erp.partner.query_page",
    version: "v1",
    templateKey: "AggregateTemplate",
    category: "customer",
    objectKind: "data",
  },
  {
    productKey: "current_stock",
    displayName: "现存量",
    description: "用友 T+ 现存量。",
    actionKey: "erp.current_stock.query",
    version: "v1",
    templateKey: "AggregateTemplate",
    category: "inventory",
    objectKind: "data",
  },
  {
    productKey: "purchase_receive",
    displayName: "采购入库",
    description: "用友 T+ 采购入库单。",
    actionKey: "erp.purchase_receive.query_list",
    version: "v1",
    templateKey: "AggregateTemplate",
    category: "inventory",
    objectKind: "data",
  },
  {
    productKey: "sale_delivery",
    displayName: "销货单",
    description: "用友 T+ 销货单。",
    actionKey: "erp.sale_delivery.query_list",
    version: "v1",
    templateKey: "AggregateTemplate",
    category: "sales",
    objectKind: "data",
  },
  {
    productKey: "sale_order",
    displayName: "销售订单",
    description: "用友 T+ 销售订单。",
    actionKey: "erp.sale_order.query_list",
    version: "v1",
    templateKey: "AggregateTemplate",
    category: "sales",
    objectKind: "data",
  },
];

const DEFAULT_PRODUCTS_BY_CONNECTOR: Record<string, readonly ConnectorDefaultProductTemplate[]> = {
  [YONYOU_TPLUS_CONNECTOR_ID]: YONYOU_TPLUS_DEFAULT_PRODUCTS,
};

export function listConnectorDefaultProducts(
  connectorId: string,
): readonly ConnectorDefaultProductTemplate[] {
  return DEFAULT_PRODUCTS_BY_CONNECTOR[connectorId.trim().toLowerCase()] ?? [];
}
