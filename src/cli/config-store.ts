import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".axiom");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const STATE_FILE = join(CONFIG_DIR, "pr-agent-state.json");

// ── Keys that belong in `global` (shared across profiles) ──

const GLOBAL_KEYS = new Set([
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
  "OPENAI_MODEL",
  "ANTHROPIC_MODEL",
]);

// ── Types ───────────────────────────────────────────────────

/** Resolved flat config — the public interface consumed by the rest of the app */
export interface SavedConfig {
  AZURE_DEVOPS_ORG?: string;
  AZURE_DEVOPS_PAT?: string;
  AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AZURE_OPENAI_ENDPOINT?: string;
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_DEPLOYMENT?: string;
  AZURE_OPENAI_API_VERSION?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_MODEL?: string;
  WATCH_REPOS?: string;
  [key: string]: string | undefined;
}

/** Per-profile or global key-value store */
interface ProfileConfig {
  [key: string]: string | undefined;
}

/** v2 on-disk config structure */
interface ConfigFileV2 {
  version: 2;
  activeProfile: string;
  global: ProfileConfig;
  profiles: Record<string, ProfileConfig>;
}

// ── Internal helpers ────────────────────────────────────────

function migrateV1toV2(v1: SavedConfig): ConfigFileV2 {
  const global: ProfileConfig = {};
  const profile: ProfileConfig = {};

  for (const [key, value] of Object.entries(v1)) {
    if (value === undefined) continue;
    if (GLOBAL_KEYS.has(key)) {
      global[key] = value;
    } else {
      profile[key] = value;
    }
  }

  return {
    version: 2,
    activeProfile: "default",
    global,
    profiles: { default: profile },
  };
}

function loadConfigFile(): ConfigFileV2 {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return { version: 2, activeProfile: "default", global: {}, profiles: {} };
    }
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    if (raw.version === 2) return raw as ConfigFileV2;

    // v1 migration
    const v2 = migrateV1toV2(raw as SavedConfig);
    saveConfigFile(v2);
    return v2;
  } catch {
    return { version: 2, activeProfile: "default", global: {}, profiles: {} };
  }
}

function saveConfigFile(config: ConfigFileV2): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (err) {
    console.error(`Failed to save config: ${err}`);
  }
}

// ── Public API ──────────────────────────────────────────────

/** Load resolved flat config for a profile (defaults to active profile) */
export function loadSavedConfig(profileName?: string): SavedConfig {
  const config = loadConfigFile();
  const name = profileName ?? config.activeProfile ?? "default";
  const profile = config.profiles[name] ?? {};
  return { ...config.global, ...profile };
}

/** Save flat config directly (kept for backward compat — prefers mergeAndSaveConfig) */
export function saveConfig(config: SavedConfig): void {
  // Route keys to global vs active profile
  const file = loadConfigFile();
  const name = file.activeProfile ?? "default";
  if (!file.profiles[name]) file.profiles[name] = {};

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (GLOBAL_KEYS.has(key)) {
      file.global[key] = value;
    } else {
      file.profiles[name]![key] = value;
    }
  }
  saveConfigFile(file);
}

/** Merge new answers into the specified profile (or active profile) and persist */
export function mergeAndSaveConfig(
  answers: Record<string, string>,
  profileName?: string,
): void {
  const config = loadConfigFile();
  const name = profileName ?? config.activeProfile ?? "default";
  if (!config.profiles[name]) config.profiles[name] = {};

  for (const [key, value] of Object.entries(answers)) {
    if (GLOBAL_KEYS.has(key)) {
      config.global[key] = value;
    } else {
      config.profiles[name]![key] = value;
    }
  }

  saveConfigFile(config);
}

/** Remove saved config — a specific profile, or the entire file if '*' */
export function clearConfig(profileName?: string): boolean {
  try {
    if (profileName === "*") {
      if (existsSync(CONFIG_FILE)) {
        unlinkSync(CONFIG_FILE);
        return true;
      }
      return false;
    }
    return deleteProfile(profileName ?? getActiveProfile());
  } catch {
    return false;
  }
}

/** Get config file path (for display purposes) */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/** Get default state file path (~/.axiom/pr-agent-state.json) */
export function getDefaultStatePath(): string {
  return STATE_FILE;
}

// ── Profile management ──────────────────────────────────────

export function listProfiles(): string[] {
  return Object.keys(loadConfigFile().profiles);
}

/** Check if a profile exists */
export function profileExists(name: string): boolean {
  return name in loadConfigFile().profiles;
}

export function getActiveProfile(): string {
  return loadConfigFile().activeProfile ?? "default";
}

export function setActiveProfile(name: string): void {
  const config = loadConfigFile();
  if (!config.profiles[name]) {
    config.profiles[name] = {};
  }
  config.activeProfile = name;
  saveConfigFile(config);
}

export function createProfile(name: string): void {
  const config = loadConfigFile();
  if (config.profiles[name]) {
    throw new Error(`Profile "${name}" already exists`);
  }
  config.profiles[name] = {};
  saveConfigFile(config);
}

export function deleteProfile(name: string): boolean {
  const config = loadConfigFile();
  if (!config.profiles[name]) return false;
  delete config.profiles[name];
  if (config.activeProfile === name) {
    const remaining = Object.keys(config.profiles);
    if (remaining.length === 0) {
      config.profiles["default"] = {};
      config.activeProfile = "default";
    } else {
      config.activeProfile = remaining[0];
    }
  }
  saveConfigFile(config);
  return true;
}
