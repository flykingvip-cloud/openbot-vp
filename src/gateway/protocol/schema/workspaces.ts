import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const WorkspaceStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("testing"),
  Type.Literal("ready"),
  Type.Literal("error"),
]);

export const WorkspaceKindSchema = Type.Union([Type.Literal("local"), Type.Literal("cloud")]);

export const CloudWorkspaceProviderSchema = Type.Union([
  Type.Literal("aliyun-oss"),
  Type.Literal("aws-s3"),
  Type.Literal("azure-blob"),
  Type.Literal("huawei-obs"),
  Type.Literal("s3-compatible"),
]);

export const WorkspaceLocalValidateParamsSchema = Type.Object(
  { path: NonEmptyString },
  { additionalProperties: false },
);

export const WorkspaceLocalValidateResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    resolvedPath: NonEmptyString,
    isDirectory: Type.Boolean(),
    readable: Type.Boolean(),
    writable: Type.Boolean(),
    errorCode: Type.Optional(NonEmptyString),
    message: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkspaceLocalBrowseParamsSchema = Type.Object(
  { path: Type.Optional(NonEmptyString) },
  { additionalProperties: false },
);

export const WorkspaceLocalChooseParamsSchema = Type.Object(
  {
    path: Type.Optional(NonEmptyString),
    title: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const WorkspaceLocalChooseResultSchema = Type.Object(
  {
    cancelled: Type.Boolean(),
    path: Type.Optional(NonEmptyString),
    message: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkspaceDirectoryEntrySchema = Type.Object(
  {
    name: NonEmptyString,
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkspaceLocalBrowseResultSchema = Type.Object(
  {
    currentPath: NonEmptyString,
    parentPath: Type.Optional(NonEmptyString),
    entries: Type.Array(WorkspaceDirectoryEntrySchema),
  },
  { additionalProperties: false },
);

export const WorkspaceCloudGenerateConfigParamsSchema = Type.Object(
  {
    provider: CloudWorkspaceProviderSchema,
    region: Type.Optional(NonEmptyString),
    bucket: Type.Optional(NonEmptyString),
    rootPrefix: Type.Optional(Type.String()),
    endpoint: Type.Optional(NonEmptyString),
    accountName: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const WorkspaceCloudGeneratedConfigSchema = Type.Object(
  {
    provider: CloudWorkspaceProviderSchema,
    endpoint: NonEmptyString,
    bucket: NonEmptyString,
    rootPrefix: Type.String(),
    region: Type.Optional(NonEmptyString),
    accountName: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const WorkspaceCloudTestConnectionParamsSchema = Type.Object(
  {
    provider: CloudWorkspaceProviderSchema,
    region: Type.Optional(NonEmptyString),
    bucket: Type.Optional(NonEmptyString),
    rootPrefix: Type.Optional(Type.String()),
    endpoint: Type.Optional(NonEmptyString),
    accountName: Type.Optional(NonEmptyString),
    accessKeyId: NonEmptyString,
    secretAccessKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkspaceCloudTestConnectionResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    capabilities: Type.Object(
      {
        canRead: Type.Boolean(),
        canWrite: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const WorkspaceCloudBrowseParamsSchema = Type.Object(
  {
    provider: CloudWorkspaceProviderSchema,
    region: Type.Optional(NonEmptyString),
    bucket: Type.Optional(NonEmptyString),
    rootPrefix: Type.Optional(Type.String()),
    endpoint: Type.Optional(NonEmptyString),
    accountName: Type.Optional(NonEmptyString),
    accessKeyId: NonEmptyString,
    secretAccessKey: NonEmptyString,
    path: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkspaceCloudBrowseResultSchema = Type.Object(
  {
    bucket: NonEmptyString,
    currentPath: Type.String(),
    parentPath: Type.Optional(Type.String()),
    directories: Type.Array(WorkspaceDirectoryEntrySchema),
  },
  { additionalProperties: false },
);

export const WorkspaceCredentialInputSchema = Type.Object(
  {
    accessKeyId: NonEmptyString,
    secretAccessKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkspaceRecordSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    kind: WorkspaceKindSchema,
    status: WorkspaceStatusSchema,
    runtimePath: NonEmptyString,
    createdAt: NonEmptyString,
    updatedAt: NonEmptyString,
    credentialRef: Type.Optional(NonEmptyString),
    lastError: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    local: Type.Optional(
      Type.Object(
        {
          path: NonEmptyString,
          resolvedPath: NonEmptyString,
          readable: Type.Boolean(),
          writable: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    cloud: Type.Optional(
      Type.Object(
        {
          provider: CloudWorkspaceProviderSchema,
          endpoint: NonEmptyString,
          bucket: NonEmptyString,
          rootPrefix: Type.String(),
          region: Type.Optional(NonEmptyString),
          accountName: Type.Optional(NonEmptyString),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const WorkspacesCreateParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    kind: WorkspaceKindSchema,
    local: Type.Optional(Type.Object({ path: NonEmptyString }, { additionalProperties: false })),
    cloud: Type.Optional(
      Type.Object(
        {
          provider: CloudWorkspaceProviderSchema,
          region: Type.Optional(NonEmptyString),
          bucket: Type.Optional(NonEmptyString),
          rootPrefix: Type.Optional(Type.String()),
          endpoint: Type.Optional(NonEmptyString),
          accountName: Type.Optional(NonEmptyString),
        },
        { additionalProperties: false },
      ),
    ),
    credentials: Type.Optional(WorkspaceCredentialInputSchema),
  },
  { additionalProperties: false },
);

export const WorkspacesCreateResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    workspaceId: NonEmptyString,
    runtimePath: NonEmptyString,
    workspace: WorkspaceRecordSchema,
  },
  { additionalProperties: false },
);

export const RobotsBindWorkspaceParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    workspaceId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const RobotsBindWorkspaceResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
    workspaceId: NonEmptyString,
  },
  { additionalProperties: false },
);
