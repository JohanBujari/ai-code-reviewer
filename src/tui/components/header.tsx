import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { formatDuration, formatTimeAgo } from '../../shared/format';
import { THEME } from '../../shared/theme';

interface HeaderProps {
  status: 'watching' | 'paused' | 'shutting-down';
  startedAt: number;
  lastPollAt?: number;
}

const STATUS_CONFIG = {
  watching: { dot: '\u25cf', color: THEME.success, label: 'WATCHING' },
  paused: { dot: '\u25cf', color: THEME.warning, label: 'PAUSED' },
  'shutting-down': { dot: '\u25cf', color: THEME.error, label: 'STOPPING' },
} as const;

export function Header({ status, startedAt, lastPollAt }: HeaderProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const { dot, color, label } = STATUS_CONFIG[status];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={THEME.primary} paddingX={1}>
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text bold color={THEME.primary}>Axiom</Text>
          <Text color={THEME.textDimmer}>{'\u2502'}</Text>
          <Text color={color}>{dot} {label}</Text>
        </Box>
        <Box gap={2}>
          <Text color={THEME.textDimmer}>{'\u23f1'} {formatDuration(Date.now() - startedAt)}</Text>
          {lastPollAt && (
            <>
              <Text color={THEME.border}>{'\u2502'}</Text>
              <Text color={THEME.textDimmer}>Polled {formatTimeAgo(lastPollAt)}</Text>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
