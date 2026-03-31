import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ClaudeCliConfig, CodexCliConfig } from "../config";
import { DEFAULTS } from "../config";
import type { AiProvider, ReviewContext } from "./provider";
import { CommandRunner, runCommand } from "./command-runner";
import {
  ProviderExecutionError,
  ProviderTimeoutError,
  ProviderUnauthenticatedError,
} from "./errors";
import { extractJson } from "./extract-json";
import {
  ensureCliProviderReady,
  detectAuthFailure,
  resolveCliCommand,
} from "./provider-auth";

export class CliAuthProvider implements AiProvider {
  constructor(
    private readonly config: CodexCliConfig | ClaudeCliConfig,
    private readonly runner: CommandRunner = runCommand,
  ) {}

  async review(
    systemPrompt: string,
    userPrompt: string,
    context: ReviewContext,
  ): Promise<string> {
    await ensureCliProviderReady(this.config, this.runner);

    return this.config.provider === "codex"
      ? this.runCodexReview(systemPrompt, userPrompt, context)
      : this.runClaudeReview(systemPrompt, userPrompt);
  }

  private async runCodexReview(
    systemPrompt: string,
    userPrompt: string,
    context: ReviewContext,
  ): Promise<string> {
    if (this.config.provider !== "codex") {
      throw new ProviderExecutionError(
        "codex",
        "Codex review was invoked with a non-Codex provider configuration.",
      );
    }

    const resolved = resolveCliCommand("codex");
    if (!resolved.command) {
      throw new ProviderExecutionError(
        "codex",
        "Codex CLI is not available.",
      );
    }

    const cwd = await mkdtemp(join(tmpdir(), "axiom-pr-codex-"));
    const schemaPath = join(cwd, "review-result-schema.json");
    const outputPath = join(cwd, "review-output.json");
    const packetPath = join(cwd, "review-packet.txt");
    const promptText = buildCodexPrompt(systemPrompt, userPrompt);
    let preserveArtifacts = process.env.AXIOM_KEEP_CLI_ARTIFACTS === "1";
    let debugHintLogged = false;
    let lastActivityAt = Date.now();
    let lastEventLabel = "starting";
    let stdoutLineBuffer = "";
    const reasoningEffort =
      this.config.reasoningEffort ?? DEFAULTS.codexReasoningEffort;
    const heartbeat = setInterval(() => {
      const elapsed = formatDuration(Date.now() - lastActivityAt);
      const eventSuffix =
        lastEventLabel && lastEventLabel !== "starting"
          ? ` • last Codex event: ${lastEventLabel}`
          : "";
      context.logger.info(
        `[codex] still running • no new output for ${elapsed}${eventSuffix}`,
      );
    }, 30_000);

    try {
      await writeFile(schemaPath, JSON.stringify(buildReviewSchema(), null, 2), "utf8");
      await writeFile(packetPath, promptText, "utf8");

      const args = [
        "exec",
        "-",
        "-c",
        `model_reasoning_effort="${reasoningEffort}"`,
        "--disable",
        "multi_agent",
        "--skip-git-repo-check",
        "--ephemeral",
        "--json",
        "--color",
        "never",
        "-s",
        "read-only",
        "--output-schema",
        schemaPath,
        "-o",
        outputPath,
      ];

      if (this.config.model) {
        args.push("-m", this.config.model);
      }

      const result = await this.runner(resolved.command, args, {
        cwd,
        timeoutMs: DEFAULTS.codexReviewTimeoutMs,
        stdin: promptText,
        onStdoutChunk: (chunk) => {
          lastActivityAt = Date.now();
          stdoutLineBuffer += chunk;
          let newlineIndex = stdoutLineBuffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = stdoutLineBuffer.slice(0, newlineIndex).trim();
            stdoutLineBuffer = stdoutLineBuffer.slice(newlineIndex + 1);
            const eventType = parseCodexEventType(line);
            if (eventType) {
              lastEventLabel = eventType;
            }
            newlineIndex = stdoutLineBuffer.indexOf("\n");
          }
        },
        onStderrChunk: () => {
          lastActivityAt = Date.now();
        },
      });

      if (result.timedOut) {
        preserveArtifacts = true;
        logCodexDebugArtifacts(
          context,
          cwd,
          resolved.command,
          args,
          packetPath,
          true,
        );
        debugHintLogged = true;
        throw new ProviderTimeoutError("codex", DEFAULTS.codexReviewTimeoutMs);
      }

      if (detectAuthFailure("codex", result.stdout, result.stderr)) {
        throw new ProviderUnauthenticatedError("codex", "codex login");
      }

      const structuredOutput = await readStructuredReviewOutput(outputPath);
      if (structuredOutput) {
        return structuredOutput;
      }

      if (result.exitCode !== 0) {
        preserveArtifacts = true;
        logCodexDebugArtifacts(
          context,
          cwd,
          resolved.command,
          args,
          packetPath,
        );
        debugHintLogged = true;
        throw new ProviderExecutionError(
          "codex",
          formatProviderFailure("Codex review failed", result.stdout, result.stderr),
        );
      }

      preserveArtifacts = true;
      logCodexDebugArtifacts(
        context,
        cwd,
        resolved.command,
        args,
        packetPath,
      );
      debugHintLogged = true;
      throw new ProviderExecutionError(
        "codex",
        "Codex review completed without producing a structured review result.",
      );
    } finally {
      clearInterval(heartbeat);
      if (!preserveArtifacts) {
        await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
      } else if (!debugHintLogged) {
        logCodexDebugArtifacts(
          context,
          cwd,
          resolved.command,
          [
            "exec",
            "-",
            "-c",
            `model_reasoning_effort="${reasoningEffort}"`,
            "--disable",
            "multi_agent",
            "--skip-git-repo-check",
            "--ephemeral",
            "--json",
            "--color",
            "never",
            "-s",
            "read-only",
            "--output-schema",
            schemaPath,
            "-o",
            outputPath,
            ...(this.config.model ? ["-m", this.config.model] : []),
          ],
          packetPath,
        );
      }
    }
  }

  private async runClaudeReview(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    if (this.config.provider !== "claude") {
      throw new ProviderExecutionError(
        "claude",
        "Claude review was invoked with a non-Claude provider configuration.",
      );
    }

    const resolved = resolveCliCommand("claude");
    if (!resolved.command) {
      throw new ProviderExecutionError(
        "claude",
        "Claude Code CLI is not available.",
      );
    }

    const cwd = await mkdtemp(join(tmpdir(), "axiom-pr-claude-"));

    try {
      const effort = this.config.effort ?? DEFAULTS.claudeEffort;
      const args = [
        "-p",
        "Review the piped PR packet and respond with ONLY the JSON review object.",
        "--append-system-prompt",
        systemPrompt,
        "--effort",
        effort,
        "--output-format",
        "json",
        "--input-format",
        "text",
        "--max-turns",
        "1",
      ];

      if (this.config.model) {
        args.push("--model", this.config.model);
      }

      const result = await this.runner(resolved.command, args, {
        cwd,
        timeoutMs: DEFAULTS.claudeReviewTimeoutMs,
        stdin: userPrompt,
      });

      if (result.timedOut) {
        throw new ProviderTimeoutError("claude", DEFAULTS.claudeReviewTimeoutMs);
      }

      if (detectAuthFailure("claude", result.stdout, result.stderr)) {
        throw new ProviderUnauthenticatedError("claude", "claude");
      }

      if (result.exitCode !== 0) {
        throw new ProviderExecutionError(
          "claude",
          formatProviderFailure("Claude review failed", result.stdout, result.stderr),
        );
      }

      const envelope = JSON.parse(result.stdout) as {
        result?: string;
        is_error?: boolean;
        subtype?: string;
      };

      if (
        envelope.is_error &&
        typeof envelope.result === "string" &&
        /\bhit your limit\b|\brate limit\b|\bquota\b|\bresets\b/i.test(
          envelope.result,
        )
      ) {
        throw new ProviderExecutionError(
          "claude",
          envelope.result.trim(),
        );
      }

      if (envelope.is_error || envelope.subtype === "error" || !envelope.result) {
        throw new ProviderExecutionError(
          "claude",
          formatProviderFailure("Claude returned an unexpected response", result.stdout, result.stderr),
        );
      }

      return extractJson(envelope.result);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ProviderExecutionError(
          "claude",
          formatProviderFailure("Claude returned invalid JSON output", "", ""),
        );
      }
      throw error;
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function buildCodexPrompt(systemPrompt: string, userPrompt: string): string {
  return [
    "Follow these instructions exactly.",
    "",
    "## System Instructions",
    systemPrompt,
    "",
    "## Review Packet",
    userPrompt,
  ].join("\n");
}

function buildReviewSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["comments"],
    properties: {
      comments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["filePath", "lineNumber", "endLineNumber", "severity", "message"],
          properties: {
            filePath: { type: "string" },
            lineNumber: { type: "number" },
            endLineNumber: {
              anyOf: [{ type: "number" }, { type: "null" }],
            },
            severity: {
              type: "string",
              enum: ["critical", "warning", "suggestion", "nitpick"],
            },
            message: { type: "string" },
          },
        },
      },
    },
  };
}

