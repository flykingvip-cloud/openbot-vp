/**
 * Batch 8 active-skill terminology.
 *
 * Shared by every bot. A turn bound to a skill, or a deliverables/smoke trial,
 * gets a short disambiguation for that skill's keywords. The platform table
 * covers consulting-report-forge. A skill may add or replace terms with the
 * frontmatter field `terminology` (the manifest hook).
 *
 * Compact form, one or more terms separated by `;`:
 * `绑定=analysis-review与task.json的sha256对照|微信/邮箱/知识源/OAuth`
 */
export type SkillTerm = {
  term: string;
  meaning: string;
  not: readonly string[];
};

export type SkillGlossaryEntry = {
  skillId: string;
  aliases: readonly string[];
  terms: readonly SkillTerm[];
};

export type SkillGlossaryManifest = {
  skillId: string;
  frontmatter?: Record<string, string>;
};

const SMOKE_TRIAL_RE =
  /技能试跑|deliverables\/smoke|\bsmoke\b|样张|skill孵化|consulting-report|analysis-review/iu;

export const PLATFORM_SKILL_GLOSSARY: readonly SkillGlossaryEntry[] = [
  {
    skillId: "consulting-report-forge",
    aliases: [
      "consulting-report",
      "consulting-report-forge",
      "skill孵化",
      "analysis-review",
      "样张",
      "smoke",
    ],
    terms: [
      {
        term: "绑定",
        meaning: "analysis-review 与 task.json 的 sha256 对照",
        not: ["微信", "邮箱", "知识源", "OAuth", "运营身份"],
      },
    ],
  },
];

/** Same words Batch 6 left as a stub. The table above is the source. */
export const SKILL_BIND_GLOSSARY_STUB = {
  term: PLATFORM_SKILL_GLOSSARY[0]?.terms[0]?.term ?? "绑定",
  meaning: PLATFORM_SKILL_GLOSSARY[0]?.terms[0]?.meaning ?? "",
  not: PLATFORM_SKILL_GLOSSARY[0]?.terms[0]?.not ?? [],
} as const;

export function parseSkillTerminologyField(raw: string | undefined): SkillTerm[] {
  const text = raw?.trim();
  if (!text) {
    return [];
  }
  const terms: SkillTerm[] = [];
  for (const chunk of text.split(";")) {
    const piece = chunk.trim();
    if (!piece) {
      continue;
    }
    const eq = piece.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const term = piece.slice(0, eq).trim();
    const rest = piece.slice(eq + 1).trim();
    const bar = rest.indexOf("|");
    const meaning = (bar >= 0 ? rest.slice(0, bar) : rest).trim();
    const not =
      bar >= 0
        ? rest
            .slice(bar + 1)
            .split("/")
            .map((token) => token.trim())
            .filter((token) => token.length > 0)
        : [];
    if (!term || !meaning) {
      continue;
    }
    terms.push({ term, meaning, not });
  }
  return terms;
}

function manifestTerms(manifest: SkillGlossaryManifest | undefined): SkillTerm[] {
  return parseSkillTerminologyField(manifest?.frontmatter?.terminology);
}

function platformEntry(skillId: string): SkillGlossaryEntry | undefined {
  const key = skillId.trim().toLowerCase();
  return PLATFORM_SKILL_GLOSSARY.find(
    (entry) =>
      entry.skillId.toLowerCase() === key ||
      entry.aliases.some((alias) => alias.toLowerCase() === key),
  );
}

function entryMatchesText(entry: SkillGlossaryEntry, text: string): boolean {
  const haystack = text.toLowerCase();
  if (haystack.includes(entry.skillId.toLowerCase())) {
    return true;
  }
  return entry.aliases.some((alias) => alias && haystack.includes(alias.toLowerCase()));
}

function mergeEntry(
  skillId: string,
  manifest: SkillGlossaryManifest | undefined,
): SkillGlossaryEntry | null {
  const platform = platformEntry(skillId);
  const fromManifest = manifestTerms(manifest);
  if (!platform && fromManifest.length === 0) {
    return null;
  }
  const id = platform?.skillId ?? manifest?.skillId ?? skillId;
  return {
    skillId: id,
    aliases: platform?.aliases ?? [id],
    terms: fromManifest.length > 0 ? fromManifest : (platform?.terms ?? []),
  };
}

