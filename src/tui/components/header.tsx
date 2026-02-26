import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  status: 'watching' | 'paused' | 'shutting-down';
  startedAt: number;
  lastPollAt?: number;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

export function Header({ status, startedAt, lastPollAt }: HeaderProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const statusColor = status === 'watching' ? 'green' : status === 'paused' ? 'yellow' : 'red';
  const statusLabel = status.toUpperCase();

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          PR Agent Watcher
        </Text>
        <Box gap={2}>
          <Text dimColor>Uptime: {formatUptime(Date.now() - startedAt)}</Text>
          <Text color={statusColor} bold>
            [{statusLabel}]
          </Text>
        </Box>
      </Box>
      {lastPollAt && (
        <Text dimColor>Last poll: {formatAgo(lastPollAt)}</Text>
      )}
    </Box>
  );
}
