import { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import dotenv from "dotenv";
import { Banner } from "./components/banner";
import { SelectInput, type SelectItem } from "./components/select-input";
import { TextInput } from "./components/text-input";
import { Spinner } from "./components/spinner";
import { TuiStore } from "./store";
import { WatcherOrchestrator } from "../watcher/orchestrator";
import { startTui } from "./app";
import { PrReviewer } from "../reviewer";
import {
  loadSavedConfig,
  mergeAndSaveConfig,
  listProfiles,
  getActiveProfile,
  setActiveProfile,
  createProfile,
  profileExists,
  getDefaultStatePath,
} from "../cli/config-store";
import type { BaseEnvConfig, WatcherEnvConfig } from "../cli/env";
import type { AiConfig } from "../config";
import type { WatchedRepo } from "../watcher/types";
import type { ReviewResult, ReviewComment, Logger } from "../types";

// ── Config variable definitions ──

interface VarDef {
  key: string;
  label: string;
  type: "text" | "secret" | "select";
  choices?: string[];
  hint?: string;
}

const COMMON_VARS: VarDef[] = [
  { key: "AZURE_DEVOPS_ORG", label: "Azure DevOps Organization", type: "text" },
  { key: "AZURE_DEVOPS_PAT", label: "Azure DevOps PAT", type: "secret" },
  {
    key: "AI_PROVIDER",
    label: "AI Provider",
    type: "select",
    choices: ["openai", "anthropic", "azure-openai"],
  },
];

const PROVIDER_VARS: Record<string, VarDef[]> = {
  openai: [{ key: "OPENAI_API_KEY", label: "OpenAI API Key", type: "secret" }],
  anthropic: [
    { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", type: "secret" },
  ],
  "azure-openai": [
    {
      key: "AZURE_OPENAI_ENDPOINT",
      label: "Azure OpenAI Endpoint",
      type: "text",
      hint: "e.g. https://your-resource.openai.azure.com",
    },
    {
      key: "AZURE_OPENAI_API_KEY",
      label: "Azure OpenAI API Key",
      type: "secret",
    },
    {
      key: "AZURE_OPENAI_DEPLOYMENT",
      label: "Azure OpenAI Deployment",
      type: "text",
    },
  ],
};

const WATCH_VARS: VarDef[] = [
  {
    key: "WATCH_REPOS",
    label: "Repos to watch",
    type: "text",
    hint: "comma-separated, format: project/repoId/repoName",
  },
];

// ── Config helpers ──

function detectMissingVars(
  command: "watch" | "review",
  answers: Record<string, string>,
  saved: Record<string, string | undefined> = {},
): VarDef[] {
  const lookup = (key: string) =>
    answers[key] ?? saved[key] ?? process.env[key];
  const missing: VarDef[] = [];
  for (const def of COMMON_VARS) {
    if (!lookup(def.key)) missing.push(def);
  }
  const provider = lookup("AI_PROVIDER");
  if (provider) {
    for (const def of PROVIDER_VARS[provider] ?? []) {
      if (!lookup(def.key)) missing.push(def);
    }
  }
  if (command === "watch") {
    for (const def of WATCH_VARS) {
      if (!lookup(def.key)) missing.push(def);
    }
  }
  return missing;
}

function buildConfigFromEnv(
  answers: Record<string, string>,
  command: "watch" | "review",
  options: { interval?: string; stateFile?: string },
): WatcherEnvConfig | BaseEnvConfig {
  const lookup = (key: string) => answers[key] ?? process.env[key];
  const require = (key: string): string => {
    const val = lookup(key);
    if (!val) throw new Error(`Missing required configuration: ${key}`);
    return val;
  };

  const org = require("AZURE_DEVOPS_ORG");
  const pat = require("AZURE_DEVOPS_PAT");
  const provider = require("AI_PROVIDER") as
    | "openai"
    | "anthropic"
    | "azure-openai";

  let ai: AiConfig;
  switch (provider) {
    case "openai":
      ai = {
        provider: "openai",
        apiKey: require("OPENAI_API_KEY"),
        model: lookup("OPENAI_MODEL"),
      };
      break;
    case "anthropic":
      ai = {
        provider: "anthropic",
        apiKey: require("ANTHROPIC_API_KEY"),
        model: lookup("ANTHROPIC_MODEL"),
      };
      break;
    case "azure-openai":
      ai = {
        provider: "azure-openai",
        endpoint: require("AZURE_OPENAI_ENDPOINT"),
        apiKey: require("AZURE_OPENAI_API_KEY"),
        deployment: require("AZURE_OPENAI_DEPLOYMENT"),
        apiVersion: lookup("AZURE_OPENAI_API_VERSION"),
      };
      break;
    default:
      throw new Error(`Unsupported AI_PROVIDER: "${provider}"`);
  }

  const base: BaseEnvConfig = { azureDevOps: { org, pat }, ai };
  if (command === "review") return base;

  const reposRaw = require("WATCH_REPOS");
  const repos: WatchedRepo[] = reposRaw.split(",").map((entry) => {
    const parts = entry.trim().split("/");
    if (parts.length < 2)
      throw new Error(`Invalid WATCH_REPOS entry: "${entry}"`);
    return {
      project: parts[0],
      repoId: parts[1],
      repoName: parts[2] ?? parts[1],
    };
  });

  return {
    ...base,
    repos,
    pollIntervalMs: parseInt(options.interval ?? "30", 10) * 1000,
    stateFilePath: options.stateFile ?? getDefaultStatePath(),
  };
}

// ── Review helpers ──

const PR_URL_REGEX =
  /https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/;
const SEVERITY_CONFIG: Record<
  string,
  { color: string; icon: string; label: string }
> = {
  critical: { color: "#ff4444", icon: "\u26a0", label: "CRITICAL" },
  warning: { color: "#ffaa00", icon: "\u25cf", label: "WARNING" },
  suggestion: { color: "#00aaff", icon: "\u25cb", label: "SUGGEST" },
  nitpick: { color: "#666666", icon: "\u00b7", label: "NITPICK" },
};

// ── Menu items ──

const MENU_ITEMS: SelectItem[] = [
  {
    label: "Watch repositories",
    value: "watch",
    icon: "\u25b6",
    description: "Monitor repos for new PRs",
  },
  {
    label: "Review a PR",
    value: "review",
    icon: "\u2691",
    description: "Paste an Azure DevOps PR URL",
  },
  { label: "Exit", value: "exit", icon: "\u2715", description: "" },
];

// ── Phases ──

type Phase =
  | "menu"
  | "profile-select"
  | "profile-name"
  | "config"
  | "review-url"
  | "reviewing"
  | "review-done"
  | "review-error"
  | "launching-watch";

// ── Single-screen App ──

interface CliAppProps {
  initialCommand?: "watch" | "review";
  initialProfile?: string;
  reviewUrl?: string;
  options: { interval?: string; stateFile?: string };
}

function CliApp({ initialCommand, initialProfile, reviewUrl, options }: CliAppProps) {
  const { exit } = useApp();

  // State
  const [phase, setPhase] = useState<Phase>("menu");
  const [command, setCommand] = useState<"watch" | "review" | null>(
    initialCommand ?? null,
  );
  const [selectedProfile, setSelectedProfile] = useState<string | null>(
    initialProfile ?? null,
  );
  const [configAnswers, setConfigAnswers] = useState<Record<string, string>>(
    {},
  );
  const [missingVars, setMissingVars] = useState<VarDef[]>([]);
  const [configIndex, setConfigIndex] = useState(0);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewStatus, setReviewStatus] = useState("Starting review...");
  const [prInfo, setPrInfo] = useState<{
    prId: number;
    project: string;
    repo: string;
  } | null>(null);
  // Handle q to exit on terminal phases
  useInput((input) => {
    if (
      (phase === "review-done" || phase === "review-error") &&
      input === "q"
    ) {
      exit();
    }
  });

  // ── Transition helpers ──

  const launchWatch = useCallback(
    (answers: Record<string, string>) => {
      setPhase("launching-watch");
      try {
        const config = buildConfigFromEnv(
          answers,
          "watch",
          options,
        ) as WatcherEnvConfig;
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
        console.error(
          "Configuration error:",
          err instanceof Error ? err.message : err,
        );
        exit();
      }
    },
    [options, exit],
  );

  const startReview = useCallback(
    async (prUrl: string, answers: Record<string, string> = {}) => {
      const match = prUrl.match(PR_URL_REGEX);
      if (!match) {
        setReviewError(
          "Invalid Azure DevOps PR URL. Expected: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}",
        );
        setPhase("review-error");
        return;
      }

      const [, , project, repoSlug, prIdStr] = match;
      const prId = parseInt(prIdStr, 10);
      setPrInfo({ prId, project, repo: repoSlug });
      setPhase("reviewing");
      setReviewStatus(`Reviewing PR #${prId} in ${project}/${repoSlug}...`);

      try {
        const config = buildConfigFromEnv(
          answers,
          "review",
          options,
        ) as BaseEnvConfig;
        const logger: Logger = {
          info: (msg) => setReviewStatus(msg),
          warn: (msg) => setReviewStatus(msg),
          error: (msg) => setReviewStatus(msg),
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
        );
        setReviewResult(result);
        setPhase("review-done");
      } catch (err) {
        setReviewError(err instanceof Error ? err.message : String(err));
        setPhase("review-error");
      }
    },
    [options],
  );

  const finishConfig = useCallback(
    (cmd: "watch" | "review", answers: Record<string, string>) => {
      mergeAndSaveConfig(answers, selectedProfile ?? undefined);
      for (const [key, value] of Object.entries(answers)) {
        process.env[key] = value;
      }
      if (cmd === "watch") {
        launchWatch(answers);
      } else {
        if (reviewUrl) {
          startReview(reviewUrl, answers);
        } else {
          setPhase("review-url");
        }
      }
    },
    [selectedProfile, reviewUrl, launchWatch, startReview],
  );

  const proceedWithProfile = useCallback(
    (cmd: "watch" | "review", profileName: string) => {
      setActiveProfile(profileName);
      setSelectedProfile(profileName);

      const saved = loadSavedConfig(profileName);
      const preAnswers: Record<string, string> = {};
      for (const [key, value] of Object.entries(saved)) {
        if (value) preAnswers[key] = value;
      }
      const missing = detectMissingVars(cmd, preAnswers, saved);
      if (missing.length === 0) {
        finishConfig(cmd, preAnswers);
        return;
      }
      setMissingVars(missing);
      setConfigIndex(0);
      setConfigAnswers(preAnswers);
      setPhase("config");
    },
    [finishConfig],
  );

  const startConfig = useCallback(
    (cmd: "watch" | "review") => {
      dotenv.config();
      setCommand(cmd);

      if (initialProfile) {
        proceedWithProfile(cmd, initialProfile);
        return;
      }

      setPhase("profile-select");
    },
    [initialProfile, proceedWithProfile],
  );

  // ── Init: if a command was passed directly, skip menu ──
  useEffect(() => {
    if (initialCommand) {
      dotenv.config();
      startConfig(initialCommand);
    }
  }, []);

  // ── Config: handle when all vars are answered ──

  const handleConfigAnswer = useCallback(
    (value: string) => {
      const currentVar = missingVars[configIndex];
      const updated = { ...configAnswers, [currentVar.key]: value };
      setConfigAnswers(updated);

      const nextIndex = configIndex + 1;

      // Check if we need more provider-specific vars after AI_PROVIDER is answered
      if (currentVar.key === "AI_PROVIDER") {
        const providerVars = PROVIDER_VARS[value] ?? [];
        const lookup = (key: string) => updated[key] ?? process.env[key];
        const newMissing = providerVars.filter((def) => !lookup(def.key));
        if (newMissing.length > 0) {
          // Insert provider vars (e.g. API key) after AI_PROVIDER, before WATCH_REPOS
          const updatedVars = [
            ...missingVars.slice(0, nextIndex),
            ...newMissing,
            ...missingVars.slice(nextIndex),
          ];
          setMissingVars(updatedVars);
          setConfigIndex(nextIndex);
          return;
        }
      }

      if (nextIndex >= missingVars.length) {
        // All done
        finishConfig(command!, updated);
      } else {
        setConfigIndex(nextIndex);
      }
    },
    [missingVars, configIndex, configAnswers, command, finishConfig],
  );

  // ── Render ──

  return (
    <Box flexDirection="column">
      {/* Banner — always shown */}
      <Banner />

      {/* Phase: Menu */}
      {phase === "menu" && (
        <SelectInput
          items={MENU_ITEMS}
          onSelect={(item) => {
            if (item.value === "exit") {
              exit();
              return;
            }
            const cmd = item.value as "watch" | "review";
            setCommand(cmd);
            startConfig(cmd);
          }}
        />
      )}

      {/* Phase: Profile select */}
      {phase === 'profile-select' && (
        <Box flexDirection="column" paddingX={1}>
          <Box marginBottom={1}>
            <Text color="#00d4ff" bold>{'\u2630'} Select Profile</Text>
          </Box>
          <SelectInput
            items={[
              ...listProfiles().map((p) => ({
                label: p === getActiveProfile() ? `${p} (active)` : p,
                value: p,
              })),
              { label: '+ Create new profile', value: '__new__' },
            ]}
            onSelect={(item) => {
              if (item.value === '__new__') {
                setPhase('profile-name');
              } else {
                proceedWithProfile(command!, item.value);
              }
            }}
          />
        </Box>
      )}

      {/* Phase: Profile name input */}
      {phase === 'profile-name' && (
        <Box flexDirection="column" paddingX={1}>
          <Box marginBottom={1}>
            <Text color="#00d4ff" bold>{'\u2630'} New Profile</Text>
          </Box>
          <TextInput
            label="Profile name"
            onSubmit={(name) => {
              try {
                createProfile(name);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes("already exists")) {
                  proceedWithProfile(command!, name);
                  return;
                }
                setReviewError(msg);
                setPhase("review-error");
                return;
              }
              proceedWithProfile(command!, name);
            }}
          />
        </Box>
      )}

      {/* Phase: Config form */}
      {phase === "config" && missingVars.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          <Box marginBottom={1} gap={1}>
            <Text color="#00d4ff" bold>
              {"\u2699"} Configuration
            </Text>
            <Text color="#555555">
              [{configIndex + 1}/{missingVars.length}]
            </Text>
          </Box>

          {/* Progress bar */}
          <Box marginBottom={1}>
            <Text color="#00d4ff">{"\u2588".repeat(configIndex)}</Text>
            <Text color="#333333">
              {"\u2591".repeat(missingVars.length - configIndex)}
            </Text>
          </Box>

          {/* Completed fields */}
          {missingVars.slice(0, configIndex).map((def) => (
            <Box key={def.key} gap={1}>
              <Text color="#00ff88">{"\u2713"}</Text>
              <Text color="#666666">{def.label}:</Text>
              <Text color="#888888">
                {def.type === "secret"
                  ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                  : configAnswers[def.key]}
              </Text>
            </Box>
          ))}

          {/* Current field */}
          {missingVars[configIndex] && (
            <Box marginTop={configIndex > 0 ? 1 : 0}>
              {missingVars[configIndex].type === "select" ? (
                <SelectInput
                  items={(missingVars[configIndex].choices ?? []).map((c) => ({
                    label: c,
                    value: c,
                  }))}
                  onSelect={(item) => handleConfigAnswer(item.value)}
                />
              ) : (
                <TextInput
                  label={missingVars[configIndex].label}
                  hint={missingVars[configIndex].hint}
                  mask={missingVars[configIndex].type === "secret"}
                  onSubmit={handleConfigAnswer}
                />
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Phase: Review URL input */}
      {phase === "review-url" && (
        <Box flexDirection="column" paddingX={1}>
          <Box marginBottom={1}>
            <Text color="#00d4ff" bold>
              {"\u2691"} Review a Pull Request
            </Text>
          </Box>
          <TextInput
            label="PR URL"
            hint="https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}"
            onSubmit={(value) => {
              startReview(value, configAnswers);
            }}
          />
        </Box>
      )}

      {/* Phase: Reviewing */}
      {phase === "reviewing" && (
        <Box flexDirection="column" paddingX={1}>
          <Box marginBottom={1}>
            <Text color="#00d4ff" bold>
              {"\u2691"} Review in Progress
            </Text>
          </Box>
          {prInfo && (
            <Box gap={1}>
              <Text color="#888888">PR</Text>
              <Text color="white" bold>
                #{prInfo.prId}
              </Text>
              <Text color="#555555">in</Text>
              <Text color="#00d4ff">
                {prInfo.project}/{prInfo.repo}
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Spinner label={reviewStatus} showDots />
          </Box>
        </Box>
      )}

      {/* Phase: Review error */}
      {phase === "review-error" && (
        <Box flexDirection="column" paddingX={1}>
          <Box
            borderStyle="round"
            borderColor="#ff4444"
            paddingX={1}
            flexDirection="column"
          >
            <Text bold color="#ff4444">
              {"\u2717"} Review Failed
            </Text>
            <Box marginTop={1}>
              <Text color="#ff8888" wrap="wrap">
                {reviewError}
              </Text>
            </Box>
          </Box>
          <Box marginTop={1} gap={2}>
            <Text color="#555555">Press</Text>
            <Text color="#00d4ff" bold>
              q
            </Text>
            <Text color="#555555">to exit</Text>
          </Box>
        </Box>
      )}

      {/* Phase: Review complete */}
      {phase === "review-done" && reviewResult && (
        <Box flexDirection="column" paddingX={1}>
          {/* Header */}
          <Box borderStyle="round" borderColor="#00d4ff" paddingX={1}>
            <Box gap={1}>
              <Text color="#00d4ff" bold>
                {"\u2713"} Review Complete
              </Text>
              {prInfo && (
                <Text color="#555555">
                  {"\u2502"} PR #{prInfo.prId} in {prInfo.project}/{prInfo.repo}
                </Text>
              )}
            </Box>
          </Box>

          {/* Comments */}
          <Box flexDirection="column" marginTop={1}>
            <Box gap={1} marginBottom={1}>
              <Text color="white" bold>
                Comments
              </Text>
              <Text color="#555555">({reviewResult.comments.length})</Text>
            </Box>
            {reviewResult.comments.length === 0 ? (
              <Box gap={1}>
                <Text color="#00ff88">{"\u2713"}</Text>
                <Text color="#00ff88">No issues found. Code looks good!</Text>
              </Box>
            ) : (
              reviewResult.comments.map((comment, i) => (
                <CommentRow key={i} comment={comment} />
              ))
            )}
          </Box>

          {/* Footer */}
          <Box
            marginTop={1}
            borderStyle="round"
            borderColor="#333333"
            paddingX={1}
            gap={2}
          >
            <Text color="#555555">Press</Text>
            <Text color="#00d4ff" bold>
              q
            </Text>
            <Text color="#555555">to exit</Text>
          </Box>
        </Box>
      )}

      {/* Phase: Launching watch */}
      {phase === "launching-watch" && (
        <Box paddingX={1} gap={1}>
          <Spinner label="Launching watcher" showDots />
        </Box>
      )}
    </Box>
  );
}

// ── Comment row ──

function CommentRow({ comment }: { comment: ReviewComment }) {
  const config = SEVERITY_CONFIG[comment.severity] ?? {
    color: "#888888",
    icon: "\u25cb",
    label: comment.severity.toUpperCase(),
  };

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1}>
      <Box gap={1}>
        <Text color={config.color} bold>
          {config.icon} {config.label}
        </Text>
        <Text color="#00d4ff">{comment.filePath}</Text>
        <Text color="#555555">:{comment.lineNumber}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text wrap="wrap" color="#cccccc">
          {comment.message}
        </Text>
      </Box>
    </Box>
  );
}

// ── Entry ──

export function startCliApp(opts: {
  command?: "watch" | "review";
  reviewUrl?: string;
  profile?: string;
  options: { interval?: string; stateFile?: string };
}): void {
  if (opts.profile && !profileExists(opts.profile)) {
    try {
      createProfile(opts.profile);
      setActiveProfile(opts.profile);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
  render(
    <CliApp
      initialCommand={opts.command}
      initialProfile={opts.profile}
      reviewUrl={opts.reviewUrl}
      options={opts.options}
    />,
  );
}
