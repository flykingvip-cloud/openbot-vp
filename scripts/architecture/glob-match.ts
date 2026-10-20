/**
 * Architecture-manifest glob matcher.
 *
 * Supports `**`, `*`, and `!(a|b|c)` negation (file stem or path segment).
 * Paths are normalized to forward slashes without a leading slash.
 */

export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

/**
 * Translate a manifest glob into a RegExp anchored to the full path.
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = normalizeRepoPath(glob);

  // `dir/!(stem).ext` — any file in dir whose basename (without ext) is not stem.
  const stemNegation = normalized.match(/^(.*\/)(!\([^)]+\))\.([A-Za-z0-9]+)$/);
  if (stemNegation) {
    const [, dir, negGroup, ext] = stemNegation;
    const alts = negGroup.slice(2, -1).split("|").map(escapeRegex);
    const dirPattern = translateGlobBody(dir, { trailingSlash: true });
    return new RegExp(`^${dirPattern}(?!${alts.join("|")}\\.${ext}$)[^/]+\\.${ext}$`);
  }

  return new RegExp(`^${translateGlobBody(normalized, { trailingSlash: false })}$`);
}

function translateGlobBody(glob: string, params: { trailingSlash: boolean }): string {
  let pattern = "";
  let index = 0;

  while (index < glob.length) {
    const rest = glob.slice(index);

    const negation = rest.match(/^!\(([^)]+)\)/);
    if (negation) {
      const alternatives = negation[1].split("|").map(escapeRegex);
      pattern += `(?!${alternatives.join("|")})`;
      index += negation[0].length;
      continue;
    }

    if (rest.startsWith("**")) {
      pattern += ".*";
      index += 2;
      continue;
    }

    if (rest.startsWith("*")) {
      pattern += "[^/]*";
      index += 1;
      continue;
    }

    const char = glob[index];
    if (char === "?") {
      pattern += "[^/]";
      index += 1;
      continue;
    }

    pattern += escapeRegex(char ?? "");
    index += 1;
  }

  void params.trailingSlash;
  return pattern;
}

export function matchesGlob(filePath: string, glob: string): boolean {
  return globToRegExp(glob).test(normalizeRepoPath(filePath));
}
