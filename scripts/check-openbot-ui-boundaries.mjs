import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const uiRoot = path.join(repoRoot, "ui", "src", "ui");

const controllerImportRules = [
  {
    file: "ui/src/ui/app.ts",
    allowed: [
      "ui/src/ui/controllers/collaboration-governance-actions.ts",
      "ui/src/ui/controllers/collaboration-learning.ts",
      "ui/src/ui/controllers/cron.ts",
      "ui/src/ui/controllers/daibai.ts",
      "ui/src/ui/controllers/devices.ts",
      "ui/src/ui/controllers/enterprise-data-source-governance.ts",
      "ui/src/ui/controllers/enterprise-operational-identity.ts",
      "ui/src/ui/controllers/enterprise-organization-snapshot.ts",
      "ui/src/ui/controllers/enterprise-seat-assets.ts",
      "ui/src/ui/controllers/exec-approval.ts",
      "ui/src/ui/controllers/exec-approvals.ts",
      "ui/src/ui/controllers/focus-switch-gate.ts",
      "ui/src/ui/controllers/knowledge-universe.ts",
      "ui/src/ui/controllers/platform-auth.ts",
      "ui/src/ui/controllers/platform-models-management.ts",
      "ui/src/ui/controllers/skills.ts",
      "ui/src/ui/controllers/spaces.ts",
      "ui/src/ui/controllers/tenant-im-binding.ts",
      "ui/src/ui/controllers/user-operational-identity.ts",
    ],
  },
  {
    file: "ui/src/ui/app-render.ts",
    allowed: [
      "ui/src/ui/controllers/control-ui-bootstrap.ts",
      "ui/src/ui/controllers/cron.ts",
      "ui/src/ui/controllers/daibai.ts",
      "ui/src/ui/controllers/focus-switch-gate.ts",
    ],
  },
  {
    file: "ui/src/ui/app-lifecycle.ts",
    allowed: ["ui/src/ui/controllers/control-ui-bootstrap.ts"],
  },
  {
    file: "ui/src/ui/app-host-adapters.ts",
    allowed: ["ui/src/ui/controllers/daibai.ts", "ui/src/ui/controllers/platform-auth.ts"],
  },
  {
    file: "ui/src/ui/app-polling.ts",
    allowed: [],
  },
  {
    file: "ui/src/ui/ports/employee/render-model-actions.ts",
    allowed: [],
  },
  {
    file: "ui/src/ui/app-settings.ts",
    allowed: [
      "ui/src/ui/controllers/enterprise-operational-identity.ts",
      "ui/src/ui/controllers/enterprise-organization-monthly-usage.ts",
      "ui/src/ui/controllers/enterprise-organization-snapshot.ts",
      "ui/src/ui/controllers/enterprise-port-session-align.ts",
      "ui/src/ui/controllers/mesh-ownership.ts",
      "ui/src/ui/controllers/mesh-shell.ts",
      "ui/src/ui/controllers/platform-models-management.ts",
      "ui/src/ui/controllers/usage.ts",
    ],
  },
  {
    file: "ui/src/ui/app-gateway.ts",
    allowed: [
      "ui/src/ui/controllers/spaces.ts",
      "ui/src/ui/controllers/user-operational-identity.ts",
    ],
  },
];

const allowedLegacyWorkbenchMetadataFiles = new Set([
  "ui/src/ui/storage.ts",
  "ui/src/ui/storage-legacy.ts",
]);

const employeeCapabilityRuntimeImportPattern =
  /\bfrom\s+["'][^"']*(?:skill-models|skill-lifecycle|robot-skills|personal-skill-library|capability-governance)[^"']*["']/;

const employeeCapabilityRuntimeFieldPattern =
  /\b(?:AssetLifecycle|RuntimeDependencyGraph|SkillRuntimeDefinition|SkillVersion|runtimeDefinition|runtimeHealth|runtimeDependency|modelPreferences|executionPolicies|routingHints|memoryStrategy)\b/;

async function readFile(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function listUiFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listUiFiles(absolutePath)));
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith(".ts")) {
      files.push(path.relative(repoRoot, absolutePath).split(path.sep).join("/"));
    }
  }
  return files;
}

function resolveImportPath(sourceFile, importPath) {
  const sourceDir = path.posix.dirname(sourceFile);
  return path.posix.normalize(path.posix.join(sourceDir, importPath));
}

function collectControllerImports(sourceText, sourceFile) {
  /** @type {Set<string>} */
  const imports = new Set();
  const patterns = [
    /\bfrom\s+["']([^"']*controllers\/[^"']+)["']/g,
    /\bimport\s+["']([^"']*controllers\/[^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      const rawImport = match[1];
      imports.add(rawImport.startsWith(".") ? resolveImportPath(sourceFile, rawImport) : rawImport);
    }
  }
  return [...imports];
}

function describeAllowedImports(allowed) {
  return allowed.length > 0 ? allowed.join(", ") : "(none)";
}

async function main() {
  /** @type {string[]} */
  const failures = [];

  for (const rule of controllerImportRules) {
    const sourceText = await readFile(rule.file);
    const controllerImports = collectControllerImports(sourceText, rule.file);
    for (const importPath of controllerImports) {
      if (!rule.allowed.includes(importPath)) {
        failures.push(
          `${rule.file}: unexpected direct controller import ${importPath}; allowed: ${describeAllowedImports(rule.allowed)}`,
        );
      }
    }
  }

  const uiFiles = await listUiFiles(uiRoot);
  for (const file of uiFiles) {
    if (file.endsWith(".test.ts") || allowedLegacyWorkbenchMetadataFiles.has(file)) {
      continue;
    }
    const sourceText = await readFile(file);
    if (file.startsWith("ui/src/ui/capability/employee-capability/")) {
      if (employeeCapabilityRuntimeImportPattern.test(sourceText)) {
        failures.push(
          `${file}: employee capability layer must not import asset/runtime or legacy skill controllers`,
        );
      }
      if (file !== "ui/src/ui/capability/employee-capability/projection.ts") {
        const withoutTypeComments = sourceText.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        if (employeeCapabilityRuntimeFieldPattern.test(withoutTypeComments)) {
          failures.push(
            `${file}: employee capability layer must not reference runtime/asset field names outside projection.ts`,
          );
        }
      }
    }
    if (
      sourceText.includes("workbenchTeamObjects") ||
      sourceText.includes("workbenchTeamOrder") ||
      sourceText.includes("workspaceTeamObjects") ||
      sourceText.includes("workspaceTeamOrder")
    ) {
      failures.push(
        `${file}: legacy workbench team metadata should only be accessed through compatibility storage cleanup`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("OpenBot UI boundary check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("OpenBot UI boundary check passed.");
}

await main();
