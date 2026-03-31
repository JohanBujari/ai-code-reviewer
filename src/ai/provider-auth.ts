import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, extname, join } from "node:path";
import type { ClaudeCliConfig, CodexCliConfig } from "../config";
import {
  ProviderNotInstalledError,
  ProviderUnauthenticatedError,
  ProviderTimeoutError,
} from "./errors";
import type { CommandRunner } from "./command-runner";
import { runCommand } from "./command-runner";
import type { CliProviderKind, ProviderSnapshot } from "./provider-status";

const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

const UNAUTH_MARKERS = [
  "not logged in",
  "login required",
  "authentication required",
  "not authenticated",
];

const RATE_LIMIT_MARKERS = [
  "hit your limit",
  "rate limit",
  "quota",
  "resets ",
];

const UNKNOWN_COMMAND_MARKERS = [
  "unknown command",
  "unrecognized command",
  "unexpected argument",
];

export async function probeCliProvider(
  provider: CodexCliConfig | ClaudeCliConfig,
  runner: CommandRunner = runCommand,
): Promise<ProviderSnapshot> {
  return provider.provider === "codex"
    ? probeCodex(runner)
    : probeClaude(runner);
}

export async function ensureCliProviderReady(
  provider: CodexCliConfig | ClaudeCliConfig,
  runner: CommandRunner = runCommand,
): Promise<ProviderSnapshot> {
  const snapshot = await probeCliProvider(provider, runner);

  if (!snapshot.installed) {
    throw new ProviderNotInstalledError(
      provider.provider,
      provider.provider === "codex" ? "codex login" : "claude",
      snapshot.message,
    );
  }

  if (snapshot.auth.status === "unauthenticated") {
    throw new ProviderUnauthenticatedError(
      provider.provider,
      provider.provider === "codex" ? "codex login" : "claude",
    );
  }

  return snapshot;
}

export async function probeCodex(
  runner: CommandRunner = runCommand,
): Promise<ProviderSnapshot> {
  const checkedAt = new Date().toISOString();
  const resolved = resolveCliCommand("codex");
  if (!resolved.command) {
    return {
      provider: "codex",
      installed: false,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      binaryPath: null,
      message: "Codex CLI is not installed. Install it and run 'codex login'.",
      checkedAt,
    };
  }

  const versionResult = await runner(resolved.command, ["--version"], {
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  });

  if (versionResult.missingBinary) {
    return {
      provider: "codex",
      installed: false,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      binaryPath: resolved.command,
      message: "Codex CLI is not installed. Install it and run 'codex login'.",
      checkedAt,
    };
  }

  if (versionResult.timedOut) {
    throw new ProviderTimeoutError("codex", DEFAULT_PROBE_TIMEOUT_MS);
  }

  const version = extractVersion(versionResult.stdout || versionResult.stderr);
  const statusResult = await runner(resolved.command, ["login", "status"], {
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  });

  if (statusResult.timedOut) {
    throw new ProviderTimeoutError("codex", DEFAULT_PROBE_TIMEOUT_MS);
  }

  const combined = normalizeCliOutput(statusResult.stdout, statusResult.stderr);

  if (
    statusResult.exitCode === 0 &&
    /\blogged in\b|\bauthenticated\b/i.test(combined)
  ) {
    return {
      provider: "codex",
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated" },
      binaryPath: resolved.command,
      checkedAt,
    };
  }

  if (containsAny(combined, UNAUTH_MARKERS)) {
    return {
      provider: "codex",
      installed: true,
      version,
      status: "error",
      auth: { status: "unauthenticated" },
      binaryPath: resolved.command,
      message: "Codex is not authenticated. Run 'codex login' and try again.",
      checkedAt,
    };
  }

  if (containsAny(combined, UNKNOWN_COMMAND_MARKERS)) {
    return {
      provider: "codex",
      installed: true,
      version,
      status: "warning",
      auth: { status: "unknown" },
      binaryPath: resolved.command,
      message:
        "Codex is installed, but this version does not support 'codex login status'.",
      checkedAt,
    };
  }

  return {
    provider: "codex",
    installed: true,
    version,
    status: "warning",
    auth: { status: "unknown" },
    binaryPath: resolved.command,
    message:
      "Codex is installed, but its authentication state could not be confirmed.",
    checkedAt,
  };
}

