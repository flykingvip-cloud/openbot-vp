import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export type ExportRow = {
  exportName: string;
  kind: string;
  signature: string;
};

export type SnapshotFile = {
  targetRel: string;
  targetAbs: string;
  rows: ExportRow[];
};

const BASELINE_DIR = path.join(
  process.cwd(),
  ".kiro/specs/gateway-plugins-monolith-decomposition/baseline",
);

const EXPORT_KINDS = new Set([
  "function",
  "type",
  "const",
  "interface",
  "enum",
  "namespace",
  "class",
]);

export function normalizeSignature(signature: string): string {
  return signature.replace(/\s+/g, " ").trim();
}

/**
 * Normalize function return-type syntax so `): T` and `=> T` compare equal.
 */
export function signaturesCompatible(expected: string, live: string): boolean {
  const normExpected = normalizeSignature(expected).replace(/\)\s*:\s+/g, ") => ");
  const normLive = normalizeSignature(live).replace(/\)\s*:\s+/g, ") => ");
  return normExpected === normLive;
}

function parseSnapshotMarkdown(content: string): SnapshotFile | null {
  const targetMatch = content.match(/^# Public Export Surface — (src\/[^\s]+)\s*$/m);
  if (!targetMatch) {
    return null;
  }
  const targetRel = targetMatch[1];
  const rows: ExportRow[] = [];
  for (const line of content.split("\n")) {
    if (!line.startsWith("|") || line.includes("exportName") || line.startsWith("| ---")) {
      continue;
    }
    // The extractor escapes literal pipes in signatures as `\|`; protect them
    // before splitting on the column separator, then restore afterwards.
    const PIPE_SENTINEL = "\u0000";
    const cells = line
      .replace(/\\\|/g, PIPE_SENTINEL)
      .split("|")
      .map((cell) => cell.trim().replace(new RegExp(PIPE_SENTINEL, "g"), "|"))
      .filter(Boolean);
    if (cells.length < 3) {
      continue;
    }
    const [exportName, kind, signature] = cells;
    if (!exportName || exportName.startsWith("\\") || !EXPORT_KINDS.has(kind)) {
      continue;
    }
    rows.push({
      exportName,
      kind,
      signature: normalizeSignature(signature),
    });
  }
  return {
    targetRel,
    targetAbs: path.resolve(process.cwd(), targetRel),
    rows,
  };
}

export function discoverSnapshotFiles(targetPrefix: string): SnapshotFile[] {
  if (!fs.existsSync(BASELINE_DIR)) {
    return [];
  }
  const snapshots: SnapshotFile[] = [];
  for (const entry of fs.readdirSync(BASELINE_DIR)) {
    if (!entry.endsWith(".md")) {
      continue;
    }
    if (entry.endsWith("-consumers.md") || entry.endsWith("-closure-probe.md")) {
      continue;
    }
    const snapshot = parseSnapshotMarkdown(fs.readFileSync(path.join(BASELINE_DIR, entry), "utf8"));
    if (snapshot && snapshot.targetRel.startsWith(targetPrefix)) {
      snapshots.push(snapshot);
    }
  }
  return snapshots.toSorted((a, b) => a.targetRel.localeCompare(b.targetRel));
}

function exportKindName(
  resolved: ts.Symbol,
  decl: ts.Declaration,
  checker: ts.TypeChecker,
): string {
  const type = checker.getTypeOfSymbolAtLocation(resolved, decl);
  if (type.getCallSignatures().length > 0) {
    return "function";
  }
  if (ts.isFunctionDeclaration(decl) || ts.isFunctionLike(decl)) {
    return "function";
  }
  if (ts.isClassDeclaration(decl)) {
    return "class";
  }
  if (ts.isInterfaceDeclaration(decl)) {
    return "interface";
  }
  if (ts.isTypeAliasDeclaration(decl)) {
    return "type";
  }
  if (ts.isEnumDeclaration(decl)) {
    return "enum";
  }
  if (ts.isModuleDeclaration(decl)) {
    return "namespace";
  }
  if (
    resolved.flags & ts.SymbolFlags.Type ||
    resolved.flags & ts.SymbolFlags.TypeAlias ||
    resolved.flags & ts.SymbolFlags.Interface
  ) {
    return "type";
  }
  return "const";
}

export function extractLiveExports(targetAbs: string): Map<string, ExportRow> {
  const program = ts.createProgram([targetAbs], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(targetAbs);
  const live = new Map<string, ExportRow>();
  if (!source) {
    return live;
  }

  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) {
    return live;
  }

  const exports = checker.getExportsOfModule(moduleSymbol);
  for (const symbol of exports) {
    const name = symbol.getName();
    if (name === "default") {
      continue;
    }
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declarations = resolved.getDeclarations();
    if (!declarations?.length) {
      continue;
    }
    const decl = declarations[0];
    const kind = exportKindName(resolved, decl, checker);
    let signature = name;
    const symbolType = checker.getTypeOfSymbolAtLocation(resolved, decl);
    const callSignatures = symbolType.getCallSignatures();
    if (kind === "function" && ts.isFunctionDeclaration(decl) && decl.type) {
      signature = normalizeSignature(checker.typeToString(checker.getTypeFromTypeNode(decl.type)));
    } else if (kind === "function" && callSignatures.length > 0) {
      signature = normalizeSignature(checker.signatureToString(callSignatures[0]));
    } else if (kind === "type" || kind === "interface") {
      signature = normalizeSignature(checker.typeToString(symbolType));
    } else if (kind === "const") {
      signature = normalizeSignature(checker.typeToString(symbolType));
    } else {
      signature = name;
    }
    live.set(name, { exportName: name, kind, signature });
  }

  return live;
}
