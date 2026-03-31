# axiom-pr

AI-powered pull request reviewer for Azure DevOps. Supports **Codex CLI**, **Claude Code**, **OpenAI**, and **Anthropic**.

Two modes of operation:

- **CLI Watcher** — long-running daemon that automatically detects and reviews PRs with a real-time terminal UI
- **Library** — integrate into your own Express/Fastify/NestJS server via webhooks

## Installation

### CLI

```bash
npm install -g axiom-pr
axiom-pr --help
```

### Library

```bash
npm install axiom-pr
```

## CLI Watcher (Recommended)

The watcher runs as a daemon, polls Azure DevOps for new PRs and new iterations (pushed commits), and reviews them automatically.

### Setup

The CLI uses an interactive setup wizard. Run `axiom-pr` and it will prompt you for everything. Configuration is saved to `~/.axiom/config.json` and reused on subsequent runs.

Alternatively, you can use a `.env` file or environment variables:

```bash
# Azure DevOps
AZURE_DEVOPS_ORG=your-org
AZURE_DEVOPS_PAT=your-personal-access-token

# AI Provider: codex | claude | openai | anthropic
AI_PROVIDER=codex

# If using Codex, run:
# codex login
# Optional:
# CODEX_MODEL=gpt-5.4
# CODEX_REASONING_EFFORT=medium

# If using Claude Code, run:
# claude
# then /login
# Optional:
# CLAUDE_MODEL=sonnet
# CLAUDE_EFFORT=medium

# If using OpenAI instead:
# OPENAI_API_KEY=sk-...

# Repositories to watch (watch mode only, format: project/repoId/displayName)
WATCH_REPOS=MyProject/repo-guid-or-name/my-repo
```

### Finding your repo details

From the Azure DevOps URL:

```
https://dev.azure.com/{org}/{project}/_git/{repoName}
```

Example: `https://dev.azure.com/atraxal/EasyHR/_git/EasyHR_frontend`
→ `WATCH_REPOS=EasyHR/EasyHR_frontend/EasyHR_frontend`

Multiple repos:

```bash
WATCH_REPOS=EasyHR/EasyHR_frontend/EasyHR_frontend,PGFlow/PGFlow/PGFlow
```

### Running

```bash
# First-time interactive setup
axiom-pr

# Start watching with the TUI
axiom-pr watch

# Run without TUI (for Docker/CI/servers)
axiom-pr watch --no-tui

# Custom poll interval (default: 30s)
axiom-pr watch --interval 60

# Custom state file location
axiom-pr watch --state-file ./my-state.json

# Use a specific profile
axiom-pr watch --profile work

# From a local repo checkout instead of npm/published binaries
npm install
npm run cli -- watch
```

When you are modifying this repo locally, prefer `npm run cli -- ...` over `npx axiom-pr`.
`npx axiom-pr` may resolve the published package instead of your current working tree, which can make fixes appear to "not apply" during testing.

### Review a single PR

```bash
axiom-pr review https://dev.azure.com/my-org/MyProject/_git/my-repo/pullrequest/123

# With a specific profile
axiom-pr review https://dev.azure.com/my-org/MyProject/_git/my-repo/pullrequest/123 --profile client-x

# From the local repo checkout
npm run cli -- review https://dev.azure.com/my-org/MyProject/_git/my-repo/pullrequest/123
```

### Configuration Profiles

Axiom supports named profiles for managing multiple Azure DevOps organizations or different configurations. Each profile stores its own org, PAT, watched repos, and provider choice. OpenAI/Anthropic API keys are still supported in profiles; Codex/Claude use the local CLI login state instead of storing provider credentials.

```bash
# Profile management
axiom-pr profile list              # List all profiles (* = active)
axiom-pr profile add <name>        # Create and switch to a new profile
axiom-pr profile edit [name]       # Update saved credentials/settings
axiom-pr profile use <name>        # Switch active profile
axiom-pr profile delete <name>     # Delete a profile

# Use a profile for a single command
axiom-pr watch --profile work
axiom-pr review <url> --profile client-x
```

On first run, the TUI prompts you to name your profile. On subsequent runs, you'll see a profile selector to pick an existing profile or create a new one.

**Config file structure** (`~/.axiom/config.json`):

