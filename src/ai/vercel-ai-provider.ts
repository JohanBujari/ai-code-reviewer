import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { z } from 'zod';
import type { AiConfig } from '../config';
import type { AiProvider } from './provider';

const reviewResultSchema = z.object({
  summary: z.string().describe('Brief overall assessment of the PR (2-4 sentences)'),
  comments: z.array(
    z.object({
      filePath: z.string().describe('Path to the file'),
      lineNumber: z.number().describe('Line number in the file'),
      severity: z.enum(['critical', 'warning', 'suggestion', 'nitpick']).describe('Severity level'),
      message: z.string().describe('Description of the issue'),
    }),
  ),
});

export class VercelAiProvider implements AiProvider {
  private readonly model: Parameters<typeof generateObject>[0]['model'];

  constructor(config: AiConfig) {
    switch (config.provider) {
      case 'openai': {
        const openai = createOpenAI({ apiKey: config.apiKey });
        this.model = openai(config.model ?? 'gpt-5.2');
        break;
      }
      case 'anthropic': {
        const anthropic = createAnthropic({ apiKey: config.apiKey });
        this.model = anthropic(config.model ?? 'claude-sonnet-4-20250514');
        break;
      }
      case 'azure-openai': {
        const azure = createAzure({
          apiKey: config.apiKey,
          resourceName: extractResourceName(config.endpoint),
        });
        this.model = azure(config.deployment);
        break;
      }
    }
  }

  async review(systemPrompt: string, userPrompt: string): Promise<string> {
    const { object } = await generateObject({
      model: this.model,
      schema: reviewResultSchema,
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 16_384,
    });
    return JSON.stringify(object);
  }
}

function extractResourceName(endpoint: string): string {
  // Endpoint format: https://{resourceName}.openai.azure.com
  try {
    const url = new URL(endpoint);
    const parts = url.hostname.split('.');
    return parts[0];
  } catch {
    return endpoint;
  }
}
