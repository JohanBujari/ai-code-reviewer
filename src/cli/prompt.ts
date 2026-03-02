import { createInterface } from "node:readline/promises";
import {
  listProfiles,
  getActiveProfile,
  createProfile,
} from "./config-store";

// ── Prompting Primitives ─────────────────────────────────

/** Prompt for plain text input */
async function askText(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim();
  } finally {
    rl.close();
  }
}

/** Prompt for secret input with asterisk masking */
async function askSecret(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const chars: string[] = [];
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (key: string) => {
      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(chars.join(""));
      } else if (key === "\u0003") {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.exit(130);
      } else if (key === "\u007F") {
        // Backspace
        if (chars.length > 0) {
          chars.pop();
          process.stdout.write("\b \b");
        }
      } else {
        chars.push(key);
        process.stdout.write("*");
      }
    };
    process.stdin.on("data", onData);
  });
}

/** Prompt with numbered selection list, returns the chosen string */
async function askSelect(prompt: string, choices: string[]): Promise<string> {
  console.log(prompt);
  choices.forEach((c, i) => console.log(`  ${i + 1}) ${c}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await rl.question("> ");
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < choices.length) {
        return choices[idx];
      }
      console.log(`  Please enter a number between 1 and ${choices.length}`);
    }
  } finally {
    rl.close();
  }
}

// ── Variable Definitions ─────────────────────────────────

interface VarDef {
  key: string;
  label: string;
  type: "text" | "secret" | "select";
  choices?: string[];
  hint?: string;
}

const COMMON_VARS: VarDef[] = [
  { key: "AZURE_DEVOPS_ORG", label: "Azure DevOps Organization", type: "text" },
  { key: "AZURE_DEVOPS_PAT", label: "Azure DevOps PAT", type: "secret" },
  {
    key: "AI_PROVIDER",
    label: "AI Provider",
    type: "select",
    choices: ["openai", "anthropic", "azure-openai"],
  },
];

const PROVIDER_VARS: Record<string, VarDef[]> = {
  openai: [{ key: "OPENAI_API_KEY", label: "OpenAI API Key", type: "secret" }],
  anthropic: [
    { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", type: "secret" },
  ],
  "azure-openai": [
    {
      key: "AZURE_OPENAI_ENDPOINT",
      label: "Azure OpenAI Endpoint",
      type: "text",
      hint: "e.g. https://your-resource.openai.azure.com",
    },
    {
      key: "AZURE_OPENAI_API_KEY",
      label: "Azure OpenAI API Key",
      type: "secret",
    },
    {
      key: "AZURE_OPENAI_DEPLOYMENT",
      label: "Azure OpenAI Deployment",
      type: "text",
    },
  ],
};

const WATCH_VARS: VarDef[] = [
  {
    key: "WATCH_REPOS",
    label: "Repos to watch",
    type: "text",
    hint: "comma-separated, format: project/repoId/repoName",
  },
];

// ── Orchestrator ─────────────────────────────────────────

async function promptVar(def: VarDef): Promise<string> {
  const hint = def.hint ? ` (${def.hint})` : "";
  const promptStr = `  ${def.label}${hint}: `;

  while (true) {
    let value: string;
    switch (def.type) {
      case "secret":
        value = await askSecret(promptStr);
        break;
      case "select":
        value = await askSelect(`  ${def.label}:`, def.choices!);
        break;
      default:
        value = await askText(promptStr);
    }
    if (value.length > 0) return value;
    console.log("    Value cannot be empty. Please try again.");
  }
}

/**
 * Interactively prompt for any missing configuration variables.
 * Prompts are phased so that provider-specific vars are only asked
 * after the AI_PROVIDER is known.
 */
export async function promptForMissingVars(
  missingKeys: Set<string>,
  command: "watch" | "review",
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};

  console.log("\nSome required configuration is missing. Please provide:\n");

  // Phase 1: Common vars (org, pat, provider)
  for (const def of COMMON_VARS) {
    if (!missingKeys.has(def.key)) continue;
    answers[def.key] = await promptVar(def);
  }

  // Phase 2: Provider-specific vars
  const provider = answers["AI_PROVIDER"] ?? process.env["AI_PROVIDER"];
  if (provider) {
    const providerVars = PROVIDER_VARS[provider] ?? [];
    for (const def of providerVars) {
      if (!missingKeys.has(def.key)) continue;
      answers[def.key] = await promptVar(def);
    }
  }

  // Phase 3: Watch-specific vars
  if (command === "watch") {
    for (const def of WATCH_VARS) {
      if (!missingKeys.has(def.key)) continue;
      answers[def.key] = await promptVar(def);
    }
  }

  console.log("");
  return answers;
}

/**
 * Prompt user to select or create a profile (non-TUI mode).
 * Returns the chosen profile name.
 */
export async function promptForProfile(): Promise<string> {
  const profiles = listProfiles();
  if (profiles.length === 0) return "default";

  const active = getActiveProfile();
  const labels = profiles.map((p) => (p === active ? `${p} (active)` : p));
  labels.push("+ Create new profile");

  console.log("");
  const selected = await askSelect("Select profile:", labels);

  if (selected === "+ Create new profile") {
    const name = await askText("  Profile name: ");
    createProfile(name);
    return name;
  }

  // Strip the " (active)" suffix if present
  return selected.replace(" (active)", "");
}