```json
{
  "version": 3,
  "activeProfile": "work",
  "global": {},
  "profiles": {
    "work": {
      "AZURE_DEVOPS_ORG": "my-work-org",
      "AZURE_DEVOPS_PAT": "pat-...",
      "AI_PROVIDER": "codex",
      "CODEX_REASONING_EFFORT": "medium",
      "WATCH_REPOS": "ProjectA/id1/Repo1"
    },
    "client-x": {
      "AZURE_DEVOPS_ORG": "client-x-org",
      "AZURE_DEVOPS_PAT": "pat-...",
      "AI_PROVIDER": "claude",
      "CLAUDE_EFFORT": "high",
      "WATCH_REPOS": "ProjectB/id2/Repo2"
    }
  }
}
```

Environment variables and `.env` always take highest priority. Any legacy Azure OpenAI settings are removed automatically the next time the config file is loaded.

### TUI Keyboard Shortcuts

| Key | Action |
| --- | ------ |
| `q` | Quit |
| `p` | Pause/resume polling |
| `r` | Force immediate refresh |
| `x` | Reset saved review state for the current provider and watched repos |

### TUI Display

The terminal UI shows:

- **Header** — watching status, uptime, last poll time
- **Repo List** — repositories being watched
- **PR Queue** — pending, in-progress, and completed reviews
- **Review Progress** — current stage, chunk info, and file download progress
- **Logs** — real-time log output with timestamps
- **Status Bar** — keyboard shortcuts and last error

### State Persistence

The watcher saves state to `~/.axiom/axiom-state.json` by default (configurable via `--state-file`) to:
- Avoid re-reviewing PRs after restart
- Track which iteration was last reviewed
- Auto-cleanup entries older than 7 days

### How the Watcher Works

1. Polls each configured repo for active pull requests (every 30s)
2. For each active PR, checks the latest iteration (commit)
3. Compares against saved state to detect new work
4. Queues new reviews (processes one at a time)
5. Fetches changed files, filters out binaries/lock files
6. Truncates very large diffs, then chunks the review workload for the AI provider
7. Posts inline comments on specific lines in Azure DevOps
8. Sets PR status (succeeded/failed based on critical issues)
9. Saves state to prevent duplicate reviews

### Review Scope And Chunk Counts

The review progress UI intentionally shows more than one file count:

- `changed` is the total number of changed files reported by Azure DevOps for the PR.
- `reviewable` is the subset left after skipping deleted files and built-in ignore patterns such as lockfiles, images, `dist/`, and `node_modules/`.
- `capped to` is how many files Axiom will actually review after applying `maxFiles` (default: `30`).
- `Chunk 3/4 • 6 files` means the current provider request contains 6 files in that chunk, not that the whole PR only has 6 files.

For Codex and Claude, chunking is based on the fully rendered embedded review packet size, so chunk file counts vary depending on diff size, project context, and PR thread context.

## Library Usage (Webhook Mode)

For integration into your own server. Install it locally with `npm install axiom-pr`. Library mode supports OpenAI/Anthropic API keys and the same local Codex/Claude CLI auth flow used by the TUI.

### Express

```typescript
import express from "express";
import { createPrReviewer } from "axiom-pr";

const app = express();
app.use(express.json());

const reviewer = createPrReviewer({
  azureDevOps: {
    org: "my-org",
    pat: process.env.AZURE_DEVOPS_PAT!,
  },
  webhookSecret: process.env.WEBHOOK_SECRET!,
  ai: {
    provider: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: "claude-sonnet-4-5", // optional, this is the default
  },
});

app.post("/api/pr-review/webhook", (req, res) => {
  if (!reviewer.verifyWebhook(req.headers["authorization"])) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.json({ received: true });
  reviewer.handleWebhook(req.body).catch(console.error);
});

app.listen(3000);
```

### Express (Drop-in Middleware)

```typescript
import express from "express";
import { expressMiddleware } from "axiom-pr";

const app = express();
app.use(express.json());

app.post(
  "/api/pr-review/webhook",
  expressMiddleware({
    azureDevOps: { org: "my-org", pat: process.env.AZURE_DEVOPS_PAT! },
    webhookSecret: process.env.WEBHOOK_SECRET!,
    ai: { provider: "openai", apiKey: process.env.OPENAI_API_KEY! },
  }),
);

app.listen(3000);
```

### Fastify

```typescript
import Fastify from "fastify";
import { createPrReviewer } from "axiom-pr";

const fastify = Fastify();
const reviewer = createPrReviewer({
  azureDevOps: { org: "my-org", pat: process.env.AZURE_DEVOPS_PAT! },
  webhookSecret: process.env.WEBHOOK_SECRET!,
  ai: { provider: "openai", apiKey: process.env.OPENAI_API_KEY! },
});

fastify.post("/api/pr-review/webhook", async (request, reply) => {
  if (!reviewer.verifyWebhook(request.headers["authorization"])) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  reply.send({ received: true });
  reviewer.handleWebhook(request.body).catch(console.error);
});

fastify.listen({ port: 3000 });
```

