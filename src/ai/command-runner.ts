import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  missingBinary: boolean;
}

export interface CommandOptions {
  cwd?: string;
  timeoutMs?: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export const runCommand: CommandRunner = (
  command,
  args,
  options = {},
) =>
  new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let missingBinary = false;
    let settled = false;

    const settle = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdoutChunk?.(text);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderrChunk?.(text);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (timeout) clearTimeout(timeout);
      missingBinary = error.code === "ENOENT";
      settle({
        stdout,
        stderr: error.message || stderr,
        exitCode: null,
        timedOut,
        missingBinary,
      });
    });

    child.on("close", (exitCode) => {
      if (timeout) clearTimeout(timeout);
      settle({
        stdout,
        stderr,
        exitCode,
        timedOut,
        missingBinary,
      });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
