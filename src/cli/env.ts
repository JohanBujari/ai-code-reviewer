import dotenv from 'dotenv';
import type { AiConfig } from '../config';
import type { WatchedRepo } from '../watcher/types';

export interface WatcherEnvConfig {
  azureDevOps: {
    org: string;
    pat: string;
  };
  ai: AiConfig;
  repos: WatchedRepo[];
  pollIntervalMs: number;
  stateFilePath: string;
}

export function loadEnvConfig(options: {
  interval?: string;
  stateFile?: string;
}): WatcherEnvConfig {
  dotenv.config();

  const org = requireEnv('AZURE_DEVOPS_ORG');
  const pat = requireEnv('AZURE_DEVOPS_PAT');
  const aiProvider = requireEnv('AI_PROVIDER') as 'openai' | 'anthropic' | 'azure-openai';

  // Parse WATCH_REPOS: "project/repoId/repoName,project2/repoId2/repoName2"
  const reposRaw = requireEnv('WATCH_REPOS');
  const repos: WatchedRepo[] = reposRaw.split(',').map((entry) => {
    const parts = entry.trim().split('/');
    if (parts.length < 2) {
      throw new Error(
        `Invalid WATCH_REPOS entry: "${entry}". Expected format: "project/repoId/repoName"`,
      );
    }
    return {
      project: parts[0],
      repoId: parts[1],
      repoName: parts[2] ?? parts[1],
    };
  });

  return {
    azureDevOps: { org, pat },
    ai: buildAiConfig(aiProvider),
    repos,
    pollIntervalMs: parseInt(options.interval ?? '30', 10) * 1000,
    stateFilePath: options.stateFile ?? './pr-agent-state.json',
  };
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function buildAiConfig(provider: string): AiConfig {
  switch (provider) {
    case 'openai':
      return {
        provider: 'openai',
        apiKey: requireEnv('OPENAI_API_KEY'),
        model: process.env['OPENAI_MODEL'],
      };
    case 'anthropic':
      return {
        provider: 'anthropic',
        apiKey: requireEnv('ANTHROPIC_API_KEY'),
        model: process.env['ANTHROPIC_MODEL'],
      };
    case 'azure-openai':
      return {
        provider: 'azure-openai',
        endpoint: requireEnv('AZURE_OPENAI_ENDPOINT'),
        apiKey: requireEnv('AZURE_OPENAI_API_KEY'),
        deployment: requireEnv('AZURE_OPENAI_DEPLOYMENT'),
        apiVersion: process.env['AZURE_OPENAI_API_VERSION'],
      };
    default:
      throw new Error(
        `Unsupported AI_PROVIDER: "${provider}". Must be one of: openai, anthropic, azure-openai`,
      );
  }
}
