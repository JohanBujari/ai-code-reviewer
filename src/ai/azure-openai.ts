import type { AzureOpenAiConfig } from '../config';
import { DEFAULTS } from '../config';
import type { AiProvider } from './provider';

export class AzureOpenAiProvider implements AiProvider {
  private readonly url: string;
  private readonly apiKey: string;

  constructor(config: AzureOpenAiConfig) {
    const version = config.apiVersion ?? DEFAULTS.azureOpenAiApiVersion;
    this.url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${version}`;
    this.apiKey = config.apiKey;
  }

  async review(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_completion_tokens: 16_384,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => '');
      throw new Error(`Azure OpenAI error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content ?? '{}';
  }
}