export function resolveActiveSkillGlossary(params: {
  userText?: string;
  boundSkillIds?: readonly string[];
  manifests?: readonly SkillGlossaryManifest[];
}): SkillGlossaryEntry[] {
  const userText = params.userText ?? "";
  const manifests = params.manifests ?? [];
  const manifestById = new Map(
    manifests.map((manifest) => [manifest.skillId.toLowerCase(), manifest]),
  );
  const wanted = new Set<string>();

  for (const id of params.boundSkillIds ?? []) {
    const trimmed = id.trim();
    if (trimmed) {
      wanted.add(trimmed);
    }
  }
  for (const manifest of manifests) {
    const entry = mergeEntry(manifest.skillId, manifest);
    if (entry && entryMatchesText(entry, userText)) {
      wanted.add(entry.skillId);
    }
  }
  for (const entry of PLATFORM_SKILL_GLOSSARY) {
    if (entryMatchesText(entry, userText)) {
      wanted.add(entry.skillId);
    }
  }
  if (SMOKE_TRIAL_RE.test(userText)) {
    wanted.add("consulting-report-forge");
  }

  const resolved: SkillGlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const id of wanted) {
    const platform = platformEntry(id);
    const canonical = platform?.skillId ?? id;
    const key = canonical.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    const manifest =
      manifestById.get(key) ??
      manifestById.get(id.toLowerCase()) ??
      manifests.find((item) => platformEntry(item.skillId)?.skillId.toLowerCase() === key);
    const entry = mergeEntry(canonical, manifest);
    if (!entry || entry.terms.length === 0) {
      continue;
    }
    seen.add(key);
    resolved.push(entry);
  }
  return resolved;
}

/** Short block injected into the shared turn prompt. Empty when no skill is active. */
export function formatActiveSkillGlossary(params: {
  userText?: string;
  boundSkillIds?: readonly string[];
  manifests?: readonly SkillGlossaryManifest[];
}): string {
  const entries = resolveActiveSkillGlossary(params);
  if (entries.length === 0) {
    return "";
  }
  const lines = ["活动技能术语（平台，全 bot 共用）："];
  for (const entry of entries) {
    for (const term of entry.terms) {
      const banned = term.not.length > 0 ? term.not.join("、") : "无关平台概念";
      lines.push(
        `${term.term} = ${term.meaning}。不是${banned}。不要停下来问这个词指哪一种账号或 OAuth 绑定。`,
      );
    }
  }
  return lines.join("\n");
}

function entriesForStopAsk(text: string, context: string): SkillGlossaryEntry[] {
  const blob = `${context}\n${text}`;
  const active = resolveActiveSkillGlossary({ userText: blob });
  const extra = PLATFORM_SKILL_GLOSSARY.filter((entry) =>
    entry.terms.some((term) => text.includes(term.term)),
  );
  const merged: SkillGlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...active, ...extra]) {
    const key = entry.skillId.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

/**
 * The assistant is asking a skill keyword as if it were an unrelated platform
 * concept (the consulting-report「绑定」→ WeChat/email/OAuth stop).
 */
export function isActiveSkillTerminologyStopAsk(text: string, context = ""): boolean {
  const blob = `${context}\n${text}`;
  for (const entry of entriesForStopAsk(text, context)) {
    const inScope =
      entryMatchesText(entry, blob) ||
      SMOKE_TRIAL_RE.test(blob) ||
      /sha256|task\.json|审查记录/iu.test(blob);
    for (const term of entry.terms) {
      if (!text.includes(term.term)) {
        continue;
      }
      const hits = term.not.filter((token) => text.includes(token));
      if (!inScope && hits.length < 2) {
        continue;
      }
      if (hits.length > 0 || /绑定方向|[？?]|哪一|还是/.test(text)) {
        return true;
      }
    }
  }
  return false;
}
