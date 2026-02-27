import { loadEnvConfigInteractive, type WatcherEnvConfig } from "../env";
import { WatcherOrchestrator } from "../../watcher/orchestrator";
import { TuiStore } from "../../tui/store";
import { startTui } from "../../tui/app";
import type { Logger } from "../../types";

export async function watchCommand(options: {
  tui?: boolean;
  interval?: string;
  stateFile?: string;
}): Promise<void> {
  let config: WatcherEnvConfig;
  try {
    config = (await loadEnvConfigInteractive(
      options,
      "watch",
    )) as WatcherEnvConfig;
  } catch (error) {
    console.error(
      `Configuration error: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  const store = new TuiStore(config.repos);

  const useTui = options.tui !== false;

  // Logger that feeds into TUI store (or console in no-tui mode)
  const logger: Logger = useTui
    ? {
        info: (msg) => store.addLog("info", msg),
        warn: (msg) => store.addLog("warn", msg),
        error: (msg) => store.addLog("error", msg),
      }
    : {
        info: (msg) => console.log(`[INFO] ${msg}`),
        warn: (msg) => console.warn(`[WARN] ${msg}`),
        error: (msg) => console.error(`[ERROR] ${msg}`),
      };

  const orchestrator = new WatcherOrchestrator(config, logger);

  // Bridge orchestrator events to TUI store
  orchestrator.on("event", (event) => store.handleEvent(event));

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down...");
    orchestrator.stop();
    setTimeout(() => process.exit(0), 1000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (useTui) {
    startTui(store, orchestrator);
  } else {
    // In no-tui mode, log events to console
    orchestrator.on("event", (event) => {
      switch (event.type) {
        case "poll-start":
          logger.info(`Polling ${event.repos.length} repo(s)...`);
          break;
        case "poll-complete":
          if (event.newJobs > 0)
            logger.info(`Found ${event.newJobs} new PR(s) to review`);
          break;
        case "review-start":
          logger.info(`Reviewing PR #${event.job.prId}: ${event.job.prTitle}`);
          break;
        case "review-complete":
          logger.info(
            `Completed PR #${event.job.prId}: ${event.job.commentsPosted ?? 0} comment(s)`,
          );
          break;
        case "review-failed":
          logger.error(`Failed PR #${event.job.prId}: ${event.error}`);
          break;
        case "poll-error":
          logger.error(`Poll error: ${event.error}`);
          break;
      }
    });
  }

  orchestrator.start();
}
