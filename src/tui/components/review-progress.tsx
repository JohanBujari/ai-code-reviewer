import React from 'react';
import { Box, Text } from 'ink';
import type { ReviewJob } from '../../watcher/types';

interface ReviewProgressProps {
  current?: ReviewJob;
  fileProgress?: {
    filePath: string;
    fileIndex: number;
    totalFiles: number;
  };
}

function progressBar(current: number, total: number, width: number): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

export function ReviewProgress({ current, fileProgress }: ReviewProgressProps) {
  if (!current) return null;

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold underline>
        Review Progress
      </Text>
      <Text>
        PR #{current.prId}: {current.prTitle}
      </Text>
      <Text dimColor>
        Repo: {current.repo.project}/{current.repo.repoName}
      </Text>
      {fileProgress && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            File {fileProgress.fileIndex + 1}/{fileProgress.totalFiles}:{' '}
            <Text color="cyan">{fileProgress.filePath}</Text>
          </Text>
          <Text color="green">
            [{progressBar(fileProgress.fileIndex + 1, fileProgress.totalFiles, 20)}]{' '}
            {Math.round(((fileProgress.fileIndex + 1) / fileProgress.totalFiles) * 100)}%
          </Text>
        </Box>
      )}
    </Box>
  );
}
