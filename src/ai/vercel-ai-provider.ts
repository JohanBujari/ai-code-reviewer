import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import type { AiConfig } from "../config";
import type { AiProvider, ReviewContext } from "./provider";
import { createReviewTools } from "./tools";

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
      case "azure-openai": {
        const azure = createAzure({
          apiKey: config.apiKey,
          resourceName: extractResourceName(config.endpoint),
        });
        this.model = azure(config.deployment);
        break;
      }
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
      maxSteps: 10,
      onStepFinish({ toolCalls, finishReason }) {
        if (toolCalls.length > 0) {
          context.logger.info(
            `[ai] called ${toolCalls.map((tc) => tc.toolName).join(", ")} (${finishReason})`,
          );
        }
      },
    });

    // Extract JSON from markdown fences if wrapped
    try {
      JSON.parse(text);
      return text;
    } catch {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      return jsonMatch ? jsonMatch[1].trim() : text;
    }
  }
}

function extractResourceName(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const parts = url.hostname.split(".");
    return parts[0];
  } catch {
    return endpoint;
  }
}
