export type WorkbenchTeamObjectKind = "assistant" | "member" | "space";

export type WorkbenchTeamObject = {
  key: string;
  kind: WorkbenchTeamObjectKind;
  alias?: string;
  createdAt: number;
  updatedAt: number;
};