function formatProviderFailure(
  prefix: string,
  stdout: string,
  stderr: string,
): string {
  const detail = summarizeFailureDetail(stderr, stdout);

  if (!detail) return prefix;
  return `${prefix}: ${detail}`;
}

async function readStructuredReviewOutput(path: string): Promise<string | null> {
  try {
    const output = await readFile(path, "utf8");
    return extractJson(output);
  } catch {
    return null;
  }
}

function summarizeFailureDetail(...streams: string[]): string | null {
  for (const stream of streams) {
    const lines = stream
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !isCliNoiseLine(line));

    if (lines.length === 0) {
      continue;
    }

    const emphasized = lines.filter((line) =>
      /\berror\b|\bfailed\b|\bpanic\b|\bdenied\b|\binvalid\b|\bmissing\b|\bnot\b|\bquota\b|\blimit\b|\bunable\b/i.test(
        line,
      ),
    );
    const chosen = (emphasized.length > 0 ? emphasized : lines).slice(-3);
    const singleLine = chosen.join(" | ").replace(/\s+/g, " ").slice(0, 600);
    if (singleLine) {
      return singleLine;
    }
  }

  return null;
}

function isCliNoiseLine(line: string): boolean {
  return (
    /^WARNING: proceeding/i.test(line) ||
    /^OpenAI Codex v/i.test(line) ||
    /^-+$/.test(line) ||
    /^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):/i.test(
      line,
    ) ||
    /^(user|assistant)$/i.test(line)
  );
}

function parseCodexEventType(line: string): string | null {
  if (!line.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(line) as { type?: string };
    return typeof parsed.type === "string" ? parsed.type : null;
  } catch {
    return null;
  }
}

function logCodexDebugArtifacts(
  context: ReviewContext,
  cwd: string,
  command: string,
  args: string[],
  packetPath: string,
  timedOut = false,
): void {
  const quotedArgs = args.map(quoteShellArg).join(" ");
  const replayCommand = `cat ${quoteShellArg(packetPath)} | ${quoteShellArg(command)} ${quotedArgs}`;
  context.logger.warn(
    `[codex-debug] ${timedOut ? "Timed out" : "Preserved"} debug artifacts in ${cwd}`,
  );
  context.logger.warn(`[codex-debug] Replay with: ${replayCommand}`);
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
