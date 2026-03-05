import type { AiConfig } from "../config";
import type { BaseEnvConfig, WatcherEnvConfig } from "../cli/env";
import type { WatchedRepo } from "../watcher/types";
import { getDefaultStatePath } from "../cli/config-store";

export interface VarDef {
  key: string;
  label: string;
  type: "text" | "secret" | "select";
  choices?: string[];
  hint?: string;
}

export const COMMON_VARS: VarDef[] = [
  {
    key: "PLATFORM",
    label: "Platform",
    type: "select",
    choices: ["azure-devops"],
  },
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

export const WATCH_VARS: VarDef[] = [
  {
    key: "WATCH_REPOS",
    label: "Repos to watch",
    type: "text",
    hint: "comma-separated, format: project/repoId/repoName",
  },
];

export function detectMissingVars(
  command: "watch" | "review",
  answers: Record<string, string>,
  saved: Record<string, string | undefined> = {},
): VarDef[] {
  const lookup = (key: string) =>
    answers[key] ?? saved[key] ?? process.env[key];
  const missing: VarDef[] = [];
  for (const def of COMMON_VARS) {
    if (!lookup(def.key)) missing.push(def);
  }
  const platform = lookup("PLATFORM");
  if (platform) {
    for (const def of PLATFORM_VARS[platform] ?? []) {
      if (!lookup(def.key)) missing.push(def);
    }
  }
  const provider = lookup("AI_PROVIDER");
  if (provider) {
    for (const def of PROVIDER_VARS[provider] ?? []) {
      if (!lookup(def.key)) missing.push(def);
    }
  }
  if (command === "watch") {
    for (const def of WATCH_VARS) {
      if (!lookup(def.key)) missing.push(def);
    }
  }
  return missing;
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

/** Build the full list of config vars based on the resolved platform and provider */
export function buildAllVars(
  answers: Record<string, string>,
  saved?: Record<string, string | undefined>,
): VarDef[] {
  const lookup = (key: string) => answers[key] ?? saved?.[key] ?? process.env[key];
  const platform = lookup("PLATFORM");
  const provider = lookup("AI_PROVIDER");
  return [
    ...COMMON_VARS,
    ...(platform ? (PLATFORM_VARS[platform] ?? []) : []),
    ...(provider ? (PROVIDER_VARS[provider] ?? []) : []),
    ...WATCH_VARS,
  ];
}

export function buildConfigFromEnv(
  answers: Record<string, string>,
  command: "watch" | "review",
  options: { interval?: string; stateFile?: string },
): WatcherEnvConfig | BaseEnvConfig {
  const lookup = (key: string) => answers[key] ?? process.env[key];
  const require = (key: string): string => {
    const val = lookup(key);
    if (!val) throw new Error(`Missing required configuration: ${key}`);
    return val;
  };

  const platform = lookup("PLATFORM") ?? "azure-devops";
  const org = require("AZURE_DEVOPS_ORG");
  const pat = require("AZURE_DEVOPS_PAT");
  const provider = require("AI_PROVIDER") as
    | "openai"
    | "anthropic"
    | "azure-openai";

  let ai: AiConfig;
  switch (provider) {
    case "openai":
      ai = {
        provider: "openai",
        apiKey: require("OPENAI_API_KEY"),
        model: lookup("OPENAI_MODEL"),
      };
      break;
    case "anthropic":
      ai = {
        provider: "anthropic",
        apiKey: require("ANTHROPIC_API_KEY"),
        model: lookup("ANTHROPIC_MODEL"),
      };
      break;
    case "azure-openai":
      ai = {
        provider: "azure-openai",
        endpoint: require("AZURE_OPENAI_ENDPOINT"),
        apiKey: require("AZURE_OPENAI_API_KEY"),
        deployment: require("AZURE_OPENAI_DEPLOYMENT"),
        apiVersion: lookup("AZURE_OPENAI_API_VERSION"),
      };
      break;
    default:
      throw new Error(`Unsupported AI_PROVIDER: "${provider}"`);
  }

  const base: BaseEnvConfig = { platform, azureDevOps: { org, pat }, ai };
  if (command === "review") return base;

  const reposRaw = require("WATCH_REPOS");
  const repos: WatchedRepo[] = reposRaw.split(",").map((entry) => {
    const parts = entry.trim().split("/");
    if (parts.length < 2)
      throw new Error(`Invalid WATCH_REPOS entry: "${entry}"`);
    return {
      project: parts[0],
      repoId: parts[1],
      repoName: parts[2] ?? parts[1],
    };
  });

  return {
    ...base,
    repos,
    pollIntervalMs: parseInt(options.interval ?? "30", 10) * 1000,
    stateFilePath: options.stateFile ?? getDefaultStatePath(),
  };
}
