export type GroupType = "team" | "workflow";

export type Group = {
  groupId: string;
  tenantId: string;
  name: string;
  type: GroupType;
};
