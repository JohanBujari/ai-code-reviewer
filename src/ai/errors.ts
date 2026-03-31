import type { CliProviderKind } from "./provider-status";

export interface ProviderErrorAction {
  type: "run-command";
  command: string;
}

export class ProviderError extends Error {
  readonly code: string;
  readonly provider: CliProviderKind;
  readonly action?: ProviderErrorAction;

  constructor(
    code: string,
    provider: CliProviderKind,
    message: string,
    action?: ProviderErrorAction,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.provider = provider;
    this.action = action;
  }
}

export class ProviderNotInstalledError extends ProviderError {
  constructor(provider: CliProviderKind, command: string, message?: string) {
    super(
      "PROVIDER_NOT_INSTALLED",
      provider,
      message ?? `${capitalize(provider)} CLI is not installed. Install it and try again.`,
      { type: "run-command", command },
    );
  }
}

export class ProviderUnauthenticatedError extends ProviderError {
  constructor(provider: CliProviderKind, command: string) {
    super(
      "PROVIDER_UNAUTHENTICATED",
      provider,
      provider === "codex"
        ? "Codex is not authenticated. Run 'codex login' and try again."
        : "Claude is not authenticated. Run 'claude', then '/login', and try again.",
      { type: "run-command", command },
    );
  }
}

export class ProviderAuthUnknownError extends ProviderError {
  constructor(provider: CliProviderKind, command: string) {
    super(
      "PROVIDER_AUTH_UNKNOWN",
      provider,
      provider === "codex"
        ? "Codex is installed, but its authentication state could not be confirmed."
        : "Claude is installed, but its authentication state could not be confirmed. Continue if you are already logged in, or run 'claude' and then '/login'.",
      { type: "run-command", command },
    );
  }
}

export class ProviderExecutionError extends ProviderError {
  constructor(provider: CliProviderKind, message: string) {
    super("PROVIDER_EXECUTION_ERROR", provider, message);
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(provider: CliProviderKind, timeoutMs: number) {
    super(
      "PROVIDER_TIMEOUT",
      provider,
      `${capitalize(provider)} timed out after ${timeoutMs}ms.`,
    );
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
