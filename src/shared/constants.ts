/** Key files that reveal project conventions and tech stack */
export const PROJECT_CONTEXT_FILES = [
  '/README.md',
  '/package.json',
  '/tsconfig.json',
  '/pyproject.toml',
  '/requirements.txt',
  '/.eslintrc.json',
  '/.eslintrc.js',
  '/biome.json',
  '/Cargo.toml',
  '/go.mod',
  '/pom.xml',
  '/build.gradle',
  '/Makefile',
  '/Dockerfile',
  '/docker-compose.yml',
];

/** Directories to skip when scanning repository trees */
export const SKIP_DIRS = [
  '/node_modules',
  '/dist',
  '/.git',
  '/vendor',
  '/__pycache__',
  '/build',
  '/.next',
];

export interface SeverityStyle {
  emoji: string;
  icon: string;
  color: string;
  label: string;
}

/** Unified severity styles used across the reviewer and TUI */
export const SEVERITY_STYLES: Record<string, SeverityStyle> = {
  critical: { emoji: '🔴', icon: '\u26a0', color: '#ff4444', label: 'CRITICAL' },
  warning: { emoji: '🟡', icon: '\u25cf', color: '#ffaa00', label: 'WARNING' },
  suggestion: { emoji: '🔵', icon: '\u25cb', color: '#00aaff', label: 'SUGGEST' },
  nitpick: { emoji: '⚪', icon: '\u00b7', color: '#666666', label: 'NITPICK' },
};

/** Maximum lines to snap a misaligned comment to the nearest changed line */
export const COMMENT_SNAP_DISTANCE = 3;

/** Maximum entries in the deduplication map before cleanup */
export const MAX_DEDUP_ENTRIES = 1000;

/** Maximum items to show in a repository tree view (reviewer context) */
export const MAX_TREE_VIEW_ITEMS = 150;

/** Maximum characters for config file content in reviewer context */
export const MAX_CONFIG_FILE_CHARS = 3_000;

/** Maximum items to show in a repository tree view (AI tool) */
export const MAX_TOOL_TREE_VIEW_ITEMS = 200;

/** Maximum characters for config file content in AI tools */
export const MAX_TOOL_CONFIG_FILE_CHARS = 5_000;

/** Maximum characters for diff/file content in AI tools */
export const MAX_TOOL_CONTENT_CHARS = 30_000;

/** Maximum PR threads to return from AI tools */
export const MAX_PR_THREADS_RETURNED = 20;

/** Maximum commits to return in file history */
export const MAX_FILE_HISTORY_COMMITS = 10;

/** Maximum context lines for surrounding context tool */
export const MAX_CONTEXT_LINES = 50;
