export const ORGANIZATION_IMPORT_TEMPLATE_FILENAME = "openbot-organization-template.csv";

export const ORGANIZATION_IMPORT_TEMPLATE_CSV = `姓名,邮箱,部门,岗位,上级部门,岗位职责
张三,zhangsan@example.com,华东区,销售总监,销售部,负责华东区域销售管理
李四,lisi@example.com,销售部/市场部,市场经理,,负责市场推广与品牌
王五,wangwu@example.com,财务部,财务专员,,负责日常账务
`;

export function downloadOrganizationImportTemplate() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const blob = new Blob([`\uFEFF${ORGANIZATION_IMPORT_TEMPLATE_CSV}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = ORGANIZATION_IMPORT_TEMPLATE_FILENAME;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}
