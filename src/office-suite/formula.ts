/**
 * Bounded spreadsheet formula engine.
 * Covers arithmetic, comparisons, cell refs, ranges, and a small function set.
 * Full Excel parity is intentionally not claimed.
 */
import { columnIndex, columnLetters } from "./xml.js";

export type NumberFormat = "general" | "number" | "percent" | "date" | "text";

export type CellLiteral = {
  value: string | number | boolean | null;
  format?: NumberFormat;
};

export type CellFormula = {
  formula: string;
  format?: NumberFormat;
};

export type CellInput = CellLiteral | CellFormula;

export type SheetModel = {
  name: string;
  cells: Record<string, CellInput>;
};

export type CalcIssue = {
  sheet: string;
  cell: string;
  code: string;
  message: string;
};

export type CalcResult = {
  values: Record<string, Record<string, string | number | boolean | null>>;
  display: Record<string, Record<string, string>>;
  issues: CalcIssue[];
};

type Workbook = Map<string, Map<string, CellInput>>;

const FUNCTIONS = new Set([
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "IF",
  "ROUND",
  "ABS",
  "AND",
  "OR",
  "NOT",
  "PRODUCT",
  "INT",
]);

class FormulaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

export function isFormulaCell(cell: CellInput): cell is CellFormula {
  return "formula" in cell;
}

export function recalculate(sheets: SheetModel[]): CalcResult {
  const book: Workbook = new Map();
  for (const sheet of sheets) {
    const cells = new Map<string, CellInput>();
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      cells.set(normalizeRef(ref), cell);
    }
    book.set(sheet.name, cells);
  }
  const values: CalcResult["values"] = {};
  const display: CalcResult["display"] = {};
  const issues: CalcIssue[] = [];
  for (const sheet of sheets) {
    values[sheet.name] = {};
    display[sheet.name] = {};
    const cells = book.get(sheet.name) ?? new Map();
    for (const ref of cells.keys()) {
      try {
        const value = evaluateCell(book, sheet.name, ref, []);
        values[sheet.name][ref] = value;
        display[sheet.name][ref] = formatValue(value, cells.get(ref)?.format ?? "general");
      } catch (error) {
        const code = error instanceof FormulaError ? error.code : "#VALUE!";
        const message = error instanceof Error ? error.message : "formula failed";
        values[sheet.name][ref] = null;
        display[sheet.name][ref] = code;
        issues.push({ sheet: sheet.name, cell: ref, code, message });
      }
    }
  }
  return { values, display, issues };
}

export function formatValue(value: string | number | boolean | null, format: NumberFormat): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "string") {
    return value;
  }
  if (format === "number") {
    return value.toFixed(2);
  }
  if (format === "percent") {
    return `${Math.round(value * 100)}%`;
  }
  if (format === "date") {
    return excelSerialToIso(value);
  }
  if (format === "text") {
    return String(value);
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 1e10) / 1e10);
}

export function excelSerialToIso(serial: number): string {
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  return new Date(utc).toISOString().slice(0, 10);
}

function evaluateCell(
  book: Workbook,
  sheet: string,
  ref: string,
  stack: string[],
): string | number | boolean | null {
  const key = `${sheet}!${ref}`;
  if (stack.includes(key)) {
    throw new FormulaError("#CYCLE", `circular reference at ${key}`);
  }
  const cell = book.get(sheet)?.get(ref);
  if (!cell) {
    return null;
  }
  if (!isFormulaCell(cell)) {
    return cell.value;
  }
  return evaluateFormula(book, sheet, cell.formula, [...stack, key]);
}

function evaluateFormula(
  book: Workbook,
  sheet: string,
  formula: string,
  stack: string[],
): string | number | boolean | null {
  const source = formula.trim().replace(/^=/, "");
  const parser = new Parser(source);
  const value = parser.parseComparison();
  parser.skip();
  if (!parser.eof()) {
    throw new FormulaError("#NAME?", `unexpected input near ${parser.rest()}`);
  }
  return resolve(book, sheet, value, stack);
}

