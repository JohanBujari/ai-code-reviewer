#!/usr/bin/env node
import { Command } from "commander";
import { startCliApp } from "../tui/cli-app";
import { watchCommand } from "./commands/watch";
import { reviewCommand } from "./commands/review";
import {
  listProfiles,
  getActiveProfile,
  setActiveProfile,
  deleteProfile,
  createProfile,
  getDefaultStatePath,
} from "./config-store";

const program = new Command();

program
  .name("axiom")
  .description("Axiom — AI-powered Azure DevOps PR reviewer")
  .version("1.0.0")
  .option("-p, --profile <name>", "Use a specific configuration profile");

// ── Watch command ──
program
  .command("watch")
  .description("Watch repositories for new PRs and review them automatically")
  .option("--no-tui", "Disable TUI, log to stdout instead")
  .option("--interval <seconds>", "Poll interval in seconds", "30")
  .option("--state-file <path>", "Path to state file", getDefaultStatePath())
  .action((options) => {
    const profile = program.opts().profile as string | undefined;
    if (options.tui === false || !process.stdin.isTTY) {
      watchCommand({ ...options, profile });
    } else {
      startCliApp({
        command: "watch",
        profile,
        options: {
          interval: options.interval,
          stateFile: options.stateFile,
        },
      });
    }
  });

// ── Review command ──
program
  .command("review [url]")
  .description("Review a single PR by Azure DevOps URL")
  .option("--no-tui", "Disable TUI, log to stdout instead")
  .action((url, options) => {
    const profile = program.opts().profile as string | undefined;
    if (options.tui === false || !process.stdin.isTTY) {
      if (!url) {
        console.error("URL is required in non-interactive mode");
        process.exit(1);
      }
      reviewCommand(url, profile);
    } else {
      startCliApp({
        command: "review",
        reviewUrl: url,
        profile,
        options: {},
      });
    }
  });

// ── Profile management subcommand ──
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const active = getActiveProfile();
    if (profiles.length === 0) {
      console.log('No profiles configured yet.');
      return;
    }
    for (const p of profiles) {
      console.log(p === active ? `* ${p}` : `  ${p}`);
    }
  });

profileCmd
  .command('add <name>')
  .description('Create a new profile')
  .action((name) => {
    try {
      createProfile(name);
      setActiveProfile(name);
      console.log(`Created and switched to profile: ${name}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch active profile')
  .action((name) => {
    try {
      setActiveProfile(name);
      console.log(`Switched to profile: ${name}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

profileCmd
  .command('edit [name]')
  .description('Edit profile credentials and settings')
  .action((name) => {
    const profile = name ?? program.opts().profile;
    startCliApp({
      command: "watch",
      profile,
      editMode: true,
      options: {},
    });
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name) => {
    if (deleteProfile(name)) {
      console.log(`Deleted profile: ${name}`);
    } else {
      console.error(`Profile "${name}" not found`);
      process.exit(1);
    }
  });

// ── Default action (no command) → interactive home screen ──
if (process.argv.length <= 2 && process.stdin.isTTY) {
  startCliApp({ options: {} });
} else {
  program.parse();
}
