import type { AnthropicConfig } from '../config';
import { DEFAULTS } from '../config';
import type { AiProvider } from './provider';

export class AnthropicProvider implements AiProvider {
  private readonly model: string;
  private readonly apiKey: string;

  constructor(config: AnthropicConfig) {
    this.model = config.model ?? DEFAULTS.anthropicModel;
    this.apiKey = config.apiKey;
  }

  async review(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 16_384,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => '');
      throw new Error(`Anthropic error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const text = data.content.find((block) => block.type === 'text')?.text ?? '{}';

    // Claude may wrap JSON in markdown code fences — extract it
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return jsonMatch ? jsonMatch[1].trim() : text;
  }
}