type Ast =
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "ref"; sheet?: string; ref: string }
  | { type: "range"; sheet?: string; start: string; end: string }
  | { type: "bin"; op: string; left: Ast; right: Ast }
  | { type: "unary"; op: string; expr: Ast }
  | { type: "call"; name: string; args: Ast[] };

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  eof(): boolean {
    this.skip();
    return this.index >= this.source.length;
  }

  rest(): string {
    return this.source.slice(this.index, this.index + 24);
  }

  parseComparison(): Ast {
    let left = this.parseSum();
    for (;;) {
      const op = this.matchOp(["<=", ">=", "<>", "=", "<", ">"]);
      if (!op) {
        return left;
      }
      left = { type: "bin", op, left, right: this.parseSum() };
    }
  }

  parseSum(): Ast {
    let left = this.parseProduct();
    for (;;) {
      const op = this.matchOp(["+", "-"]);
      if (!op) {
        return left;
      }
      left = { type: "bin", op, left, right: this.parseProduct() };
    }
  }

  parseProduct(): Ast {
    let left = this.parseUnary();
    for (;;) {
      const op = this.matchOp(["*", "/"]);
      if (!op) {
        return left;
      }
      left = { type: "bin", op, left, right: this.parseUnary() };
    }
  }

  parseUnary(): Ast {
    this.skip();
    if (this.peek() === "-") {
      this.index += 1;
      return { type: "unary", op: "-", expr: this.parseUnary() };
    }
    if (this.peek() === "+") {
      this.index += 1;
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  parsePrimary(): Ast {
    this.skip();
    const char = this.peek();
    if (char === "(") {
      this.index += 1;
      const inner = this.parseComparison();
      this.expect(")");
      return inner;
    }
    if (char === '"') {
      return { type: "str", value: this.parseString() };
    }
    if (char >= "0" && char <= "9") {
      return { type: "num", value: this.parseNumber() };
    }
    if (char === ".") {
      return { type: "num", value: this.parseNumber() };
    }
    const ident = this.parseIdent();
    if (!ident) {
      throw new FormulaError("#NAME?", "expected a value");
    }
    if (ident.toUpperCase() === "TRUE") {
      return { type: "bool", value: true };
    }
    if (ident.toUpperCase() === "FALSE") {
      return { type: "bool", value: false };
    }
    this.skip();
    if (this.peek() === "(") {
      return this.parseCall(ident.toUpperCase());
    }
    return this.parseRefOrRange(ident);
  }

  private parseCall(name: string): Ast {
    if (!FUNCTIONS.has(name)) {
      throw new FormulaError("#NAME?", `unsupported function ${name}`);
    }
    this.expect("(");
    const args: Ast[] = [];
    this.skip();
    if (this.peek() !== ")") {
      for (;;) {
        args.push(this.parseArg());
        this.skip();
        if (this.peek() === ",") {
          this.index += 1;
          continue;
        }
        break;
      }
    }
    this.expect(")");
    return { type: "call", name, args };
  }

  private parseArg(): Ast {
    const saved = this.index;
    try {
      return this.parseComparison();
    } catch (error) {
      this.index = saved;
      if (error instanceof FormulaError && error.code === "#NAME?") {
        throw error;
      }
      throw error;
    }
  }

  private parseRefOrRange(ident: string): Ast {
    let sheet: string | undefined;
    let head = ident;
    if (ident.startsWith("'")) {
      const end = ident.lastIndexOf("'");
      sheet = ident.slice(1, end);
      head = ident.slice(end + 1);
    }
    if (head.includes("!")) {
      const [sheetName, ref] = splitSheetRef(head);
      sheet = sheetName;
      head = ref;
    }
    this.skip();
    if (this.peek() === ":") {
      this.index += 1;
      const endIdent = this.parseIdent();
      if (!endIdent) {
        throw new FormulaError("#REF!", "range is missing an end");
      }
      return { type: "range", sheet, start: normalizeRef(head), end: normalizeRef(endIdent) };
    }
    if (!/^[A-Za-z]+\d+$/.test(head)) {
      throw new FormulaError("#NAME?", `unknown name ${ident}`);
    }
    return { type: "ref", sheet, ref: normalizeRef(head) };
  }

  private parseIdent(): string {
    this.skip();
    if (this.peek() === "'") {
      const end = this.source.indexOf("'", this.index + 1);
      if (end < 0) {
        throw new FormulaError("#NAME?", "unterminated sheet name");
      }
      let cursor = end + 1;
      if (this.source[cursor] === "!") {
        cursor += 1;
      }
      while (cursor < this.source.length && /[A-Za-z0-9]/.test(this.source[cursor] ?? "")) {
        cursor += 1;
      }
      const token = this.source.slice(this.index, cursor);
      this.index = cursor;
      return token;
    }
    const start = this.index;
    while (
      this.index < this.source.length &&
      /[A-Za-z0-9_.!]/.test(this.source[this.index] ?? "")
    ) {
      this.index += 1;
    }
    return this.source.slice(start, this.index);
  }

  private parseNumber(): number {
    const start = this.index;
    while (this.index < this.source.length && /[0-9.]/.test(this.source[this.index] ?? "")) {
      this.index += 1;
    }
    const value = Number(this.source.slice(start, this.index));
    if (!Number.isFinite(value)) {
      throw new FormulaError("#VALUE!", "invalid number");
    }
    return value;
  }

  private parseString(): string {
    this.index += 1;
    let out = "";
    while (this.index < this.source.length) {
      const char = this.source[this.index] ?? "";
      this.index += 1;
      if (char === '"') {
        if (this.peek() === '"') {
          out += '"';
          this.index += 1;
          continue;
        }
        return out;
      }
      out += char;
    }
    throw new FormulaError("#VALUE!", "unterminated string");
  }

  private matchOp(ops: string[]): string | null {
    this.skip();
    const rest = this.source.slice(this.index);
    const found = ops.find((op) => rest.startsWith(op));
    if (!found) {
      return null;
    }
    this.index += found.length;
    return found;
  }

  private expect(token: string): void {
    this.skip();
    if (!this.source.startsWith(token, this.index)) {
      throw new FormulaError("#VALUE!", `expected ${token}`);
    }
    this.index += token.length;
  }

  private peek(): string {
    this.skip();
    return this.source[this.index] ?? "";
  }

  skip(): void {
    while (this.index < this.source.length && /\s/.test(this.source[this.index] ?? "")) {
      this.index += 1;
    }
  }
}

function resolve(
  book: Workbook,
  sheet: string,
  ast: Ast,
  stack: string[],
): string | number | boolean | null {
  switch (ast.type) {
    case "num":
      return ast.value;
    case "str":
      return ast.value;
    case "bool":
      return ast.value;
    case "ref":
      return evaluateCell(book, ast.sheet ?? sheet, ast.ref, stack);
    case "range":
      throw new FormulaError("#VALUE!", "a range is only valid inside a function");
    case "unary": {
      const value = asNumber(resolve(book, sheet, ast.expr, stack));
      return -value;
    }
    case "bin":
      return evalBin(book, sheet, ast, stack);
    case "call":
      return evalCall(book, sheet, ast, stack);
    default:
      return null;
  }
}

function evalBin(
  book: Workbook,
  sheet: string,
  ast: Extract<Ast, { type: "bin" }>,
  stack: string[],
): string | number | boolean | null {
  if (
    ast.op === "=" ||
    ast.op === "<>" ||
    ast.op === "<" ||
    ast.op === ">" ||
    ast.op === "<=" ||
    ast.op === ">="
  ) {
    const left = resolve(book, sheet, ast.left, stack);
    const right = resolve(book, sheet, ast.right, stack);
    const same = left === right;
    if (ast.op === "=") {
      return same;
    }
    if (ast.op === "<>") {
      return !same;
    }
    const ln = asNumber(left);
    const rn = asNumber(right);
    if (ast.op === "<") {
      return ln < rn;
    }
    if (ast.op === ">") {
      return ln > rn;
    }
    if (ast.op === "<=") {
      return ln <= rn;
    }
    return ln >= rn;
  }
  const left = asNumber(resolve(book, sheet, ast.left, stack));
  const right = asNumber(resolve(book, sheet, ast.right, stack));
  if (ast.op === "+") {
    return left + right;
  }
  if (ast.op === "-") {
    return left - right;
  }
  if (ast.op === "*") {
    return left * right;
  }
  if (right === 0) {
    throw new FormulaError("#DIV/0!", "division by zero");
  }
  return left / right;
}

function evalCall(
  book: Workbook,
  sheet: string,
  ast: Extract<Ast, { type: "call" }>,
  stack: string[],
): string | number | boolean | null {
  if (ast.name === "IF") {
    const cond = resolve(book, sheet, ast.args[0] ?? { type: "bool", value: false }, stack);
    const truthy = typeof cond === "boolean" ? cond : asNumber(cond) !== 0;
    const chosen = truthy ? ast.args[1] : ast.args[2];
    return chosen ? resolve(book, sheet, chosen, stack) : null;
  }
  if (ast.name === "NOT") {
    const cond = resolve(book, sheet, ast.args[0] ?? { type: "bool", value: false }, stack);
    return !(typeof cond === "boolean" ? cond : asNumber(cond) !== 0);
  }
  if (ast.name === "AND" || ast.name === "OR") {
    const flags = ast.args.map((arg) => {
      const value = resolve(book, sheet, arg, stack);
      return typeof value === "boolean" ? value : asNumber(value) !== 0;
    });
    return ast.name === "AND" ? flags.every(Boolean) : flags.some(Boolean);
  }
  const numbers = flattenNumbers(book, sheet, ast.args, stack);
  if (ast.name === "SUM") {
    return numbers.reduce((sum, value) => sum + value, 0);
  }
  if (ast.name === "PRODUCT") {
    return numbers.reduce((product, value) => product * value, 1);
  }
  if (ast.name === "AVERAGE") {
    if (numbers.length === 0) {
      throw new FormulaError("#DIV/0!", "average of empty range");
    }
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }
  if (ast.name === "MIN") {
    if (numbers.length === 0) {
      return 0;
    }
    return Math.min(...numbers);
  }
  if (ast.name === "MAX") {
    if (numbers.length === 0) {
      return 0;
    }
    return Math.max(...numbers);
  }
  if (ast.name === "COUNT") {
    return numbers.length;
  }
  if (ast.name === "ROUND") {
    const digits = numbers[1] ?? 0;
    const factor = 10 ** digits;
    return Math.round((numbers[0] ?? 0) * factor) / factor;
  }
  if (ast.name === "ABS") {
    return Math.abs(numbers[0] ?? 0);
  }
  if (ast.name === "INT") {
    return Math.trunc(numbers[0] ?? 0);
  }
  throw new FormulaError("#NAME?", ast.name);
}

function flattenNumbers(book: Workbook, sheet: string, args: Ast[], stack: string[]): number[] {
  const numbers: number[] = [];
  for (const arg of args) {
    if (arg.type === "range") {
      for (const ref of expandRange(arg.start, arg.end)) {
        const value = evaluateCell(book, arg.sheet ?? sheet, ref, stack);
        if (typeof value === "number") {
          numbers.push(value);
        } else if (typeof value === "boolean") {
          numbers.push(value ? 1 : 0);
        }
      }
      continue;
    }
    const value = resolve(book, sheet, arg, stack);
    if (value === null || value === "") {
      continue;
    }
    numbers.push(asNumber(value));
  }
  return numbers;
}

function expandRange(start: string, end: string): string[] {
  const a = parseA1(start);
  const b = parseA1(end);
  const refs: string[] = [];
  const row0 = Math.min(a.row, b.row);
  const row1 = Math.max(a.row, b.row);
  const col0 = Math.min(a.col, b.col);
  const col1 = Math.max(a.col, b.col);
  if (row1 - row0 > 5000 || col1 - col0 > 200) {
    throw new FormulaError("#REF!", "range exceeds the formula engine limit");
  }
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      refs.push(`${columnLetters(col)}${row}`);
    }
  }
  return refs;
}

function parseA1(ref: string): { row: number; col: number } {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!match) {
    throw new FormulaError("#REF!", `bad reference ${ref}`);
  }
  const col = columnIndex(match[1] ?? "");
  const row = Number(match[2]);
  if (col < 0 || row < 1) {
    throw new FormulaError("#REF!", `bad reference ${ref}`);
  }
  return { row, col };
}

function asNumber(value: string | number | boolean | null): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value === null || value === "") {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new FormulaError("#VALUE!", `not a number: ${value}`);
  }
  return parsed;
}

function normalizeRef(ref: string): string {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!match) {
    return ref.trim().toUpperCase();
  }
  return `${(match[1] ?? "").toUpperCase()}${match[2] ?? ""}`;
}

function splitSheetRef(token: string): [string, string] {
  const bang = token.lastIndexOf("!");
  return [token.slice(0, bang), token.slice(bang + 1)];
}
