import type { AiConfig, ClaudeCliConfig, CodexCliConfig } from "../config";

export type CliProviderKind = "codex" | "claude";
export type ProviderState = "ready" | "warning" | "error";
export type AuthStatus = "authenticated" | "unauthenticated" | "unknown";

export interface ProviderSnapshot {
  provider: CliProviderKind;
  installed: boolean;
  version: string | null;
  status: ProviderState;
  auth: { status: AuthStatus };
  binaryPath?: string | null;
  message?: string;
  checkedAt: string;
}

export function isCliAuthConfig(
  config: AiConfig,
): config is CodexCliConfig | ClaudeCliConfig {
  return config.transport === "provider-cli";
}

export function isApiKeyConfig(config: AiConfig): boolean {
  return !isCliAuthConfig(config);
}

export function getProviderLoginCommand(provider: CliProviderKind): string {
  return provider === "codex" ? "codex login" : "claude then /login";
}

export function isProviderReady(snapshot: ProviderSnapshot): boolean {
  return snapshot.installed && snapshot.status !== "error";
}
