import { useEffect, useCallback } from "react";
import { render, Box, useApp, useInput } from "ink";
import dotenv from "dotenv";
import { Banner } from "./components/banner";
import { TuiStore } from "./store";
import { WatcherOrchestrator } from "../watcher/orchestrator";
import { startTui } from "./app";
import { PrReviewer } from "../reviewer";
import {
  loadProfileSelectionConfig,
  mergeAndSaveConfig,
  setActiveProfile,
  createProfile,
  profileExists,
  deleteProfile,
} from "../cli/config-store";
import type { BaseEnvConfig, WatcherEnvConfig } from "../cli/env";
import type { Logger, ReviewProgressUpdate } from "../types";
import { THEME } from "../shared/theme";
import { probeCliProvider } from "../ai/provider-auth";
import {
  isCliAuthConfig,
  type ProviderSnapshot,
} from "../ai/provider-status";

import { useCliReducer } from "./hooks/use-cli-reducer";
import { PR_URL_REGEX, type Phase } from "./cli-constants";
import {
  detectMissingVars,
  buildConfigFromEnv,
  loadProfileAnswers,
  buildAllVars,
  PLATFORM_VARS,
  PROVIDER_VARS,
} from "./config-vars";

import { MenuPhase } from "./phases/menu-phase";
import {
  ProfileSelectPhase,
  ProfileNamePhase,
  ManageProfilePhase,
  ManageProfileActionPhase,
} from "./phases/profile-phase";
import { SetupGuidePhase } from "./phases/setup-guide-phase";
import { ConfigPhase } from "./phases/config-phase";
import {
  ReviewUrlPhase,
  ReviewingPhase,
  ReviewDonePhase,
  ReviewErrorPhase,
} from "./phases/review-phase";
import { LaunchingPhase } from "./phases/launching-phase";
import { ProviderCheckPhase } from "./phases/provider-check-phase";

// ── Single-screen App ──

interface CliAppProps {
  initialCommand?: "watch" | "review";
  initialProfile?: string;
  reviewUrl?: string;
  editMode?: boolean;
  options: { interval?: string; stateFile?: string };
}

type InputKey = {
  escape?: boolean;
};

