import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AiConfig } from "../config";
import type { AiProvider, ReviewContext } from "./provider";
import { createReviewTools } from "./tools";
import { extractJson } from "./extract-json";

export class VercelAiProvider implements AiProvider {
  private readonly model: Parameters<typeof generateText>[0]["model"];

  constructor(config: AiConfig) {
    switch (config.provider) {
      case "openai": {
        const openai = createOpenAI({ apiKey: config.apiKey });
        this.model = openai(config.model ?? "gpt-5.2");
        break;
      }
      case "anthropic": {
        const anthropic = createAnthropic({ apiKey: config.apiKey });
        this.model = anthropic(config.model ?? "claude-sonnet-4-5");
        break;
      }
      default:
        throw new Error(
          `VercelAiProvider only supports API-key providers. Received: ${config.provider}`,
        );
    }
  }

  async review(
    systemPrompt: string,
    userPrompt: string,
    context: ReviewContext,
  ): Promise<string> {
    const tools = createReviewTools(context);

    const { text } = await generateText({
      model: this.model,
      system: systemPrompt,
      prompt: userPrompt,
      tools,
      maxTokens: 16_384,
      maxSteps: 15,
      onStepFinish({ toolCalls, finishReason }) {
        if (toolCalls.length > 0) {
          context.logger.info(
            `[ai] called ${toolCalls.map((tc) => tc.toolName).join(", ")} (${finishReason})`,
          );
        }
      },
    });

    return extractJson(text);
  }
}
