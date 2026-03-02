import dotenv from "dotenv";
import type { AiConfig } from "../config";
import type { WatchedRepo } from "../watcher/types";
import { loadSavedConfig, profileExists } from "./config-store";
import { promptForMissingVars } from "./prompt";
import { getDefaultStatePath } from "./config-store";

// ── Types ────────────────────────────────────────────────

/** Base config shared by all commands (org + pat + ai) */
export interface BaseEnvConfig {
  azureDevOps: {
    org: string;
    pat: string;
  };
  ai: AiConfig;
}

/** Extended config for the watch command (adds repos, polling, state) */
export interface WatcherEnvConfig extends BaseEnvConfig {
  repos: WatchedRepo[];
  pollIntervalMs: number;
  stateFilePath: string;
}

// ── Env Lookup Abstraction ───────────────────────────────

type EnvLookup = (key: string) => string | undefined;

function createEnvLookup(overrides: Record<string, string> = {}): EnvLookup {
  return (key: string) => overrides[key] ?? process.env[key];
}

// ── Missing Variable Detection ───────────────────────────

function getRequiredProviderKeys(provider: string): string[] {
  switch (provider) {
    case "openai":
      return ["OPENAI_API_KEY"];
    case "anthropic":
      return ["ANTHROPIC_API_KEY"];
    case "azure-openai":
      return [
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_DEPLOYMENT",
      ];
    default:
      return [];
  }
}

function detectMissingVars(
  command: "watch" | "review",
  lookup: EnvLookup,
): Set<string> {
  const missing = new Set<string>();

  for (const key of ["AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PAT", "AI_PROVIDER"]) {
    if (!lookup(key)) missing.add(key);
  }

  // Provider-specific (only check if provider is already known)
  const provider = lookup("AI_PROVIDER");
  if (provider) {
    for (const key of getRequiredProviderKeys(provider)) {
      if (!lookup(key)) missing.add(key);
    }
  }

  if (command === "watch" && !lookup("WATCH_REPOS")) {
    missing.add("WATCH_REPOS");
  }

  return missing;
}

// ── Interactive Loader (async, prompts on missing vars) ──

export async function loadEnvConfigInteractive(
  options: { interval?: string; stateFile?: string; profile?: string },
  command: "watch" | "review",
): Promise<WatcherEnvConfig | BaseEnvConfig> {
  dotenv.config();

  if (options.profile && !profileExists(options.profile)) {
    throw new Error(
      `Profile "${options.profile}" does not exist yet. Create it with: axiom profile add ${options.profile}`,
    );
  }

  // Saved config for the active/specified profile as fallback (env vars win)
  const saved = loadSavedConfig(options.profile);
  let lookup: EnvLookup = (key) => process.env[key] ?? saved[key];
  const missing = detectMissingVars(command, lookup);

  if (missing.size > 0) {
    if (!process.stdin.isTTY) {
      const keys = [...missing].join(", ");
      throw new Error(
        `Missing required configuration: ${keys}. ` +
          `Set them in .env or as environment variables.`,
      );
    }

    // Prompt for all missing vars (phased: common -> provider -> watch)
    const answers = await promptForMissingVars(missing, command);
    lookup = createEnvLookup(answers);

    // If AI_PROVIDER was just answered, check provider-specific keys
    const provider = lookup("AI_PROVIDER");
    if (provider) {
      const providerMissing = getRequiredProviderKeys(provider).filter(
        (k) => !lookup(k),
      );
      if (providerMissing.length > 0) {
        const extra = await promptForMissingVars(
          new Set(providerMissing),
          command,
        );
        lookup = createEnvLookup({ ...answers, ...extra });
      }
    }
  }

  return buildConfig(lookup, options, command);
}

// ── Config Builder ───────────────────────────────────────

function buildConfig(
  lookup: EnvLookup,
  options: { interval?: string; stateFile?: string },
  command: "watch" | "review",
): WatcherEnvConfig | BaseEnvConfig {
  const require = (key: string): string => {
    const val = lookup(key);
    if (!val) throw new Error(`Missing required configuration: ${key}`);
    return val;
  };

  const org = require("AZURE_DEVOPS_ORG");
  const pat = require("AZURE_DEVOPS_PAT");
  const provider = require("AI_PROVIDER") as
    | "openai"
    | "anthropic"
    | "azure-openai";
  const ai = buildAiConfig(provider, lookup, require);

  const base: BaseEnvConfig = { azureDevOps: { org, pat }, ai };

  if (command === "review") {
    return base;
  }

  const reposRaw = require("WATCH_REPOS");
  const repos: WatchedRepo[] = reposRaw.split(",").map((entry) => {
    const parts = entry.trim().split("/");
    if (parts.length < 2) {
      throw new Error(
        `Invalid WATCH_REPOS entry: "${entry}". Expected format: "project/repoId/repoName"`,
      );
    }
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

function buildAiConfig(
  provider: string,
  lookup: EnvLookup,
  require: (key: string) => string,
): AiConfig {
  switch (provider) {
    case "openai":
      return {
        provider: "openai",
        apiKey: require("OPENAI_API_KEY"),
        model: lookup("OPENAI_MODEL"),
      };
    case "anthropic":
      return {
        provider: "anthropic",
        apiKey: require("ANTHROPIC_API_KEY"),
        model: lookup("ANTHROPIC_MODEL"),
      };
    case "azure-openai":
      return {
        provider: "azure-openai",
        endpoint: require("AZURE_OPENAI_ENDPOINT"),
        apiKey: require("AZURE_OPENAI_API_KEY"),
        deployment: require("AZURE_OPENAI_DEPLOYMENT"),
        apiVersion: lookup("AZURE_OPENAI_API_VERSION"),
      };
    default:
      throw new Error(
        `Unsupported AI_PROVIDER: "${provider}". Must be one of: openai, anthropic, azure-openai`,
      );
  }
}

// ── Backward-compat sync loader ──────────────────────────

export function loadEnvConfig(options: {
  interval?: string;
  stateFile?: string;
  profile?: string;
}): WatcherEnvConfig {
  dotenv.config();
  const saved = loadSavedConfig(options.profile);
  const lookup: EnvLookup = (key) => process.env[key] ?? saved[key];
  return buildConfig(lookup, options, "watch") as WatcherEnvConfig;
}
