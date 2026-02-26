# Architecture Flow

## Mermaid Diagram (renders in GitHub/GitLab)

```mermaid
flowchart TB
    subgraph Triggers["Entry Points"]
        Webhook["Webhook (Express/Fastify)"]
        Watch["CLI: pr-agent watch"]
        Direct["Programmatic API"]
    end

    subgraph WatchMode["Watch Mode Only"]
        Poller["Poller"]
        Queue["ReviewQueue"]
        State["StateManager"]
    end

    subgraph Core["Core"]
        Reviewer["PrReviewer"]
    end

    subgraph External["External Services"]
        ADO["Azure DevOps API"]
        AI["AI Provider\n(OpenAI/Anthropic/Azure)"]
    end

    Webhook --> Reviewer
    Direct --> Reviewer
    Watch --> Poller
    Poller --> Queue
    Queue --> Reviewer
    Reviewer --> State

    Reviewer --> ADO
    Reviewer --> AI
    ADO --> Reviewer
    AI --> Reviewer
```

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         AI Code Reviewer (azure-devops-pr-reviewer)               │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────┐
                              │  Entry Points    │
                              └────────┬─────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
     ┌────────────────┐      ┌────────────────┐      ┌────────────────┐
     │ Webhook Mode   │      │  Watch Mode    │      │ Programmatic   │
     │ (Express/etc)  │      │  (CLI: watch)  │      │ (API call)     │
     └───────┬────────┘      └───────┬────────┘      └───────┬────────┘
             │                      │                       │
             │                      │  ┌─────────────┐     │
             │                      └──┤ Poller      │     │
             │                         │ (interval)  │     │
             │                         └──────┬──────┘     │
             │                                │            │
             │                         ┌──────▼──────┐     │
             │                         │ ReviewQueue │     │
             │                         └──────┬──────┘     │
             │                                │            │
             └────────────────────────────────┼────────────┘
                                              │
                                              ▼
                              ┌───────────────────────────────┐
                              │       PrReviewer              │
                              │  (core orchestration logic)    │
                              └───────────────┬───────────────┘
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              │                               │                               │
              ▼                               ▼                               ▼
     ┌────────────────┐             ┌────────────────┐             ┌────────────────┐
     │ AzureDevOps    │             │  AI Provider   │             │ StateManager   │
     │ Client         │             │  (pluggable)   │             │ (watch mode)   │
     └───────┬────────┘             └───────┬────────┘             └────────────────┘
             │                              │
             │                              │
             ▼                              ▼
     ┌────────────────┐             ┌────────────────┐
     │ Azure DevOps   │             │ Azure OpenAI   │
     │ REST API       │             │ OpenAI /       │
     │ (PRs, files,   │             │ Anthropic      │
     │  comments)     │             │                │
     └────────────────┘             └────────────────┘
```

## Review Flow (Step-by-Step)

```
1. TRIGGER
   ├─ Webhook: Azure DevOps sends POST when PR created/updated
   ├─ Watch:   Poller discovers new PRs on interval
   └─ Direct:  reviewPullRequest(project, repoId, prId) called

2. FETCH
   PrReviewer → AzureDevOpsClient
   ├─ getPrIterations()      → latest iteration
   ├─ getIterationChanges() → list of changed files
   └─ getFileContent()      → actual file diffs (batched)

3. FILTER
   ├─ Skip: lock files, minified, images, dist/, node_modules/
   ├─ Cap:  maxFiles (default 30)
   └─ Truncate: maxDiffLength per file

4. AI REVIEW
   PrReviewer → AiProvider (Azure OpenAI | OpenAI | Anthropic)
   ├─ Chunk files if too large
   ├─ Build prompt (system + file diffs)
   └─ Parse JSON response → { summary, comments[] }

5. POST RESULTS
   PrReviewer → AzureDevOpsClient
   ├─ setPrStatus('pending')           → "AI review in progress"
   ├─ createCommentThread()            → inline comments per issue
   ├─ createGeneralComment()           → summary at top of PR
   └─ setPrStatus('succeeded'|'failed') → based on critical issues
```

## Component Responsibilities

| Component | Role |
|-----------|------|
| **PrReviewer** | Orchestrates the full review: fetch → filter → AI → post. Handles webhook verification, deduplication. |
| **AzureDevOpsClient** | All Azure DevOps API calls (PRs, iterations, file content, comments, status). |
| **AiProvider** | Abstract interface; implementations for Azure OpenAI, OpenAI, Anthropic. |
| **Poller** | (Watch mode) Periodically lists active PRs, detects new ones, enqueues for review. |
| **ReviewQueue** | (Watch mode) Serializes review jobs, processes one at a time. |
| **StateManager** | (Watch mode) Persists reviewed PR IDs to avoid re-reviewing. |
| **TuiStore / TUI** | (Watch mode) Terminal UI showing repos, queue, logs, progress. |

## External Dependencies

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Azure DevOps    │     │ AI APIs         │     │ Your Server     │
│ • Service Hooks │     │ • Azure OpenAI  │     │ • Webhook route  │
│ • REST API      │     │ • OpenAI        │     │ • Express/      │
│ • PAT auth      │     │ • Anthropic     │     │   Fastify/Nest  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```