export async function probeClaude(
  runner: CommandRunner = runCommand,
): Promise<ProviderSnapshot> {
  const checkedAt = new Date().toISOString();
  const resolved = resolveCliCommand("claude");

  if (!resolved.command) {
    return {
      provider: "claude",
      installed: false,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      binaryPath: null,
      message: "Claude Code CLI is not installed. Install it and run 'claude'.",
      checkedAt,
    };
  }

  const versionResult = await runner(resolved.command, ["--version"], {
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  });

  if (versionResult.missingBinary) {
    return {
      provider: "claude",
      installed: false,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      binaryPath: resolved.command,
      message: "Claude Code CLI is not installed. Install it and run 'claude'.",
      checkedAt,
    };
  }

  if (versionResult.timedOut) {
    throw new ProviderTimeoutError("claude", DEFAULT_PROBE_TIMEOUT_MS);
  }

  const combined = normalizeCliOutput(versionResult.stdout, versionResult.stderr);
  const version = extractVersion(combined);
  const authProbe = await runClaudeAuthProbe(resolved.command, runner);

  if (authProbe.timedOut) {
    throw new ProviderTimeoutError("claude", DEFAULT_PROBE_TIMEOUT_MS);
  }

  if (detectAuthFailure("claude", authProbe.stdout, authProbe.stderr)) {
    return {
      provider: "claude",
      installed: true,
      version,
      status: "error",
      auth: { status: "unauthenticated" },
      binaryPath: resolved.command,
      message: "Claude is not authenticated. Run 'claude' and then '/login', then re-check.",
      checkedAt,
    };
  }

  const envelope = parseClaudeEnvelope(authProbe.stdout);

  if (isClaudeUnauthenticatedEnvelope(envelope)) {
    return {
      provider: "claude",
      installed: true,
      version,
      status: "error",
      auth: { status: "unauthenticated" },
      binaryPath: resolved.command,
      message: "Claude is not authenticated. Run 'claude' and then '/login', then re-check.",
      checkedAt,
    };
  }

  if (isClaudeRateLimitedEnvelope(envelope)) {
    return {
      provider: "claude",
      installed: true,
      version,
      status: "error",
      auth: { status: "authenticated" },
      binaryPath: resolved.command,
      message: envelope?.result?.trim() || "Claude is authenticated, but the account has hit its usage limit.",
      checkedAt,
    };
  }

  if (authProbe.exitCode === 0 && isSuccessfulClaudeEnvelope(envelope)) {
    return {
      provider: "claude",
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated" },
      binaryPath: resolved.command,
      message: "Claude authentication was verified successfully.",
      checkedAt,
    };
  }

  return {
    provider: "claude",
    installed: true,
    version,
    status: "warning",
    auth: { status: "unknown" },
    binaryPath: resolved.command,
    message:
      "Claude CLI is available, but authentication could not be confirmed. Re-check or run 'claude' and then '/login'.",
    checkedAt,
  };
}

export function resolveCliCommand(
  provider: CliProviderKind,
): { command: string | null } {
  const envKey = provider === "codex" ? "CODEX_BIN" : "CLAUDE_BIN";
  const binaryName = provider;
  const explicitCommand = process.env[envKey];
  const candidatePaths = [
    ...(explicitCommand ? expandExecutablePathCandidates(explicitCommand) : []),
    ...findOnPath(binaryName),
    ...(provider === "codex"
      ? [
          "/opt/homebrew/bin/codex",
          "/usr/local/bin/codex",
          join(homedir(), ".local/bin/codex"),
          join(homedir(), "bin/codex"),
          ...getWindowsNpmShimCandidates("codex"),
        ]
      : [
          "/opt/homebrew/bin/claude",
          "/usr/local/bin/claude",
          join(homedir(), ".local/bin/claude"),
          join(homedir(), "bin/claude"),
          ...getWindowsNpmShimCandidates("claude"),
        ]),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return { command: candidate };
    }
  }

  return { command: null };
}

export function detectAuthFailure(
  provider: CliProviderKind,
  stdout: string,
  stderr: string,
): boolean {
  const normalizedStderr = normalizeCliOutput("", stderr);
  if (containsAny(normalizedStderr, UNAUTH_MARKERS)) return true;
  if (provider === "claude" && normalizedStderr.includes("/login")) return true;

  if (provider === "claude") {
    const envelope = parseClaudeEnvelope(stdout);
    if (envelope) {
      return isClaudeUnauthenticatedEnvelope(envelope);
    }

    const normalizedStdout = normalizeCliOutput(stdout, "");
    return (
      containsAny(normalizedStdout, UNAUTH_MARKERS) ||
      normalizedStdout.includes("/login")
    );
  }

  return containsAny(normalizeCliOutput(stdout, ""), UNAUTH_MARKERS);
}

