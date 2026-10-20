/**
 * P2-OFFLINE golden samples. Data only — importing does not create agents.
 */

export type CompilerCaseId =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N";

export type CompilerFixture = {
  id: CompilerCaseId;
  rawRequest: string;
  revision?: string;
  gold: {
    resolutionKind: "published" | "custom_draft";
    blueprintId?: string;
    validation: "valid" | "valid_with_gaps" | "invalid";
    policy?: Array<{ id: string; effect: "recommended" | "confirmation_required" | "disabled" }>;
    expectMissingCritical?: boolean;
    unresolvedNeed?: string;
    recipeId?: string;
    sharedSkillKey?: string;
    schedule?: string;
    canConfirm?: boolean;
  };
};

export const COMPILER_FIXTURES: readonly CompilerFixture[] = [
  {
    id: "A",
    rawRequest: "创建销售助理，跟进 CRM，出销售周报",
    gold: {
      resolutionKind: "published",
      blueprintId: "sales_assistant",
      validation: "valid",
      canConfirm: true,
    },
  },
  {
    id: "B",
    rawRequest: "每天帮我看销售数据，发现异常提醒我，每周一给我一个总结",
    gold: {
      resolutionKind: "published",
      blueprintId: "sales_operations_analyst",
      validation: "valid",
      schedule: "每天",
      canConfirm: true,
    },
  },
  {
    id: "C",
    rawRequest: "监控竞品价格、分析内容、每周报告",
    gold: {
      resolutionKind: "published",
      blueprintId: "market_analyst",
      validation: "valid",
      canConfirm: true,
    },
  },
  {
    id: "D",
    rawRequest: "能看 CRM，不能改 CRM",
    gold: {
      resolutionKind: "custom_draft",
      validation: "valid",
      policy: [{ id: "crm.write", effect: "disabled" }],
      canConfirm: true,
    },
  },
  {
    id: "E",
    rawRequest: "创建一个营销员工，可以直接发布公众号文章",
    gold: {
      resolutionKind: "custom_draft",
      validation: "valid",
      policy: [{ id: "public.publish", effect: "confirmation_required" }],
      canConfirm: true,
    },
  },
  {
    id: "F",
    rawRequest: "创建销售助理",
    revision: "CRM 只读，不能改",
    gold: {
      resolutionKind: "published",
      blueprintId: "sales_assistant",
      validation: "valid",
      policy: [{ id: "crm.write", effect: "disabled" }],
      canConfirm: true,
    },
  },
  {
    id: "G",
    rawRequest: "创建销售助理",
    gold: {
      resolutionKind: "published",
      blueprintId: "sales_assistant",
      validation: "valid",
      canConfirm: true,
    },
  },
  {
    id: "H",
    rawRequest: "创建销售助理，还要处理邮件",
    gold: {
      resolutionKind: "published",
      blueprintId: "sales_assistant",
      validation: "valid",
      recipeId: "email-communication",
      sharedSkillKey: "personal-mail-assistant",
      canConfirm: true,
    },
  },
  {
    id: "I",
    rawRequest: "我要一个财务助理",
    gold: {
      resolutionKind: "published",
      blueprintId: "finance_assistant",
      validation: "valid_with_gaps",
      expectMissingCritical: true,
      policy: [{ id: "finance.write", effect: "disabled" }],
      canConfirm: true,
    },
  },
  {
    id: "J",
    rawRequest: "分析客户流失",
    gold: {
      resolutionKind: "custom_draft",
      validation: "valid_with_gaps",
      unresolvedNeed: "customer-churn-analysis",
      canConfirm: true,
    },
  },
  {
    id: "K",
    rawRequest: "创建销售助理",
    gold: {
      resolutionKind: "published",
      blueprintId: "sales_assistant",
      validation: "valid",
      canConfirm: true,
    },
  },
  {
    id: "L",
    rawRequest: "创建销售助理",
    gold: {
      resolutionKind: "published",
      blueprintId: "sales_assistant",
      validation: "valid",
      canConfirm: true,
    },
  },
  {
    id: "M",
    rawRequest: "创建销售助理",
    gold: {
      resolutionKind: "published",
      blueprintId: "sales_assistant",
      validation: "valid",
      canConfirm: true,
    },
  },
  {
    id: "N",
    rawRequest: "创建销售助理",
    gold: {
      resolutionKind: "published",
      blueprintId: "sales_assistant",
      validation: "valid",
      canConfirm: true,
    },
  },
];
