# axiom

AI-powered pull request reviewer for Azure DevOps. Supports **OpenAI**, **Claude (Anthropic)**, and **Azure OpenAI**.

Two modes of operation:

- **CLI Watcher** — long-running daemon that automatically detects and reviews PRs with a real-time terminal UI
- **Library** — integrate into your own Express/Fastify/NestJS server via webhooks

## Installation

```bash
npm install -g axiom
```

## CLI Watcher (Recommended)

The watcher runs as a daemon, polls Azure DevOps for new PRs and new iterations (pushed commits), and reviews them automatically.

### Setup

The CLI uses an interactive setup wizard — just run `axiom` and it will prompt you for everything. Configuration is saved to `~/.axiom/config.json` and reused on subsequent runs.

Alternatively, you can use a `.env` file or environment variables:

```bash
# Azure DevOps
AZURE_DEVOPS_ORG=your-org
AZURE_DEVOPS_PAT=your-personal-access-token

# AI Provider: openai | anthropic | azure-openai
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Repositories to watch (comma-separated: project/repoId/displayName)
WATCH_REPOS=MyProject/my-repo/my-repo
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
# Build first
npm run build

# Run with TUI
node dist/cli.mjs watch

# Run without TUI (for Docker/CI/servers)
node dist/cli.mjs watch --no-tui

# Custom poll interval (default: 30s)
node dist/cli.mjs watch --interval 60

# Custom state file location
node dist/cli.mjs watch --state-file ./my-state.json

# Use a specific profile
node dist/cli.mjs watch --profile work

# Or link globally
npm link
axiom watch
```

### Review a single PR

```bash
node dist/cli.mjs review https://dev.azure.com/my-org/MyProject/_git/my-repo/pullrequest/123

# With a specific profile
node dist/cli.mjs review https://dev.azure.com/my-org/MyProject/_git/my-repo/pullrequest/123 --profile client-x
```

### Configuration Profiles

Axiom supports named profiles for managing multiple Azure DevOps organizations or different configurations. Each profile stores its own org, PAT, and watched repos. AI provider and API keys can be stored in both global (shared defaults) and profiles; profile values override global when set.

```bash
# Profile management
axiom profile list              # List all profiles (* = active)
axiom profile use <name>        # Switch active profile
axiom profile delete <name>     # Delete a profile

# Use a profile for a single command
axiom watch --profile work
axiom review <url> --profile client-x
```

On first run, the TUI prompts you to name your profile. On subsequent runs, you'll see a profile selector to pick an existing profile or create a new one.

**Config file structure** (`~/.axiom/config.json`):

```json
{
  "version": 2,
  "activeProfile": "work",
  "global": {
    "AI_PROVIDER": "anthropic",
    "ANTHROPIC_API_KEY": "sk-ant-..."
  },
  "profiles": {
    "work": {
      "AZURE_DEVOPS_ORG": "my-work-org",
      "AZURE_DEVOPS_PAT": "pat-...",
      "WATCH_REPOS": "ProjectA/id1/Repo1"
    },
    "client-x": {
      "AZURE_DEVOPS_ORG": "client-x-org",
      "AZURE_DEVOPS_PAT": "pat-...",
      "AI_PROVIDER": "openai",
      "OPENAI_API_KEY": "sk-..."
    }
  }
}
```

Keys can live in `global` (shared defaults) or in profiles (profile-specific). Profile values override global when both are set — for example, `client-x` above uses OpenAI instead of the global Anthropic default. Environment variables and `.env` always take highest priority.

### TUI Keyboard Shortcuts

| Key | Action |
| --- | ------ |
| `q` | Quit |
| `p` | Pause/resume polling |
| `r` | Force immediate refresh |
| `c` | Clear active profile credentials and exit |

### TUI Display

The terminal UI shows:

- **Header** — watching status, uptime, last poll time
- **Repo List** — repositories being watched
- **PR Queue** — pending, in-progress, and completed reviews
- **Review Progress** — current file being reviewed with progress bar
- **Logs** — real-time log output with timestamps
- **Status Bar** — keyboard shortcuts and last error

### State Persistence

The watcher saves state to `~/.axiom/pr-agent-state.json` by default (configurable via `--state-file`) to:
- Avoid re-reviewing PRs after restart
- Track which iteration was last reviewed
- Auto-cleanup entries older than 7 days

