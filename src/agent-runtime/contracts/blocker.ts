export type BlockerGrade = "mainline" | "side_path" | "already_cleared";

export type EnvProbe = {
  reason: string;
  passed: boolean;
};
