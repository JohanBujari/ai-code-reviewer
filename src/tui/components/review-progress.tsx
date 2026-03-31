import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { ReviewJob } from '../../watcher/types';
import { THEME } from '../../shared/theme';

interface ReviewProgressProps {
  current?: ReviewJob;
  stage?: {
    label: string;
    detail?: string;
    updatedAt: number;
  };
  fileProgress?: {
    filePath: string;
    fileIndex: number;
    totalFiles: number;
  };
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return SPINNER_FRAMES[frame]!;
}

function useElapsed(startedAt?: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return '0s';
  const s = Math.floor((now - startedAt) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function progressBar(current: number, total: number, width: number): string {
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = '━'.repeat(filled) + '╌'.repeat(empty);
  return bar;
}

export function ReviewProgress({ current, stage, fileProgress }: ReviewProgressProps) {
  if (!current) return null;

  const spinner = useSpinner();
  const elapsed = useElapsed(current.startedAt ?? current.queuedAt);
  const stageElapsed = useElapsed(stage?.updatedAt);
  const stageLabel = stage?.label ?? 'Review in progress';
  const stageDetail = stage?.detail;

  const pct = fileProgress
    ? Math.round(((fileProgress.fileIndex + 1) / fileProgress.totalFiles) * 100)
    : 0;

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold underline>
        Review Progress
      </Text>

      <Box marginTop={1} gap={1}>
        <Text color={THEME.primary} bold>
          PR #{current.prId}
        </Text>
        <Text>{current.prTitle}</Text>
      </Box>
      <Box gap={1}>
        <Text dimColor>
          {current.repo.project}/{current.repo.repoName}
        </Text>
        <Text color={THEME.textMuted}>•</Text>
        <Text color={THEME.textSecondary}>{elapsed}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color={THEME.primary}>{spinner}</Text>
          <Text color={THEME.textDim}>{stageLabel}</Text>
        </Box>
        {(stageDetail || stage) && (
          <Box marginLeft={2} gap={1}>
            {stageDetail ? <Text color={THEME.textSecondary}>{stageDetail}</Text> : null}
            {stage ? <Text color={THEME.textMuted}>({stageElapsed} in this step)</Text> : null}
          </Box>
        )}
      </Box>

      {fileProgress && (
        <Box flexDirection="column" marginTop={1}>
          <Box marginLeft={2}>
            <Text color="cyan">{fileProgress.filePath}</Text>
          </Box>
          <Box marginTop={1} gap={1}>
            <Text>{'  '}</Text>
            <Text color={pct === 100 ? THEME.success : THEME.primary}>
              {progressBar(fileProgress.fileIndex + 1, fileProgress.totalFiles, 20)}
            </Text>
            <Text color={pct === 100 ? THEME.success : THEME.textSecondary} bold>
              {pct}%
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
