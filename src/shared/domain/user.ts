export type UserStatus = "active" | "inactive";

export type User = {
  userId: string;
  tenantId: string;
  name: string;
  role: string;
  status: UserStatus;
};
