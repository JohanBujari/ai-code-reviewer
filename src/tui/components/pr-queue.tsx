import React from 'react';
import { Box, Text } from 'ink';
import type { ReviewJob } from '../../watcher/types';
import { formatDuration, truncate } from '../../shared/format';

interface PrQueueProps {
  pending: ReviewJob[];
  current?: ReviewJob;
  completed: ReviewJob[];
}

function statusIcon(job: ReviewJob): string {
  switch (job.status) {
    case 'completed':
      return '\u2713';
    case 'failed':
      return '\u2717';
    case 'in-progress':
      return '\u25CB';
    case 'queued':
      return '\u2022';
  }
}

function statusColor(job: ReviewJob): string {
  switch (job.status) {
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'in-progress':
      return 'yellow';
    case 'queued':
      return 'gray';
  }
}

function formatJobDuration(start: number, end?: number): string {
  return formatDuration((end ?? Date.now()) - start);
}

export function PrQueue({ pending, current, completed }: PrQueueProps) {
  const recentCompleted = completed.slice(0, 5);

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold underline>
        Review Queue
      </Text>

      {current && (
        <Box marginTop={1}>
          <Text color="yellow" bold>
            {statusIcon(current)} PR #{current.prId}:{' '}
          </Text>
          <Text>{truncate(current.prTitle, 50)}</Text>
          <Text dimColor> ({formatJobDuration(current.startedAt ?? current.queuedAt)})</Text>
        </Box>
      )}

      {pending.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Queued ({pending.length}):</Text>
          {pending.slice(0, 5).map((job) => (
            <Text key={job.id} color="gray">
              {'  '}{statusIcon(job)} PR #{job.prId}: {truncate(job.prTitle, 45)}
            </Text>
          ))}
          {pending.length > 5 && (
            <Text dimColor>  ... and {pending.length - 5} more</Text>
          )}
        </Box>
      )}

      {recentCompleted.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Recent:</Text>
          {recentCompleted.map((job) => (
            <Text key={job.id} color={statusColor(job)}>
              {'  '}{statusIcon(job)} PR #{job.prId}: {truncate(job.prTitle, 35)}
              {job.status === 'completed' && (
                <Text dimColor> ({job.commentsPosted ?? 0} comments)</Text>
              )}
              {job.status === 'failed' && (
                <Text color="red" dimColor> (failed)</Text>
              )}
            </Text>
          ))}
        </Box>
      )}

      {!current && pending.length === 0 && completed.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No reviews yet. Waiting for PRs...</Text>
        </Box>
      )}
    </Box>
  );
}

