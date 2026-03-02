import React from 'react';
import { Box, Text } from 'ink';

const LOGO_LINES = [
  '     _          _                 ',
  '    / \\   __  _(_) ___  _ __ ___  ',
  '   / _ \\  \\ \\/ / |/ _ \\| \'_ ` _ \\ ',
  '  / ___ \\  >  <| | (_) | | | | | |',
  ' /_/   \\_\\/_/\\_\\_|\\___/|_| |_| |_|',
];

const GRADIENT: string[] = ['#00d4ff', '#00b8e6', '#009dcc', '#0081b3', '#006699'];

interface BannerProps {
  version?: string;
}

export function Banner({ version = '1.1.0' }: BannerProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#00d4ff" paddingX={2} paddingY={1} marginBottom={1}>
      {/* Logo with gradient lines */}
      <Box flexDirection="column" alignItems="center">
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color={GRADIENT[i]} bold>
            {line}
          </Text>
        ))}
      </Box>

      {/* Tagline */}
      <Box justifyContent="center" marginTop={1}>
        <Text color="#888888">{'  '}~</Text>
        <Text color="white" bold> AI-Powered Code Review </Text>
        <Text color="#888888">~{'  '}</Text>
      </Box>

      {/* Version + divider */}
      <Box justifyContent="center">
        <Text dimColor>v{version}</Text>
      </Box>
    </Box>
  );
}
