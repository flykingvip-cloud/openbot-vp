import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type BudgetEntry = {
  path: string;
  maxLines: number;
  why: string;
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Locked at landing — facades and large Sub_Modules from gateway-plugins-monolith-decomposition. */
const BUDGETS: BudgetEntry[] = [
  {
    path: "src/gateway/platform-auth.ts",
    maxLines: 150,
    why: "platform-auth facade: re-exports only; logic in src/gateway/platform-auth/*.",
  },
  {
    path: "src/gateway/platform-auth/control-ui-dispatcher.ts",
    maxLines: 500,
    why: "platform-auth Control UI HTTP dispatcher Sub_Module (route table + write-lock wiring).",
  },
  {
    path: "src/gateway/collaboration-learning.ts",
    maxLines: 70,
    why: "collaboration-learning facade: re-exports only; logic in src/gateway/collaboration-learning/*.",
  },
  {
    path: "src/gateway/collaboration-learning/shared.ts",
    maxLines: 2881,
    why: "collaboration-learning shared helpers Sub_Module (locked to origin/main size after baseline check unmask).",
  },
  {
    path: "src/gateway/platform-auth/auth-helpers.ts",
    maxLines: 659,
    why: "platform-auth auth-helpers Sub_Module (locked to origin/main size after baseline check unmask).",
  },
  {
    path: "src/gateway/platform-auth/routes-employee.ts",
    maxLines: 773,
    why: "platform-auth employee route handlers Sub_Module (locked to origin/main size after baseline check unmask).",
  },
  {
    path: "src/gateway/platform-auth/routes-login-password.ts",
    maxLines: 724,
    why: "platform-auth login/password route handlers Sub_Module (locked to origin/main size after baseline check unmask).",
  },
  {
    path: "src/gateway/platform-auth/routes-enterprise.ts",
    maxLines: 964,
    why: "platform-auth enterprise route handlers Sub_Module (locked to origin/main size after baseline check unmask).",
  },
  {
    path: "src/plugins/loader.ts",
    maxLines: 20,
    why: "plugin loader facade: keeps loadOpenBotPlugins entry point stable; logic in src/plugins/loader/*.",
  },
  {
    path: "src/plugins/hooks.ts",
    maxLines: 60,
    why: "plugin hooks facade: re-exports types + createHookRunner; sub-modules in src/plugins/hooks/*.",
  },
  {
    path: "ui/src/ui/app.ts",
    maxLines: 4347,
    why: "control-ui shell: wiring only; feature logic belongs in controllers/ + wiring/ (locked to origin/main size after baseline check unmask).",
  },
  {
    path: "ui/src/ui/app-gateway.ts",
    maxLines: 320,
    why: "gateway connect facade; event dispatch lives in ui/src/ui/gateway-subscriptions/*.",
  },
];

async function countLines(filePath: string): Promise<number> {
  const content = await readFile(path.join(REPO_ROOT, filePath), "utf8");
  return content.split("\n").length;
}

async function main(): Promise<void> {
  const offenders: string[] = [];

  for (const entry of BUDGETS) {
    const lines = await countLines(entry.path);
    if (lines > entry.maxLines) {
      offenders.push(`${entry.path}: ${lines} lines (budget ${entry.maxLines}) — ${entry.why}`);
    }
  }

  if (offenders.length > 0) {
    console.error("Core composition-root LOC guard failed:");
    for (const offender of offenders) {
      console.error(`- ${offender}`);
    }
    process.exit(1);
  }

  console.log(`Core composition-root LOC guard passed (${BUDGETS.length} files within budget).`);
}

await main();
