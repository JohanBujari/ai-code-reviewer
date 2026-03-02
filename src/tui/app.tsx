import React, { useEffect } from "react";
import { render, Box, useInput, useApp } from "ink";
import type { WatcherOrchestrator } from "../watcher/orchestrator";
import type { TuiStore } from "./store";
import { deleteProfile, getActiveProfile, getConfigPath } from "../cli/config-store";
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

function App({ store, orchestrator }: AppProps) {
  const state = useAppState(store);
  const { exit } = useApp();

  // Exit on fatal errors (invalid PAT, auth failures, etc.)
  useEffect(() => {
    const onFatal = () => {
      setTimeout(() => {
        exit();
        process.exit(1);
      }, 2000);
    };
    orchestrator.on("event", (event: { type: string }) => {
      if (event.type === "fatal-error") onFatal();
    });
  }, [orchestrator, exit]);

  useInput((input) => {
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
    if (input === "c") {
      const profile = getActiveProfile();
      const cleared = deleteProfile(profile);
      if (cleared) {
        store.addLog(
          "info",
          `Profile "${profile}" cleared from ${getConfigPath()}. Relaunch to re-enter.`,
        );
      } else {
        store.addLog("warn", `No saved config found for profile "${profile}"`);
      }
      orchestrator.stop();
      exit();
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