### How the Watcher Works

1. Polls each configured repo for active pull requests (every 30s)
2. For each active PR, checks the latest iteration (commit)
3. Compares against saved state to detect new work
4. Queues new reviews (processes one at a time)
5. Fetches changed files, filters out binaries/lock files
6. Chunks large changes and sends to the AI provider
7. Posts inline comments on specific lines in Azure DevOps
8. Posts a summary comment with severity breakdown
9. Sets PR status (succeeded/failed based on critical issues)
10. Saves state to prevent duplicate reviews

## Library Usage (Webhook Mode)

For integration into your own server — the library has zero production dependencies and uses native `fetch()`.

### Express

```typescript
import express from "express";
import { createPrReviewer } from "axiom";

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
import { expressMiddleware } from "axiom";

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
import { createPrReviewer } from "axiom";

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
import { createPrReviewer } from "axiom";

const reviewer = createPrReviewer({
  azureDevOps: { org: "my-org", pat: process.env.AZURE_DEVOPS_PAT! },
  webhookSecret: process.env.WEBHOOK_SECRET!,
  ai: {
    provider: "azure-openai",
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    deployment: "gpt-4o",
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

### OpenAI

```typescript
ai: {
  provider: 'openai',
  apiKey: 'sk-...',
  model: 'gpt-5.2', // optional, default: 'gpt-5.2'
}
```

### Claude (Anthropic)

```typescript
ai: {
  provider: 'anthropic',
  apiKey: 'sk-ant-...',
  model: 'claude-sonnet-4-5', // optional, this is the default
}
```

### Azure OpenAI

```typescript
ai: {
  provider: 'azure-openai',
  endpoint: 'https://my-resource.openai.azure.com',
  apiKey: 'your-api-key',
  deployment: 'gpt-4o',
  apiVersion: '2024-02-01', // optional
}
```

## Configuration Options (Library)

| Option            | Type       | Default   | Description                                           |
| ----------------- | ---------- | --------- | ----------------------------------------------------- |
| `azureDevOps.org` | `string`   | required  | Azure DevOps organization name                        |
| `azureDevOps.pat` | `string`   | required  | Personal access token with Code (Read/Write) scope    |
| `webhookSecret`   | `string`   | required  | Shared secret for webhook authentication              |
| `ai`              | `AiConfig` | required  | AI provider configuration (see above)                 |
| `maxFiles`        | `number`   | `30`      | Maximum files to review per PR                        |
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
| `--state-file <path>` | `~/.axiom/pr-agent-state.json` | Path to state persistence file (watch only) |

## Environment Variables (CLI)

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_DEVOPS_ORG` | Yes | Azure DevOps organization name |
| `AZURE_DEVOPS_PAT` | Yes | Personal access token |
| `AI_PROVIDER` | Yes | `openai`, `anthropic`, or `azure-openai` |
| `OPENAI_API_KEY` | If openai | OpenAI API key |
| `WATCH_REPOS` | Yes | Comma-separated repos: `project/repoId/name` |
| `OPENAI_MODEL` | No | Override model (default: `gpt-5.2`) |
| `ANTHROPIC_API_KEY` | If anthropic | Anthropic API key |
| `ANTHROPIC_MODEL` | No | Override model (default: `claude-sonnet-4-5`) |
| `AZURE_OPENAI_ENDPOINT` | If azure-openai | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_API_KEY` | If azure-openai | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | If azure-openai | Deployment name |
| `AZURE_OPENAI_API_VERSION` | No | API version (default: `2024-02-01`) |

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
docker build -t pr-agent .
docker run --env-file .env pr-agent
```

### systemd

```ini
[Unit]
Description=PR Agent Watcher
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/pr-agent/dist/cli.mjs watch --no-tui
WorkingDirectory=/opt/pr-agent
EnvironmentFile=/opt/pr-agent/.env
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

console.log(result.summary);
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
│       ├── watch.ts        # axiom watch
│       └── review.ts       # axiom review <url>
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
│   ├── hooks/
│   │   └── use-app-state.ts
│   └── components/         # UI components
├── ai/                     # AI provider (Vercel AI SDK)
│   ├── provider.ts         # Interface + system prompt
│   ├── vercel-ai-provider.ts  # OpenAI/Anthropic/Azure via Vercel AI SDK
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
