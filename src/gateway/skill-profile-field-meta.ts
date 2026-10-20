export type ProfileFieldSource = "user" | "inferred" | "system";

export type ProfileFieldMeta = {
  source: ProfileFieldSource;
  confidence: number;
};

export type TrackedProfileField =
  | "name"
  | "summary"
  | "assetType"
  | "usageExamples"
  | "inputDescription"
  | "outputDescription"
  | "tags"
  | "category";

export type ProfileFieldMetaMap = Partial<Record<TrackedProfileField, ProfileFieldMeta>>;

const SOURCE_RANK: Record<ProfileFieldSource, number> = {
  user: 3,
  system: 2,
  inferred: 1,
};

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function createFieldMeta(source: ProfileFieldSource, confidence: number): ProfileFieldMeta {
  return { source, confidence: clampConfidence(confidence) };
}

/** Legacy profiles without metadata: non-empty fields are treated as weak inferred. */
export function resolveEffectiveFieldMeta(
  field: TrackedProfileField,
  value: unknown,
  meta: ProfileFieldMeta | undefined,
): ProfileFieldMeta {
  if (meta) {
    return meta;
  }
  const hasValue = Array.isArray(value)
    ? value.length > 0
    : typeof value === "string"
      ? value.trim().length > 0
      : value !== undefined && value !== null && value !== "";
  if (hasValue) {
    return createFieldMeta("inferred", 0.5);
  }
  return createFieldMeta("inferred", 0);
}

export function shouldApplyProfileFieldPatch(params: {
  currentMeta: ProfileFieldMeta | undefined;
  nextMeta: ProfileFieldMeta;
  field: TrackedProfileField;
  currentValue: unknown;
}): boolean {
  const current = resolveEffectiveFieldMeta(params.field, params.currentValue, params.currentMeta);
  const next = params.nextMeta;
  if (current.source === "user") {
    return false;
  }
  if (next.source === "user") {
    return true;
  }
  if (next.source === "system" && current.source === "inferred") {
    return true;
  }
  if (next.source === "system" && current.source === "system") {
    return next.confidence >= current.confidence;
  }
  if (next.source === "inferred" && current.source === "inferred") {
    return next.confidence > current.confidence;
  }
  if (SOURCE_RANK[next.source] > SOURCE_RANK[current.source]) {
    return true;
  }
  return false;
}

export function markUserProfileFields(
  meta: ProfileFieldMetaMap | undefined,
  fields: TrackedProfileField[],
): ProfileFieldMetaMap {
  const next = { ...meta };
  for (const field of fields) {
    next[field] = createFieldMeta("user", 1);
  }
  return next;
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

/** Detect profile fields the user changed during manual edit. */
export function detectUserEditedProfileFields(
  current: MergeableProfile,
  patch: Partial<MergeableProfile>,
): TrackedProfileField[] {
  const fields: TrackedProfileField[] = [];
  if (patch.name !== undefined && patch.name !== current.name) {
    fields.push("name");
  }
  if (patch.summary !== undefined && patch.summary !== current.summary) {
    fields.push("summary");
  }
  if (patch.inputDescription !== undefined && patch.inputDescription !== current.inputDescription) {
    fields.push("inputDescription");
  }
  if (
    patch.outputDescription !== undefined &&
    patch.outputDescription !== current.outputDescription
  ) {
    fields.push("outputDescription");
  }
  if (patch.category !== undefined && patch.category !== current.category) {
    fields.push("category");
  }
  if (
    patch.usageExamples !== undefined &&
    !stringArraysEqual(patch.usageExamples, current.usageExamples)
  ) {
    fields.push("usageExamples");
  }
  if (patch.tags !== undefined && !stringArraysEqual(patch.tags, current.tags)) {
    fields.push("tags");
  }
  return fields;
}

type MergeableProfile = {
  name: string;
  summary: string;
  assetType: string;
  usageExamples: string[];
  inputDescription: string;
  outputDescription: string;
  tags: string[];
  category: string;
};

type ProfilePatch = Partial<MergeableProfile>;

export function mergeSkillProfileWithFieldMeta<T extends MergeableProfile>(params: {
  profile: T;
  fieldMeta?: ProfileFieldMetaMap;
  patch: ProfilePatch;
  patchMeta: ProfileFieldSource;
  patchConfidence: number;
}): { profile: T; fieldMeta: ProfileFieldMetaMap } {
  const fieldMeta: ProfileFieldMetaMap = { ...params.fieldMeta };
  const nextMeta = createFieldMeta(params.patchMeta, params.patchConfidence);
  const profile = { ...params.profile };

  const applyString = (field: Extract<TrackedProfileField, keyof ProfilePatch>, value?: string) => {
    if (value === undefined) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (
      !shouldApplyProfileFieldPatch({
        currentMeta: fieldMeta[field],
        nextMeta,
        field,
        currentValue: profile[field as keyof T],
      })
    ) {
      return;
    }
    (profile as MergeableProfile)[field as keyof MergeableProfile] = trimmed as never;
    fieldMeta[field] = nextMeta;
  };

  const applyArray = (field: "usageExamples" | "tags", value?: string[]) => {
    if (!value || value.length === 0) {
      return;
    }
    if (
      !shouldApplyProfileFieldPatch({
        currentMeta: fieldMeta[field],
        nextMeta,
        field,
        currentValue: profile[field],
      })
    ) {
      return;
    }
    profile[field] = value;
    fieldMeta[field] = nextMeta;
  };

  applyString("name", params.patch.name);
  applyString("summary", params.patch.summary);
  applyString("inputDescription", params.patch.inputDescription);
  applyString("outputDescription", params.patch.outputDescription);
  applyString("category", params.patch.category);
  applyArray("usageExamples", params.patch.usageExamples);
  applyArray("tags", params.patch.tags);

  if (
    params.patch.assetType &&
    profile.assetType === "capability" &&
    shouldApplyProfileFieldPatch({
      currentMeta: fieldMeta.assetType,
      nextMeta,
      field: "assetType",
      currentValue: profile.assetType,
    })
  ) {
    profile.assetType = params.patch.assetType;
    fieldMeta.assetType = nextMeta;
  }

  return { profile, fieldMeta };
}