### NestJS

```typescript
import { Controller, Post, Req, Res } from "@nestjs/common";
import { createPrReviewer } from "axiom-pr";

const reviewer = createPrReviewer({
  azureDevOps: { org: "my-org", pat: process.env.AZURE_DEVOPS_PAT! },
  webhookSecret: process.env.WEBHOOK_SECRET!,
  ai: {
    transport: "provider-cli",
    provider: "codex",
    model: "gpt-5.2",
  },
});

@Controller("pr-review")
export class PrReviewController {
  @Post("webhook")
  handleWebhook(@Req() req, @Res() res) {
    if (!reviewer.verifyWebhook(req.headers["authorization"])) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    res.json({ received: true });
    reviewer.handleWebhook(req.body).catch(console.error);
  }
}
```

## AI Provider Configuration

### Codex CLI

```typescript
ai: {
  transport: 'provider-cli',
  provider: 'codex',
  model: 'gpt-5.2', // optional
  reasoningEffort: 'medium', // optional, default: 'medium'
}
```

Requires a local Codex install plus `codex login`.

Supported `reasoningEffort` values: `low`, `medium`, `high`, `xhigh`.

If the CLI is installed outside your shell `PATH`, set `CODEX_BIN=/absolute/path/to/codex`.

### Claude Code

```typescript
ai: {
  transport: 'provider-cli',
  provider: 'claude',
  model: 'sonnet', // optional
  effort: 'medium', // optional, default: 'medium'
}
```

Requires a local Claude Code install plus `claude`, then `/login`.

Supported `effort` values: `low`, `medium`, `high`, `max`.

If the CLI is installed outside your shell `PATH`, set `CLAUDE_BIN=/absolute/path/to/claude`.

For provider-CLI reviews, Axiom uses its own explicit Codex/Claude effort settings instead of inheriting heavier personal CLI defaults, so PR review latency stays predictable across machines.

### OpenAI

```typescript
ai: {
  transport: 'api-key',
  provider: 'openai',
  apiKey: 'sk-...',
  model: 'gpt-5.2', // optional, default: 'gpt-5.2'
}
```

### Claude (Anthropic)

```typescript
ai: {
  transport: 'api-key',
  provider: 'anthropic',
  apiKey: 'sk-ant-...',
  model: 'claude-sonnet-4-5', // optional, this is the default
}
```

## Configuration Options (Library)

| Option            | Type       | Default   | Description                                           |
| ----------------- | ---------- | --------- | ----------------------------------------------------- |
| `azureDevOps.org` | `string`   | required  | Azure DevOps organization name                        |
| `azureDevOps.pat` | `string`   | required  | Personal access token with Code (Read/Write) scope    |
| `webhookSecret`   | `string`   | required  | Shared secret for webhook authentication              |
| `ai`              | `AiConfig` | required  | AI provider configuration (see above)                 |
| `maxFiles`        | `number`   | `Infinity`| Maximum files to review per PR (no cap by default)    |
| `maxDiffLength`   | `number`   | `10000`   | Max characters per file before truncation             |
| `skipPatterns`    | `RegExp[]` | built-in  | Patterns for files to skip (lock files, images, etc.) |
| `customPrompt`    | `string`   | built-in  | Override the system prompt for the AI reviewer        |
| `logger`          | `Logger`   | `console` | Custom logger implementing `{ info, warn, error }`    |

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --profile <name>` | active profile | Use a specific configuration profile |
| `--no-tui` | TUI enabled | Disable terminal UI, log to stdout |
| `--interval <seconds>` | `30` | Poll interval in seconds (watch only) |
| `--state-file <path>` | `~/.axiom/axiom-state.json` | Path to state persistence file (watch only) |

## Environment Variables (CLI)

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_DEVOPS_ORG` | Yes | Azure DevOps organization name |
| `AZURE_DEVOPS_PAT` | Yes | Personal access token |
| `AI_PROVIDER` | Yes | `codex`, `claude`, `openai`, or `anthropic` |
| `CODEX_MODEL` | No | Optional model override when `AI_PROVIDER=codex` |
| `CODEX_REASONING_EFFORT` | No | Optional Codex thinking budget: `low`, `medium`, `high`, `xhigh` (default: `medium`) |
| `CLAUDE_MODEL` | No | Optional model override when `AI_PROVIDER=claude` |
| `CLAUDE_EFFORT` | No | Optional Claude thinking budget: `low`, `medium`, `high`, `max` (default: `medium`) |
| `OPENAI_API_KEY` | If openai | OpenAI API key |
| `WATCH_REPOS` | Watch only | Comma-separated repos: `project/repoId/name` |
| `OPENAI_MODEL` | No | Override model (default: `gpt-5.2`) |
| `ANTHROPIC_API_KEY` | If anthropic | Anthropic API key |
| `ANTHROPIC_MODEL` | No | Override model (default: `claude-sonnet-4-5`) |

