import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

function getConfigDirInternal(): string {
  return process.env.AXIOM_CONFIG_DIR || join(homedir(), ".axiom");
}

function getConfigFilePath(): string {
  return join(getConfigDirInternal(), "config.json");
}

function getStateFileInternal(): string {
  return join(getConfigDirInternal(), "axiom-state.json");
}

// ── Legacy provider keys that may still exist in `global` ──

const LEGACY_GLOBAL_PROVIDER_KEYS = new Set([
  "AI_PROVIDER",
  "CODEX_MODEL",
  "CODEX_REASONING_EFFORT",
  "CLAUDE_MODEL",
  "CLAUDE_EFFORT",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_MODEL",
  "ANTHROPIC_MODEL",
]);

// ── Types ───────────────────────────────────────────────────

/** Resolved flat config — the public interface consumed by the rest of the app */
export interface SavedConfig {
  PLATFORM?: string;
  AZURE_DEVOPS_ORG?: string;
  AZURE_DEVOPS_PAT?: string;
  AI_PROVIDER?: string;
  CODEX_MODEL?: string;
  CODEX_REASONING_EFFORT?: string;
  CLAUDE_MODEL?: string;
  CLAUDE_EFFORT?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_MODEL?: string;
  WATCH_REPOS?: string;
  [key: string]: string | undefined;
}

/** Per-profile or global key-value store */
interface ProfileConfig {
  [key: string]: string | undefined;
}

/** v3 on-disk config structure */
interface ConfigFileV3 {
  version: 3;
  activeProfile: string;
  global: ProfileConfig;
  profiles: Record<string, ProfileConfig>;
}

// ── Internal helpers ────────────────────────────────────────

function sanitizeProfileConfig(config: ProfileConfig): ProfileConfig {
  const sanitized: ProfileConfig = {};

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (key.startsWith("AZURE_OPENAI_")) continue;
    if (key === "AI_PROVIDER" && value === "azure-openai") continue;
    sanitized[key] = value;
  }

  return sanitized;
}

function migrateV1toV3(v1: SavedConfig): ConfigFileV3 {
  return {
    version: 3,
    activeProfile: "default",
    global: {},
    profiles: { default: sanitizeProfileConfig(v1) },
  };
}

function migrateToV3(raw: unknown): ConfigFileV3 {
  if (
    raw &&
    typeof raw === "object" &&
    "version" in raw &&
    (raw as { version?: number }).version === 3
  ) {
    const config = raw as ConfigFileV3;
    return {
      version: 3,
      activeProfile: config.activeProfile ?? "default",
      global: sanitizeProfileConfig(config.global ?? {}),
      profiles: Object.fromEntries(
        Object.entries(config.profiles ?? {}).map(([name, profile]) => [
          name,
          sanitizeProfileConfig(profile ?? {}),
        ]),
      ),
    };
  }

  if (
    raw &&
    typeof raw === "object" &&
    "version" in raw &&
    (raw as { version?: number }).version === 2
  ) {
    const config = raw as {
      activeProfile?: string;
      global?: ProfileConfig;
      profiles?: Record<string, ProfileConfig>;
    };
    return {
      version: 3,
      activeProfile: config.activeProfile ?? "default",
      global: sanitizeProfileConfig(config.global ?? {}),
      profiles: Object.fromEntries(
        Object.entries(config.profiles ?? { default: {} }).map(
          ([name, profile]) => [name, sanitizeProfileConfig(profile ?? {})],
        ),
      ),
    };
  }

  return migrateV1toV3(raw as SavedConfig);
}

function loadConfigFile(): ConfigFileV3 {
  const configFile = getConfigFilePath();
  try {
    if (!existsSync(configFile)) {
      return { version: 3, activeProfile: "default", global: {}, profiles: { default: {} } };
    }
    const raw = JSON.parse(readFileSync(configFile, "utf-8"));
    const v3 = migrateToV3(raw);
    if (JSON.stringify(raw) !== JSON.stringify(v3)) {
      saveConfigFile(v3);
    }
    return v3;
  } catch {
    return { version: 3, activeProfile: "default", global: {}, profiles: { default: {} } };
  }
}

function saveConfigFile(config: ConfigFileV3): void {
  const configDir = getConfigDirInternal();
  const configFile = getConfigFilePath();
  try {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");
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

/** Load only the profile-specific config (no globals merged in) */
export function loadProfileOnlyConfig(profileName?: string): SavedConfig {
  const config = loadConfigFile();
  const name = profileName ?? config.activeProfile ?? "default";
  return { ...(config.profiles[name] ?? {}) };
}

/** Load profile config for TUI profile selection.
 *  If a legacy config still stores provider settings in `global` and the
 *  selected profile does not yet have its own AI provider, fall back to the
 *  merged view so existing profiles do not appear blank.
 */
export function loadProfileSelectionConfig(profileName?: string): SavedConfig {
  const config = loadConfigFile();
  const name = profileName ?? config.activeProfile ?? "default";
  const profile = config.profiles[name] ?? {};

  if (profile.AI_PROVIDER) {
    return { ...profile };
  }

  const hasLegacyGlobalProvider = [...LEGACY_GLOBAL_PROVIDER_KEYS].some(
    (key) => config.global[key] !== undefined,
  );

  if (!hasLegacyGlobalProvider) {
    return { ...profile };
  }

  return { ...config.global, ...profile };
}

/** Save flat config directly (kept for backward compat — prefers mergeAndSaveConfig).
 *  All keys go to the active profile; profile overrides global when loading. */
export function saveConfig(config: SavedConfig): void {
  const file = loadConfigFile();
  const name = file.activeProfile ?? "default";
  if (!file.profiles[name]) file.profiles[name] = {};

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    file.profiles[name]![key] = value;
  }
  file.profiles[name] = sanitizeProfileConfig(file.profiles[name] ?? {});
  saveConfigFile(file);
}

/** Merge new answers into the specified profile (or active profile) and persist.
 *  Keys can be stored in both global and profile; profile overrides global when loading. */
export function mergeAndSaveConfig(
  answers: Record<string, string>,
  profileName?: string,
): void {
  const config = loadConfigFile();
  const name = profileName ?? config.activeProfile ?? "default";
  if (!config.profiles[name]) config.profiles[name] = {};

  for (const [key, value] of Object.entries(answers)) {
    config.profiles[name]![key] = value;
  }

  config.profiles[name] = sanitizeProfileConfig(config.profiles[name] ?? {});
  saveConfigFile(config);
}

/** Remove saved config — a specific profile, or the entire file if '*' */
export function clearConfig(profileName?: string): boolean {
  const configFile = getConfigFilePath();
  try {
    if (profileName === "*") {
      if (existsSync(configFile)) {
        unlinkSync(configFile);
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
  return getConfigFilePath();
}

/** Get default state file path (~/.axiom/axiom-state.json) */
export function getDefaultStatePath(): string {
  return getStateFileInternal();
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
