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

const STATUS_CONFIG = {
  watching: { dot: '\u25cf', color: '#00ff88', label: 'WATCHING' },
  paused: { dot: '\u25cf', color: '#ffaa00', label: 'PAUSED' },
  'shutting-down': { dot: '\u25cf', color: '#ff4444', label: 'STOPPING' },
} as const;

export function Header({ status, startedAt, lastPollAt }: HeaderProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const { dot, color, label } = STATUS_CONFIG[status];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#00d4ff" paddingX={1}>
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text bold color="#00d4ff">Axiom</Text>
          <Text color="#555555">{'\u2502'}</Text>
          <Text color={color}>{dot} {label}</Text>
        </Box>
        <Box gap={2}>
          <Text color="#555555">{'\u23f1'} {formatUptime(Date.now() - startedAt)}</Text>
          {lastPollAt && (
            <>
              <Text color="#333333">{'\u2502'}</Text>
              <Text color="#555555">Polled {formatAgo(lastPollAt)}</Text>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