function CliApp({ initialCommand, initialProfile, reviewUrl, editMode, options }: CliAppProps) {
  const { exit } = useApp();
  const [state, dispatch] = useCliReducer({
    command: initialCommand ?? null,
    selectedProfile: initialProfile ?? null,
  });

  // Handle q/Esc to go back on terminal and info phases
  useInput((input: string, key: InputKey) => {
    if (state.phase === "review-done" && (key.escape || input === "q")) {
      dispatch({ type: "SET_PHASE", phase: "menu" });
    }
    if (state.phase === "review-error" && (key.escape || input === "q")) {
      dispatch({ type: "SET_PHASE", phase: "menu" });
    }
    if (state.phase === "reviewing" && key.escape) {
      dispatch({ type: "SET_PHASE", phase: "menu" });
    }
    if (state.phase === "setup-guide" && (key.escape || input === "q")) {
      dispatch({ type: "SET_PHASE", phase: "menu" });
    }
  });

  // ── Transition helpers ──

  const launchWatch = useCallback(
    (answers: Record<string, string>) => {
      dispatch({ type: "SET_PHASE", phase: "launching-watch" });
      try {
        const config = buildConfigFromEnv(answers, "watch", options) as WatcherEnvConfig;
        const store = new TuiStore(config.repos);
        const logger: Logger = {
          info: (msg) => store.addLog("info", msg),
          warn: (msg) => store.addLog("warn", msg),
          error: (msg) => store.addLog("error", msg),
        };
        const orchestrator = new WatcherOrchestrator(config, logger);
        orchestrator.on("event", (event) => store.handleEvent(event));

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

        exit();
        setTimeout(() => {
          startTui(store, orchestrator);
          orchestrator.start();
        }, 100);
      } catch (err) {
        dispatch({
          type: "REVIEW_ERROR",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [options, exit],
  );

  const startReview = useCallback(
    async (prUrl: string, answers: Record<string, string> = {}) => {
      const match = prUrl.match(PR_URL_REGEX);
      if (!match) {
        dispatch({
          type: "REVIEW_ERROR",
          error: "Invalid Azure DevOps PR URL. Expected: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}",
        });
        return;
      }

      const [, , project, repoSlug, prIdStr] = match;
      const prId = parseInt(prIdStr, 10);
      dispatch({ type: "REVIEW_STARTED", prInfo: { prId, project, repo: repoSlug } });

      try {
        const config = buildConfigFromEnv(answers, "review", options) as BaseEnvConfig;
        const logger: Logger = {
          info: (msg) => dispatch({ type: "SET_REVIEW_STATUS", status: msg }),
          warn: (msg) => dispatch({ type: "SET_REVIEW_STATUS", status: msg }),
          error: (msg) => dispatch({ type: "SET_REVIEW_STATUS", status: msg }),
        };
        const reviewer = new PrReviewer({
          azureDevOps: config.azureDevOps,
          webhookSecret: "",
          ai: config.ai,
          logger,
        });
        const result = await reviewer.reviewPullRequest(
          project,
          repoSlug,
          prId,
          undefined,
          undefined,
          (progress: ReviewProgressUpdate) =>
            dispatch({
              type: "SET_REVIEW_STATUS",
              status: formatReviewStatus(progress),
            }),
        );
        dispatch({ type: "REVIEW_COMPLETE", result });
      } catch (err) {
        dispatch({ type: "REVIEW_ERROR", error: err instanceof Error ? err.message : String(err) });
      }
    },
    [options],
  );

  const finishConfig = useCallback(
    (cmd: "watch" | "review" | null, answers: Record<string, string>) => {
      // Filter out empty optional values before persisting
      const cleaned: Record<string, string> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (value) cleaned[key] = value;
      }
      mergeAndSaveConfig(cleaned, state.selectedProfile ?? undefined);
      for (const [key, value] of Object.entries(cleaned)) {
        process.env[key] = value;
      }
      if (state.isEditOnly) {
        dispatch({ type: "BATCH", actions: [
          { type: "SET_EDIT_ONLY", isEditOnly: false },
          { type: "SET_PHASE", phase: "menu" },
        ]});
        return;
      }
      if (cmd === "watch") {
        launchWatch(answers);
      } else {
        if (reviewUrl) {
          startReview(reviewUrl, answers);
        } else {
          dispatch({ type: "SET_PHASE", phase: "review-url" });
        }
      }
    },
    [state.selectedProfile, state.isEditOnly, reviewUrl, launchWatch, startReview],
  );

  const beginCommand = useCallback(
    (
      cmd: "watch" | "review",
      answers: Record<string, string>,
      origin: Phase,
    ) => {
      dispatch({ type: "SET_CONFIG_ANSWERS", answers });

      try {
        const config = buildConfigFromEnv(answers, cmd, options);
        if (isCliAuthConfig(config.ai)) {
          dispatch({
            type: "START_PROVIDER_CHECK",
            command: cmd,
            answers,
            origin,
          });
          return;
        }
      } catch (err) {
        dispatch({
          type: "REVIEW_ERROR",
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      finishConfig(cmd, answers);
    },
    [finishConfig, options],
  );

  const editProfile = useCallback(
    (profileName: string) => {
      setActiveProfile(profileName);
      dispatch({ type: "SELECT_PROFILE", profile: profileName });

      const saved = loadProfileSelectionConfig(profileName);
      const preAnswers = loadProfileAnswers(saved);
      dispatch({
        type: "START_CONFIG",
        vars: buildAllVars(preAnswers, saved),
        answers: {},
        origin: state.manageProfileName ? "manage-profile-action" : "menu",
        isEditOnly: true,
      });
    },
    [state.manageProfileName],
  );

  const proceedWithProfile = useCallback(
    (cmd: "watch" | "review", profileName: string) => {
      setActiveProfile(profileName);
      dispatch({ type: "SELECT_PROFILE", profile: profileName });

      const saved = loadProfileSelectionConfig(profileName);
      const preAnswers = loadProfileAnswers(saved);
      const missing = detectMissingVars(cmd, preAnswers, saved);
      if (missing.length === 0) {
        beginCommand(cmd, loadProfileAnswers(saved), "profile-select");
        return;
      }
      dispatch({
        type: "START_CONFIG",
        vars: missing,
        answers: preAnswers,
        origin: "profile-select",
      });
    },
    [beginCommand],
  );

  const startConfig = useCallback(
    (cmd: "watch" | "review", forceEdit = false) => {
      dotenv.config();
      dispatch({ type: "SET_COMMAND", command: cmd });

      if (initialProfile) {
        if (forceEdit) {
          editProfile(initialProfile);
        } else {
          proceedWithProfile(cmd, initialProfile);
        }
        return;
      }

      dispatch({ type: "SET_PHASE", phase: "profile-select" });
    },
    [initialProfile, proceedWithProfile, editProfile],
  );

  // ── Init: if a command was passed directly, skip menu ──
  useEffect(() => {
    if (initialCommand) {
      dotenv.config();
      startConfig(initialCommand, editMode);
    } else if (editMode && initialProfile) {
      dotenv.config();
      setActiveProfile(initialProfile);
      dispatch({ type: "SELECT_PROFILE", profile: initialProfile });
      const saved = loadProfileSelectionConfig(initialProfile);
      const preAnswers = loadProfileAnswers(saved);
      dispatch({
        type: "START_CONFIG",
        vars: buildAllVars(preAnswers, saved),
        answers: {},
        origin: "menu",
        isEditOnly: true,
      });
    }
  }, []);

  // ── Config: handle when a var is answered ──
  const handleConfigAnswer = useCallback(
    (value: string) => {
      const currentVar = state.missingVars[state.configIndex];
      const updated = { ...state.configAnswers, [currentVar.key]: value };
      const nextIndex = state.configIndex + 1;

      // When platform/provider changes, swap in the correct specific vars
      if (currentVar.key === "PLATFORM" || currentVar.key === "AI_PROVIDER") {
        const varMap = currentVar.key === "PLATFORM" ? PLATFORM_VARS : PROVIDER_VARS;
        const newVars = varMap[value] ?? [];

        // Collect ALL keys from every option in this map so we can remove stale ones
        const allDynamicKeys = new Set(
          Object.values(varMap).flatMap((defs) => defs.map((d) => d.key)),
        );

        // Remove old dynamic vars from the list, clear their answers
        const cleaned = state.missingVars
          .slice(nextIndex)
          .filter((v) => !allDynamicKeys.has(v.key));
        for (const k of allDynamicKeys) delete updated[k];

        const updatedVars = [
          ...state.missingVars.slice(0, nextIndex),
          ...newVars,
          ...cleaned,
        ];
        dispatch({ type: "SET_CONFIG_ANSWERS", answers: updated });
        dispatch({ type: "SET_MISSING_VARS", vars: updatedVars });
        dispatch({ type: "SET_CONFIG_INDEX", index: nextIndex });
        return;
      }

      if (nextIndex >= state.missingVars.length) {
        beginCommand(state.command!, updated, "config");
      } else {
        dispatch({ type: "SET_CONFIG_ANSWERS", answers: updated });
        dispatch({ type: "SET_CONFIG_INDEX", index: nextIndex });
      }
    },
    [state.missingVars, state.configIndex, state.configAnswers, state.command, beginCommand],
  );

  const handleConfigBack = useCallback(() => {
    if (state.configIndex <= 0) {
      dispatch({ type: "BATCH", actions: [
        { type: "SET_EDIT_ONLY", isEditOnly: false },
        { type: "SET_PHASE", phase: state.configOrigin },
      ]});
      return;
    }
    const prevIndex = state.configIndex - 1;
    const prevVar = state.missingVars[prevIndex];
    const updated = { ...state.configAnswers };
    delete updated[prevVar.key];

    // Remove dynamically-inserted platform/provider vars when going back
    let filteredVars: typeof state.missingVars | undefined;
    if (prevVar.key === "PLATFORM" || prevVar.key === "AI_PROVIDER") {
      const varMap = prevVar.key === "PLATFORM" ? PLATFORM_VARS : PROVIDER_VARS;
      const oldValue = state.configAnswers[prevVar.key];
      if (oldValue) {
        const dynamicKeys = (varMap[oldValue] ?? []).map((v) => v.key);
        filteredVars = state.missingVars.filter((v) => !dynamicKeys.includes(v.key));
        for (const k of dynamicKeys) delete updated[k];
      }
    }

    dispatch({ type: "CONFIG_BACK", prevIndex, answers: updated, vars: filteredVars });
  }, [state.configIndex, state.missingVars, state.configAnswers, state.configOrigin]);

  const refreshProviderCheck = useCallback(async () => {
    const context = state.providerCheckContext;
    if (!context) return;

    dispatch({ type: "SET_PROVIDER_LOADING", loading: true });

    try {
      const config = buildConfigFromEnv(context.answers, context.command, options);
      if (!isCliAuthConfig(config.ai)) {
        finishConfig(context.command, context.answers);
        return;
      }

      const snapshot = await probeCliProvider(config.ai);
      dispatch({ type: "SET_PROVIDER_SNAPSHOT", snapshot });
    } catch (err) {
      const provider = context.answers["AI_PROVIDER"] === "claude"
        ? "claude"
        : "codex";
      const snapshot: ProviderSnapshot = {
        provider,
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
      dispatch({ type: "SET_PROVIDER_SNAPSHOT", snapshot });
    }
  }, [state.providerCheckContext, options, finishConfig]);

  const continueFromProviderCheck = useCallback(() => {
    const context = state.providerCheckContext;
    if (!context) return;
    finishConfig(context.command, context.answers);
  }, [state.providerCheckContext, finishConfig]);

  const backFromProviderCheck = useCallback(() => {
    const origin = state.providerCheckContext?.origin ?? "menu";
    dispatch({
      type: "BATCH",
      actions: [
        { type: "CLEAR_PROVIDER_CHECK" },
        { type: "SET_PHASE", phase: origin },
      ],
    });
  }, [state.providerCheckContext]);

  // ── Render ──

  return (
    <Box flexDirection="column">
      <Banner />

      {state.phase === "menu" && (
        <MenuPhase
          onSelect={(value) => {
            if (value === "exit") { exit(); return; }
            if (value === "manage-profile") {
              dispatch({ type: "BATCH", actions: [
                { type: "SET_MANAGE_MESSAGE", message: null },
                { type: "SET_PHASE", phase: "manage-profile" },
              ]});
              return;
            }
            if (value === "setup-guide") {
              dispatch({ type: "SET_PHASE", phase: "setup-guide" });
              return;
            }
            const cmd = value as "watch" | "review";
            dispatch({ type: "SET_COMMAND", command: cmd });
            startConfig(cmd);
          }}
        />
      )}

      {state.phase === "profile-select" && (
        <ProfileSelectPhase
          onSelect={(profile) => proceedWithProfile(state.command!, profile)}
          onCreateNew={() => dispatch({ type: "SET_PHASE", phase: "profile-name" })}
          onBack={() => dispatch({ type: "SET_PHASE", phase: "menu" })}
        />
      )}

      {state.phase === "profile-name" && (
        <ProfileNamePhase
          command={state.command}
          onCreated={(name) => proceedWithProfile(state.command!, name)}
          onError={(msg) => dispatch({ type: "REVIEW_ERROR", error: msg })}
          onBack={() => dispatch({ type: "SET_PHASE", phase: "profile-select" })}
        />
      )}

      {state.phase === "manage-profile" && (
        <ManageProfilePhase
          message={state.manageMessage}
          onSelect={(name) => {
            dispatch({ type: "SET_MANAGE_PROFILE", name });
            dispatch({ type: "SET_PHASE", phase: "manage-profile-action" });
          }}
          onBack={() => dispatch({ type: "SET_PHASE", phase: "menu" })}
        />
      )}

      {state.phase === "manage-profile-action" && state.manageProfileName && (
        <ManageProfileActionPhase
          profileName={state.manageProfileName}
          onEdit={(name) => { dotenv.config(); editProfile(name); }}
          onDelete={(name) => {
            if (deleteProfile(name)) {
              dispatch({ type: "SET_MANAGE_MESSAGE", message: { text: `Deleted profile "${name}"`, color: THEME.success } });
            } else {
              dispatch({ type: "SET_MANAGE_MESSAGE", message: { text: `Profile "${name}" not found`, color: THEME.error } });
            }
            dispatch({ type: "SET_MANAGE_PROFILE", name: null });
            dispatch({ type: "SET_PHASE", phase: "manage-profile" });
          }}
          onBack={() => dispatch({ type: "SET_PHASE", phase: "manage-profile" })}
        />
      )}

      {state.phase === "setup-guide" && <SetupGuidePhase />}

      {state.phase === "config" && (
        <ConfigPhase
          missingVars={state.missingVars}
          configIndex={state.configIndex}
          configAnswers={state.configAnswers}
          onAnswer={handleConfigAnswer}
          onBack={handleConfigBack}
        />
      )}

      {state.phase === "provider-check" && (
        <ProviderCheckPhase
          snapshot={state.providerSnapshot}
          loading={state.providerCheckLoading}
          onRefresh={refreshProviderCheck}
          onContinue={continueFromProviderCheck}
          onBack={backFromProviderCheck}
        />
      )}

      {state.phase === "review-url" && (
        <ReviewUrlPhase
          onSubmit={(url) => startReview(url, state.configAnswers)}
          onBack={() => dispatch({ type: "SET_PHASE", phase: "menu" })}
        />
      )}

      {state.phase === "reviewing" && (
        <ReviewingPhase prInfo={state.prInfo} status={state.reviewStatus} />
      )}

      {state.phase === "review-error" && (
        <ReviewErrorPhase error={state.reviewError} />
      )}

      {state.phase === "review-done" && state.reviewResult && (
        <ReviewDonePhase result={state.reviewResult} prInfo={state.prInfo} />
      )}

      {state.phase === "launching-watch" && <LaunchingPhase />}
    </Box>
  );
}

function formatReviewStatus(progress: ReviewProgressUpdate): string {
  if (progress.kind === "file") {
    return `[review] downloading file diffs (${progress.fileIndex + 1}/${progress.totalFiles}) • ${progress.filePath}`;
  }

  return progress.detail
    ? `[review] ${progress.label} (${progress.detail})`
    : `[review] ${progress.label}`;
}

// ── Entry ──

export function startCliApp(opts: {
  command?: "watch" | "review";
  reviewUrl?: string;
  profile?: string;
  editMode?: boolean;
  options: { interval?: string; stateFile?: string };
}): void {
  if (opts.profile && !profileExists(opts.profile)) {
    try {
      createProfile(opts.profile);
      setActiveProfile(opts.profile);
    } catch {
      // Profile creation failed — let the TUI handle it interactively
      opts.profile = undefined;
    }
  }
  render(
    <CliApp
      initialCommand={opts.command}
      initialProfile={opts.profile}
      reviewUrl={opts.reviewUrl}
      editMode={opts.editMode}
      options={opts.options}
    />,
  );
}