function normalizeCliOutput(stdout: string, stderr: string): string {
  return [stdout, stderr]
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("WARNING: proceeding"))
    .join("\n")
    .toLowerCase();
}

function extractVersion(output: string): string | null {
  const normalized = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("WARNING: proceeding"));
  if (!normalized) return null;
  const match = normalized.match(/(\d+\.\d+\.\d+(?:[-\w.]*)?)/);
  return match?.[1] ?? normalized;
}

function containsAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

async function runClaudeAuthProbe(
  command: string,
  runner: CommandRunner,
) {
  const cwd = await mkdtemp(join(tmpdir(), "axiom-claude-probe-"));
  try {
    return await runner(
      command,
      [
        "-p",
        "Reply with exactly OK.",
        "--output-format",
        "json",
        "--max-turns",
        "1",
      ],
      {
        cwd,
        timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
      },
    );
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

function parseClaudeEnvelope(stdout: string): {
  result?: string;
  is_error?: boolean;
  subtype?: string;
} | null {
  try {
    return JSON.parse(stdout) as {
      result?: string;
      is_error?: boolean;
      subtype?: string;
    };
  } catch {
    return null;
  }
}

function isSuccessfulClaudeEnvelope(
  parsed: ReturnType<typeof parseClaudeEnvelope>,
): boolean {
  return Boolean(
    parsed &&
    !parsed.is_error &&
    parsed.subtype !== "error" &&
    typeof parsed.result === "string" &&
    parsed.result.length > 0,
  );
}

function isClaudeUnauthenticatedEnvelope(
  parsed: ReturnType<typeof parseClaudeEnvelope>,
): boolean {
  if (!parsed || !parsed.is_error || typeof parsed.result !== "string") {
    return false;
  }

  const normalized = parsed.result.toLowerCase();
  return containsAny(normalized, UNAUTH_MARKERS) || normalized.includes("/login");
}

function isClaudeRateLimitedEnvelope(
  parsed: ReturnType<typeof parseClaudeEnvelope>,
): boolean {
  if (!parsed || typeof parsed.result !== "string") {
    return false;
  }

  const normalized = parsed.result.toLowerCase();
  return containsAny(normalized, RATE_LIMIT_MARKERS);
}

export function findOnPath(
  binaryName: string,
  options: {
    platform?: NodeJS.Platform;
    pathValue?: string;
    pathExt?: string;
  } = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const pathValue = options.pathValue ?? process.env.PATH ?? "";
  if (!pathValue) return [];
  const pathDelimiter = platform === "win32" ? ";" : delimiter;
  const executableNames = getExecutableNames(
    binaryName,
    platform,
    options.pathExt,
  );

  return pathValue
    .split(pathDelimiter)
    .filter(Boolean)
    .flatMap((segment) =>
      executableNames.map((executableName) => join(segment, executableName)),
    );
}

export function getExecutableNames(
  binaryName: string,
  platform: NodeJS.Platform = process.platform,
  pathExt: string | undefined = process.env.PATHEXT,
): string[] {
  if (platform !== "win32") {
    return [binaryName];
  }

  const extensions = (pathExt ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`))
    .map((entry) => entry.toLowerCase());

  return [binaryName, ...extensions.map((entry) => `${binaryName}${entry}`)];
}

function expandExecutablePathCandidates(
  commandPath: string,
  platform: NodeJS.Platform = process.platform,
  pathExt: string | undefined = process.env.PATHEXT,
): string[] {
  if (platform !== "win32" || extname(commandPath)) {
    return [commandPath];
  }

  return [commandPath, ...getExecutableNames("", platform, pathExt)
    .slice(1)
    .map((extension) => `${commandPath}${extension}`)];
}

function getWindowsNpmShimCandidates(binaryName: string): string[] {
  if (process.platform !== "win32") {
    return [];
  }

  const roamingNpm =
    process.env.APPDATA
      ? join(process.env.APPDATA, "npm", binaryName)
      : join(homedir(), "AppData", "Roaming", "npm", binaryName);
  const localNpm =
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "npm", binaryName)
      : join(homedir(), "AppData", "Local", "npm", binaryName);

  return [
    ...expandExecutablePathCandidates(roamingNpm),
    ...expandExecutablePathCandidates(localNpm),
  ];
}
