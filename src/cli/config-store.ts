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

/** Saved user configuration (credentials + settings) */
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

/** Load saved config from ~/.axiom/config.json */
export function loadSavedConfig(): SavedConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as SavedConfig;
  } catch {
    return {};
  }
}

/** Save config to ~/.axiom/config.json */
export function saveConfig(config: SavedConfig): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (err) {
    // Silently fail — don't crash the app if we can't write config
    console.error(`Failed to save config: ${err}`);
  }
}

/** Merge new answers into saved config and persist */
export function mergeAndSaveConfig(answers: Record<string, string>): void {
  const existing = loadSavedConfig();
  const merged = { ...existing, ...answers };
  saveConfig(merged);
}

/** Remove saved config file so credentials are cleared */
export function clearConfig(): boolean {
  try {
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
      return true;
    }
    return false;
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
