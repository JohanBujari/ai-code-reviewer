#!/usr/bin/env node
import { Command } from 'commander';
import { startCliApp } from '../tui/cli-app';
import { watchCommand } from './commands/watch';
import { reviewCommand } from './commands/review';

const program = new Command();

program
  .name('axiom')
  .description('Axiom — AI-powered Azure DevOps PR reviewer')
  .version('1.1.0');

// ── Watch command ──
program
  .command('watch')
  .description('Watch repositories for new PRs and review them automatically')
  .option('--no-tui', 'Disable TUI, log to stdout instead')
  .option('--interval <seconds>', 'Poll interval in seconds', '30')
  .option('--state-file <path>', 'Path to state file', './pr-agent-state.json')
  .action((options) => {
    if (options.tui === false || !process.stdin.isTTY) {
      // Fallback to plain text mode
      watchCommand(options);
    } else {
      startCliApp({
        command: 'watch',
        options: {
          interval: options.interval,
          stateFile: options.stateFile,
        },
      });
    }
  });

// ── Review command ──
program
  .command('review [url]')
  .description('Review a single PR by Azure DevOps URL')
  .option('--no-tui', 'Disable TUI, log to stdout instead')
  .action((url, options) => {
    if (options.tui === false || !process.stdin.isTTY) {
      if (!url) {
        console.error('URL is required in non-interactive mode');
        process.exit(1);
      }
      reviewCommand(url);
    } else {
      startCliApp({
        command: 'review',
        reviewUrl: url,
        options: {},
      });
    }
  });

// ── Default action (no command) → interactive home screen ──
if (process.argv.length <= 2 && process.stdin.isTTY) {
  startCliApp({ options: {} });
} else {
  program.parse();
}
