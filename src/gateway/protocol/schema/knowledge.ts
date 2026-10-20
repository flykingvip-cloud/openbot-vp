import { Type, type Static } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const KnowledgeDocumentPreviewParamsSchema = Type.Object(
  {
    knowledgeBaseId: NonEmptyString,
    documentId: NonEmptyString,
    render: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type KnowledgeDocumentPreviewParams = Static<typeof KnowledgeDocumentPreviewParamsSchema>;

export const KnowledgeDocumentPreviewResultSchema = Type.Object(
  {
    filename: NonEmptyString,
    relativePath: Type.Optional(Type.String()),
    mimeType: NonEmptyString,
    byteLength: Type.Integer({ minimum: 0 }),
    textLike: Type.Boolean(),
    renderKind: Type.Optional(Type.Literal("html")),
    html: Type.Optional(Type.String()),
    base64: Type.Optional(Type.String()),
    source: Type.Optional(
      Type.Union([Type.Literal("original_store"), Type.Literal("local_index")]),
    ),
  },
  { additionalProperties: false },
);

export type KnowledgeDocumentPreviewResult = Static<typeof KnowledgeDocumentPreviewResultSchema>;
