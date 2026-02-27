import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { z } from "zod";
import type { AiConfig } from "../config";
import type { AiProvider, ReviewContext } from "./provider";
import { createReviewTools } from "./tools";

export const reviewResultSchema = z.object({
  summary: z
    .string()
    .describe("Brief overall assessment of the PR (2-4 sentences)"),
  comments: z.array(
    z.object({
      filePath: z.string().describe("Path to the file"),
      lineNumber: z.number().describe("Line number in the file"),
      severity: z
        .enum(["critical", "warning", "suggestion", "nitpick"])
        .describe("Severity level"),
      message: z.string().describe("Description of the issue"),
    }),
  ),
});

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
    context?: ReviewContext,
  ): Promise<string> {
    // If no context provided, fall back to simple generateText (no tools)
    if (!context) {
      return this.reviewSimple(systemPrompt, userPrompt);
    }

    return this.reviewWithTools(systemPrompt, userPrompt, context);
  }

  /**
   * Agentic review with tools — Claude can fetch files, read PR threads,
   * and check file history before producing the final structured review.
   */
  private async reviewWithTools(
    systemPrompt: string,
    userPrompt: string,
    context: ReviewContext,
  ): Promise<string> {
    const tools = createReviewTools(context);

    const { text, steps } = await generateText({
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

    // Try to parse as JSON, return raw text if it's already valid
    try {
      JSON.parse(text);
      return text;
    } catch {
      // Extract JSON from markdown fences if wrapped
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      return jsonMatch ? jsonMatch[1].trim() : text;
    }
  }

  /**
   * Simple review without tools — used when no ReviewContext is available.
   */
  private async reviewSimple(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const { text } = await generateText({
      model: this.model,
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 16_384,
    });

    // Extract JSON from markdown fences if wrapped
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return jsonMatch ? jsonMatch[1].trim() : text;
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
