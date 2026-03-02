import React from 'react';
import { Box, Text } from 'ink';

const ASCII_ART = `
     _          _
    / \\   __  _(_) ___  _ __ ___
   / _ \\  \\ \\/ / |/ _ \\| '_ \` _ \\
  / ___ \\  >  <| | (_) | | | | | |
 /_/   \\_\\/_/\\_\\_|\\___/|_| |_| |_|
`.trimEnd();

interface BannerProps {
  version?: string;
}

export function Banner({ version = '1.1.0' }: BannerProps) {
  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text color="cyan" bold>
        {ASCII_ART}
      </Text>
      <Box justifyContent="center" marginTop={1}>
        <Text color="white" bold>
          AI-powered Azure DevOps PR Reviewer
        </Text>
        <Text dimColor> v{version}</Text>
      </Box>
      <Box justifyContent="center">
        <Text dimColor>
          ────────────────────────────────────────
        </Text>
      </Box>
    </Box>
  );
}
