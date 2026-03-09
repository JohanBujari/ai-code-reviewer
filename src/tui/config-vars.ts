import { buildConfig } from "../cli/env";
import type { BaseEnvConfig, WatcherEnvConfig } from "../cli/env";

export interface VarDef {
  key: string;
  label: string;
  type: "text" | "secret" | "select";
  choices?: string[];
  hint?: string;
  /** If true, the field is shown in config but not treated as required */
  optional?: boolean;
  /** Return an error message if invalid, or null/undefined if valid */
  validate?: (value: string) => string | null;
}

export const COMMON_VARS: VarDef[] = [
  {
    key: "AI_PROVIDER",
    label: "AI Provider",
    type: "select",
    choices: ["openai", "anthropic", "azure-openai"],
  },
];

export const PLATFORM_VARS: Record<string, VarDef[]> = {
  "azure-devops": [
    { key: "AZURE_DEVOPS_ORG", label: "Azure DevOps Organization", type: "text" },
    { key: "AZURE_DEVOPS_PAT", label: "Azure DevOps PAT", type: "secret" },
  ],
};

export const PROVIDER_VARS: Record<string, VarDef[]> = {
  openai: [
    { key: "OPENAI_API_KEY", label: "OpenAI API Key", type: "secret" },
    { key: "OPENAI_MODEL", label: "Model", type: "text", hint: "e.g. gpt-5.2 (default: gpt-5.2)", optional: true },
  ],
  anthropic: [
    { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", type: "secret" },
    { key: "ANTHROPIC_MODEL", label: "Model", type: "text", hint: "e.g. claude-sonnet-4-5 (default: claude-sonnet-4-5)", optional: true },
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

export const WATCH_VARS: VarDef[] = [
  {
    key: "WATCH_REPOS",
    label: "Repos to watch",
    type: "text",
    hint: "format: project/repoId/repoName (comma-separated for multiple)",
    validate: (value: string) => {
      const entries = value.split(",").map((e) => e.trim()).filter(Boolean);
      if (entries.length === 0) return "At least one repo is required";
      for (const entry of entries) {
        const parts = entry.split("/");
        if (parts.length < 2) return `Invalid format: "${entry}" — expected project/repoId/repoName`;
      }
      return null;
    },
  },
];

/** Ordered list of all config vars for a given command + known values.
 *  Order: AI Provider → provider-specific → Azure DevOps → repos (watch only) */
function resolveVarList(
  command: "watch" | "review",
  lookup: (key: string) => string | undefined,
): VarDef[] {
  const provider = lookup("AI_PROVIDER");
  return [
    ...COMMON_VARS,
    ...(provider ? (PROVIDER_VARS[provider] ?? []) : []),
    ...(PLATFORM_VARS["azure-devops"] ?? []),
    ...(command === "watch" ? WATCH_VARS : []),
  ];
}

export function detectMissingVars(
  command: "watch" | "review",
  answers: Record<string, string>,
  saved: Record<string, string | undefined> = {},
): VarDef[] {
  // Only check answers and saved config — not process.env, which may
  // contain stale values from a previously configured profile.
  const lookup = (key: string) => answers[key] ?? saved[key];
  return resolveVarList(command, lookup).filter((def) => {
    if (def.optional) return false;
    const val = lookup(def.key);
    if (!val) return true;
    // Re-prompt if the saved value fails validation
    if (def.validate && def.validate(val) !== null) return true;
    return false;
  });
}

/** Load a profile's saved config into a flat key-value map (skipping empty values) */
export function loadProfileAnswers(
  saved: Record<string, string | undefined>,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(saved)) {
    if (value) answers[key] = value;
  }
  return answers;
}

/** Build the full list of config vars (for edit mode — includes all fields) */
export function buildAllVars(
  answers: Record<string, string>,
  saved?: Record<string, string | undefined>,
): VarDef[] {
  const lookup = (key: string) => answers[key] ?? saved?.[key] ?? process.env[key];
  return resolveVarList("watch", lookup);
}

export function buildConfigFromEnv(
  answers: Record<string, string>,
  command: "watch" | "review",
  options: { interval?: string; stateFile?: string },
): WatcherEnvConfig | BaseEnvConfig {
  const lookup = (key: string) => answers[key] || process.env[key] || undefined;
  return buildConfig(lookup, options, command);
}
