import type { OpenAiConfig } from '../config';
import { DEFAULTS } from '../config';
import type { AiProvider } from './provider';

export class OpenAiProvider implements AiProvider {
  private readonly model: string;
  private readonly apiKey: string;

  constructor(config: OpenAiConfig) {
    this.model = config.model ?? DEFAULTS.openAiModel;
    this.apiKey = config.apiKey;
  }

  async review(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
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
      throw new Error(`OpenAI error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content ?? '{}';
  }
}
