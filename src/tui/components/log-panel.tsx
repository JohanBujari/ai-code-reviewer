import React from 'react';
import { Box, Text } from 'ink';

interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface LogPanelProps {
  logs: LogEntry[];
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour12: false });
}

function levelColor(level: string): string {
  switch (level) {
    case 'error':
      return 'red';
    case 'warn':
      return 'yellow';
    default:
      return 'white';
  }
}

function levelLabel(level: string): string {
  switch (level) {
    case 'error':
      return 'ERR';
    case 'warn':
      return 'WRN';
    default:
      return 'INF';
  }
}

const MAX_VISIBLE = 20;

export function LogPanel({ logs }: LogPanelProps) {
  const visibleLogs = logs.slice(-MAX_VISIBLE);

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold underline>
        Logs ({logs.length})
      </Text>
      {visibleLogs.length === 0 ? (
        <Text dimColor>No logs yet.</Text>
      ) : (
        visibleLogs.map((log, i) => (
          <Text key={`${log.timestamp}-${i}`} color={levelColor(log.level)} wrap="wrap">
            <Text dimColor>{formatTime(log.timestamp)}</Text>{' '}
            <Text bold>[{levelLabel(log.level)}]</Text>{' '}
            {log.message}
          </Text>
        ))
      )}
    </Box>
  );
}
