import type { Logger } from './types';

export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'max';

export interface CodexCliConfig {
  transport: 'provider-cli';
  provider: 'codex';
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
}

export interface ClaudeCliConfig {
  transport: 'provider-cli';
  provider: 'claude';
  model?: string;
  effort?: ClaudeEffort;
}

export interface OpenAiConfig {
  provider: 'openai';
  transport?: 'api-key';
  apiKey: string;
  model?: string;
}

export interface AnthropicConfig {
  provider: 'anthropic';
  transport?: 'api-key';
  apiKey: string;
  model?: string;
}

export type AiConfig =
  | CodexCliConfig
  | ClaudeCliConfig
  | OpenAiConfig
  | AnthropicConfig;

export interface PrReviewerOptions {
  azureDevOps: {
    org: string;
    pat: string;
  };
  webhookSecret: string;
  ai: AiConfig;
  maxFiles?: number;
  maxDiffLength?: number;
  skipPatterns?: RegExp[];
  customPrompt?: string;
  logger?: Logger;
}

export const DEFAULTS = {
  maxFiles: 30,
  maxDiffLength: 10_000,
  openAiModel: 'gpt-5.2',
  anthropicModel: 'claude-sonnet-4-5',
  devOpsApiVersion: '7.1',
  dedupTtlMs: 10 * 60 * 1000,
  maxCharsPerChunk: 400_000,
  maxCliCharsPerChunk: 60_000,
  fileFetchBatchSize: 5,
  codexReviewTimeoutMs: 15 * 60 * 1000,
  claudeReviewTimeoutMs: 5 * 60 * 1000,
  codexReasoningEffort: 'medium' as CodexReasoningEffort,
  claudeEffort: 'medium' as ClaudeEffort,
} as const;

export const SKIP_PATTERNS: RegExp[] = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.lock$/,
  /dist\//,
  /node_modules\//,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.ico$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  /\.pdf$/,
  /\.zip$/,
  /\.tar$/,
  /\.gz$/,
];
