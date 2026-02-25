import type { Logger } from './types';

export interface AzureOpenAiConfig {
  provider: 'azure-openai';
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion?: string;
}

export interface OpenAiConfig {
  provider: 'openai';
  apiKey: string;
  model?: string;
}

export interface AnthropicConfig {
  provider: 'anthropic';
  apiKey: string;
  model?: string;
}

export type AiConfig = AzureOpenAiConfig | OpenAiConfig | AnthropicConfig;

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
  openAiModel: 'gpt-4o',
  anthropicModel: 'claude-sonnet-4-20250514',
  azureOpenAiApiVersion: '2024-02-01',
  devOpsApiVersion: '7.1',
  dedupTtlMs: 10 * 60 * 1000,
  maxCharsPerChunk: 400_000,
  fileFetchBatchSize: 5,
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
