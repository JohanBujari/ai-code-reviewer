import type { AiConfig } from "../config";
import type { AiProvider } from "./provider";
import { isCliAuthConfig } from "./provider-status";
import { CliAuthProvider } from "./cli-provider";
import { VercelAiProvider } from "./vercel-ai-provider";

export function createAiProvider(config: AiConfig): AiProvider {
  return isCliAuthConfig(config)
    ? new CliAuthProvider(config)
    : new VercelAiProvider(config);
}
