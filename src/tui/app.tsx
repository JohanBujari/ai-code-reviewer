import React, { useEffect } from "react";
import { render, Box, useInput, useApp } from "ink";
import type { WatcherOrchestrator } from "../watcher/orchestrator";
import type { TuiStore } from "./store";
import { useAppState } from "./hooks/use-app-state";
import { Header } from "./components/header";
import { RepoList } from "./components/repo-list";
import { PrQueue } from "./components/pr-queue";
import { ReviewProgress } from "./components/review-progress";
import { LogPanel } from "./components/log-panel";
import { StatusBar } from "./components/status-bar";

interface AppProps {
  store: TuiStore;
  orchestrator: WatcherOrchestrator;
}

type InputKey = {
  escape?: boolean;
};

function App({ store, orchestrator }: AppProps) {
  const state = useAppState(store);
  const { exit } = useApp();

  // Exit on fatal errors (invalid PAT, auth failures, etc.)
  useEffect(() => {
    const handler = (event: { type: string }) => {
      if (event.type === "fatal-error") {
        setTimeout(() => {
          exit();
          process.exit(1);
        }, 2000);
      }
    };
    orchestrator.on("event", handler);
    return () => {
      orchestrator.off("event", handler);
    };
  }, [orchestrator, exit]);

  useInput((input: string, _key: InputKey) => {
    if (input === "q") {
      orchestrator.stop();
      exit();
    }
    if (input === "p") {
      if (orchestrator.isPaused()) {
        orchestrator.resume();
        store.state.status = "watching";
      } else {
        orchestrator.pause();
        store.state.status = "paused";
      }
      store.emit("change", store.state);
    }
    if (input === "r") {
      orchestrator.forcePoll();
      store.addLog("info", "Manual refresh triggered");
    }
    if (input === "x") {
      const removed = orchestrator.resetReviewState();
      if (removed > 0) {
        store.addLog(
          "info",
          `Cleared ${removed} remembered review entr${removed === 1 ? "y" : "ies"} for the current provider. Re-queueing PRs...`,
        );
      } else {
        store.addLog(
          "info",
          "No remembered reviews were found for the current provider.",
        );
      }
      orchestrator.forcePoll();
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        status={state.status}
        startedAt={state.startedAt}
        lastPollAt={state.lastPollAt}
      />
      <RepoList repos={state.repos} />
      <PrQueue
        pending={state.pendingJobs}
        current={state.currentJob}
        completed={state.completedJobs}
      />
      <ReviewProgress
        current={state.currentJob}
        stage={state.currentStage}
        fileProgress={state.currentFileProgress}
      />
      <LogPanel logs={state.logs} />
      <StatusBar errors={state.errors} />
    </Box>
  );
}

export function startTui(
  store: TuiStore,
  orchestrator: WatcherOrchestrator,
): void {
  render(<App store={store} orchestrator={orchestrator} />);
}