## Azure DevOps Setup

1. **Create a Personal Access Token (PAT)**
   - Go to `https://dev.azure.com/{org}/_usersSettings/tokens`
   - Create a token with **Code (Read & Write)** scope
   - Tip: Use a dedicated service account so comments appear from a bot user

2. **For webhook mode**, create a Service Hook:
   - Go to Project Settings → Service Hooks → Create subscription
   - Choose **Web Hooks**
   - Event: **Pull request created** (and/or **Pull request updated**)
   - URL: `https://your-server.com/api/pr-review/webhook`
   - Authentication: **Basic** with empty username and your webhook secret as password

3. **For local development**, use [ngrok](https://ngrok.com/):
   ```bash
   ngrok http 3000
   ```

## What Gets Reviewed

The reviewer focuses on:

- **Bugs**: Logic errors, null/undefined issues, race conditions
- **Security**: Injection vulnerabilities, auth issues, secrets exposure
- **Performance**: N+1 queries, memory leaks, inefficient algorithms
- **Readability**: Unclear naming, overly complex logic, missing error handling

Files automatically skipped: lock files, minified files, source maps, images, fonts, archives, `dist/`, `node_modules/`.

## Deployment

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
ENTRYPOINT ["node", "dist/cli.mjs", "watch", "--no-tui"]
```

```bash
docker build -t axiom-pr .
docker run --env-file .env axiom-pr
```

### systemd

```ini
[Unit]
Description=PR Agent Watcher
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/axiom-pr/dist/cli.mjs watch --no-tui
WorkingDirectory=/opt/axiom-pr
EnvironmentFile=/opt/axiom-pr/.env
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Programmatic Usage

Trigger reviews without webhooks or the watcher:

```typescript
const result = await reviewer.reviewPullRequest(
  "MyProject", // Azure DevOps project name
  "repo-guid", // Repository ID
  123, // Pull request ID
  "PR Title", // Optional
  "PR Description", // Optional
);

console.log(result.comments);
console.log(`Found ${result.comments.length} issues`);
```

## Architecture

```
src/
├── cli/                    # CLI entry point (axiom command)
│   ├── index.ts            # Commander setup
│   ├── env.ts              # .env loader + validation
│   ├── config-store.ts     # Profile-based config persistence (~/.axiom/config.json)
│   ├── prompt.ts           # Non-TUI prompting primitives
│   └── commands/
│       ├── watch.ts        # axiom-pr watch
│       └── review.ts       # axiom-pr review <url>
├── watcher/                # Polling + queue engine
│   ├── orchestrator.ts     # Wires poller → queue → reviewer
│   ├── poller.ts           # Polls Azure DevOps on interval
│   ├── queue.ts            # Serial review queue
│   ├── state.ts            # JSON file persistence
│   └── types.ts            # Watcher-specific types
├── tui/                    # Terminal UI (Ink + React)
│   ├── app.tsx             # Root component (watch dashboard)
│   ├── cli-app.tsx         # Interactive config wizard + review UI
│   ├── store.ts            # Event-driven state
│   ├── config-vars.ts      # Config variable definitions + detection
│   ├── hooks/
│   │   ├── use-app-state.ts
│   │   └── use-cli-reducer.ts
│   ├── phases/             # Phase-specific UI components
│   └── components/         # Shared UI components
├── ai/                     # AI provider backends + CLI probes
│   ├── provider.ts         # Interface + system prompt
│   ├── cli-provider.ts        # Codex/Claude CLI-backed reviews
│   ├── provider-auth.ts       # CLI probe + auth normalization
│   ├── factory.ts             # Provider factory
│   ├── vercel-ai-provider.ts  # OpenAI/Anthropic via Vercel AI SDK
│   └── tools.ts            # AI tool definitions
├── azure-devops/
│   └── client.ts           # Azure DevOps REST API client
├── reviewer.ts             # Core review engine
├── config.ts               # Configuration + defaults
├── types.ts                # Shared type definitions
└── index.ts                # Library entry point
```

## License

MIT
