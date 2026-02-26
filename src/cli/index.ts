#!/usr/bin/env node
import { Command } from 'commander';
import { watchCommand } from './commands/watch';
import { reviewCommand } from './commands/review';

const program = new Command();

program
  .name('pr-agent')
  .description('AI-powered Azure DevOps PR reviewer')
  .version('1.0.0');

program
  .command('watch')
  .description('Watch repositories for new PRs and review them automatically')
  .option('--no-tui', 'Disable TUI, log to stdout instead')
  .option('--interval <seconds>', 'Poll interval in seconds', '30')
  .option('--state-file <path>', 'Path to state file', './pr-agent-state.json')
  .action(watchCommand);

program
  .command('review <url>')
  .description('Review a single PR by Azure DevOps URL')
  .action(reviewCommand);

program.parse();
