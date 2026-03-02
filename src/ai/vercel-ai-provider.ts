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

    return extractJson(text);
  }
}

/**
 * Robustly extract the JSON payload from an AI response that may contain
 * markdown fences, prose preamble, or other surrounding text.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();

  // 1. Already valid JSON
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    /* fall through */
  }

  // 2. Markdown code fence: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const candidate = fenceMatch[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* fall through */
    }
  }

  // 3. Find the first { ... } block spanning the whole JSON object
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const candidate = trimmed.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* fall through */
    }
  }

  // 4. Nothing worked — return as-is and let the caller handle the error
  return text;
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
