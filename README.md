# azure-devops-pr-reviewer

AI-powered pull request reviewer for Azure DevOps. Supports **Azure OpenAI**, **OpenAI**, and **Claude (Anthropic)**.

Zero production dependencies — uses native `fetch()` (Node 18+).

## Installation

```bash
npm install azure-devops-pr-reviewer
```

## Quick Start

### Express

```typescript
import express from 'express';
import { createPrReviewer } from 'azure-devops-pr-reviewer';

const app = express();
app.use(express.json());

const reviewer = createPrReviewer({
  azureDevOps: {
    org: 'my-org',
    pat: process.env.AZURE_DEVOPS_PAT!,
  },
  webhookSecret: process.env.WEBHOOK_SECRET!,
  ai: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-sonnet-4-20250514', // optional, this is the default
  },
});

app.post('/api/pr-review/webhook', (req, res) => {
  if (!reviewer.verifyWebhook(req.headers['authorization'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({ received: true });
  reviewer.handleWebhook(req.body).catch(console.error);
});

app.listen(3000);
```

### Express (Drop-in Middleware)

```typescript
import express from 'express';
import { expressMiddleware } from 'azure-devops-pr-reviewer';

const app = express();
app.use(express.json());

app.post(
  '/api/pr-review/webhook',
  expressMiddleware({
    azureDevOps: { org: 'my-org', pat: process.env.AZURE_DEVOPS_PAT! },
    webhookSecret: process.env.WEBHOOK_SECRET!,
    ai: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
  }),
);

app.listen(3000);
```

### Fastify

```typescript
import Fastify from 'fastify';
import { createPrReviewer } from 'azure-devops-pr-reviewer';

const fastify = Fastify();
const reviewer = createPrReviewer({
  azureDevOps: { org: 'my-org', pat: process.env.AZURE_DEVOPS_PAT! },
  webhookSecret: process.env.WEBHOOK_SECRET!,
  ai: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
});

fastify.post('/api/pr-review/webhook', async (request, reply) => {
  if (!reviewer.verifyWebhook(request.headers['authorization'])) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  reply.send({ received: true });
  reviewer.handleWebhook(request.body).catch(console.error);
});

fastify.listen({ port: 3000 });
```

### NestJS

```typescript
import { Controller, Post, Req, Res } from '@nestjs/common';
import { createPrReviewer } from 'azure-devops-pr-reviewer';

const reviewer = createPrReviewer({
  azureDevOps: { org: 'my-org', pat: process.env.AZURE_DEVOPS_PAT! },
  webhookSecret: process.env.WEBHOOK_SECRET!,
  ai: {
    provider: 'azure-openai',
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    deployment: 'gpt-4o',
  },
});

@Controller('pr-review')
export class PrReviewController {
  @Post('webhook')
  handleWebhook(@Req() req, @Res() res) {
    if (!reviewer.verifyWebhook(req.headers['authorization'])) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.json({ received: true });
    reviewer.handleWebhook(req.body).catch(console.error);
  }
}
```

## AI Provider Configuration

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

### OpenAI

```typescript
ai: {
  provider: 'openai',
  apiKey: 'sk-...',
  model: 'gpt-4o', // optional, default: 'gpt-4o'
}
```

### Claude (Anthropic)

```typescript
ai: {
  provider: 'anthropic',
  apiKey: 'sk-ant-...',
  model: 'claude-sonnet-4-20250514', // optional, this is the default
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `azureDevOps.org` | `string` | required | Azure DevOps organization name |
| `azureDevOps.pat` | `string` | required | Personal access token with Code (Read/Write) scope |
| `webhookSecret` | `string` | required | Shared secret for webhook authentication |
| `ai` | `AiConfig` | required | AI provider configuration (see above) |
| `maxFiles` | `number` | `30` | Maximum files to review per PR |
| `maxDiffLength` | `number` | `10000` | Max characters per file before truncation |
| `skipPatterns` | `RegExp[]` | built-in | Patterns for files to skip (lock files, images, etc.) |
| `customPrompt` | `string` | built-in | Override the system prompt for the AI reviewer |
| `logger` | `Logger` | `console` | Custom logger implementing `{ info, warn, error }` |

## Azure DevOps Setup

1. **Create a Personal Access Token (PAT)**
   - Go to `https://dev.azure.com/{org}/_usersSettings/tokens`
   - Create a token with **Code (Read & Write)** scope

2. **Create a Service Hook**
   - Go to Project Settings → Service Hooks → Create subscription
   - Choose **Web Hooks**
   - Event: **Pull request created** (and/or **Pull request updated**)
   - URL: `https://your-server.com/api/pr-review/webhook`
   - Authentication: **Basic** with empty username and your webhook secret as the password

3. **For local development**, use [ngrok](https://ngrok.com/) to expose your local server:
   ```bash
   ngrok http 3000
   ```

## How It Works

1. Azure DevOps sends a webhook when a PR is created or updated
2. The package verifies the webhook authorization
3. Fetches the latest iteration and changed files from Azure DevOps
4. Filters out binary files, lock files, and other non-reviewable content
5. Sends file contents to the configured AI provider for review
6. Posts inline comments on specific lines and a summary comment on the PR
7. Sets a PR status (succeeded/failed) based on whether critical issues were found

## What Gets Reviewed

The reviewer focuses on:
- **Bugs**: Logic errors, null/undefined issues, race conditions
- **Security**: Injection vulnerabilities, auth issues, secrets exposure
- **Performance**: N+1 queries, memory leaks, inefficient algorithms
- **Readability**: Unclear naming, overly complex logic, missing error handling

Files automatically skipped: lock files, minified files, source maps, images, fonts, archives, `dist/`, `node_modules/`.

## Programmatic Usage

You can also trigger reviews programmatically without webhooks:

```typescript
const result = await reviewer.reviewPullRequest(
  'MyProject',     // Azure DevOps project name
  'repo-guid',     // Repository ID
  123,             // Pull request ID
  'PR Title',      // Optional
  'PR Description' // Optional
);

console.log(result.summary);
console.log(`Found ${result.comments.length} issues`);
```

## License

MIT
